import { defineConfig } from "vite";

const proxy = { "/api": { target: "http://127.0.0.1:8765", changeOrigin: true } };

export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? "./" : "/",
  server: { proxy, host: "127.0.0.1" },
  preview: { proxy, host: "127.0.0.1" },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/zrender/")) return "chart-renderer";
          if (id.includes("/node_modules/echarts/")) return "charts";
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
        },
      },
    },
  },
}));
