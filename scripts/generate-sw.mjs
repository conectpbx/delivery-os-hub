import { generateSW } from "workbox-build";
import path from "node:path";
import fs from "node:fs";

const publicDir = path.resolve(process.cwd(), "public");

await generateSW({
  swDest: path.join(publicDir, "sw.js"),
  globDirectory: publicDir,
  globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
  navigateFallback: "/dashboard",
  navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//, /^\/_serverFn\//],
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: [
    {
      urlPattern: ({ request }) => request.mode === "navigate",
      handler: "NetworkFirst",
      options: {
        cacheName: "html-navigations",
        networkTimeoutSeconds: 5,
        expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 7 },
      },
    },
    {
      urlPattern: ({ url, request, sameOrigin }) =>
        sameOrigin &&
        (request.destination === "script" ||
          request.destination === "style" ||
          request.destination === "font" ||
          request.destination === "image") &&
        !url.pathname.startsWith("/api/"),
      handler: "CacheFirst",
      options: {
        cacheName: "static-assets",
        expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
  ],
});

console.log("✔ Service worker gerado em", path.join(publicDir, "sw.js"));
