import path from "node:path";

// This module always lives at <app-root>/src/server or <app-root>/dist-server/server,
// so two parent traversals consistently land at the app root in both dev and prod.
const APP_ROOT = path.resolve(__dirname, "..", "..");

export function getAppRoot() {
  return APP_ROOT;
}

export function resolveAppPath(...segments: string[]) {
  return path.join(APP_ROOT, ...segments);
}

export function getBuiltClientRoot() {
  return resolveAppPath("dist", "client");
}

export function getSampleVaultRoot() {
  return resolveAppPath("sample-vault");
}

export function getSourceConfigPath() {
  return resolveAppPath("wiki-os.config.ts");
}

export function getBuiltConfigPath() {
  return resolveAppPath("dist-server", "wiki-os.config.js");
}

export function getVersionInfoPath() {
  return resolveAppPath("version.json");
}
