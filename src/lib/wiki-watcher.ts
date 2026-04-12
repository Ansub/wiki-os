import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

import { normalizeRelativePath } from "./wiki-file-utils";

export const WATCH_DEBOUNCE_MS = 350;
export const WATCH_RESTART_BASE_MS = 500;
export const WATCH_RESTART_MAX_MS = 30_000;
export const WATCH_RESTART_STABLE_MS = 60_000;
export const WATCH_RESTART_JITTER = 0.2;
export const DEFAULT_PERIODIC_RECONCILE_MS = 15 * 60 * 1000;

export type WikiWatcherTimer = ReturnType<typeof setTimeout>;
export type WikiWatcherSyncSource = "watcher" | "periodic";

export interface WatchEventClassification {
  file: string;
  shouldQueueFile: boolean;
  shouldReconcile: boolean;
}

export interface WatcherReconcileStats {
  upserted: number;
  deleted: number;
}

export interface WikiWatcherState {
  periodicReconcileTimer: WikiWatcherTimer | null;
  periodicReconcilePromise: Promise<void> | null;
  watcher: FSWatcher | null;
  watcherPromise: Promise<void> | null;
  watcherDebounceTimer: WikiWatcherTimer | null;
  watcherRestartTimer: WikiWatcherTimer | null;
  watcherStableTimer: WikiWatcherTimer | null;
  watcherRestartAttempts: number;
  watcherNeedsPostRestartReconcile: boolean;
  suppressWatcherRestart: boolean;
  watcherFlushPromise: Promise<void> | null;
  pendingPaths: Set<string>;
  pendingFullReconcile: boolean;
}

export interface WikiWatcherRuntimeOptions {
  nodeEnv?: string;
  disableWatch?: boolean;
  disablePeriodicReconcile?: boolean;
  periodicReconcileMs?: number | string | null | undefined;
}

export interface WikiWatcherDependencies {
  state: WikiWatcherState;
  env?: WikiWatcherRuntimeOptions;
  watch?: typeof watch;
  random?: () => number;
  assertWikiRootAccessible: () => Promise<void>;
  requireWikiRoot: () => string;
  ensureIndexReady: () => Promise<void>;
  reconcileIndexWithDisk: (options?: { source?: string }) => Promise<WatcherReconcileStats>;
  syncSinglePath: (relativePath: string) => Promise<boolean>;
  recordSyncSuccess: (source: WikiWatcherSyncSource) => void;
  recordSyncError: (source: WikiWatcherSyncSource, error: unknown) => void;
  markRevisionChanged: () => void;
}

export interface WikiWatcherController {
  getPeriodicReconcileIntervalMs(): number | null;
  clearPeriodicReconcileTimer(): void;
  schedulePeriodicReconcile(): void;
  drainPendingUpdates(): Promise<void>;
  flushPendingWatcherChanges(): Promise<void>;
  scheduleWatcherFlush(): void;
  clearWatcherRestartTimer(): void;
  clearWatcherStableTimer(): void;
  scheduleWatcherRestart(): void;
  armWatcherStableTimer(watcher: FSWatcher): void;
  queuePostRestartFullReconcile(): void;
  shouldHandleWatchPath(fileName: string | Buffer | null): WatchEventClassification;
  startWikiWatcher(): Promise<void>;
  runPeriodicReconcile(): Promise<void>;
}

export function getPeriodicReconcileIntervalMs(env: WikiWatcherRuntimeOptions = {}) {
  if (env.nodeEnv === "test" || env.disablePeriodicReconcile) {
    return null;
  }

  if (env.periodicReconcileMs === null || env.periodicReconcileMs === undefined) {
    return DEFAULT_PERIODIC_RECONCILE_MS;
  }

  const rawInterval =
    typeof env.periodicReconcileMs === "number"
      ? env.periodicReconcileMs
      : env.periodicReconcileMs.trim();

  if (rawInterval === "") {
    return DEFAULT_PERIODIC_RECONCILE_MS;
  }

  const parsedInterval =
    typeof rawInterval === "number" ? rawInterval : Number(rawInterval);
  if (!Number.isFinite(parsedInterval) || parsedInterval <= 0) {
    return null;
  }

  return Math.max(1_000, Math.floor(parsedInterval));
}

export function computeWatcherRestartDelay(
  attempt: number,
  random: () => number = Math.random,
) {
  const cappedBaseDelay = Math.min(
    WATCH_RESTART_BASE_MS * 2 ** Math.max(attempt - 1, 0),
    WATCH_RESTART_MAX_MS,
  );
  const jitterSpread = cappedBaseDelay * WATCH_RESTART_JITTER;
  const jitteredDelay = cappedBaseDelay - jitterSpread + random() * jitterSpread * 2;

  return Math.max(WATCH_RESTART_BASE_MS, Math.round(jitteredDelay));
}

export function shouldHandleWatchPath(
  fileName: string | Buffer | null,
): WatchEventClassification {
  if (!fileName) {
    return { file: "", shouldQueueFile: false, shouldReconcile: true };
  }

  const relativePath = normalizeRelativePath(fileName.toString());
  if (!relativePath) {
    return { file: "", shouldQueueFile: false, shouldReconcile: true };
  }

  const extension = path.extname(relativePath);
  if (!extension) {
    return { file: relativePath, shouldQueueFile: false, shouldReconcile: true };
  }

  if (extension === ".md") {
    return { file: relativePath, shouldQueueFile: true, shouldReconcile: false };
  }

  return { file: relativePath, shouldQueueFile: false, shouldReconcile: false };
}

export function createWikiWatcherController(
  dependencies: WikiWatcherDependencies,
): WikiWatcherController {
  const state = dependencies.state;
  const env = dependencies.env ?? {};
  const random = dependencies.random ?? Math.random;
  const watchImpl = dependencies.watch ?? watch;

  function clearPeriodicReconcileTimer() {
    if (state.periodicReconcileTimer) {
      clearTimeout(state.periodicReconcileTimer);
      state.periodicReconcileTimer = null;
    }
  }

  async function flushPendingWatcherChanges() {
    if (state.watcherFlushPromise) {
      return state.watcherFlushPromise;
    }

    const pendingPaths = [...state.pendingPaths];
    const needsFullReconcile = state.pendingFullReconcile;
    state.pendingPaths.clear();
    state.pendingFullReconcile = false;

    if (pendingPaths.length === 0 && !needsFullReconcile) {
      return;
    }

    state.watcherFlushPromise = (async () => {
      let changed = false;

      if (needsFullReconcile) {
        const reconciled = await dependencies.reconcileIndexWithDisk();
        changed = reconciled.upserted > 0 || reconciled.deleted > 0;
      }

      for (const pendingPath of pendingPaths) {
        const didChange = await dependencies.syncSinglePath(pendingPath);
        if (didChange) {
          changed = true;
        }
      }

      if (changed) {
        dependencies.markRevisionChanged();
      }

      if (needsFullReconcile || pendingPaths.length > 0) {
        dependencies.recordSyncSuccess("watcher");
      }
    })()
      .catch((error) => {
        // Preserve availability on transient watch errors and recover on next request.
        dependencies.recordSyncError("watcher", error);
        state.pendingFullReconcile = true;
      })
      .finally(() => {
        state.watcherFlushPromise = null;
        if (state.pendingFullReconcile || state.pendingPaths.size > 0) {
          scheduleWatcherFlush();
        }
      });

    return state.watcherFlushPromise;
  }

  function schedulePeriodicReconcile() {
    const intervalMs = getPeriodicReconcileIntervalMs(env);
    if (intervalMs === null) {
      clearPeriodicReconcileTimer();
      return;
    }

    clearPeriodicReconcileTimer();
    state.periodicReconcileTimer = setTimeout(() => {
      state.periodicReconcileTimer = null;
      void runPeriodicReconcile();
    }, intervalMs);
  }

  function scheduleWatcherFlush() {
    if (state.watcherDebounceTimer) {
      clearTimeout(state.watcherDebounceTimer);
    }

    state.watcherDebounceTimer = setTimeout(() => {
      state.watcherDebounceTimer = null;
      void flushPendingWatcherChanges();
    }, WATCH_DEBOUNCE_MS);
  }

  function clearWatcherRestartTimer() {
    if (!state.watcherRestartTimer) {
      return;
    }

    clearTimeout(state.watcherRestartTimer);
    state.watcherRestartTimer = null;
  }

  function clearWatcherStableTimer() {
    if (!state.watcherStableTimer) {
      return;
    }

    clearTimeout(state.watcherStableTimer);
    state.watcherStableTimer = null;
  }

  function scheduleWatcherRestart() {
    if (env.nodeEnv === "test" || env.disableWatch) {
      return;
    }

    if (state.watcher || state.watcherPromise || state.watcherRestartTimer) {
      return;
    }

    state.watcherRestartAttempts += 1;
    const delayMs = computeWatcherRestartDelay(state.watcherRestartAttempts, random);

    state.watcherRestartTimer = setTimeout(() => {
      state.watcherRestartTimer = null;
      void startWikiWatcher();
    }, delayMs);
  }

  function armWatcherStableTimer(watcher: FSWatcher) {
    clearWatcherStableTimer();
    state.watcherStableTimer = setTimeout(() => {
      if (state.watcher !== watcher) {
        return;
      }

      state.watcherStableTimer = null;
      state.watcherRestartAttempts = 0;
    }, WATCH_RESTART_STABLE_MS);
  }

  function queuePostRestartFullReconcile() {
    if (!state.watcherNeedsPostRestartReconcile) {
      return;
    }

    state.watcherNeedsPostRestartReconcile = false;
    state.pendingFullReconcile = true;
    scheduleWatcherFlush();
  }

  async function startWikiWatcher() {
    if (env.nodeEnv === "test" || env.disableWatch) {
      return;
    }

    if (state.watcher || state.watcherPromise) {
      return state.watcherPromise ?? undefined;
    }

    clearWatcherRestartTimer();
    state.watcherPromise = (async () => {
      await dependencies.assertWikiRootAccessible();
      const wikiRoot = dependencies.requireWikiRoot();
      const watcher = watchImpl(wikiRoot, { recursive: true }, (eventType, fileName) => {
        const watchEvent = shouldHandleWatchPath(fileName);
        if (watchEvent.shouldQueueFile) {
          state.pendingPaths.add(watchEvent.file);
        }
        if (watchEvent.shouldReconcile || eventType === "rename") {
          state.pendingFullReconcile = true;
        }
        if (watchEvent.shouldQueueFile || watchEvent.shouldReconcile || eventType === "rename") {
          scheduleWatcherFlush();
        }
      });

      let watcherClosed = false;
      const handleWatcherTermination = () => {
        if (watcherClosed) {
          return;
        }

        watcherClosed = true;
        clearWatcherStableTimer();

        if (state.watcher === watcher) {
          state.watcher = null;
        }

        if (state.suppressWatcherRestart) {
          return;
        }

        state.watcherNeedsPostRestartReconcile = true;
        state.pendingFullReconcile = true;
        scheduleWatcherFlush();

        try {
          watcher.close();
        } catch {
          // Ignore close errors while transitioning to the restart path.
        }

        scheduleWatcherRestart();
      };

      watcher.on("error", handleWatcherTermination);
      watcher.on("close", handleWatcherTermination);

      state.watcher = watcher;
      armWatcherStableTimer(watcher);
      queuePostRestartFullReconcile();
    })()
      .catch(() => {
        clearWatcherStableTimer();
        state.watcherNeedsPostRestartReconcile = true;
        scheduleWatcherRestart();
        // Keep serving from the persisted index if watcher setup fails.
      })
      .finally(() => {
        state.watcherPromise = null;
      });

    return state.watcherPromise;
  }

  async function runPeriodicReconcile() {
    if (state.periodicReconcilePromise) {
      return state.periodicReconcilePromise;
    }

    state.periodicReconcilePromise = (async () => {
      await dependencies.ensureIndexReady();

      const hasPendingWatcherWork =
        state.watcherDebounceTimer !== null ||
        state.watcherFlushPromise !== null ||
        state.pendingFullReconcile ||
        state.pendingPaths.size > 0;

      if (hasPendingWatcherWork) {
        await drainPendingUpdates();
        return;
      }

      await dependencies.reconcileIndexWithDisk({ source: "periodic" });
    })().finally(() => {
      state.periodicReconcilePromise = null;
      if (!state.periodicReconcileTimer) {
        schedulePeriodicReconcile();
      }
    });

    return state.periodicReconcilePromise;
  }

  async function drainPendingUpdates() {
    if (state.watcherDebounceTimer) {
      clearTimeout(state.watcherDebounceTimer);
      state.watcherDebounceTimer = null;
      await flushPendingWatcherChanges();
    } else if (state.watcherFlushPromise) {
      await state.watcherFlushPromise;
    }
  }

  return {
    getPeriodicReconcileIntervalMs: () => getPeriodicReconcileIntervalMs(env),
    clearPeriodicReconcileTimer,
    schedulePeriodicReconcile,
    drainPendingUpdates,
    flushPendingWatcherChanges,
    scheduleWatcherFlush,
    clearWatcherRestartTimer,
    clearWatcherStableTimer,
    scheduleWatcherRestart,
    armWatcherStableTimer,
    queuePostRestartFullReconcile,
    shouldHandleWatchPath,
    startWikiWatcher,
    runPeriodicReconcile,
  };
}
