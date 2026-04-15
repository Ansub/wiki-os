#!/usr/bin/env node

import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const configPath = path.join(repoRoot, "wiki-os.config.ts");
const require = createRequire(import.meta.url);
const tscEntryPoint = require.resolve("typescript/bin/tsc");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
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
  try {
    await access(configPath, fsConstants.F_OK);
  } catch {
    return;
  }

  await run(process.execPath, [
    tscEntryPoint,
    "--pretty",
    "false",
    "--target",
    "ES2022",
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--outDir",
    "dist-server",
    "wiki-os.config.ts",
  ]);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "build-config failed";
  console.error(message);
  process.exit(1);
});