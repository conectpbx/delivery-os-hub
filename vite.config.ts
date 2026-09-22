import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    router: {
      codeSplittingOptions: {
        // Habilitar split por rota (path) melhora significativamente o tempo de carregamento inicial no mobile.
        defaultBehavior: 'path',
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
    build: {
      // Otimização de chunking para evitar arquivos muito grandes no mobile.
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes("node_modules/leaflet")) return "vendor-maps";
            if (id.includes("node_modules/recharts")) return "vendor-charts";
            if (id.includes("node_modules/@supabase")) return "vendor-supabase";
          },
        },
      },
    },
  },
});
