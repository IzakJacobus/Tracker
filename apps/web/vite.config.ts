import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { serviceWorker } from "./build/sw-plugin.ts";

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:47601", changeOrigin: false },
    },
  },
  build: { outDir: "dist", sourcemap: true, target: "es2022" },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
  },
});
