import {
  formatTopicLabel,
  getTopicLabel,
  normalizeTopicKey,
  type WikiOsConfig,
} from "./wiki-config";
import { normalizeRelativePath } from "./wiki-file-utils";
import {
  slugFromFileName,
  type PersonOverrideValue,
  type SearchMatch,
} from "./wiki-shared";

export interface BacklinkReference {
  targetRaw: string;
  targetSlug: string;
}

export interface AggregatedBacklinkReference {
  targetRaw: string;
  count: number;
}

export const CONTENT_STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "because",
  "been",
  "being",
  "between",
  "could",
  "every",
  "first",
  "from",
  "have",
  "into",
  "local",
  "many",
  "more",
  "most",
  "note",
  "notes",
  "obsidian",
  "page",
  "their",
  "there",
  "these",
  "this",
  "through",
  "using",
  "what",
  "when",
  "where",
  "which",
  "wiki",
  "with",
  "your",
]);

export const PERSON_BIOGRAPHY_KEYWORDS = [
  "born",
  "author",
  "writer",
  "engineer",
  "founder",
  "entrepreneur",
  "businessman",
  "businesswoman",
  "philosopher",
  "scientist",
  "mathematician",
  "physicist",
  "inventor",
  "emperor",
  "king",
  "queen",
  "president",
  "strategist",
  "scholar",
  "teacher",
  "coach",
  "artist",
  "actor",
  "actress",
  "comedian",
  "creator",
  "youtuber",
  "podcaster",
  "minister",
  "prophet",
  "imam",
  "saint",
  "poet",
  "historian",
  "essayist",
  "investor",
  "operator",
  "athlete",
  "runner",
  "soldier",
  "monk",
  "ceo",
  "doctor",
  "physician",
  "programmer",
  "researcher",
  "ruler",
  "revolutionary",
  "statesman",
];

export const PERSON_SECTION_HEADINGS = new Set([
  "origin",
  "personal",
  "early life",
  "career",
  "ventures",
  "family",
  "legacy",
  "works",
  "biography",
  "life",
]);

export function extractSummary(markdown: string): string {
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (
      trimmed.length > 30 &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("-") &&
      !trimmed.startsWith("*") &&
      !trimmed.startsWith("[") &&
      !trimmed.startsWith("!")
    ) {
      return trimmed.length > 180 ? `${trimmed.slice(0, 180)}...` : trimmed;
    }
  }

  return "";
}

export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => toStringArray(item))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export function frontmatterEntries(frontmatter: Record<string, unknown>) {
  return Object.entries(frontmatter).map(([key, value]) => [normalizeTopicKey(key), value] as const);
}

export function collectFrontmatterTopics(
  frontmatter: Record<string, unknown>,
  config: WikiOsConfig,
) {
  const matched: string[] = [];

  for (const [key, value] of frontmatterEntries(frontmatter)) {
    if (!config.categories.frontmatterKeys.includes(key)) {
      continue;
    }

    matched.push(...toStringArray(value));
  }

  return matched;
}

export function collectFolderTopics(file: string, config: WikiOsConfig) {
  const parts = normalizeRelativePath(file).split("/").slice(0, -1);
  return parts.slice(0, config.categories.folderDepth);
}

export function collectHeuristicTopics(title: string, markdown: string) {
  const frequencies = new Map<string, number>();
  const titleWords = title.match(/[A-Za-z0-9][A-Za-z0-9'-]{2,}/g) ?? [];
  const bodyWords = markdown.match(/[A-Za-z0-9][A-Za-z0-9'-]{2,}/g) ?? [];

  for (const word of [...titleWords, ...bodyWords]) {
    const normalized = normalizeTopicKey(word);

    if (
      !normalized ||
      normalized.length < 4 ||
      CONTENT_STOPWORDS.has(normalized) ||
      /^\d+$/.test(normalized)
    ) {
      continue;
    }

    frequencies.set(normalized, (frequencies.get(normalized) ?? 0) + 1);
  }

  return [...frequencies.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([value]) => value);
}

export function dedupeTopics(
  values: string[],
  aliases: WikiOsConfig["categories"]["aliases"],
) {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const value of values) {
    const normalized = normalizeTopicKey(value);
    if (!normalized) {
      continue;
    }

    const label = getTopicLabel(value, aliases);
    const labelKey = normalizeTopicKey(label);
    if (!labelKey || seen.has(labelKey)) {
      continue;
    }

    seen.add(labelKey);
    labels.push(label);
  }

  return labels;
}

export function deriveCategoryNames(
  file: string,
  title: string,
  contentMarkdown: string,
  frontmatter: Record<string, unknown>,
  config: WikiOsConfig,
) {
  const frontmatterTopics = collectFrontmatterTopics(frontmatter, config);
  const folderTopics = collectFolderTopics(file, config);
  const heuristicTopics =
    frontmatterTopics.length > 0 || folderTopics.length > 0
      ? []
      : collectHeuristicTopics(title, contentMarkdown);

  const resolved = dedupeTopics(
    [...frontmatterTopics, ...folderTopics, ...heuristicTopics].map(formatTopicLabel),
    config.categories.aliases,
  );

  return resolved.slice(0, 5);
}

export function frontmatterHasTruthyValue(
  frontmatter: Record<string, unknown>,
  keys: string[],
) {
  for (const [key, value] of frontmatterEntries(frontmatter)) {
    if (!keys.includes(key)) {
      continue;
    }

    if (typeof value === "boolean") {
      if (value) {
        return true;
      }
      continue;
    }

    for (const item of toStringArray(value)) {
      const normalized = normalizeTopicKey(item);
      if (normalized === "person" || normalized === "people" || normalized === "biography") {
        return true;
      }
    }
  }

  return false;
}

export function frontmatterHasConfiguredPersonTag(
  frontmatter: Record<string, unknown>,
  config: WikiOsConfig,
) {
  return collectFrontmatterTopics(frontmatter, config).some((topic) =>
    config.people.tagNames.includes(normalizeTopicKey(topic)),
  );
}

export function detectExplicitPersonPage(
  file: string,
  frontmatter: Record<string, unknown>,
  config: WikiOsConfig,
) {
  const folderNames = normalizeRelativePath(file)
    .split("/")
    .slice(0, -1)
    .map(normalizeTopicKey);

  if (folderNames.some((name) => config.people.folderNames.includes(name))) {
    return true;
  }

  if (frontmatterHasTruthyValue(frontmatter, config.people.frontmatterKeys)) {
    return true;
  }

  return frontmatterHasConfiguredPersonTag(frontmatter, config);
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasLikelyPersonNameTitle(title: string) {
  const tokens = title
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0 || tokens.length > 4) {
    return 0;
  }

  const validNameToken = /^(?:[A-Z][a-z]+|[A-Z][a-z]+[-'][A-Za-z]+|[A-Z]\.|[A-Z][a-z]+\.)$/;
  if (!tokens.every((token) => validNameToken.test(token))) {
    return 0;
  }

  return tokens.length >= 2 ? 2 : 1;
}

export function extractLeadSentence(markdown: string) {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("#") &&
        !line.startsWith("-") &&
        !line.startsWith("*") &&
        !line.startsWith("[["),
    );

  const merged = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!merged) {
    return "";
  }

  const [firstSentence = merged] = merged.split(/(?<=[.!?])\s+/);
  return firstSentence.slice(0, 240).toLowerCase();
}

export function hasBiographySummaryCue(title: string, markdown: string) {
  const leadSentence = extractLeadSentence(markdown);
  if (!leadSentence) {
    return false;
  }

  const normalizedTitle = title.toLowerCase();
  const leadWindow = leadSentence.slice(0, 120);
  const directBiographyPattern =
    hasLikelyPersonNameTitle(title) >= 2
      ? new RegExp(`^${escapeRegex(normalizedTitle)}(?:\\s*\\([^)]*\\))?\\s+was\\b`)
      : null;

  if (
    leadSentence.startsWith("born ") ||
    (directBiographyPattern !== null && directBiographyPattern.test(leadSentence))
  ) {
    return true;
  }

  return PERSON_BIOGRAPHY_KEYWORDS.some((keyword) =>
    new RegExp(`\\b${keyword}\\b`).test(leadWindow),
  );
}

export function hasBiographySectionCue(markdown: string) {
  const headings = markdown.match(/^#+\s+(.+)$/gm) ?? [];

  return headings.some((headingLine) =>
    PERSON_SECTION_HEADINGS.has(normalizeTopicKey(headingLine.replace(/^#+\s+/, ""))),
  );
}

export function detectPersonFromContentHeuristics(title: string, markdown: string) {
  let score = hasLikelyPersonNameTitle(title);

  if (hasBiographySummaryCue(title, markdown)) {
    score += 2;
  }

  if (hasBiographySectionCue(markdown)) {
    score += 1;
  }

  return score >= 3;
}

export function detectPersonPage(
  file: string,
  title: string,
  contentMarkdown: string,
  frontmatter: Record<string, unknown>,
  config: WikiOsConfig,
  personOverride?: PersonOverrideValue | null,
) {
  if (config.people.mode === "off") {
    return false;
  }

  if (personOverride === "person") {
    return true;
  }

  if (personOverride === "not-person") {
    return false;
  }

  const isExplicitPerson = detectExplicitPersonPage(file, frontmatter, config);
  if (isExplicitPerson || config.people.mode === "explicit") {
    return isExplicitPerson;
  }

  return detectPersonFromContentHeuristics(title, contentMarkdown);
}

export function countTermOccurrences(content: string, term: string) {
  if (!term) {
    return 0;
  }

  let count = 0;
  let startIndex = 0;

  while (true) {
    const matchIndex = content.indexOf(term, startIndex);
    if (matchIndex === -1) {
      return count;
    }

    count += 1;
    startIndex = matchIndex + term.length;
  }
}

export function extractBacklinkReferences(markdown: string): BacklinkReference[] {
  const references: BacklinkReference[] = [];
  const linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(markdown)) !== null) {
    const rawTarget = match[1].trim().replace(/^sources\//, "");
    if (!rawTarget) {
      continue;
    }

    const targetFile = rawTarget.endsWith(".md") ? rawTarget : `${rawTarget}.md`;
    references.push({
      targetRaw: rawTarget,
      targetSlug: slugFromFileName(targetFile),
    });
  }

  return references;
}

export function aggregateBacklinkReferences(
  references: BacklinkReference[],
): Map<string, AggregatedBacklinkReference> {
  const targets = new Map<string, AggregatedBacklinkReference>();

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

export function buildSearchMatches(
  markdown: string,
  title: string,
  terms: string[],
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const seen = new Set<string>();
  let currentHeading = title;

  for (const line of markdown.split("\n")) {
    const headingMatch = line.match(/^#+\s+(.+)/);
    if (headingMatch) {
      currentHeading = headingMatch[1];
      continue;
    }

    const snippet = line.trim();
    if (snippet.length <= 10) {
      continue;
    }

    const lineLower = line.toLowerCase();
    if (!terms.some((term) => lineLower.includes(term))) {
      continue;
    }

    const key = `${currentHeading}\u0000${snippet}`;
    if (seen.has(key)) {
      continue;
    }

    matches.push({ heading: currentHeading, snippet });
    seen.add(key);

    if (matches.length >= 3) {
      break;
    }
  }

  return matches;
}

export function buildFtsQuery(terms: string[]) {
  return terms.map((term) => `"${term.replace(/"/g, "\"\"")}"*`).join(" AND ");
}
