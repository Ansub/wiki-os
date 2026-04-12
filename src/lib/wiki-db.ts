import Database from "better-sqlite3";

import type { WikiHeading } from "./wiki-shared";

export const DEFAULT_WIKI_INDEX_CACHE_VERSION = 4;
export const REQUIRED_INDEX_TABLES = ["pages", "backlinks", "categories", "pages_fts"] as const;

export type SqliteDb = Database.Database;

export interface BacklinkReferenceRecord {
  targetRaw: string;
  targetSlug: string;
}

export interface IndexedWikiPageRecord {
  file: string;
  slug: string;
  title: string;
  titleLower: string;
  markdown: string;
  contentMarkdown: string;
  contentLower: string;
  wordCount: number;
  backlinkReferences: BacklinkReferenceRecord[];
  categoryNames: string[];
  hasCodeBlocks: boolean;
  headings: WikiHeading[];
  modifiedAt: number;
  summary: string;
  isPerson: boolean;
}

export interface WikiDbCategorySeed {
  name: string;
  emoji: string;
  sortOrder: number;
}

export interface WikiDbMigrationOptions {
  cacheVersion?: number;
}

export interface WikiDbIntegrityCheckOptions extends WikiDbMigrationOptions {
  requiredTables?: readonly string[];
  formatErrorMessage?: (error: unknown, fallback: string) => string;
  onResult?: (ok: boolean, error: string | null) => void;
}

export interface WikiDbIntegrityCheckResult {
  ok: boolean;
  error: string | null;
}

function formatErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

function reportIntegrityCheck(
  options: WikiDbIntegrityCheckOptions | undefined,
  ok: boolean,
  error: string | null,
) {
  options?.onResult?.(ok, error);
}

function aggregateBacklinkReferences(
  references: BacklinkReferenceRecord[],
): Map<string, { targetRaw: string; count: number }> {
  const targets = new Map<string, { targetRaw: string; count: number }>();

  for (const reference of references) {
    const existing = targets.get(reference.targetSlug);
    if (existing) {
      existing.count += 1;
    } else {
      targets.set(reference.targetSlug, { targetRaw: reference.targetRaw, count: 1 });
    }
  }

  return targets;
}

export function applyDbPragmas(db: SqliteDb) {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("temp_store = MEMORY");
  db.pragma("cache_size = -32768");
  db.pragma("mmap_size = 268435456");
  db.pragma("wal_autocheckpoint = 4000");
  db.pragma("journal_size_limit = 67108864");
  db.pragma("optimize = 0x10002");
}

export function openIndexDb(indexDbPath: string) {
  const db = new Database(indexDbPath);
  applyDbPragmas(db);
  return db;
}

export function runDbMigrations(db: SqliteDb, options: WikiDbMigrationOptions = {}) {
  const cacheVersion = options.cacheVersion ?? DEFAULT_WIKI_INDEX_CACHE_VERSION;

  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      file TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      title_lower TEXT NOT NULL,
      markdown TEXT NOT NULL,
      content_markdown TEXT NOT NULL,
      content_lower TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      has_code_blocks INTEGER NOT NULL CHECK (has_code_blocks IN (0, 1)),
      headings_json TEXT NOT NULL,
      modified_at REAL NOT NULL,
      summary TEXT NOT NULL,
      is_person INTEGER NOT NULL CHECK (is_person IN (0, 1)),
      kind TEXT NOT NULL CHECK (kind IN ('page', 'source', 'raw')),
      category_names_json TEXT NOT NULL,
      backlink_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS backlinks (
      source_file TEXT NOT NULL REFERENCES pages(file) ON DELETE CASCADE,
      target_raw TEXT NOT NULL,
      target_slug TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL,
      PRIMARY KEY (source_file, target_slug)
    );

    CREATE INDEX IF NOT EXISTS idx_pages_kind ON pages(kind);
    CREATE INDEX IF NOT EXISTS idx_pages_modified ON pages(modified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pages_backlink ON pages(backlink_count DESC, modified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_backlinks_target_slug ON backlinks(target_slug);

    CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY,
      emoji TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
      file UNINDEXED,
      slug UNINDEXED,
      title,
      content
    );
  `);
  db.pragma(`user_version = ${cacheVersion}`);
}

export function seedCategoryRules(db: SqliteDb, categorySeeds: Iterable<WikiDbCategorySeed>) {
  const upsert = db.prepare(`
    INSERT INTO categories (name, emoji, sort_order)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      emoji = excluded.emoji,
      sort_order = excluded.sort_order
  `);
  const seed = db.transaction((seeds: WikiDbCategorySeed[]) => {
    db.prepare("DELETE FROM categories").run();

    for (const seedValue of seeds) {
      upsert.run(seedValue.name, seedValue.emoji, seedValue.sortOrder);
    }
  });

  seed([...categorySeeds]);
}

export function runStartupIntegrityCheck(
  db: SqliteDb,
  options: WikiDbIntegrityCheckOptions = {},
): WikiDbIntegrityCheckResult {
  const requiredTables = options.requiredTables ?? REQUIRED_INDEX_TABLES;
  const cacheVersion = options.cacheVersion ?? DEFAULT_WIKI_INDEX_CACHE_VERSION;
  const errorFormatter = options.formatErrorMessage ?? formatErrorMessage;

  try {
    const tableRows = db
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name IN (${requiredTables.map(() => "?").join(", ")})
        `,
      )
      .all(...requiredTables) as Array<{ name: string }>;
    const tableNames = new Set(tableRows.map((row) => row.name));

    for (const tableName of requiredTables) {
      if (!tableNames.has(tableName)) {
        const error = `missing required index table: ${tableName}`;
        reportIntegrityCheck(options, false, error);
        return { ok: false, error };
      }
    }

    const userVersion = db.pragma("user_version", { simple: true }) as number;
    if (userVersion !== cacheVersion) {
      const error = `index user_version ${userVersion} is incompatible with cache version ${cacheVersion}`;
      reportIntegrityCheck(options, false, error);
      return { ok: false, error };
    }

    const quickCheckRows = db.prepare("PRAGMA quick_check").pluck().all() as string[];
    const quickCheckError = quickCheckRows.find((row) => row !== "ok");
    if (quickCheckError) {
      const error = `quick_check failed: ${quickCheckError}`;
      reportIntegrityCheck(options, false, error);
      return { ok: false, error };
    }

    const foreignKeyRows = db.prepare("PRAGMA foreign_key_check").all() as Array<{
      table: string;
      rowid: number;
      parent: string;
      fkid: number;
    }>;
    if (foreignKeyRows.length > 0) {
      const firstRow = foreignKeyRows[0];
      const error = `foreign_key_check failed on ${firstRow.table} row ${firstRow.rowid} -> ${firstRow.parent} (${foreignKeyRows.length} issue(s))`;
      reportIntegrityCheck(options, false, error);
      return { ok: false, error };
    }

    reportIntegrityCheck(options, true, null);
    return { ok: true, error: null };
  } catch (error) {
    const message = errorFormatter(error, "startup integrity check failed");
    reportIntegrityCheck(options, false, message);
    return { ok: false, error: message };
  }
}

export function getSourceTargets(db: SqliteDb, sourceFile: string) {
  const rows = db
    .prepare("SELECT target_slug AS targetSlug FROM backlinks WHERE source_file = ?")
    .all(sourceFile) as Array<{ targetSlug: string }>;
  return rows.map((row) => row.targetSlug);
}

export function recomputeBacklinkCountsForSlugs(db: SqliteDb, slugs: Iterable<string>) {
  const uniqueSlugs = [...new Set([...slugs].filter(Boolean))];
  if (uniqueSlugs.length === 0) {
    return;
  }

  const countInbound = db.prepare(`
    SELECT COALESCE(SUM(occurrence_count), 0) AS count
    FROM backlinks
    WHERE target_slug = ?
  `);
  const updateBacklinkCount = db.prepare("UPDATE pages SET backlink_count = ? WHERE slug = ?");

  const run = db.transaction((targetSlugs: string[]) => {
    for (const slug of targetSlugs) {
      const row = countInbound.get(slug) as { count: number } | undefined;
      updateBacklinkCount.run(row?.count ?? 0, slug);
    }
  });

  run(uniqueSlugs);
}

export function upsertPageRecord(db: SqliteDb, page: IndexedWikiPageRecord) {
  const previousPage = db
    .prepare("SELECT slug FROM pages WHERE file = ?")
    .get(page.file) as { slug: string } | undefined;
  const previousTargets = getSourceTargets(db, page.file);
  const backlinkTargets = aggregateBacklinkReferences(page.backlinkReferences);

  const upsert = db.transaction(() => {
    db.prepare(`
      INSERT INTO pages (
        file,
        slug,
        title,
        title_lower,
        markdown,
        content_markdown,
        content_lower,
        word_count,
        has_code_blocks,
        headings_json,
        modified_at,
        summary,
        is_person,
        kind,
        category_names_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'page', ?)
      ON CONFLICT(file) DO UPDATE SET
        slug = excluded.slug,
        title = excluded.title,
        title_lower = excluded.title_lower,
        markdown = excluded.markdown,
        content_markdown = excluded.content_markdown,
        content_lower = excluded.content_lower,
        word_count = excluded.word_count,
        has_code_blocks = excluded.has_code_blocks,
        headings_json = excluded.headings_json,
        modified_at = excluded.modified_at,
        summary = excluded.summary,
        is_person = excluded.is_person,
        kind = 'page',
        category_names_json = excluded.category_names_json
    `).run(
      page.file,
      page.slug,
      page.title,
      page.titleLower,
      page.markdown,
      page.contentMarkdown,
      page.contentLower,
      page.wordCount,
      page.hasCodeBlocks ? 1 : 0,
      JSON.stringify(page.headings),
      page.modifiedAt,
      page.summary,
      page.isPerson ? 1 : 0,
      JSON.stringify(page.categoryNames),
    );

    db.prepare("DELETE FROM backlinks WHERE source_file = ?").run(page.file);
    const insertBacklink = db.prepare(`
      INSERT INTO backlinks (source_file, target_raw, target_slug, occurrence_count)
      VALUES (?, ?, ?, ?)
    `);
    for (const [targetSlug, target] of backlinkTargets) {
      insertBacklink.run(page.file, target.targetRaw, targetSlug, target.count);
    }

    db.prepare("DELETE FROM pages_fts WHERE file = ?").run(page.file);
    db.prepare(`
      INSERT INTO pages_fts (file, slug, title, content)
      VALUES (?, ?, ?, ?)
    `).run(page.file, page.slug, page.title, page.contentMarkdown);
  });

  upsert();

  const affectedSlugs = new Set<string>([page.slug, ...previousTargets, ...backlinkTargets.keys()]);
  if (previousPage?.slug) {
    affectedSlugs.add(previousPage.slug);
  }

  recomputeBacklinkCountsForSlugs(db, affectedSlugs);
}

export function deletePageByFile(db: SqliteDb, file: string) {
  const existingPage = db
    .prepare("SELECT slug FROM pages WHERE file = ?")
    .get(file) as { slug: string } | undefined;
  if (!existingPage) {
    return false;
  }

  const previousTargets = getSourceTargets(db, file);

  const remove = db.transaction(() => {
    db.prepare("DELETE FROM pages_fts WHERE file = ?").run(file);
    db.prepare("DELETE FROM pages WHERE file = ?").run(file);
  });
  remove();

  recomputeBacklinkCountsForSlugs(db, [existingPage.slug, ...previousTargets]);
  return true;
}
