import Database from "better-sqlite3";

import {
  buildFtsQuery,
  buildSearchMatches,
  countTermOccurrences,
} from "./wiki-classification";
import { getTopicEmoji, getTopicLabel, isTopicHidden, type WikiOsConfig } from "./wiki-config";
import {
  type CategoryInfo,
  type GraphData,
  type HomepageData,
  type PageSummary,
  type PersonOverrideValue,
  type SearchResult,
  type WikiHeading,
  type WikiPageData,
  type WikiStats,
  decodeSlugParts,
} from "./wiki-shared";

type SqliteDb = Database.Database;

export type SyncSource = "startup" | "watcher" | "reindex" | "periodic" | "manual";

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

export interface WikiIndexStatus {
  dbPath: string;
  totalPages: number;
  totalWords: number;
  periodicReconcileMs: number | null;
  lastSyncAtMs: number | null;
  lastSyncAt: string | null;
  lastSyncSource: SyncSource | null;
  lastSyncError: string | null;
}

export interface DerivedData {
  stats: WikiStats;
  homepage: HomepageData;
}

export interface WikiQueryCacheState {
  db: SqliteDb | null;
  revision: number;
  cacheRevision: number;
  derivedCache: DerivedData | null;
  personOverrides: Record<string, PersonOverrideValue>;
  lastSyncAtMs: number | null;
  lastSyncSource: SyncSource | null;
  lastSyncError: string | null;
  lastIntegrityCheckAtMs: number | null;
  lastIntegrityCheckOk: boolean | null;
  lastIntegrityCheckError: string | null;
  periodicReconcileTimer: unknown | null;
  periodicReconcilePromise: Promise<void> | null;
  pendingPaths: Set<string>;
  pendingFullReconcile: boolean;
  watcher: unknown | null;
  watcherPromise: Promise<void> | null;
  watcherFlushPromise: Promise<void> | null;
}

export interface WikiQueryDependencies {
  ensureIndexReady(): Promise<void>;
  drainPendingUpdates(): Promise<void>;
  getDb(): SqliteDb;
  getConfig(): Promise<WikiOsConfig>;
  getCacheState(): WikiQueryCacheState;
  getPeriodicReconcileIntervalMs(): number | null;
  getIndexDbPath(): string;
  recordIntegrityCheck(ok: boolean, error?: string | null): void;
  formatError(error: unknown, fallback: string): string;
}

export interface WikiQueries {
  getDerivedData(): Promise<DerivedData>;
  canonicalSlugFromRouteParts(slugParts: string[]): Promise<string>;
  searchWiki(query: string): Promise<SearchResult[]>;
  getWikiStats(): Promise<WikiStats>;
  getHomepageData(): Promise<HomepageData>;
  getGraphData(): Promise<GraphData>;
  getWikiPage(slugParts: string[]): Promise<WikiPageData>;
  getWikiIndexStatus(): Promise<WikiIndexStatus>;
  getWikiHealthStatus(): Promise<WikiHealthStatus>;
}

interface PageRow {
  file: string;
  slug: string;
  title: string;
  summary: string;
  wordCount: number;
  modifiedAt: number;
  backlinkCount: number;
  categoryNamesJson: string;
  isPerson: number;
}

interface SearchCandidate {
  file: string;
  title: string;
  titleLower: string;
  contentLower: string;
  markdown: string;
}

interface GraphNodeRow {
  slug: string;
  title: string;
  summary: string;
  backlinkCount: number;
  wordCount: number;
  categoryNamesJson: string;
}

interface GraphEdgeRow {
  source: string;
  target: string;
  weight: number;
}

interface PageNeighborRow {
  slug: string;
  title: string;
  backlinkCount: number;
  categoryNamesJson: string;
}

interface WikiPageRow {
  file: string;
  slug: string;
  title: string;
  contentMarkdown: string;
  hasCodeBlocks: number;
  headingsJson: string;
  modifiedAt: number;
  categoryNamesJson: string;
  isPerson: number;
}

function toIsoString(value: number | null) {
  return value === null ? null : new Date(value).toISOString();
}

export function parseJsonArray<T>(value: unknown): T[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function normalizeSearchTerms(query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return [];
  }

  return trimmed.split(/\s+/).filter(Boolean);
}

async function prepareRead(deps: WikiQueryDependencies) {
  await deps.ensureIndexReady();
  await deps.drainPendingUpdates();
}

function pickRandom<T>(items: T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

export async function getDerivedData(deps: WikiQueryDependencies): Promise<DerivedData> {
  await prepareRead(deps);

  const cache = deps.getCacheState();
  if (cache.derivedCache && cache.cacheRevision === cache.revision) {
    return cache.derivedCache;
  }

  const [config, db] = await Promise.all([deps.getConfig(), Promise.resolve(deps.getDb())]);
  const totals = db
    .prepare(`
      SELECT
        COUNT(*) AS totalPages,
        COALESCE(SUM(word_count), 0) AS totalWords
      FROM pages
    `)
    .get() as { totalPages: number; totalWords: number };

  const topBacklinks = db
    .prepare(`
      SELECT
        COALESCE(p.title, MIN(b.target_raw)) AS page,
        CAST(SUM(b.occurrence_count) AS INTEGER) AS count
      FROM backlinks b
      LEFT JOIN pages p ON p.slug = b.target_slug
      GROUP BY b.target_slug
      ORDER BY count DESC, page ASC
      LIMIT 15
    `)
    .all() as Array<{ page: string; count: number }>;

  const visibleRows = db
    .prepare(`
      SELECT
        file,
        slug,
        title,
        summary,
        word_count AS wordCount,
        modified_at AS modifiedAt,
        backlink_count AS backlinkCount,
        category_names_json AS categoryNamesJson,
        is_person AS isPerson
      FROM pages
    `)
    .all() as PageRow[];

  const pageSummaries = visibleRows.map<PageSummary>((row) => ({
    file: row.file,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    backlinkCount: row.backlinkCount,
    wordCount: row.wordCount,
    modifiedAt: row.modifiedAt,
  }));

  const pageSummariesByFile = new Map(pageSummaries.map((page) => [page.file, page]));
  const visiblePages = visibleRows.map((row) => ({
    ...row,
    topics: parseJsonArray<string>(row.categoryNamesJson),
  }));

  const recentPages = [...pageSummaries]
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, 6);
  const topConnected = [...pageSummaries]
    .sort((a, b) => b.backlinkCount - a.backlinkCount || b.modifiedAt - a.modifiedAt)
    .slice(0, 6);

  const topicPages = new Map<string, PageSummary[]>();

  for (const row of visiblePages) {
    const page = pageSummariesByFile.get(row.file);
    if (!page) {
      continue;
    }

    for (const topic of row.topics) {
      if (isTopicHidden(topic, config.categories.hidden)) {
        continue;
      }

      const label = getTopicLabel(topic, config.categories.aliases);
      const existing = topicPages.get(label);
      if (existing) {
        existing.push(page);
      } else {
        topicPages.set(label, [page]);
      }
    }
  }

  const categories: CategoryInfo[] = [...topicPages.entries()]
    .map(([name, pages]) => {
      const dedupedPages = [...new Map(pages.map((page) => [page.file, page])).values()].sort(
        (a, b) => b.backlinkCount - a.backlinkCount || b.modifiedAt - a.modifiedAt,
      );

      return {
        name,
        emoji: getTopicEmoji(name, config.categories.aliases),
        count: dedupedPages.length,
        pages: dedupedPages,
      };
    })
    .filter((category) => category.count > 0)
    .sort(
      (a, b) =>
        b.count - a.count ||
        (b.pages[0]?.backlinkCount ?? 0) - (a.pages[0]?.backlinkCount ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, config.categories.maxTopics);

  const people = visibleRows
    .filter((row) => row.isPerson === 1)
    .map((row) => pageSummariesByFile.get(row.file))
    .filter((page): page is PageSummary => page !== undefined)
    .sort((a, b) => b.backlinkCount - a.backlinkCount || a.title.localeCompare(b.title));

  const emptySummary: PageSummary = {
    file: "",
    slug: "",
    title: "No pages yet",
    summary: "",
    backlinkCount: 0,
    wordCount: 0,
    modifiedAt: 0,
  };

  const derivedData: DerivedData = {
    stats: {
      total_pages: totals.totalPages,
      total_words: totals.totalWords,
      top_backlinks: topBacklinks,
    },
    homepage: {
      totalPages: totals.totalPages,
      totalWords: totals.totalWords,
      featured: pickRandom(pageSummaries, 4),
      recentPages,
      categories,
      topConnected,
      people,
    },
  };

  cache.derivedCache = derivedData;
  cache.cacheRevision = cache.revision;
  return derivedData;
}

export async function canonicalSlugFromRouteParts(slugParts: string[]) {
  const decodedParts = decodeSlugParts(slugParts);
  if (decodedParts.length === 0) {
    throw new Error("Invalid wiki slug");
  }

  for (const part of decodedParts) {
    if (part === "." || part === ".." || part.includes("\0") || part.includes("\\")) {
      throw new Error("Invalid wiki slug");
    }
  }

  return decodedParts.map((part) => encodeURIComponent(part)).join("/");
}

export async function searchWiki(
  deps: WikiQueryDependencies,
  query: string,
): Promise<SearchResult[]> {
  await prepareRead(deps);

  const terms = normalizeSearchTerms(query);
  if (terms.length === 0) {
    return [];
  }

  const db = deps.getDb();
  const ftsQuery = buildFtsQuery(terms);

  let candidates: SearchCandidate[] = [];

  try {
    candidates = db
      .prepare(`
        SELECT
          p.file AS file,
          p.title AS title,
          p.title_lower AS titleLower,
          p.content_lower AS contentLower,
          p.markdown AS markdown
        FROM pages_fts f
        JOIN pages p ON p.file = f.file
        WHERE pages_fts MATCH ?
        ORDER BY bm25(pages_fts)
        LIMIT 80
      `)
      .all(ftsQuery) as SearchCandidate[];
  } catch {
    return [];
  }

  const results: SearchResult[] = [];

  for (const candidate of candidates) {
    let score = 0;
    const matchedTerms = new Set<string>();

    for (const term of terms) {
      if (candidate.titleLower.includes(term)) {
        score += 10;
        matchedTerms.add(term);
      }

      const count = countTermOccurrences(candidate.contentLower, term);
      if (count > 0) {
        score += count;
        matchedTerms.add(term);
      }
    }

    if (matchedTerms.size < terms.length || score === 0) {
      continue;
    }

    results.push({
      file: candidate.file,
      score,
      matches: buildSearchMatches(candidate.markdown, candidate.title, terms),
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}

export async function getWikiStats(deps: WikiQueryDependencies): Promise<WikiStats> {
  const derived = await getDerivedData(deps);
  return derived.stats;
}

export async function getHomepageData(deps: WikiQueryDependencies): Promise<HomepageData> {
  const derived = await getDerivedData(deps);
  return derived.homepage;
}

export async function getGraphData(deps: WikiQueryDependencies): Promise<GraphData> {
  await prepareRead(deps);

  const [config, db] = await Promise.all([deps.getConfig(), Promise.resolve(deps.getDb())]);
  const nodes = db
    .prepare(`
      SELECT slug, title, summary, backlink_count AS backlinkCount, word_count AS wordCount, category_names_json AS categoryNamesJson
      FROM pages
    `)
    .all() as GraphNodeRow[];

  const edges = db
    .prepare(`
      SELECT p1.slug AS source, b.target_slug AS target, b.occurrence_count AS weight
      FROM backlinks b
      JOIN pages p1 ON p1.file = b.source_file
      JOIN pages p2 ON p2.slug = b.target_slug
    `)
    .all() as GraphEdgeRow[];

  const neighborMap = new Map<string, Set<string>>();
  for (const edge of edges) {
    const sourceNeighbors = neighborMap.get(edge.source) ?? new Set<string>();
    sourceNeighbors.add(edge.target);
    neighborMap.set(edge.source, sourceNeighbors);

    const targetNeighbors = neighborMap.get(edge.target) ?? new Set<string>();
    targetNeighbors.add(edge.source);
    neighborMap.set(edge.target, targetNeighbors);
  }

  const visibleNodes = nodes
    .map((node) => ({
      slug: node.slug,
      title: node.title,
      backlinkCount: node.backlinkCount,
      wordCount: node.wordCount,
      categories: parseJsonArray<string>(node.categoryNamesJson),
      summary: node.summary,
      neighbors: [...(neighborMap.get(node.slug) ?? [])],
    }))
    .filter(
      (node) =>
        node.categories.length === 0 ||
        node.categories.some((category) => !isTopicHidden(category, config.categories.hidden)),
    );

  const visibleSlugs = new Set(visibleNodes.map((node) => node.slug));

  return {
    nodes: visibleNodes.map((node) => ({
      ...node,
      neighbors: node.neighbors.filter((slug) => visibleSlugs.has(slug)),
    })),
    edges: edges.filter(
      (edge) => visibleSlugs.has(edge.source) && visibleSlugs.has(edge.target),
    ),
  };
}

export async function getWikiPage(
  deps: WikiQueryDependencies,
  slugParts: string[],
): Promise<WikiPageData> {
  await prepareRead(deps);

  const canonicalSlug = await canonicalSlugFromRouteParts(slugParts);
  const db = deps.getDb();
  const row = db
    .prepare(`
      SELECT
        file,
        slug,
        title,
        content_markdown AS contentMarkdown,
        has_code_blocks AS hasCodeBlocks,
        headings_json AS headingsJson,
        modified_at AS modifiedAt,
        category_names_json AS categoryNamesJson,
        is_person AS isPerson
      FROM pages
      WHERE slug = ?
    `)
    .get(canonicalSlug) as WikiPageRow | undefined;

  if (!row) {
    throw new Error("Wiki page not found");
  }

  const outbound = db
    .prepare(`
      SELECT DISTINCT p.slug, p.title, p.backlink_count AS backlinkCount, p.category_names_json AS categoryNamesJson
      FROM backlinks b
      JOIN pages p ON p.slug = b.target_slug
      WHERE b.source_file = ?
    `)
    .all(row.file) as PageNeighborRow[];

  const inbound = db
    .prepare(`
      SELECT DISTINCT p.slug, p.title, p.backlink_count AS backlinkCount, p.category_names_json AS categoryNamesJson
      FROM backlinks b
      JOIN pages p ON p.file = b.source_file
      WHERE b.target_slug = ?
    `)
    .all(row.slug) as PageNeighborRow[];

  const neighborMap = new Map<string, PageNeighborRow>();
  for (const neighbor of [...outbound, ...inbound]) {
    if (neighbor.slug !== row.slug) {
      neighborMap.set(neighbor.slug, neighbor);
    }
  }

  const neighbors = [...neighborMap.values()]
    .map((neighbor) => ({
      slug: neighbor.slug,
      title: neighbor.title,
      backlinkCount: neighbor.backlinkCount,
      categories: parseJsonArray<string>(neighbor.categoryNamesJson),
    }))
    .sort((a, b) => b.backlinkCount - a.backlinkCount);

  const cache = deps.getCacheState();

  return {
    slug: row.slug,
    title: row.title,
    fileName: row.file,
    contentMarkdown: row.contentMarkdown,
    hasCodeBlocks: row.hasCodeBlocks === 1,
    headings: parseJsonArray<WikiHeading>(row.headingsJson),
    modifiedAt: row.modifiedAt,
    categories: parseJsonArray<string>(row.categoryNamesJson),
    neighbors,
    isPerson: row.isPerson === 1,
    personOverride: cache.personOverrides[row.file] ?? null,
  };
}

export async function getWikiIndexStatus(
  deps: WikiQueryDependencies,
): Promise<WikiIndexStatus> {
  await prepareRead(deps);

  const db = deps.getDb();
  const cache = deps.getCacheState();
  const periodicReconcileMs = deps.getPeriodicReconcileIntervalMs();
  const row = db
    .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(word_count), 0) AS words FROM pages")
    .get() as { count: number; words: number };

  return {
    dbPath: deps.getIndexDbPath(),
    totalPages: row.count,
    totalWords: row.words,
    periodicReconcileMs,
    lastSyncAtMs: cache.lastSyncAtMs,
    lastSyncAt: toIsoString(cache.lastSyncAtMs),
    lastSyncSource: cache.lastSyncSource,
    lastSyncError: cache.lastSyncError,
  };
}

export async function getWikiHealthStatus(
  deps: WikiQueryDependencies,
): Promise<WikiHealthStatus> {
  await prepareRead(deps);

  const periodicReconcileMs = deps.getPeriodicReconcileIntervalMs();
  const cache = deps.getCacheState();

  let pagesCount: number | null = null;
  let ftsCount: number | null = null;

  try {
    const db = deps.getDb();
    const row = db
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM pages) AS pagesCount,
          (SELECT COUNT(*) FROM pages_fts) AS ftsCount
      `)
      .get() as { pagesCount: number; ftsCount: number };

    pagesCount = row.pagesCount;
    ftsCount = row.ftsCount;

    if (pagesCount === ftsCount) {
      deps.recordIntegrityCheck(true, null);
    } else {
      deps.recordIntegrityCheck(
        false,
        `Page/FTS count mismatch: pages=${pagesCount}, fts=${ftsCount}`,
      );
    }
  } catch (error) {
    deps.recordIntegrityCheck(false, deps.formatError(error, "Integrity check failed"));
  }

  return {
    sync: {
      lastSyncAtMs: cache.lastSyncAtMs,
      lastSyncAt: toIsoString(cache.lastSyncAtMs),
      lastSyncSource: cache.lastSyncSource,
      lastSyncError: cache.lastSyncError,
      periodicReconcileMs,
      periodicReconcileScheduled: cache.periodicReconcileTimer !== null,
      periodicReconcileInFlight: cache.periodicReconcilePromise !== null,
      pendingPaths: cache.pendingPaths.size,
      pendingFullReconcile: cache.pendingFullReconcile,
      watcherActive: cache.watcher !== null,
      watcherStarting: cache.watcherPromise !== null,
      watcherFlushInFlight: cache.watcherFlushPromise !== null,
      revision: cache.revision,
      cacheRevision: cache.cacheRevision,
    },
    integrity: {
      ok: cache.lastIntegrityCheckOk,
      lastCheckAt: toIsoString(cache.lastIntegrityCheckAtMs),
      error: cache.lastIntegrityCheckError,
      dbReady: cache.db !== null,
      pagesCount,
      ftsCount,
    },
  };
}

export function createWikiQueries(deps: WikiQueryDependencies): WikiQueries {
  return {
    getDerivedData: () => getDerivedData(deps),
    canonicalSlugFromRouteParts,
    searchWiki: (query) => searchWiki(deps, query),
    getWikiStats: () => getWikiStats(deps),
    getHomepageData: () => getHomepageData(deps),
    getGraphData: () => getGraphData(deps),
    getWikiPage: (slugParts) => getWikiPage(deps, slugParts),
    getWikiIndexStatus: () => getWikiIndexStatus(deps),
    getWikiHealthStatus: () => getWikiHealthStatus(deps),
  };
}
