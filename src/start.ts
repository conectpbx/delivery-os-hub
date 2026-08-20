import { createStart, createMiddleware } from "@tanstack/react-start";
import { createCsrfMiddleware } from "@tanstack/start-client-core";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const isAbortError = (error: unknown) => {
  if (error == null || typeof error !== "object") return false;
  const e = error as { name?: string; message?: string; code?: string };
  return (
    e.name === "AbortError" ||
    e.code === "ECONNRESET" ||
    e.code === "ABORT_ERR" ||
    /aborted|socket hang up|premature close/i.test(e.message ?? "")
  );
};

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    // The client closed the connection (navigation, refresh, HMR). Nothing to
    // render — surfacing a 500 page here causes a false blank screen.
    if (isAbortError(error)) {
      return new Response(null, { status: 499 });
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});


// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
