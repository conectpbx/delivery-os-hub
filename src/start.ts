import { createStart, createMiddleware } from "@tanstack/react-start";
import { createCsrfMiddleware } from "@tanstack/start-client-core";

import { renderErrorPage } from "./lib/error-page";
import { isExpectedRequestAbort } from "./lib/error-capture";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    // The client closed the connection (navigation, refresh, HMR). Nothing to
    // render — surfacing a 500 page here causes a false blank screen.
    if (isExpectedRequestAbort(error)) {
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
