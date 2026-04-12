import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PersonOverrideValue } from "../lib/wiki-shared";
import { getSampleVaultRoot } from "./app-paths";

const HOME = process.env.HOME ?? os.homedir();
const STATE_DIR = path.join(HOME, ".wiki-os");
const DEFAULT_SETUP_CONFIG_PATH =
  process.env.WIKIOS_SETUP_CONFIG ?? path.join(STATE_DIR, "config.json");

type WikiRootSource = "env" | "saved" | "none";

export interface WikiRuntimeConfigError {
  code: "INVALID_JSON" | "INVALID_CONFIG";
  message: string;
  path: string;
}

export interface StoredWikiRuntimeConfig {
  wikiRoot?: string | null;
  personOverridesByVault?: Record<string, Record<string, PersonOverrideValue>>;
}

export interface WikiRuntimeSettings {
  wikiRoot: string | null;
  wikiRootSource: WikiRootSource;
  indexDbPath: string | null;
  setupConfigPath: string;
  sampleVaultPath: string | null;
  personOverrides: Record<string, PersonOverrideValue>;
  configError: WikiRuntimeConfigError | null;
}

export interface WikiSetupStatus {
  configured: boolean;
  wikiRoot: string | null;
  wikiRootSource: WikiRootSource;
  hasEnvOverride: boolean;
  sampleVaultPath: string | null;
  folderPickerAvailable: boolean;
  configError: WikiRuntimeConfigError | null;
}

export class WikiRuntimeConfigFileError extends Error {
  readonly configError: WikiRuntimeConfigError;

  constructor(configError: WikiRuntimeConfigError) {
    super(configError.message);
    this.name = "WikiRuntimeConfigFileError";
    this.configError = configError;
  }
}

interface StoredConfigState {
  config: StoredWikiRuntimeConfig;
  configError: WikiRuntimeConfigError | null;
}

function normalizeInputPath(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === "~") {
    return HOME;
  }

  if (trimmed.startsWith("~/")) {
    return path.join(HOME, trimmed.slice(2));
  }

  return path.resolve(trimmed);
}

async function pathIsDirectory(filePath: string) {
  try {
    const details = await stat(filePath);
    return details.isDirectory();
  } catch {
    return false;
  }
}

async function canRead(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readStoredConfigState(setupConfigPath: string): Promise<StoredConfigState> {
  if (!(await canRead(setupConfigPath))) {
    return {
      config: {},
      configError: null,
    };
  }

  try {
    const raw = await readFile(setupConfigPath, "utf8");
    const trimmed = raw.trim();

    if (!trimmed) {
      return {
        config: {},
        configError: {
          code: "INVALID_CONFIG",
          message:
            "Your local WikiOS config file is empty. Choose a vault below to replace it.",
          path: setupConfigPath,
        },
      };
    }

    const parsed = JSON.parse(trimmed) as unknown;
    if (!isPlainObject(parsed)) {
      return {
        config: {},
        configError: {
          code: "INVALID_CONFIG",
          message:
            "Your local WikiOS config file is not valid. Choose a vault below to replace it.",
          path: setupConfigPath,
        },
      };
    }

    return {
      config: parsed as StoredWikiRuntimeConfig,
      configError: null,
    };
  } catch (error) {
    const message =
      error instanceof SyntaxError
        ? "Your local WikiOS config file is unreadable. Choose a vault below to replace it."
        : "WikiOS could not read the local config file. Choose a vault below to replace it.";

    return {
      config: {},
      configError: {
        code: error instanceof SyntaxError ? "INVALID_JSON" : "INVALID_CONFIG",
        message,
        path: setupConfigPath,
      },
    };
  }
}

function normalizeRelativeFileKey(value: string) {
  const normalized = path.posix
    .normalize(value.trim().replace(/\\/g, "/"))
    .replace(/^\/+/, "")
    .replace(/^\.\//, "");

  if (!normalized || normalized === "." || normalized.startsWith("../")) {
    return null;
  }

  return normalized;
}

function normalizePersonOverrides(
  value: Record<string, PersonOverrideValue> | undefined,
): Record<string, PersonOverrideValue> {
  const normalized: Record<string, PersonOverrideValue> = {};

  for (const [file, override] of Object.entries(value ?? {})) {
    const normalizedFile = normalizeRelativeFileKey(file);
    if (!normalizedFile) {
      continue;
    }

    if (override === "person" || override === "not-person") {
      normalized[normalizedFile] = override;
    }
  }

  return normalized;
}

function buildDefaultIndexDbPath(wikiRoot: string) {
  const indexDbFile = `${createHash("sha1").update(wikiRoot).digest("hex")}.sqlite`;
  return path.join(STATE_DIR, "indexes", indexDbFile);
}

export async function resolveWikiRuntimeSettings(): Promise<WikiRuntimeSettings> {
  const setupConfigPath = DEFAULT_SETUP_CONFIG_PATH;
  const sampleVaultCandidate = getSampleVaultRoot();
  const sampleVaultPath = (await pathIsDirectory(sampleVaultCandidate)) ? sampleVaultCandidate : null;

  const envWikiRoot = normalizeInputPath(process.env.WIKI_ROOT);
  const forcedEnvWikiRoot = normalizeInputPath(process.env.WIKIOS_FORCE_WIKI_ROOT);
  const storedConfigState = await readStoredConfigState(setupConfigPath);
  const storedWikiRoot =
    storedConfigState.configError === null
      ? normalizeInputPath(storedConfigState.config.wikiRoot ?? null)
      : null;

  const wikiRoot = forcedEnvWikiRoot ?? storedWikiRoot ?? envWikiRoot ?? null;
  const wikiRootSource: WikiRootSource = forcedEnvWikiRoot
    ? "env"
    : storedWikiRoot
      ? "saved"
      : envWikiRoot
      ? "env"
      : "none";
  const personOverrides =
    wikiRoot === null || storedConfigState.configError !== null
      ? {}
      : normalizePersonOverrides(storedConfigState.config.personOverridesByVault?.[wikiRoot]);

  return {
    wikiRoot,
    wikiRootSource,
    indexDbPath: wikiRoot
      ? normalizeInputPath(process.env.WIKIOS_INDEX_DB) ?? buildDefaultIndexDbPath(wikiRoot)
      : null,
    setupConfigPath,
    sampleVaultPath,
    personOverrides,
    configError: storedConfigState.configError,
  };
}

export async function validateWikiRootPath(inputPath: string) {
  const normalized = normalizeInputPath(inputPath);

  if (!normalized) {
    throw new Error("Enter the path to your Obsidian vault.");
  }

  if (!(await pathIsDirectory(normalized))) {
    throw new Error("That path does not exist or is not a folder.");
  }

  return normalized;
}

export async function saveWikiRuntimeConfig(
  nextConfig: StoredWikiRuntimeConfig,
  options: { overwriteCorrupt?: boolean } = {},
) {
  const setupConfigPath = DEFAULT_SETUP_CONFIG_PATH;
  const storedConfigState = await readStoredConfigState(setupConfigPath);

  if (storedConfigState.configError && !options.overwriteCorrupt) {
    throw new WikiRuntimeConfigFileError(storedConfigState.configError);
  }

  await mkdir(path.dirname(setupConfigPath), { recursive: true });
  const tempPath = path.join(
    path.dirname(setupConfigPath),
    `.config.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );

  try {
    await writeFile(tempPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
    await rename(tempPath, setupConfigPath);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export async function loadWikiRuntimeConfig() {
  const storedConfigState = await readStoredConfigState(DEFAULT_SETUP_CONFIG_PATH);

  if (storedConfigState.configError) {
    throw new WikiRuntimeConfigFileError(storedConfigState.configError);
  }

  return storedConfigState.config;
}

export async function saveWikiPersonOverride(
  wikiRoot: string,
  file: string,
  override: PersonOverrideValue | null,
) {
  const normalizedFile = normalizeRelativeFileKey(file);
  if (!normalizedFile) {
    throw new Error("Invalid wiki page path.");
  }

  const storedConfig = await loadWikiRuntimeConfig();
  const personOverridesByVault = { ...(storedConfig.personOverridesByVault ?? {}) };
  const currentOverrides = normalizePersonOverrides(personOverridesByVault[wikiRoot]);

  if (override === null) {
    delete currentOverrides[normalizedFile];
  } else {
    currentOverrides[normalizedFile] = override;
  }

  if (Object.keys(currentOverrides).length === 0) {
    delete personOverridesByVault[wikiRoot];
  } else {
    personOverridesByVault[wikiRoot] = currentOverrides;
  }

  await saveWikiRuntimeConfig({
    ...storedConfig,
    personOverridesByVault:
      Object.keys(personOverridesByVault).length > 0 ? personOverridesByVault : undefined,
  });

  return currentOverrides[normalizedFile] ?? null;
}

export async function getWikiSetupStatus(): Promise<WikiSetupStatus> {
  const runtime = await resolveWikiRuntimeSettings();

  return {
    configured: runtime.wikiRoot !== null,
    wikiRoot: runtime.wikiRoot,
    wikiRootSource: runtime.wikiRootSource,
    hasEnvOverride: runtime.wikiRootSource === "env",
    sampleVaultPath: runtime.sampleVaultPath,
    folderPickerAvailable: process.platform === "darwin",
    configError: runtime.configError,
  };
}
