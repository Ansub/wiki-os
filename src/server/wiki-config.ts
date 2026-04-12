import { access } from "node:fs/promises";
import { createRequire } from "node:module";

import {
  DEFAULT_WIKI_OS_CONFIG,
  type WikiOsConfig,
  type WikiOsConfigInput,
  resolveWikiOsConfig,
} from "../lib/wiki-config";
import { getBuiltConfigPath, getSourceConfigPath } from "./app-paths";

let cachedConfig: Promise<WikiOsConfig> | null = null;
const requireFromHere = createRequire(__filename);

async function canRead(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function importConfigModule(filePath: string): Promise<WikiOsConfigInput | null> {
  const loaded = requireFromHere(filePath) as { default?: WikiOsConfigInput } & WikiOsConfigInput;

  if (loaded.default && typeof loaded.default === "object") {
    return loaded.default;
  }

  return typeof loaded === "object" ? loaded : null;
}

async function loadUserConfig(): Promise<WikiOsConfigInput | null> {
  if (process.env.NODE_ENV === "test") {
    return null;
  }

  const sourceConfigPath = getSourceConfigPath();
  const builtConfigPath = getBuiltConfigPath();

  const isProductionRuntime =
    process.env.NODE_ENV === "production" || process.argv[1]?.endsWith(".js");

  const candidates = isProductionRuntime
    ? [builtConfigPath, sourceConfigPath]
    : [sourceConfigPath, builtConfigPath];

  for (const candidate of candidates) {
    if (!(await canRead(candidate))) {
      continue;
    }

    try {
      return await importConfigModule(candidate);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown config error";
      console.warn(`Failed to load WikiOS config from ${candidate}: ${message}`);
    }
  }

  return null;
}

export function resetWikiOsConfigCache() {
  cachedConfig = null;
}

export async function getWikiOsConfig(): Promise<WikiOsConfig> {
  if (!cachedConfig) {
    cachedConfig = (async () => {
      const loadedConfig = await loadUserConfig();
      return resolveWikiOsConfig(loadedConfig ?? DEFAULT_WIKI_OS_CONFIG);
    })();
  }

  return cachedConfig;
}
