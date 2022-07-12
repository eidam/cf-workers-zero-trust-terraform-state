import { Router } from "itty-router";
import { responseHeaders } from "./main";
import { Env } from "./types";

export class TerraformStateIndexDurableObject {
  state: DurableObjectState;
  storage: DurableObjectStorage;
  env: Env;

  router: Router<any>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.storage = state.storage;
    this.env = env;

    const router = Router();
    router.get("/", (req) => this.listStates());
    router.post("*", (req) => this.createState(req));

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

  async listStates() {
    const statesMap = await this.storage.list();

    return new Response(JSON.stringify(Array.from(statesMap.keys())), {
      status: 200,
      ...responseHeaders,
    });
  }

  async createState(req) {
    const { pathname } = new URL(req.url);
    await this.storage.put(pathname, null);
    return new Response(null, { status: 200, ...responseHeaders });
  }
}
