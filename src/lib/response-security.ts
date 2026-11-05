/** Keep API/auth responses out of shared caches, including framework-generated failures. */
export function secureResponse(request: Request, response: Response, production = true): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(self), geolocation=(self), microphone=()");
  if (!headers.has("Content-Security-Policy")) {
    headers.set(
      "Content-Security-Policy",
      "base-uri 'self'; object-src 'none'" +
        (production
          ? "; frame-ancestors 'self' https://lovable.dev https://*.lovable.dev https://gptengineer.app https://*.gptengineer.app"
          : ""),
    );
  }
  const url = new URL(request.url);
  if (
    request.headers.has("authorization") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_server") ||
    response.status >= 400
  ) {
    headers.set("Cache-Control", "no-store");
  } else if (headers.get("content-type")?.includes("text/html")) {
    headers.set("Cache-Control", "private, no-cache");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
