import { promises as fs } from "node:fs";
import path from "node:path";

import type { WikiHeading } from "./wiki-shared";

export interface BacklinkReference {
  targetRaw: string;
  targetSlug: string;
}

export interface IndexedWikiPage {
  file: string;
  slug: string;
  title: string;
  titleLower: string;
  markdown: string;
  contentMarkdown: string;
  contentLower: string;
  wordCount: number;
  backlinkReferences: BacklinkReference[];
  categoryNames: string[];
  hasCodeBlocks: boolean;
  headings: WikiHeading[];
  modifiedAt: number;
  summary: string;
  isPerson: boolean;
}

export interface ReconcileStats {
  upserted: number;
  deleted: number;
}

export type SyncSource = "startup" | "watcher" | "reindex" | "periodic" | "manual";

export interface ParsedWikiFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

export interface PreparedWikiMarkdown {
  contentMarkdown: string;
  hasCodeBlocks: boolean;
  headings: WikiHeading[];
}

export interface WikiIndexerRuntimeDependencies {
  syncRuntimeSettings: () => Promise<unknown>;
  requireWikiRoot: () => string;
  requireIndexDbPath: () => string;
}

export interface WikiIndexerPathDependencies {
  normalizeRelativePath: (value: string) => string;
  isIgnoredDirectoryName: (name: string) => boolean;
  shouldIndexRelativeFile: (file: string) => boolean;
}

export interface WikiIndexerPageDependencies<TConfig = unknown>
  extends WikiIndexerRuntimeDependencies {
  getWikiEnvironmentConfig: () => Promise<TConfig>;
  titleFromFileName: (file: string) => string;
  slugFromFileName: (file: string) => string;
  parseWikiFrontmatter: (markdown: string) => ParsedWikiFrontmatter;
  prepareWikiMarkdown: (markdown: string) => PreparedWikiMarkdown;
  deriveCategoryNames: (
    file: string,
    title: string,
    contentMarkdown: string,
    frontmatter: Record<string, unknown>,
    config: TConfig,
  ) => string[];
  detectPersonPage: (
    file: string,
    title: string,
    contentMarkdown: string,
    frontmatter: Record<string, unknown>,
    config: TConfig,
  ) => boolean;
  extractBacklinkReferences: (markdown: string) => BacklinkReference[];
  extractSummary: (markdown: string) => string;
}

export interface WikiIndexerDbDependencies<TDb> extends WikiIndexerRuntimeDependencies {
  requireDb: () => TDb;
  upsertPageRecord: (db: TDb, page: IndexedWikiPage) => void;
  deletePageByFile: (db: TDb, file: string) => boolean;
  selectPageModifiedAt: (db: TDb, file: string) => number | undefined;
  listIndexedPages: (db: TDb) => Array<{ file: string; modifiedAt: number }>;
}

export interface WikiIndexerSyncDependencies {
  markRevisionChanged?: () => void;
  recordSyncSuccess?: (source: SyncSource) => void;
  recordSyncError?: (source: SyncSource, error: unknown) => void;
}

export type WikiIndexerDependencies<TDb, TConfig = unknown> = WikiIndexerPathDependencies &
  WikiIndexerPageDependencies<TConfig> &
  WikiIndexerDbDependencies<TDb> &
  WikiIndexerSyncDependencies;

export interface ReconcileOptions {
  forceAll?: boolean;
  source?: SyncSource | null;
}

export interface WikiIndexer<TDb, TConfig = unknown> {
  assertWikiRootAccessible: () => Promise<void>;
  collectMarkdownFiles: (dir: string, root: string) => Promise<string[]>;
  loadIndexedWikiPage: (
    file: string,
    modifiedAtOverride?: number,
  ) => Promise<IndexedWikiPage | null>;
  ensureDbDirectory: () => Promise<void>;
  pathExists: (filePath: string) => Promise<boolean>;
  hasExistingIndexArtifacts: () => Promise<boolean>;
  syncSinglePath: (relativePath: string) => Promise<boolean>;
  reconcileIndexWithDisk: (options?: ReconcileOptions) => Promise<ReconcileStats>;
  dependencies: WikiIndexerDependencies<TDb, TConfig>;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isMissingPathError(error: unknown) {
  return isErrnoException(error) && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

export async function assertWikiRootAccessible(
  deps: WikiIndexerRuntimeDependencies,
): Promise<void> {
  await deps.syncRuntimeSettings();
  const wikiRoot = deps.requireWikiRoot();
  const stat = await fs.stat(wikiRoot);

  if (!stat.isDirectory()) {
    throw new Error(`WIKI_ROOT is not a directory: ${wikiRoot}`);
  }
}

export async function collectMarkdownFiles(
  dir: string,
  root: string,
  deps: WikiIndexerPathDependencies,
): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (deps.isIgnoredDirectoryName(entry.name)) {
        continue;
      }

      files.push(...(await collectMarkdownFiles(fullPath, root, deps)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = deps.normalizeRelativePath(path.relative(root, fullPath));
    if (deps.shouldIndexRelativeFile(relativePath)) {
      files.push(relativePath);
    }
  }

  return files;
}

export async function loadIndexedWikiPage<TConfig>(
  file: string,
  deps: WikiIndexerPageDependencies<TConfig>,
  modifiedAtOverride?: number,
): Promise<IndexedWikiPage | null> {
  const wikiRoot = deps.requireWikiRoot();
  const filePath = path.join(wikiRoot, file);

  try {
    const [markdown, modifiedAt] = await Promise.all([
      fs.readFile(filePath, "utf8"),
      modifiedAtOverride === undefined
        ? fs.stat(filePath).then((stat) => stat.mtimeMs)
        : Promise.resolve(modifiedAtOverride),
    ]);

    const config = await deps.getWikiEnvironmentConfig();
    const title = deps.titleFromFileName(file);
    const titleLower = title.toLowerCase();
    const { data: frontmatter, body } = deps.parseWikiFrontmatter(markdown);
    const prepared = deps.prepareWikiMarkdown(body);
    const categoryNames = deps.deriveCategoryNames(
      file,
      title,
      prepared.contentMarkdown,
      frontmatter,
      config,
    );
    const isPerson = deps.detectPersonPage(
      file,
      title,
      prepared.contentMarkdown,
      frontmatter,
      config,
    );

    return {
      file,
      slug: deps.slugFromFileName(file),
      title,
      titleLower,
      markdown: body,
      contentMarkdown: prepared.contentMarkdown,
      contentLower: prepared.contentMarkdown.toLowerCase(),
      wordCount: prepared.contentMarkdown.split(/\s+/).filter(Boolean).length,
      backlinkReferences: deps.extractBacklinkReferences(body),
      categoryNames,
      hasCodeBlocks: prepared.hasCodeBlocks,
      headings: prepared.headings,
      modifiedAt,
      summary: deps.extractSummary(prepared.contentMarkdown),
      isPerson,
    };
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }

    throw error;
  }
}

export async function ensureDbDirectory(
  deps: Pick<WikiIndexerRuntimeDependencies, "requireIndexDbPath">,
): Promise<void> {
  await fs.mkdir(path.dirname(deps.requireIndexDbPath()), { recursive: true });
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export async function hasExistingIndexArtifacts(
  deps: Pick<WikiIndexerRuntimeDependencies, "requireIndexDbPath">,
): Promise<boolean> {
  const indexDbPath = deps.requireIndexDbPath();
  const paths = [indexDbPath, `${indexDbPath}-wal`, `${indexDbPath}-shm`];

  for (const filePath of paths) {
    if (await pathExists(filePath)) {
      return true;
    }
  }

  return false;
}

export async function syncSinglePath<TDb, TConfig>(
  relativePath: string,
  deps: WikiIndexerDependencies<TDb, TConfig>,
): Promise<boolean> {
  const db = deps.requireDb();
  const wikiRoot = deps.requireWikiRoot();
  const normalizedPath = deps.normalizeRelativePath(relativePath);
  if (!normalizedPath) {
    return false;
  }

  if (!normalizedPath.endsWith(".md")) {
    return false;
  }

  if (!deps.shouldIndexRelativeFile(normalizedPath)) {
    return deps.deletePageByFile(db, normalizedPath);
  }

  const absolutePath = path.join(wikiRoot, normalizedPath);
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      return deps.deletePageByFile(db, normalizedPath);
    }

    const existingModifiedAt = deps.selectPageModifiedAt(db, normalizedPath);
    if (existingModifiedAt !== undefined && Math.abs(existingModifiedAt - stat.mtimeMs) < 0.5) {
      return false;
    }

    const page = await loadIndexedWikiPage(normalizedPath, deps, stat.mtimeMs);
    if (!page) {
      return deps.deletePageByFile(db, normalizedPath);
    }

    deps.upsertPageRecord(db, page);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return deps.deletePageByFile(db, normalizedPath);
    }

    throw error;
  }
}

export async function reconcileIndexWithDisk<TDb, TConfig>(
  deps: WikiIndexerDependencies<TDb, TConfig>,
  options: ReconcileOptions = {},
): Promise<ReconcileStats> {
  const source = options.source ?? null;

  try {
    await assertWikiRootAccessible(deps);
    const wikiRoot = deps.requireWikiRoot();
    const db = deps.requireDb();
    const files = (await collectMarkdownFiles(wikiRoot, wikiRoot, deps)).sort();
    const fileSet = new Set(files);
    const existingRows = deps.listIndexedPages(db);
    const existingMap = new Map(existingRows.map((row) => [row.file, row.modifiedAt]));

    let upserted = 0;
    let deleted = 0;

    for (const file of files) {
      const fullPath = path.join(wikiRoot, file);
      const stat = await fs.stat(fullPath);
      const modifiedAt = existingMap.get(file);
      const needsUpdate =
        options.forceAll === true ||
        modifiedAt === undefined ||
        Math.abs(modifiedAt - stat.mtimeMs) >= 0.5;

      if (!needsUpdate) {
        continue;
      }

      const page = await loadIndexedWikiPage(file, deps, stat.mtimeMs);
      if (!page) {
        continue;
      }

      deps.upsertPageRecord(db, page);
      upserted += 1;
    }

    for (const existingFile of existingMap.keys()) {
      if (fileSet.has(existingFile)) {
        continue;
      }

      if (deps.deletePageByFile(db, existingFile)) {
        deleted += 1;
      }
    }

    if (upserted > 0 || deleted > 0) {
      deps.markRevisionChanged?.();
    }

    if (source) {
      deps.recordSyncSuccess?.(source);
    }

    return { upserted, deleted };
  } catch (error) {
    if (source) {
      deps.recordSyncError?.(source, error);
    }

    throw error;
  }
}

export function createWikiIndexer<TDb, TConfig>(
  dependencies: WikiIndexerDependencies<TDb, TConfig>,
): WikiIndexer<TDb, TConfig> {
  return {
    assertWikiRootAccessible: () => assertWikiRootAccessible(dependencies),
    collectMarkdownFiles: (dir, root) => collectMarkdownFiles(dir, root, dependencies),
    loadIndexedWikiPage: (file, modifiedAtOverride) =>
      loadIndexedWikiPage(file, dependencies, modifiedAtOverride),
    ensureDbDirectory: () => ensureDbDirectory(dependencies),
    pathExists,
    hasExistingIndexArtifacts: () => hasExistingIndexArtifacts(dependencies),
    syncSinglePath: (relativePath) => syncSinglePath(relativePath, dependencies),
    reconcileIndexWithDisk: (options) => reconcileIndexWithDisk(dependencies, options),
    dependencies,
  };
}
