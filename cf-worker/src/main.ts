import { parse } from "worktop/cookie";
export { TerraformStateDurableObject } from "./do-state";
export { TerraformStateIndexDurableObject } from "./do-index";
import {
  getDoStub,
  isJwtAllowedForPathname,
  verifyJwt,
} from "./utils";

// @ts-ignore
import configFile from "./../../config.yaml";
// @ts-ignore
import indexHtml from "./public/index.html";
// @ts-ignore
import indexCss from "../dist/main.css";
import { StateConfig } from "./types";

export const responseHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json",
};

export const stateConfig = <StateConfig>configFile;

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (e) {
      return new Response(e.message, { status: 500, ...responseHeaders });
    }
  },

  // CRON Trigger to cleanup old state versions
  async scheduled(controller, env, ctx) {
    // list all states
    const res = await passToDo(new Request("http://fake.host/"), "/", env);
    const states = await res.json()

    // call /cleanup on all of them
    // TODO mark last cleanup time, clean up up to xx states per run
    await Promise.all(states.map(state => passToDo(new Request("http://fake.host/", {method: "DELETE"}), state, env)))
  },
};

async function handleRequest(req, env) {
  const { pathname, searchParams, protocol, hostname, port } = new URL(req.url);
  const isHtmlRequest = req.headers.get("accept")?.includes("text/html");
  const listParam = searchParams.get("list") || isHtmlRequest || false;

  let operation;
  if (req.method === "GET") {
    operation = listParam || isHtmlRequest ? "list" : "read";
  } else {
    operation = "write";
  }

  let requestJwt;
  const cookie = parse(req.headers.get("Cookie") || "");
  const accessJwt =
    req.headers.get("Cf-Access-Jwt-Assertion") || cookie["CF_Authorization"];
  const authHeader = req.headers.get("Authorization");

  // Make sure JWT or client id/secret was passed
  if (!accessJwt && !authHeader) {
    if (isHtmlRequest) {
      return Response.redirect(`${protocol}//${hostname}:${port}/auth`, 302);
    }
    return new Response(
      JSON.stringify({ error: "HTTP remote state endpoint requires auth" }),
      { status: 401, ...responseHeaders }
    );
  } else if (pathname === "/auth") {
    // redirect to homepage after login through Access
    return Response.redirect(`${protocol}//${hostname}:${port}/`, 302);
  } else if (pathname === "/main.css") {
    // serve CSS
    return new Response(indexCss, {
      status: 200,
      headers: { "content-type": "text/css" },
    });
  }

  if (authHeader) {
    const [scheme, credentials] = authHeader.split(" ");
    const [username, password] = atob(credentials).split(":");

    if (username === "jwt") {
      requestJwt = password;
    }
  }

  if (!requestJwt) {
    requestJwt = accessJwt;
  }

  // Validate JWT token and return decoded data
  const jwt = await verifyJwt(requestJwt, env);
  if (!jwt.success) {
    return new Response(JSON.stringify({ error: jwt.error }), {
      status: 403,
      ...responseHeaders,
    });
  }

  // is request JWT allowed for operation on path?
  const isJwtAllowed = isJwtAllowedForPathname(operation, pathname, jwt);
  if (!isJwtAllowed) {
    return new Response(
      JSON.stringify({ error: `Not allowed to perform '${operation}' operation` }),
      { status: 403, ...responseHeaders }
    );
  }

  if (operation === "list") {
    if (isHtmlRequest) {
      return new Response(indexHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    const res = await passToDo(new Request("http://fake.host/", req), pathname, env, jwt);

    // if its /, its request for list of states
    if (pathname === "/") {
      const states = await res.json()
      const filteredStates = states.filter(x => isJwtAllowedForPathname("list", x, jwt))
      return new Response(JSON.stringify(filteredStates), {status: 200, headers: {...responseHeaders}})
    } else {
      return res
    }
  } else {
    return passToDo(req, pathname, env, jwt);
  }
}

async function passToDo(req, pathname, env, jwt = {}) {
  const stub = getDoStub(env, pathname);
  return await stub.fetch(req, {
    method: req.method,
    headers: req.headers,
    body: req.body
      ? JSON.stringify({
          bodyText: await req.text(),
          jwt,
        })
      : undefined,
  });
}
