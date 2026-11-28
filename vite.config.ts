import { generateServiceWorker } from "./scripts/generate-sw";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    router: {
      codeSplittingOptions: {
        defaultBehavior: [
          ["component"],
          ["pendingComponent"],
          ["errorComponent", "notFoundComponent"],
        ],
      },
    },
  },
  nitro: {
    preset: "node-server",
  },
  vite: {
    plugins: [
      {
        name: "delivery-os-service-worker",
        apply: "build",
        applyToEnvironment: (environment) => environment.name === "client",
        async writeBundle() {
          await generateServiceWorker(this.environment.config.build.outDir);
        },
      },
    ],
    optimizeDeps: {
      exclude: ["@tanstack/start-client-core"],
    },
  },
});
