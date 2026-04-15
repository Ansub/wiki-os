#!/usr/bin/env node

import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const appName = "WikiOS";
const baseUrl = process.env.WIKIOS_BASE_URL ?? "http://localhost:5211";
const restartCommand = process.env.WIKIOS_RESTART_COMMAND ?? "";
const stateDir = path.resolve(process.env.XDG_STATE_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? repoRoot, ".local", "state"), "wiki-os");
const logDir = path.join(stateDir, "logs");
const deployLog = path.join(logDir, "deploy.log");

function timestamp() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

async function log(message) {
  const line = `[${timestamp()}] ${message}`;
  console.log(line);
  await appendFile(deployLog, `${line}\n`, "utf8");
}

async function fail(message) {
  await log(`FATAL: ${message}`);
  process.exit(1);
}

function npmCommand() {
  if (process.env.npm_execpath) {
    return {
      command: process.env.npm_node_execpath ?? process.execPath,
      args: [process.env.npm_execpath],
    };
  }

  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: [],
  };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...options.env },
      shell: options.shell ?? false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const collect = (chunk) => {
      output += chunk.toString();
    };

    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(output);
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}`));
    });
  });
}

async function runNpm(args, options = {}) {
  const npm = npmCommand();
  return run(npm.command, [...npm.args, ...args], { ...options, shell: npm.args.length === 0 && process.platform === "win32" });
}

async function waitForHealth() {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        await log(`Health endpoint is up (took ${attempt}s)`);
        return;
      }
    } catch {
      // Keep retrying until timeout.
    }

    if (attempt === 20) {
      throw new Error(`Health endpoint did not come up within 20 seconds (${baseUrl}/api/health)`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const skipPull = flags.has("--skip-pull");
  const skipInstall = flags.has("--skip-install");
  const skipRestart = flags.has("--skip-restart");
  const skipSmoke = flags.has("--skip-smoke");

  await mkdir(logDir, { recursive: true });
  await writeFile(deployLog, "", "utf8");

  await log("═══════════════════════════════════════");
  await log(`${appName} deploy started`);
  await log("═══════════════════════════════════════");

  if (!skipPull) {
    await log("Pulling latest from origin/main...");
    try {
      await run("git", ["pull", "origin", "main", "--ff-only"]);
    } catch {
      await fail("git pull failed — resolve conflicts first");
    }
  } else {
    await log("Skipping git pull (--skip-pull)");
  }

  const commit = (await run("git", ["rev-parse", "--short", "HEAD"])).trim();
  const commitFull = (await run("git", ["rev-parse", "HEAD"])).trim();
  const deployedAt = new Date().toISOString();
  await log(`Commit: ${commit}`);

  if (!skipInstall) {
    await log("Installing dependencies...");
    try {
      const output = await runNpm(["install", "--prefer-offline"]);
      const lines = output.trim().split(/\r?\n/).filter(Boolean);
      await appendFile(deployLog, `${lines.slice(-3).join("\n")}${lines.length ? "\n" : ""}`, "utf8");
    } catch {
      await fail("npm install failed");
    }
  } else {
    await log("Skipping npm install (--skip-install)");
  }

  await log("Building app...");
  try {
    const output = await runNpm(["run", "build"]);
    const lines = output.trim().split(/\r?\n/).filter(Boolean);
    await appendFile(deployLog, `${lines.slice(-8).join("\n")}${lines.length ? "\n" : ""}`, "utf8");
  } catch {
    await fail("Build failed");
  }

  await writeFile(
    path.join(repoRoot, "version.json"),
    JSON.stringify(
      {
        commit: commitFull,
        commitShort: commit,
        deployedAt,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await log(`Version file written (${commit})`);

  if (!skipRestart) {
    if (restartCommand) {
      await log("Running restart command...");
      try {
        await run(restartCommand, [], { shell: true });
      } catch {
        await fail("restart command failed");
      }
    } else {
      await log("No WIKIOS_RESTART_COMMAND configured; restart your process manager manually if needed.");
    }
  } else {
    await log("Skipping service restart (--skip-restart)");
  }

  if (!skipSmoke) {
    await log("Waiting for health endpoint...");
    try {
      await waitForHealth();
    } catch (error) {
      await fail(error instanceof Error ? error.message : "Health check failed");
    }

    await log("Running smoke tests...");
    try {
      await run(process.execPath, [path.join(__dirname, "smoke-test.mjs")], {
        env: {
          ...process.env,
          WIKIOS_BASE_URL: baseUrl,
        },
      });
      await log("═══════════════════════════════════════");
      await log(`Deploy complete ✓  (${commit})`);
      await log("═══════════════════════════════════════");
    } catch {
      await log("═══════════════════════════════════════");
      await log("DEPLOY FAILED — smoke tests did not pass");
      await log(`Check: ${deployLog}`);
      await log("═══════════════════════════════════════");
      process.exit(1);
    }
  } else {
    await log("Skipping smoke tests (--skip-smoke)");
    await log(`Deploy complete ✓  (${commit})`);
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : "deploy failed";
  console.error(message);
  try {
    await appendFile(deployLog, `${message}\n`, "utf8");
  } catch {
    // Ignore log write failures during fatal exit.
  }
  process.exit(1);
});