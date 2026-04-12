import type { FSWatcher } from "node:fs";

import type Database from "better-sqlite3";

import type { WikiRuntimeDependency } from "./wiki-environment";
import type {
  HomepageData,
  PersonOverrideValue,
  WikiStats,
} from "./wiki-shared";

export const CACHE_VERSION = 4;

type SqliteDb = Database.Database;

export type SyncSource = "startup" | "watcher" | "reindex" | "periodic" | "manual";

export interface ReconcileStats {
  upserted: number;
  deleted: number;
}

export interface WikiHealthStatus {
  sync: {
    lastSyncAtMs: number | null;
    lastSyncAt: string | null;
    lastSyncSource: SyncSource | null;
    lastSyncError: string | null;
    periodicReconcileMs: number | null;
    periodicReconcileScheduled: boolean;
    periodicReconcileInFlight: boolean;
    pendingPaths: number;
    pendingFullReconcile: boolean;
    watcherActive: boolean;
    watcherStarting: boolean;
    watcherFlushInFlight: boolean;
    revision: number;
    cacheRevision: number;
  };
  integrity: {
    ok: boolean | null;
    lastCheckAt: string | null;
    error: string | null;
    dbReady: boolean;
    pagesCount: number | null;
    ftsCount: number | null;
  };
}

export interface DerivedData {
  stats: WikiStats;
  homepage: HomepageData;
}

export interface WikiCacheState {
  version: number;
  db: SqliteDb | null;
  initPromise: Promise<void> | null;
  periodicReconcileTimer: NodeJS.Timeout | null;
  periodicReconcilePromise: Promise<void> | null;
  watcher: FSWatcher | null;
  watcherPromise: Promise<void> | null;
  watcherDebounceTimer: NodeJS.Timeout | null;
  watcherRestartTimer: NodeJS.Timeout | null;
  watcherStableTimer: NodeJS.Timeout | null;
  watcherRestartAttempts: number;
  watcherNeedsPostRestartReconcile: boolean;
  suppressWatcherRestart: boolean;
  watcherFlushPromise: Promise<void> | null;
  pendingPaths: Set<string>;
  pendingFullReconcile: boolean;
  revision: number;
  cacheRevision: number;
  derivedCache: DerivedData | null;
  wikiRoot: string | null;
  indexDbPath: string | null;
  runtimeKey: string | null;
  personOverrides: Record<string, PersonOverrideValue>;
  lastSyncAtMs: number | null;
  lastSyncSource: SyncSource | null;
  lastSyncError: string | null;
  lastIntegrityCheckAtMs: number | null;
  lastIntegrityCheckOk: boolean | null;
  lastIntegrityCheckError: string | null;
}

export interface WikiStateDependencies {
  clearWatcherRestartTimer: () => void;
  clearWatcherStableTimer: () => void;
  clearPeriodicReconcileTimer: () => void;
  schedulePeriodicReconcile: () => void;
  resetWikiEnvironmentConfigCache: () => void;
  resolveWikiEnvironmentRuntime: () => Promise<WikiRuntimeDependency>;
  closeDbHandle: (db: SqliteDb | null) => void;
  formatSyncError?: (error: unknown, fallback: string) => string;
}

type GlobalWithWikiCache = typeof globalThis & {
  __wikiUiCache?: WikiCacheState;
};

function defaultFormatSyncError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function createInitialWikiCacheState(): WikiCacheState {
  return {
    version: CACHE_VERSION,
    db: null,
    initPromise: null,
    periodicReconcileTimer: null,
    periodicReconcilePromise: null,
    watcher: null,
    watcherPromise: null,
    watcherDebounceTimer: null,
    watcherRestartTimer: null,
    watcherStableTimer: null,
    watcherRestartAttempts: 0,
    watcherNeedsPostRestartReconcile: false,
    suppressWatcherRestart: false,
    watcherFlushPromise: null,
    pendingPaths: new Set<string>(),
    pendingFullReconcile: false,
    revision: 0,
    cacheRevision: -1,
    derivedCache: null,
    wikiRoot: null,
    indexDbPath: null,
    runtimeKey: null,
    personOverrides: {},
    lastSyncAtMs: null,
    lastSyncSource: null,
    lastSyncError: null,
    lastIntegrityCheckAtMs: null,
    lastIntegrityCheckOk: null,
    lastIntegrityCheckError: null,
  };
}

function hydrateWikiCacheState(cache: WikiCacheState) {
  cache.db ??= null;
  cache.initPromise ??= null;
  cache.periodicReconcileTimer ??= null;
  cache.periodicReconcilePromise ??= null;
  cache.watcher ??= null;
  cache.watcherPromise ??= null;
  cache.watcherDebounceTimer ??= null;
  cache.watcherRestartTimer ??= null;
  cache.watcherStableTimer ??= null;
  cache.watcherRestartAttempts ??= 0;
  cache.watcherNeedsPostRestartReconcile ??= false;
  cache.suppressWatcherRestart ??= false;
  cache.watcherFlushPromise ??= null;
  cache.pendingPaths = cache.pendingPaths instanceof Set ? cache.pendingPaths : new Set<string>();
  cache.pendingFullReconcile ??= false;
  cache.revision ??= 0;
  cache.cacheRevision ??= -1;
  cache.derivedCache ??= null;
  cache.wikiRoot ??= null;
  cache.indexDbPath ??= null;
  cache.runtimeKey ??= null;
  cache.personOverrides ??= {};
  cache.lastSyncAtMs ??= null;
  cache.lastSyncSource ??= null;
  cache.lastSyncError ??= null;
  cache.lastIntegrityCheckAtMs ??= null;
  cache.lastIntegrityCheckOk ??= null;
  cache.lastIntegrityCheckError ??= null;

  return cache;
}

function createBootstrappedWikiCache() {
  const globalCache = globalThis as GlobalWithWikiCache;
  const existingCache = globalCache.__wikiUiCache;
  const cache =
    existingCache?.version === CACHE_VERSION
      ? hydrateWikiCacheState(existingCache)
      : createInitialWikiCacheState();

  globalCache.__wikiUiCache = cache;
  return cache;
}

export const wikiCache = createBootstrappedWikiCache();

export function currentRuntimeKey(wikiRoot: string | null, indexDbPath: string | null) {
  return wikiRoot && indexDbPath ? `${wikiRoot}\u0000${indexDbPath}` : null;
}

export function clearRuntimeTimers(
  cache: WikiCacheState,
  dependencies: Pick<
    WikiStateDependencies,
    "clearWatcherRestartTimer" | "clearWatcherStableTimer" | "clearPeriodicReconcileTimer"
  >,
) {
  if (cache.watcherDebounceTimer) {
    clearTimeout(cache.watcherDebounceTimer);
    cache.watcherDebounceTimer = null;
  }

  dependencies.clearWatcherRestartTimer();
  dependencies.clearWatcherStableTimer();
  dependencies.clearPeriodicReconcileTimer();
}

export function resetDerivedCache(cache: WikiCacheState) {
  cache.derivedCache = null;
  cache.cacheRevision = -1;
}

export function resetWikiRuntimeCacheState(cache: WikiCacheState, dependencies: WikiStateDependencies) {
  clearRuntimeTimers(cache, dependencies);
  cache.pendingPaths.clear();
  cache.pendingFullReconcile = false;
  cache.watcherFlushPromise = null;
  cache.watcherPromise = null;
  cache.periodicReconcilePromise = null;
  cache.initPromise = null;
  cache.watcherRestartAttempts = 0;
  cache.watcherNeedsPostRestartReconcile = false;
  resetDerivedCache(cache);
}

export async function closeWikiWatcher(
  cache: WikiCacheState,
  dependencies: Pick<WikiStateDependencies, "clearWatcherStableTimer">,
) {
  const watcher = cache.watcher;
  if (!watcher) {
    return;
  }

  cache.watcher = null;
  dependencies.clearWatcherStableTimer();

  try {
    watcher.close();
  } catch {
    // Ignore close errors while intentionally reloading runtime settings.
  }
}

export async function waitForRuntimeWorkToSettle(cache: WikiCacheState) {
  const activeWork = [
    cache.initPromise,
    cache.watcherFlushPromise,
    cache.periodicReconcilePromise,
  ].filter((work): work is Promise<void> => work !== null);

  if (activeWork.length === 0) {
    return;
  }

  await Promise.allSettled(activeWork);
}

export async function reloadWikiRuntimeState(
  cache: WikiCacheState,
  nextWikiRoot: string | null,
  nextIndexDbPath: string | null,
  nextPersonOverrides: Record<string, PersonOverrideValue>,
  dependencies: WikiStateDependencies,
) {
  cache.suppressWatcherRestart = true;

  try {
    clearRuntimeTimers(cache, dependencies);
    await waitForRuntimeWorkToSettle(cache);

    if (cache.watcher || cache.db) {
      await closeWikiWatcher(cache, dependencies);

      if (cache.db) {
        const db = cache.db;
        cache.db = null;
        resetDerivedCache(cache);

        try {
          dependencies.closeDbHandle(db);
        } catch {
          // Preserve the original runtime reload error and continue resetting state.
        }
      }
    }

    resetWikiRuntimeCacheState(cache, dependencies);
    dependencies.resetWikiEnvironmentConfigCache();
    cache.wikiRoot = nextWikiRoot;
    cache.indexDbPath = nextIndexDbPath;
    cache.runtimeKey = currentRuntimeKey(nextWikiRoot, nextIndexDbPath);
    cache.personOverrides = nextPersonOverrides;
  } finally {
    cache.suppressWatcherRestart = false;
  }
}

export async function syncRuntimeSettings(
  cache: WikiCacheState,
  dependencies: Pick<
    WikiStateDependencies,
    "resolveWikiEnvironmentRuntime" | "resetWikiEnvironmentConfigCache" | "clearWatcherRestartTimer" |
      "clearWatcherStableTimer" | "clearPeriodicReconcileTimer" | "schedulePeriodicReconcile" |
      "closeDbHandle" | "formatSyncError"
  >,
) {
  const runtime = await dependencies.resolveWikiEnvironmentRuntime();
  const nextRuntimeKey = currentRuntimeKey(runtime.wikiRoot, runtime.indexDbPath);

  if (cache.runtimeKey !== nextRuntimeKey) {
    await reloadWikiRuntimeState(cache, runtime.wikiRoot, runtime.indexDbPath, runtime.personOverrides, {
      ...dependencies,
      formatSyncError: dependencies.formatSyncError,
    });
  } else {
    cache.wikiRoot = runtime.wikiRoot;
    cache.indexDbPath = runtime.indexDbPath;
    cache.personOverrides = runtime.personOverrides;
  }

  return runtime;
}

export class WikiSetupRequiredError extends Error {
  constructor(message = "Wiki vault is not configured") {
    super(message);
    this.name = "WikiSetupRequiredError";
  }
}

export function requireWikiRoot(cache: WikiCacheState) {
  if (!cache.wikiRoot) {
    throw new WikiSetupRequiredError();
  }

  return cache.wikiRoot;
}

export function requireIndexDbPath(cache: WikiCacheState) {
  if (!cache.indexDbPath) {
    throw new WikiSetupRequiredError();
  }

  return cache.indexDbPath;
}

export function recordSyncSuccess(
  cache: WikiCacheState,
  source: SyncSource,
  dependencies: Pick<WikiStateDependencies, "schedulePeriodicReconcile">,
) {
  cache.lastSyncAtMs = Date.now();
  cache.lastSyncSource = source;
  cache.lastSyncError = null;
  dependencies.schedulePeriodicReconcile();
}

export function recordSyncError(
  cache: WikiCacheState,
  source: SyncSource,
  error: unknown,
  dependencies: Pick<WikiStateDependencies, "schedulePeriodicReconcile" | "formatSyncError">,
) {
  cache.lastSyncAtMs = Date.now();
  cache.lastSyncSource = source;
  cache.lastSyncError = (dependencies.formatSyncError ?? defaultFormatSyncError)(
    error,
    "Wiki sync failed",
  );
  dependencies.schedulePeriodicReconcile();
}

export function recordIntegrityCheck(
  cache: WikiCacheState,
  ok: boolean,
  error: string | null = null,
) {
  cache.lastIntegrityCheckAtMs = Date.now();
  cache.lastIntegrityCheckOk = ok;
  cache.lastIntegrityCheckError = error;
}

export function markRevisionChanged(cache: WikiCacheState) {
  cache.revision += 1;
}

export function toIsoString(value: number | null) {
  return value === null ? null : new Date(value).toISOString();
}
