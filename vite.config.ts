import path from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const devHost = process.env.WIKIOS_DEV_CLIENT_HOST ?? "0.0.0.0";
const devPort = Number(process.env.WIKIOS_DEV_CLIENT_PORT ?? "5211");
const devApiHost = process.env.WIKIOS_DEV_SERVER_HOST ?? "127.0.0.1";
const devApiPort = Number(process.env.WIKIOS_DEV_SERVER_PORT ?? "5212");

export default defineConfig({
  plugins: [react()],
  publicDir: "public",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: devHost,
    port: devPort,
    proxy: {
      "/api": `http://${devApiHost}:${devApiPort}`,
    },
  },
});
