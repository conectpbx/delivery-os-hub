import { defineConfig } from "nitro/config";

export default defineConfig({
  compressPublicAssets: true,
  routeRules: {
    "/**": {
      headers: {
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
      },
    },
    "/assets/**": { headers: { "cache-control": "public, max-age=31536000, immutable" } },
    "/sw.js": { headers: { "cache-control": "no-store" } },
    "/manifest.webmanifest": { headers: { "cache-control": "no-cache" } },
  },
});
