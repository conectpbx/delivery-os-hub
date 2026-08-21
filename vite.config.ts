import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { generateSW } from "workbox-build";
import path from "node:path";
import fs from "node:fs";
import type { Plugin } from "vite";

function pwaServiceWorkerPlugin(): Plugin {
  let rootDir: string;
  let isProduction: boolean;

  return {
    name: "tanstack-pwa-sw",
    configResolved(config) {
      rootDir = config.root;
      isProduction = config.isProduction;
    },
    async closeBundle() {
      if (!isProduction) return;

      const outDir = path.resolve(rootDir, ".output", "public");
      if (!fs.existsSync(outDir)) return;

      await generateSW({
        swDest: path.join(outDir, "sw.js"),
        globDirectory: outDir,
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
            urlPattern: ({ url, request, sameOrigin }: any) =>
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

      console.log("✔ Service worker gerado em", path.join(outDir, "sw.js"));
    },
  };
}

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  nitro: {
    preset: "node-server",
  },
  vite: {
    optimizeDeps: {
      exclude: ["@tanstack/start-client-core"],
    },
    plugins: [pwaServiceWorkerPlugin()],
  },
});
