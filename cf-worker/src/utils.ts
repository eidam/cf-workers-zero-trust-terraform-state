import jwt_decode, { JwtHeader, JwtPayload } from "jwt-decode";
import { base64url } from "rfc4648";
import UrlPattern = require("url-pattern");
import { stateConfig } from "./main";
import { Jwt } from "./types";

const scopeOperations = {
  write: ["list", "read", "write"],
  read: ["list", "read"],
  list: ["list"],
};

const requestHeaders = {
  accept: "application/json",
  "user-agent": "terraform-state/oidc-client",
};

export const getDoStub = (env, pathname = "/") => {
  // pathname / is routed to the index DO
  if (pathname === "/") {
    const doId = env.DO_TF_STATE_INDEX.idFromName("index");
    return env.DO_TF_STATE_INDEX.get(doId);
  } else {
    const doId = env.DO_TF_STATE.idFromName(pathname);
    return env.DO_TF_STATE.get(doId);
  }
};

/**
 * Constructs a ULID generator closure that emits universally unique,
 * monotonic values.
 *
 * let generator = ULID();
 * let ulid0 = generator();
 * let ulid1 = generator();
 * assert(ulid0 < ulid1);
 */
export default function ulid(): string {
  const BASE32 = [
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "J",
    "K",
    "M",
    "N",
    "P",
    "Q",
    "R",
    "S",
    "T",
    "V",
    "W",
    "X",
    "Y",
    "Z",
  ];
  let last = -1;
  /* Pre-allocate work buffers / views */
  let ulid = new Uint8Array(16);
  let time = new DataView(ulid.buffer, 0, 6);
  let rand = new Uint8Array(ulid.buffer, 6, 10);
  let dest = new Array(26);

  function encode(ulid) {
    dest[0] = BASE32[ulid[0] >> 5];
    dest[1] = BASE32[(ulid[0] >> 0) & 0x1f];
    for (let i = 0; i < 3; i++) {
      dest[i * 8 + 2] = BASE32[ulid[i * 5 + 1] >> 3];
      dest[i * 8 + 3] =
        BASE32[((ulid[i * 5 + 1] << 2) | (ulid[i * 5 + 2] >> 6)) & 0x1f];
      dest[i * 8 + 4] = BASE32[(ulid[i * 5 + 2] >> 1) & 0x1f];
      dest[i * 8 + 5] =
        BASE32[((ulid[i * 5 + 2] << 4) | (ulid[i * 5 + 3] >> 4)) & 0x1f];
      dest[i * 8 + 6] =
        BASE32[((ulid[i * 5 + 3] << 1) | (ulid[i * 5 + 4] >> 7)) & 0x1f];
      dest[i * 8 + 7] = BASE32[(ulid[i * 5 + 4] >> 2) & 0x1f];
      dest[i * 8 + 8] =
        BASE32[((ulid[i * 5 + 4] << 3) | (ulid[i * 5 + 5] >> 5)) & 0x1f];
      dest[i * 8 + 9] = BASE32[(ulid[i * 5 + 5] >> 0) & 0x1f];
    }
    return dest.join("");
  }

  let now = Date.now();
  if (now === last) {
    /* 80-bit overflow is so incredibly unlikely that it's not
     * considered as a possiblity here.
     */
    for (let i = 9; i >= 0; i--) if (rand[i]++ < 255) break;
  } else {
    last = now;
    time.setUint16(0, (now / 4294967296.0) | 0);
    time.setUint32(2, now | 0);
    self.crypto.getRandomValues(rand);
  }
  return encode(ulid);
}

export function bytesToSize(bytes) {
  var sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  if (bytes == 0) return "0 Byte";
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i)) + " " + sizes[i];
}

// Verify Cloudflare Access JWT
export const verifyJwt = async (jwtToken, env) => {
  try {
    const header = jwt_decode(jwtToken, { header: true }) as JwtHeader & {
      kid: string;
    };
    const payload = jwt_decode(jwtToken) as JwtPayload & Jwt["claims"];

    const issuerConfig = stateConfig.issuers.find((x) => x.iss === payload.iss);
    if (!issuerConfig) {
      throw "JWT token issuer is not configured";
    }

    const currentTime = Math.floor(Date.now() / 1000);
    if (payload.exp < currentTime) throw "JWT token is expired";
    if (payload.iat > currentTime) throw "JWT token issued in the future";
    if (payload.nbf > currentTime) throw "JWT token is not valid yet";

    const jwk = await getIssuerJwk(issuerConfig, payload.iss, header.kid, env);
    const verified = await verifyJwtSignature(jwtToken, jwk);
    if (!verified) throw "JWT token could not be verified";

    return {
      success: true,
      header,
      payload,
      issuer: issuerConfig,
    };
  } catch (e) {
    return {
      success: false,
      error: e.toString(),
    };
  }
};

// Get OIDC Issuer jwk for key id
// TODO implement caching for both fetches
const getIssuerJwk = async (issuerConfig, iss, kid, env) => {
  type OidcConfig = {
    jwks_uri: string;
  };

  type JwkKeys = {
    keys: Record<string, string>[];
  };

  // discover JWKs if not explicitly set in config
  let jwksUri = issuerConfig.jwks_uri;
  if (!jwksUri) {
    const oidcConfigRes = await fetch(
      `${
        iss.startsWith("https://") ? iss : `https://${iss}`
      }/.well-known/openid-configuration`,
      { headers: requestHeaders }
    );
    const oidcConfig = (await oidcConfigRes.json()) as OidcConfig;
    jwksUri = oidcConfig.jwks_uri;
  }

  // fetch JWKs and return specific one for kid
  const jwksRes = await fetch(jwksUri, { headers: requestHeaders });
  const jwks = (await jwksRes.json()) as JwkKeys;
  return jwks.keys.find((x) => x.kid === kid);
};

export const verifyJwtSignature = (jwsObject, jwk) => {
  const jwsSigningInput = jwsObject.split(".").slice(0, 2).join(".");
  const jwsSignature = jwsObject.split(".")[2];
  return crypto.subtle
    .importKey(
      "jwk",
      jwk,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: { name: "SHA-256" },
      },
      false,
      ["verify"]
    )
    .then((key) =>
      crypto.subtle.verify(
        { name: "RSASSA-PKCS1-v1_5" },
        key,
        base64url.parse(jwsSignature, { loose: true }),
        new TextEncoder().encode(jwsSigningInput)
      )
    );
};

export const getPoliciesForPathname = (pathname, jwtIssuerId) => {
  return stateConfig.policies
    .map((policy) => {
      var pattern = new UrlPattern(policy.path, {
        segmentNameCharset: "a-zA-Z0-9_-",
        segmentValueCharset: "a-zA-Z0-9-_~ %@.",
      });
      const match = pattern.match(pathname);
      if (match) {
        // keep named params only
        delete match._;

        const jwts = policy.jwts.filter((x) => x.issuer_id === jwtIssuerId);
        if (jwts.length) {
          return {
            path: policy.path,
            jwts,
            urlParamsClaims: match,
          };
        }
      }
    })
    .filter(Boolean);
};

export const isJwtAllowedForPathname = (operation, pathname, jwt) => {
  // list of states is always allowed 
  if (operation === "list" && pathname === "/") {
    return true
  }

  const policies = getPoliciesForPathname(pathname, jwt.issuer.id)
  return policies.some((policy) =>
    policy.jwts.some((policyJwt) => {
      // assign url claims
      const claims = Object.assign(
        policyJwt.claims || {},
        !policyJwt.ignore_url_params_claims ? policy.urlParamsClaims : {}
      );

      // validate each policy claim
      // each claim condition MUST return true
      const allClaimsValid = Object.keys(claims).every((claim) => {
        const jwtPolicyClaimValue = claims[claim];

        if (jwtPolicyClaimValue == jwt.payload[claim]) {
          return true;
        } else if (
          Array.isArray(jwtPolicyClaimValue) &&
          typeof jwt.payload[claim] === "string"
        ) {
          return jwtPolicyClaimValue.includes(jwt.payload[claim].toString());
        }
        return false;
      });

      if (
        allClaimsValid &&
        scopeOperations[policyJwt.scope].includes(operation)
      ) {
        return true;
      }
    })
  );
};
