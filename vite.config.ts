import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    router: {
      codeSplittingOptions: {
        defaultBehavior: [],
      },
    },
  },
  nitro: {
    preset: "node-server",
  },
  vite: {
    optimizeDeps: {
      exclude: ["@tanstack/start-client-core"],
    },
  },
});
