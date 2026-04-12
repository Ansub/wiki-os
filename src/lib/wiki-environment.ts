import {
  DEFAULT_WIKI_OS_CONFIG,
  resolveWikiOsConfig,
  type WikiOsConfig,
} from "./wiki-config";
import type { PersonOverrideValue } from "./wiki-shared";

export interface WikiRuntimeDependency {
  wikiRoot: string | null;
  indexDbPath: string | null;
  personOverrides: Record<string, PersonOverrideValue>;
}

interface WikiEnvironmentAdapters {
  getConfig: () => Promise<WikiOsConfig>;
  resetConfigCache: () => void;
  resolveRuntime: () => Promise<WikiRuntimeDependency>;
}

const defaultAdapters: WikiEnvironmentAdapters = {
  getConfig: async () => resolveWikiOsConfig(DEFAULT_WIKI_OS_CONFIG),
  resetConfigCache: () => {},
  resolveRuntime: async () => ({
    wikiRoot: null,
    indexDbPath: null,
    personOverrides: {},
  }),
};

let adapters: WikiEnvironmentAdapters = defaultAdapters;

export function configureWikiEnvironment(nextAdapters: Partial<WikiEnvironmentAdapters>) {
  adapters = {
    ...adapters,
    ...nextAdapters,
  };
}

export function resetWikiEnvironment() {
  adapters = defaultAdapters;
}

export function getWikiEnvironmentConfig() {
  return adapters.getConfig();
}

export function resetWikiEnvironmentConfigCache() {
  adapters.resetConfigCache();
}

export function resolveWikiEnvironmentRuntime() {
  return adapters.resolveRuntime();
}
