#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const port = process.env.WIKIOS_DEV_SERVER_PORT ?? "5212";
const require = createRequire(import.meta.url);
const tsxEntryPoint = require.resolve("tsx/dist/cli.mjs");

const child = spawn(process.execPath, [tsxEntryPoint, "watch", "src/server/server.ts"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: port,
  },
  stdio: "inherit",
});

child.on("error", (error) => {
  const message = error instanceof Error ? error.message : "dev-server failed";
  console.error(message);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});