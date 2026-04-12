import { configureWikiEnvironment } from "../lib/wiki-environment";
import { getWikiOsConfig, resetWikiOsConfigCache } from "./wiki-config";
import { resolveWikiRuntimeSettings } from "./wiki-runtime";

export function configureServerWikiCore() {
  configureWikiEnvironment({
    getConfig: getWikiOsConfig,
    resetConfigCache: resetWikiOsConfigCache,
    resolveRuntime: async () => {
      const runtime = await resolveWikiRuntimeSettings();
      return {
        wikiRoot: runtime.wikiRoot,
        indexDbPath: runtime.indexDbPath,
        personOverrides: runtime.personOverrides,
      };
    },
  });
}
