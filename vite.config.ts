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
          // Heavy chart libs split into per-library chunks so each is
          // lazy-loaded only on the viewports that need it. ECharts is
          // the desktop chart (1.1MB); lightweight-charts is the mobile
          // chart (~50KB). With viewport-gated lazy imports, desktop
          // never loads lightweight-charts and mobile never loads
          // echarts.
          echarts: ["echarts", "echarts-for-react"],
          "lightweight-charts": ["lightweight-charts"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
