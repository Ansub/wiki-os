import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function escapeAppleScriptString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function isDirectory(filePath: string) {
  try {
    const details = await stat(filePath);
    return details.isDirectory();
  } catch {
    return false;
  }
}

export function isFinderFolderPickerAvailable() {
  return process.platform === "darwin";
}

export async function pickFolderWithFinder(defaultPath?: string | null) {
  if (!isFinderFolderPickerAvailable()) {
    throw new Error("Finder folder picker is available on macOS only.");
  }

  try {
    await access("/usr/bin/osascript");
  } catch {
    throw new Error("osascript is unavailable on this machine.");
  }

  const normalizedDefault = defaultPath?.trim() ? path.resolve(defaultPath) : null;
  const canUseDefault = normalizedDefault ? await isDirectory(normalizedDefault) : false;

  const script = canUseDefault
    ? [
        `set defaultFolder to POSIX file "${escapeAppleScriptString(normalizedDefault!)}"`,
        'set chosenFolder to choose folder with prompt "Select your Obsidian vault" default location defaultFolder',
        "return POSIX path of chosenFolder",
      ].join("\n")
    : [
        'set chosenFolder to choose folder with prompt "Select your Obsidian vault"',
        "return POSIX path of chosenFolder",
      ].join("\n");

  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script]);
    const pickedPath = stdout.trim().replace(/\/$/, "");
    return pickedPath || null;
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : "";

    if (stderr.includes("-128")) {
      return null;
    }

    throw error;
  }
}
