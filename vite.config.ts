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
          // ECharts is statically imported by both
          // `DesktopTerminalChartCanvas` (the lazy-loaded /app
          // chart) AND by FanChart / EquityCurve (the / root-route
          // ES-prediction charts). Without the explicit chunk,
          // Rollup inlines it into the entry chunk because
          // multiple modules pull from it — exploding the entry
          // from ~125 KB gz to ~500 KB gz. Keep it as a vendor
          // chunk so it's a single shared download cached across
          // routes.
          echarts: ["echarts", "echarts-for-react"],
          // lightweight-charts is reached ONLY via the dynamic
          // `import("./MobileChartCanvas")` boundary, so Rollup
          // auto-splits it. No manualChunks entry needed.
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
