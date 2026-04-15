#!/usr/bin/env node

import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const tscEntryPoint = require.resolve("typescript/bin/tsc");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}`));
    });
  });
}

async function main() {
  await rm(path.join(repoRoot, "dist-server"), { force: true, recursive: true });
  await rm(path.join(repoRoot, "tsconfig.server.tsbuildinfo"), { force: true });
  await run(process.execPath, [tscEntryPoint, "-p", "tsconfig.server.json"]);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "build-server failed";
  console.error(message);
  process.exit(1);
});