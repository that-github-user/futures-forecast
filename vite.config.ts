import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    proxy: {
      // Proxy API calls to the backend in dev mode
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/admin": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/dc-api": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks: {
          // ECharts CORE only. Deliberately excludes
          // echarts-for-react: that adapter pulls React as a
          // peer dep, and bundling it into the echarts vendor
          // chunk caused Rollup to hoist React's exported
          // symbols INTO the echarts chunk. The entry chunk's
          // React import then transitively pulled in echarts
          // (R2 flagged this — every route preloaded the 382 KB
          // gz echarts chunk). Excluding echarts-for-react means
          // Rollup inlines the small adapter (~3 KB raw) into
          // each consumer's route chunk, but the heavy core stays
          // as a single shared vendor chunk.
          echarts: ["echarts"],
        },
      },
    },
  },
});
