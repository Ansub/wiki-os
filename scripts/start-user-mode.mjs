#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const npmExecPath = process.env.npm_execpath;
const nodeExecPath = process.env.npm_node_execpath ?? process.execPath;

function runCommand(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const command = npmExecPath ? nodeExecPath : (process.platform === "win32" ? "npm.cmd" : "npm");
    const commandArgs = npmExecPath ? [npmExecPath, ...args] : args;

    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${commandArgs.join(" ")} exited with code ${code ?? 1}`));
    });
  });
}

async function start() {
  await runCommand(["run", "build"]);
  await runCommand(["run", "serve"], {
    WIKIOS_OPEN_BROWSER: process.env.WIKIOS_OPEN_BROWSER ?? "1",
  });
}

start().catch((error) => {
  const message = error instanceof Error ? error.message : "Failed to start WikiOS";
  console.error(message);
  process.exit(1);
});
