export interface SearchMatch {
  heading: string;
  snippet: string;
}

export type PersonOverrideValue = "person" | "not-person";

export interface SearchResult {
  file: string;
  score: number;
  matches: SearchMatch[];
}

export interface BacklinkStat {
  page: string;
  count: number;
}

export interface WikiStats {
  total_pages: number;
  total_words: number;
  top_backlinks: BacklinkStat[];
}

export interface WikiHeading {
  text: string;
  id: string;
  level: number;
}

export interface WikiNeighbor {
  slug: string;
  title: string;
  backlinkCount: number;
  categories: string[];
}

export interface WikiPageData {
  slug: string;
  title: string;
  fileName: string;
  contentMarkdown: string;
  hasCodeBlocks: boolean;
  headings: WikiHeading[];
  modifiedAt: number;
  categories: string[];
  neighbors: WikiNeighbor[];
  isPerson: boolean;
  personOverride: PersonOverrideValue | null;
}

export interface PageSummary {
  file: string;
  slug: string;
  title: string;
  summary: string;
  backlinkCount: number;
  wordCount: number;
  modifiedAt: number;
}

export interface CategoryInfo {
  name: string;
  emoji: string;
  count: number;
  pages: PageSummary[];
}

export interface HomepageData {
  totalPages: number;
  totalWords: number;
  featured: PageSummary[];
  recentPages: PageSummary[];
  categories: CategoryInfo[];
  topConnected: PageSummary[];
  people: PageSummary[];
}

export interface GraphNode {
  slug: string;
  title: string;
  backlinkCount: number;
  wordCount: number;
  categories: string[];
  summary: string;
  neighbors: string[]; // slugs of connected nodes
}

export interface GraphEdge {
  source: string; // slug
  target: string; // slug
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function decodeSlugParts(parts: string[]) {
  return parts.map((part) => decodeURIComponent(part).trim()).filter(Boolean);
}

export function slugPartsFromFileName(fileName: string) {
  return fileName
    .replace(/\.md$/i, "")
    .split("/")
    .map((part) => encodeURIComponent(part));
}

export function slugFromFileName(fileName: string) {
  return slugPartsFromFileName(fileName).join("/");
}

export function titleFromFileName(fileName: string) {
  const withoutExtension = fileName.replace(/\.md$/i, "");
  const parts = withoutExtension.split("/");
  return parts[parts.length - 1] ?? withoutExtension;
}

/**
 * Resolve a relative path against a source file path (posix-style).
 * Handles ".", "..", and bare filenames.
 */
export function resolveRelativePath(relative: string, sourceFile: string): string {
  const dir = sourceFile.split("/").slice(0, -1);
  const parts = relative.split("/").filter(Boolean);

  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") { if (dir.length > 0) dir.pop(); continue; }
    dir.push(part);
  }

  return "/" + dir.join("/");
}

// Returns true for hrefs that produce no backlink: external, fragment-only
function isNonInternalHref(href: string): boolean {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return true;
  if (href.startsWith("#")) return true;
  return false;
}

// Strip fragment, resolve relative, ensure .md extension
function normalizeHrefPath(href: string, sourceFile?: string): string {
  let path = href;
  const hashIndex = path.indexOf("#");
  if (hashIndex >= 0) path = path.substring(0, hashIndex);
  if (!path.startsWith("/") && sourceFile) path = resolveRelativePath(path, sourceFile);
  return path.endsWith(".md") ? path : path + ".md";
}

/**
 * Convert a markdown link href to a wiki slug.
 * Returns null for external URLs and fragment-only links.
 */
export function hrefToSlug(href: string, sourceFile?: string): string | null {
  if (isNonInternalHref(href)) return null;
  const path = normalizeHrefPath(href, sourceFile);
  return slugFromFileName(path.replace(/^\/+/g, ""));
}
