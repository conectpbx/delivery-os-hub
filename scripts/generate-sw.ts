import { generateSW } from "workbox-build";
import path from "node:path";
import fs from "node:fs";

// Called after client chunks are written, before Nitro scans/compresses public assets.
export async function generateServiceWorker(outputDir: string) {
  const publicDir = path.resolve(outputDir);

  if (!fs.existsSync(publicDir)) {
    throw new Error("Build the application before generating the service worker");
  }

  // These public files may not have been copied by Nitro yet.
  const sourceDir = path.resolve(process.cwd(), "public");
  for (const name of ["icons", "favicon.png", "manifest.webmanifest"]) {
    fs.cpSync(path.join(sourceDir, name), path.join(publicDir, name), { recursive: true });
  }

  await generateSW({
    swDest: path.join(publicDir, "sw.js"),
    globDirectory: publicDir,
    globPatterns: [
      "assets/**/*.{js,css,svg,png,woff2}",
      "icons/*.png",
      "favicon.png",
      "manifest.webmanifest",
    ],
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    cleanupOutdatedCaches: true,
    // Activate only after existing tabs close, keeping their route code consistent.
    skipWaiting: false,
    clientsClaim: true,
    runtimeCaching: [
      {
        urlPattern: ({ request }) => request.mode === "navigate",
        handler: "NetworkFirst",
        options: {
          cacheName: "html-navigations",
          networkTimeoutSeconds: 3,
          cacheableResponse: { statuses: [200] },
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
          cacheableResponse: { statuses: [200] },
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
        },
      },
    ],
  });

  console.log("✔ Service worker gerado em", path.join(publicDir, "sw.js"));
}
