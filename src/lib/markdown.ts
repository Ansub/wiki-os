import { type WikiHeading, slugFromFileName } from "./wiki-shared";

export function wikilinkHref(target: string) {
  return `/wiki/${slugFromFileName(`${target}.md`)}`;
}

export function transformObsidianLinks(markdown: string) {
  return markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, rawTarget: string, rawLabel?: string) => {
    const target = rawTarget.trim();
    const label = (rawLabel ?? rawTarget).trim();
    return `[${label}](${wikilinkHref(target)})`;
  });
}

export interface PreparedWikiMarkdown {
  contentMarkdown: string;
  hasCodeBlocks: boolean;
  headings: WikiHeading[];
}

export interface ParsedWikiFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

function parseFrontmatterScalar(value: string): unknown {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (trimmed === "null") {
    return null;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((part) => parseFrontmatterScalar(part))
      .filter((part) => part !== "");
  }

  return trimmed;
}

export function parseWikiFrontmatter(markdown: string): ParsedWikiFrontmatter {
  const normalized = markdown.replace(/\r\n/g, "\n");

  if (!normalized.startsWith("---\n")) {
    return { data: {}, body: normalized };
  }

  const lines = normalized.split("\n");
  const frontmatterLines: string[] = [];
  let closingIndex = -1;

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === "---" || lines[index] === "...") {
      closingIndex = index;
      break;
    }

    frontmatterLines.push(lines[index]);
  }

  if (closingIndex === -1) {
    return { data: {}, body: normalized };
  }

  const data: Record<string, unknown> = {};

  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index];
    const listItemMatch = line.match(/^\s*-\s+(.+)$/);
    if (listItemMatch) {
      continue;
    }

    const keyOnlyMatch = line.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (keyOnlyMatch) {
      const key = keyOnlyMatch[1];
      const values: unknown[] = [];

      for (let nextIndex = index + 1; nextIndex < frontmatterLines.length; nextIndex += 1) {
        const nextLine = frontmatterLines[nextIndex];
        const nextListItemMatch = nextLine.match(/^\s*-\s+(.+)$/);
        if (!nextListItemMatch) {
          break;
        }

        values.push(parseFrontmatterScalar(nextListItemMatch[1]));
        index = nextIndex;
      }

      data[key] = values;
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!match) {
      continue;
    }

    data[match[1]] = parseFrontmatterScalar(match[2]);
  }

  return {
    data,
    body: lines.slice(closingIndex + 1).join("\n").trimStart(),
  };
}

export function stripLeadingMarkdownTitle(markdown: string) {
  return markdown.replace(/^#\s+.+\n?/, "").trimStart();
}

export function createHeadingId(text: string) {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
}

export function extractMarkdownHeadings(markdown: string): WikiHeading[] {
  const headings: WikiHeading[] = [];

  for (const line of markdown.split("\n")) {
    const match = line.match(/^(#{1,4})\s+(.+)$/);
    if (!match) {
      continue;
    }

    const text = match[2]
      .replace(/\*\*/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .trim();

    headings.push({
      text,
      id: createHeadingId(text),
      level: match[1].length,
    });
  }

  return headings;
}

export function prepareWikiMarkdown(markdown: string): PreparedWikiMarkdown {
  const { body } = parseWikiFrontmatter(markdown);
  const contentMarkdown = stripLeadingMarkdownTitle(transformObsidianLinks(body));

  return {
    contentMarkdown,
    hasCodeBlocks: contentMarkdown.includes("```"),
    headings: extractMarkdownHeadings(contentMarkdown),
  };
}
