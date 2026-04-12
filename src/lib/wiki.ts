import {
  getTopicEmoji,
  getTopicLabel,
  type WikiOsConfig,
} from "./wiki-config";
import {
  deriveCategoryNames,
  detectPersonPage,
  extractBacklinkReferences,
  extractSummary,
} from "./wiki-classification";
import {
  getWikiEnvironmentConfig,
  resetWikiEnvironmentConfigCache,
  resolveWikiEnvironmentRuntime,
} from "./wiki-environment";
import {
  deletePageByFile,
  openIndexDb,
  runDbMigrations,
  runStartupIntegrityCheck,
  seedCategoryRules,
  upsertPageRecord,
  type SqliteDb,
} from "./wiki-db";
import {
  isIgnoredDirectoryName,
  normalizeRelativePath,
  quarantineCorruptIndexFiles,
  shouldIndexRelativeFile,
} from "./wiki-file-utils";
import { createWikiIndexer } from "./wiki-indexer";
import { parseWikiFrontmatter, prepareWikiMarkdown } from "./markdown";
import { createWikiQueries } from "./wiki-queries";
import {
  CACHE_VERSION,
  WikiSetupRequiredError,
  markRevisionChanged as markRevisionChangedState,
  recordIntegrityCheck as recordIntegrityCheckState,
  recordSyncError as recordSyncErrorState,
  recordSyncSuccess as recordSyncSuccessState,
  reloadWikiRuntimeState as reloadWikiRuntimeStateState,
  requireIndexDbPath as requireIndexDbPathState,
  requireWikiRoot as requireWikiRootState,
  resetDerivedCache,
  syncRuntimeSettings as syncRuntimeSettingsState,
  type SyncSource,
  wikiCache,
} from "./wiki-state";
import { createWikiWatcherController } from "./wiki-watcher";
export type {
  SearchMatch,
  SearchResult,
  BacklinkStat,
  WikiStats,
  WikiPageData,
  WikiHeading,
  PageSummary,
  CategoryInfo,
  HomepageData,
  GraphNode,
  GraphEdge,
  GraphData,
  PersonOverrideValue,
} from "./wiki-shared";
export {
  decodeSlugParts,
  slugPartsFromFileName,
  slugFromFileName,
  titleFromFileName,
} from "./wiki-shared";
import {
  slugFromFileName,
  titleFromFileName,
} from "./wiki-shared";

export { WikiSetupRequiredError } from "./wiki-state";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function buildCategorySeeds(config: WikiOsConfig) {
  const configuredTopics = Object.keys(config.categories.aliases)
    .map((topic) => getTopicLabel(topic, config.categories.aliases))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return configuredTopics.map((topic, index) => ({
    name: topic,
    emoji: getTopicEmoji(topic, config.categories.aliases),
    sortOrder: index,
  }));
}

function requireDb(): SqliteDb {
  if (!wikiCache.db) {
    throw new Error("Wiki index is not initialized");
  }

  return wikiCache.db;
}

function closeDbHandle(db: SqliteDb | null) {
  if (!db) {
    return;
  }

  if (wikiCache.db === db) {
    wikiCache.db = null;
    resetDerivedCache(wikiCache);
  }

  try {
    db.close();
  } catch {
    // Preserve the original startup error and continue with self-heal.
  }
}

let watcherController: ReturnType<typeof createWikiWatcherController> | null = null;

function getWatcherController() {
  if (!watcherController) {
    watcherController = createWikiWatcherController({
      state: wikiCache,
      env: {
        nodeEnv: process.env.NODE_ENV,
        disableWatch: process.env.WIKIOS_DISABLE_WATCH === "1",
        disablePeriodicReconcile:
          process.env.NODE_ENV === "test" ||
          process.env.WIKIOS_DISABLE_PERIODIC_RECONCILE === "1",
        periodicReconcileMs: process.env.WIKIOS_PERIODIC_RECONCILE_MS?.trim(),
      },
      assertWikiRootAccessible: () => indexer.assertWikiRootAccessible(),
      requireWikiRoot,
      ensureIndexReady,
      reconcileIndexWithDisk: (options) =>
        indexer.reconcileIndexWithDisk(options as { source?: SyncSource | null }),
      syncSinglePath: (relativePath) => indexer.syncSinglePath(relativePath),
      recordSyncSuccess,
      recordSyncError,
      markRevisionChanged,
    });
  }

  return watcherController;
}

function getStateDependencies() {
  return {
    clearWatcherRestartTimer: () => getWatcherController().clearWatcherRestartTimer(),
    clearWatcherStableTimer: () => getWatcherController().clearWatcherStableTimer(),
    clearPeriodicReconcileTimer: () => getWatcherController().clearPeriodicReconcileTimer(),
    schedulePeriodicReconcile: () => getWatcherController().schedulePeriodicReconcile(),
    resetWikiEnvironmentConfigCache,
    resolveWikiEnvironmentRuntime,
    closeDbHandle,
    formatSyncError: errorMessage,
  };
}

function recordSyncSuccess(source: SyncSource) {
  recordSyncSuccessState(wikiCache, source, {
    schedulePeriodicReconcile: () => getWatcherController().schedulePeriodicReconcile(),
  });
}

function recordSyncError(source: SyncSource, error: unknown) {
  recordSyncErrorState(wikiCache, source, error, {
    schedulePeriodicReconcile: () => getWatcherController().schedulePeriodicReconcile(),
    formatSyncError: errorMessage,
  });
}

function recordIntegrityCheck(ok: boolean, error: string | null = null) {
  recordIntegrityCheckState(wikiCache, ok, error);
}

function markRevisionChanged() {
  markRevisionChangedState(wikiCache);
}

async function syncRuntimeSettings() {
  return syncRuntimeSettingsState(wikiCache, getStateDependencies());
}

async function reloadWikiRuntimeState(
  nextWikiRoot: string | null,
  nextIndexDbPath: string | null,
  nextPersonOverrides: Record<string, "person" | "not-person">,
) {
  await reloadWikiRuntimeStateState(
    wikiCache,
    nextWikiRoot,
    nextIndexDbPath,
    nextPersonOverrides,
    getStateDependencies(),
  );
}

function requireWikiRoot() {
  return requireWikiRootState(wikiCache);
}

function requireIndexDbPath() {
  return requireIndexDbPathState(wikiCache);
}

const indexer = createWikiIndexer<SqliteDb, WikiOsConfig>({
  syncRuntimeSettings,
  requireWikiRoot,
  requireIndexDbPath,
  normalizeRelativePath,
  isIgnoredDirectoryName,
  shouldIndexRelativeFile,
  getWikiEnvironmentConfig,
  titleFromFileName,
  slugFromFileName,
  parseWikiFrontmatter,
  prepareWikiMarkdown,
  deriveCategoryNames,
  detectPersonPage: (file, title, contentMarkdown, frontmatter, config) =>
    detectPersonPage(
      file,
      title,
      contentMarkdown,
      frontmatter,
      config,
      wikiCache.personOverrides[file] ?? null,
    ),
  extractBacklinkReferences,
  extractSummary,
  requireDb,
  upsertPageRecord,
  deletePageByFile,
  selectPageModifiedAt: (db, file) =>
    (db.prepare("SELECT modified_at AS modifiedAt FROM pages WHERE file = ?").get(file) as
      | { modifiedAt: number }
      | undefined)?.modifiedAt,
  listIndexedPages: (db) =>
    db.prepare("SELECT file, modified_at AS modifiedAt FROM pages").all() as Array<{
      file: string;
      modifiedAt: number;
    }>,
  markRevisionChanged,
  recordSyncSuccess,
  recordSyncError,
});

const queries = createWikiQueries({
  ensureIndexReady,
  drainPendingUpdates: () => getWatcherController().drainPendingUpdates(),
  getDb: requireDb,
  getConfig: getWikiEnvironmentConfig,
  getCacheState: () => wikiCache,
  getPeriodicReconcileIntervalMs: () => getWatcherController().getPeriodicReconcileIntervalMs(),
  getIndexDbPath: requireIndexDbPath,
  recordIntegrityCheck,
  formatError: errorMessage,
});

export async function isWikiConfigured() {
  const runtime = await syncRuntimeSettings();
  return runtime.wikiRoot !== null;
}

export function isWikiSetupRequiredError(error: unknown): error is WikiSetupRequiredError {
  return error instanceof WikiSetupRequiredError;
}

export async function reloadWikiRuntime() {
  const runtime = await resolveWikiEnvironmentRuntime();
  await reloadWikiRuntimeState(runtime.wikiRoot, runtime.indexDbPath, runtime.personOverrides);
  return runtime;
}

async function ensureIndexReady() {
  const runtime = await syncRuntimeSettings();

  if (!runtime.wikiRoot || !runtime.indexDbPath) {
    throw new WikiSetupRequiredError();
  }

  if (wikiCache.db) {
    return;
  }

  if (!wikiCache.initPromise) {
    wikiCache.initPromise = (async () => {
      const config = await getWikiEnvironmentConfig();
      await indexer.assertWikiRootAccessible();
      await indexer.ensureDbDirectory();
      const hadExistingArtifacts = await indexer.hasExistingIndexArtifacts();
      const indexDbPath = requireIndexDbPath();
      let db: SqliteDb | null = null;

      try {
        if (hadExistingArtifacts) {
          try {
            db = openIndexDb(indexDbPath);
            const integrity = runStartupIntegrityCheck(db, {
              cacheVersion: CACHE_VERSION,
              formatErrorMessage: errorMessage,
              onResult: recordIntegrityCheck,
            });

            if (!integrity.ok) {
              console.warn(
                `Wiki index integrity check failed for ${indexDbPath}: ${integrity.error}. Rebuilding from vault.`,
              );
              closeDbHandle(db);
              db = null;
              await quarantineCorruptIndexFiles(indexDbPath, Date.now());
            }
          } catch (error) {
            const openError = errorMessage(error, "Failed to open wiki index");
            recordIntegrityCheck(false, openError);
            console.warn(
              `Wiki index could not be opened cleanly at ${indexDbPath}: ${openError}. Rebuilding from vault.`,
            );
            closeDbHandle(db);
            db = null;
            await quarantineCorruptIndexFiles(indexDbPath, Date.now());
          }
        }

        if (!db) {
          db = openIndexDb(indexDbPath);
          runDbMigrations(db, { cacheVersion: CACHE_VERSION });
          seedCategoryRules(db, buildCategorySeeds(config));

          const integrity = runStartupIntegrityCheck(db, {
            cacheVersion: CACHE_VERSION,
            formatErrorMessage: errorMessage,
            onResult: recordIntegrityCheck,
          });
          if (!integrity.ok) {
            throw new Error(`Fresh wiki index integrity check failed: ${integrity.error}`);
          }

          wikiCache.db = db;
          await indexer.reconcileIndexWithDisk({ forceAll: true, source: "startup" });
        } else {
          runDbMigrations(db, { cacheVersion: CACHE_VERSION });
          seedCategoryRules(db, buildCategorySeeds(config));

          wikiCache.db = db;
          await indexer.reconcileIndexWithDisk({ source: "startup" });
        }

        void getWatcherController().startWikiWatcher();
      } catch (error) {
        closeDbHandle(db);
        throw error;
      }
    })().finally(() => {
      wikiCache.initPromise = null;
    });
  }

  await wikiCache.initPromise;
}

export async function primeWikiSnapshot() {
  await ensureIndexReady();
  return queries.getDerivedData();
}

export async function reindexWikiSnapshot() {
  await ensureIndexReady();

  if (wikiCache.watcherDebounceTimer) {
    clearTimeout(wikiCache.watcherDebounceTimer);
    wikiCache.watcherDebounceTimer = null;
  }
  wikiCache.pendingPaths.clear();
  wikiCache.pendingFullReconcile = false;

  await indexer.reconcileIndexWithDisk({ forceAll: true, source: "reindex" });
  const derived = await queries.getDerivedData();
  return derived.stats;
}

export async function searchWiki(query: string) {
  return queries.searchWiki(query);
}

export async function getWikiStats() {
  return queries.getWikiStats();
}

export async function getHomepageData() {
  return queries.getHomepageData();
}

export async function getGraphData() {
  return queries.getGraphData();
}

export async function getWikiPage(slugParts: string[]) {
  return queries.getWikiPage(slugParts);
}

export async function getWikiIndexStatus() {
  return queries.getWikiIndexStatus();
}

export async function getWikiHealthStatus() {
  return queries.getWikiHealthStatus();
}

export async function getWikiRootPath() {
  const runtime = await syncRuntimeSettings();
  return runtime.wikiRoot;
}

export async function getWikiIndexPath() {
  const runtime = await syncRuntimeSettings();
  return runtime.indexDbPath;
}

export function formatWikiError(error: unknown) {
  return errorMessage(error, "Wiki index error");
}
