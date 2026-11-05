import "./lib/error-capture";
import { readBodyBytes, RequestBodyError } from "./lib/request-body";
import { secureResponse } from "./lib/response-security";

import { consumeLastCapturedError, isExpectedRequestAbort } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const capturedError = consumeLastCapturedError();
  if (isExpectedRequestAbort(capturedError)) {
    return new Response(null, { status: 499 });
  }
  console.error(capturedError ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      if (request.method === "POST" && new URL(request.url).pathname.startsWith("/_server")) {
        const bytes = await readBodyBytes(request, 8_100_000);
        request = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          signal: request.signal,
          body: bytes.buffer,
        });
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return secureResponse(
        request,
        await normalizeCatastrophicSsrResponse(response),
        import.meta.env.PROD,
      );
    } catch (error) {
      if (error instanceof RequestBodyError) {
        return secureResponse(
          request,
          Response.json({ error: error.code }, { status: error.status }),
          import.meta.env.PROD,
        );
      }
      if (isExpectedRequestAbort(error)) {
        return secureResponse(request, new Response(null, { status: 499 }), import.meta.env.PROD);
      }
      console.error(error);
      return secureResponse(
        request,
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        import.meta.env.PROD,
      );
    }
  },
};
