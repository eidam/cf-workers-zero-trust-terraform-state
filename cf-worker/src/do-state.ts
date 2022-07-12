import { getDecryptedKV, putEncryptedKV } from "encrypt-workers-kv";
import { Router } from "itty-router";
import { responseHeaders, stateConfig } from "./main";
import { Env } from "./types";
import { bytesToSize, getDoStub } from "./utils";

const stateKeyPrefix = "state::";
const stateKeyCurrentVersion = "version::current";
const stateKeyCurrentLock = "lock::current";
const maxVersions = 1000

type stateMetadata = {
  id: string;
  size: string;
  created_at: string;
  path: string;
  jwt: any;
  terraform: any,
  kv_key: string;
  kv_key_encrypt_password?: string;
};

type lock = {
  ID: string;
  Operation: string;
  Info: string;
  Who: string;
  Created: string;
  Path: string;
};

export class TerraformStateDurableObject {
  state: DurableObjectState;
  storage: DurableObjectStorage;
  env: Env;

  router: Router<any>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.storage = state.storage;
    this.env = env;

    const router = Router();
    router.get("/", (req) => this.listStateVersions());
    router.get("*", (req) => this.getStateVersion());
    router.post("*", (req) => this.createStateVersion(req));
    router.patch("*", (req) => this.setStateVersion(req));
    router.delete("*", (req) => this.deleteStateVersions(req));
    router.lock("*", (req) => this.lockState(req));
    router.unlock("*", (req) => this.unlockState());
    router.delete("*", (req) => this.unlockState()); // just temp to avoid gitlab deleting states

    router.all(
      "*",
      (req) => new Response(null, { status: 400, ...responseHeaders })
    );

    this.router = router;
  }

  async fetch(req: Request) {
    try {
      return this.router.handle(req);
    } catch (e) {
      return new Response(null, { status: 500 });
    }
  }

  async listStateVersions() {
    const versions = await this.getSortedVersions()

    return new Response(
      JSON.stringify({
        lock: (await this.storage.get(stateKeyCurrentLock)) || {},
        current: await this.storage.get(stateKeyCurrentVersion),
        issuers: stateConfig.issuers.reduce((obj, item) => (obj[item.id] = item, obj) ,{}),
        versions,
      }),
      { status: 200, ...responseHeaders }
    );
  }

  async getStateVersion(version = undefined) {
    // get specific or current version
    const stateVersion = version
      ? version
      : await this.storage.get(stateKeyCurrentVersion);
    const stateVersionMetadata = (await this.storage.get(
      `${stateKeyPrefix}${stateVersion}`
    )) as stateMetadata;
    if (!stateVersionMetadata) {
      return new Response(null, { status: 404, ...responseHeaders });
    }

    let state = await getDecryptedKV(this.env.KV_TF_STATE, stateVersionMetadata.kv_key, stateVersionMetadata.kv_key_encrypt_password)

    if (!state) {
      // this should not happen
      return new Response(null, { status: 500, ...responseHeaders });
    }

    return new Response(state, { status: 200, ...responseHeaders });
  }

  async createStateVersion(req) {
    const { pathname } = new URL(req.url);
    const { bodyText: state, jwt } = await req.json();
    const parsedState = JSON.parse(state)
    const version = crypto.randomUUID();
    const encryptPassword = crypto.randomUUID();

    if (!state)
      return new Response(
        JSON.stringify({ error: "missing state in the request body" }),
        { status: 400 }
      );

    const metadata: stateMetadata = {
      id: version,
      size: bytesToSize(new TextEncoder().encode(state).length),
      created_at: new Date().toISOString(),
      path: pathname,
      terraform: {
        version: parsedState.terraform_version,
      },
      jwt: {
        issuer_id: jwt.issuer?.id,
        payload: jwt.payload,
      },
      kv_key: `${stateKeyPrefix}${pathname}::${version}`,
    };

    await putEncryptedKV(this.env.KV_TF_STATE, metadata.kv_key, state, encryptPassword)

    await this.storage.put(`${stateKeyPrefix}${version}`, {...metadata, kv_key_encrypt_password: encryptPassword });
    await this.storage.put(stateKeyCurrentVersion, version);

    await this.registerState(pathname);

    return new Response(state, { status: 200, ...responseHeaders });
  }

  async setStateVersion(req) {
    const { bodyText: newVersion, jwt } = await req.json();

    if (!newVersion)
      return new Response(
        JSON.stringify({ error: "missing version in the request body" }),
        { status: 400 }
      );

    // require manual lock to be set
    const lock = (await this.storage.get(stateKeyCurrentLock)) as lock;
    if (!lock || (lock && lock.Operation !== "OperationTypeManual")) {
      return new Response(
        JSON.stringify({
          error:
            "switching state versions requires lock with OperationTypeManual type",
        }),
        { status: 400 }
      );
    }

    const newVersionMetadata: stateMetadata = await this.storage.get(
      `${stateKeyPrefix}${newVersion}`
    );

    if (!newVersionMetadata)
      return new Response(null, { status: 404, ...responseHeaders });

    await this.storage.put(stateKeyCurrentVersion, newVersion);

    return new Response(null, { status: 200, ...responseHeaders });
  }

  async deleteStateVersions(req) {
    // TODO lock the state while performing cleanup
    const versions = await this.getSortedVersions(true)
    const currentVersion = await this.storage.get(stateKeyCurrentVersion)

    versions.slice(maxVersions).forEach(async (value: stateMetadata, key) => {
      if (currentVersion !== value.id) {
        await this.env.KV_TF_STATE.delete(value.kv_key);
        await this.storage.delete(`${stateKeyPrefix}${value.id}`)
      }
    });

    return new Response(null, { status: 200, ...responseHeaders });
  }

  async lockState(req) {
    const params = new URL(req.url).searchParams;
    const { bodyText: reqLockText, jwt } = await req.json();
    const reqLock = JSON.parse(reqLockText);
    const operation = params.get("operation");

    const lock = {
      ID: reqLock.ID || crypto.randomUUID(),
      Operation: operation || reqLock.Operation,
      Info: reqLock.Info || "",
      Who: reqLock.Who,
      Created: new Date().toISOString(),
      Path: "",
      jwt: {
        issuer_id: jwt.issuer.id,
        payload: jwt.payload,
      },
    };

    const currentLock = (await this.storage.get(stateKeyCurrentLock)) as lock;
    if (currentLock) {
      return new Response(JSON.stringify(currentLock), {
        status: 423,
        ...responseHeaders,
      });
    }

    await this.storage.put(stateKeyCurrentLock, lock);
    return new Response(JSON.stringify(lock), {
      status: 200,
      ...responseHeaders,
    });
  }

  async unlockState() {
    await this.storage.delete(stateKeyCurrentLock);
    return new Response(JSON.stringify({ok: true}), { status: 200, ...responseHeaders });
  }

  async registerState(pathname) {
    const stub = getDoStub(this.env, "/");
    return stub.fetch(`https://fake.host${pathname}`, {
      method: "POST",
    });
  }

  async getSortedVersions(getAllMetadata = false) {
    const versionsMap = await this.storage.list({
      prefix: stateKeyPrefix,
    });

    return Array.from(versionsMap, ([name, value]) => {
      const metadata = value as stateMetadata;
      return getAllMetadata ? metadata : {
        id: metadata.id,
        created_at: metadata.created_at,
        size: metadata.size,
        jwt: metadata.jwt,
        terraform: metadata.terraform,
      };
    }).sort((a, b) => (a.created_at >= b.created_at ? -1 : 1));
  }
}
