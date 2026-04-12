#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function parseFlags(argv) {
  return {
    skipInstall: argv.includes("--skip-install"),
    skipStart: argv.includes("--skip-start"),
    noOpenBrowser: argv.includes("--no-open-browser"),
  };
}

function runCommand(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, args, {
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

      reject(new Error(`${npmCommand} ${args.join(" ")} exited with code ${code ?? 1}`));
    });
  });
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  if (!flags.skipInstall) {
    await runCommand(["install", "--prefer-offline"]);
  }

  if (!flags.skipStart) {
    await runCommand(["start"], {
      WIKIOS_OPEN_BROWSER:
        flags.noOpenBrowser ? "0" : process.env.WIKIOS_OPEN_BROWSER ?? "1",
    });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "WikiOS first-run failed";
  console.error(message);
  process.exit(1);
});
