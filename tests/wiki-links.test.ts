import { describe, expect, it } from "vitest";

import { hrefToSlug } from "../src/lib/wiki-shared";
import { extractBacklinkReferences } from "../src/lib/wiki-classification";
import { transformWikiLinks, prepareWikiMarkdown } from "../src/lib/markdown";

/* ── hrefToSlug ── */

describe("hrefToSlug", () => {
  it("converts absolute /path/to/file.md to slug", () => {
    expect(hrefToSlug("/skills/kubernetes.md")).toBe("skills/kubernetes");
  });

  it("converts absolute path without .md extension", () => {
    expect(hrefToSlug("/skills/kubernetes")).toBe("skills/kubernetes");
  });

  it("strips leading slash for paths without .md", () => {
    expect(hrefToSlug("skills/kubernetes.md")).toBe("skills/kubernetes");
  });

  it("strips fragment from path", () => {
    expect(hrefToSlug("/skills/kubernetes.md#overview")).toBe("skills/kubernetes");
  });

  it("returns null for https:// URLs", () => {
    expect(hrefToSlug("https://example.com")).toBeNull();
  });

  it("returns null for http:// URLs", () => {
    expect(hrefToSlug("http://example.com/page")).toBeNull();
  });

  it("returns null for mailto: links", () => {
    expect(hrefToSlug("mailto:test@example.com")).toBeNull();
  });

  it("returns null for fragment-only links", () => {
    expect(hrefToSlug("#section")).toBeNull();
  });

  it("encodes spaces in path segments", () => {
    expect(hrefToSlug("/some/File Name.md")).toBe("some/File%20Name");
  });

  it("encodes special characters in path segments", () => {
    expect(hrefToSlug("/path/The Algorithm - Slides.md")).toBe(
      "path/The%20Algorithm%20-%20Slides",
    );
  });

  it("resolves relative ../ paths against source file", () => {
    expect(hrefToSlug("../metrics/52-percent.md", "roles/micron.md")).toBe(
      "metrics/52-percent",
    );
  });

  it("resolves relative ./ paths against source file", () => {
    expect(hrefToSlug("./metrics.md", "roles/micron.md")).toBe("roles/metrics");
  });

  it("resolves bare filenames against source file directory", () => {
    expect(hrefToSlug("other.md", "roles/micron.md")).toBe("roles/other");
  });

  it("resolves relative path through multiple .. levels", () => {
    expect(
      hrefToSlug("../../topics/overview.md", "a/b/c/page.md"),
    ).toBe("a/topics/overview");
  });

  it("resolves relative path at root level", () => {
    expect(hrefToSlug("../other.md", "page.md")).toBe("other");
  });
});

/* ── extractBacklinkReferences ── */

describe("extractBacklinkReferences", () => {
  it("extracts [[wikilinks]]", () => {
    const refs = extractBacklinkReferences("See [[LLMs]]");
    expect(refs).toHaveLength(1);
    expect(refs[0].targetRaw).toBe("LLMs");
    expect(refs[0].targetSlug).toBe("LLMs");
  });

  it("extracts [[wikilink|alias]] with pipe syntax", () => {
    const refs = extractBacklinkReferences("See [[Andrej Karpathy|Karpathy]]");
    expect(refs).toHaveLength(1);
    expect(refs[0].targetRaw).toBe("Andrej Karpathy");
    expect(refs[0].targetSlug).toBe("Andrej%20Karpathy");
  });

  it("extracts markdown [text](/path/to/file.md) links", () => {
    const refs = extractBacklinkReferences("See [K8s](/skills/kubernetes.md)");
    expect(refs).toHaveLength(1);
    expect(refs[0].targetRaw).toBe("skills/kubernetes");
    expect(refs[0].targetSlug).toBe("skills/kubernetes");
  });

  it("extracts markdown links without .md extension", () => {
    const refs = extractBacklinkReferences("See [K8s](/skills/kubernetes)");
    expect(refs).toHaveLength(1);
    expect(refs[0].targetSlug).toBe("skills/kubernetes");
  });

  it("skips external https:// URLs", () => {
    const refs = extractBacklinkReferences("Search [Google](https://google.com)");
    expect(refs).toHaveLength(0);
  });

  it("skips fragment-only links", () => {
    const refs = extractBacklinkReferences("Jump to [#section](#section)");
    expect(refs).toHaveLength(0);
  });

  it("skips mailto: links", () => {
    const refs = extractBacklinkReferences("Email [me](mailto:test@test.com)");
    expect(refs).toHaveLength(0);
  });

  it("skips http:// URLs", () => {
    const refs = extractBacklinkReferences("Visit [site](http://example.org)");
    expect(refs).toHaveLength(0);
  });

  it("handles mixed [[wikilinks]] and [markdown links]", () => {
    const refs = extractBacklinkReferences(
      "See [[wiki]] and [K8s](/skills/kubernetes.md)",
    );
    expect(refs).toHaveLength(2);
    const slugs = refs.map((r) => r.targetSlug).sort();
    expect(slugs).toEqual(["skills/kubernetes", "wiki"]);
  });

  it("strips fragments from markdown link hrefs", () => {
    const refs = extractBacklinkReferences(
      "See [doc](/roles/head.md#responsibilities)",
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].targetSlug).toBe("roles/head");
  });

  it("resolves relative markdown links with sourceFile", () => {
    const refs = extractBacklinkReferences(
      "See [Metric](../metrics/52-percent.md)",
      "roles/micron-head-of-engineering.md",
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].targetRaw).toBe("metrics/52-percent");
    expect(refs[0].targetSlug).toBe("metrics/52-percent");
  });

  it("handles bare filename links resolved with sourceFile", () => {
    const refs = extractBacklinkReferences(
      "See [Leads](kubernetes.md)",
      "roles/micron.md",
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].targetSlug).toBe("roles/kubernetes");
  });

  it("matches markdown links with multi-line content", () => {
    const md =
      "# Title\n\nSome text [Link](/page.md).\n\nMore text [[wikilink]] and [other](/doc.md).";
    const refs = extractBacklinkReferences(md);
    expect(refs).toHaveLength(3);
  });

  it("does not double-count same link target (dedup on slug only via aggregate)", () => {
    const refs = extractBacklinkReferences(
      "[[page]] and [page](/page.md)",
    );
    // Two separate BacklinkReference entries with same slug
    expect(refs).toHaveLength(2);
    expect(refs[0].targetSlug).toBe(refs[1].targetSlug);
  });
});

/* ── transformWikiLinks ── */

describe("transformWikiLinks", () => {
  it("still converts [[wikilinks]] into /wiki/{slug} links", () => {
    expect(transformWikiLinks("See [[LLMs]]")).toBe(
      "See [LLMs](/wiki/LLMs)",
    );
  });

  it("still handles [[wikilinks|alias]] syntax", () => {
    expect(transformWikiLinks("See [[Andrej Karpathy|Karpathy]]")).toBe(
      "See [Karpathy](/wiki/Andrej%20Karpathy)",
    );
  });

  it("handles [[slides/The Algorithm - Slides]]", () => {
    expect(
      transformWikiLinks("Deck: [[slides/The Algorithm - Slides]]"),
    ).toBe(
      "Deck: [slides/The Algorithm - Slides](/wiki/slides/The%20Algorithm%20-%20Slides)",
    );
  });

  it("converts [text](/path/to/file.md) markdown links to /wiki/{slug}", () => {
    expect(transformWikiLinks("See [K8s](/skills/kubernetes.md)")).toBe(
      "See [K8s](/wiki/skills/kubernetes)",
    );
  });

  it("converts markdown links without .md extension", () => {
    expect(transformWikiLinks("See [K8s](/skills/kubernetes)")).toBe(
      "See [K8s](/wiki/skills/kubernetes)",
    );
  });

  it("leaves external https:// URLs unchanged", () => {
    expect(transformWikiLinks("Search [Google](https://google.com)")).toBe(
      "Search [Google](https://google.com)",
    );
  });

  it("leaves http:// URLs unchanged", () => {
    expect(
      transformWikiLinks("Open [site](http://example.org)"),
    ).toBe("Open [site](http://example.org)");
  });

  it("leaves fragment-only links unchanged", () => {
    expect(transformWikiLinks("Jump to [#section](#section)")).toBe(
      "Jump to [#section](#section)",
    );
  });

  it("leaves mailto: links unchanged", () => {
    expect(transformWikiLinks("Email [me](mailto:test@test.com)")).toBe(
      "Email [me](mailto:test@test.com)",
    );
  });

  it("handles mixed content with both link types", () => {
    const result = transformWikiLinks(
      "See [[ObsidianNote]] and [MarkdownNote](/some/note.md)",
    );
    expect(result).toContain("/wiki/ObsidianNote");
    expect(result).toContain("/wiki/some/note");
  });

  it("does not double-convert already-converted wiki links", () => {
    // Links that already start with /wiki/ must not be re-converted
    const result = transformWikiLinks(
      "This is [already](/wiki/skills/kubernetes) a wiki link",
    );
    expect(result).toBe(
      "This is [already](/wiki/skills/kubernetes) a wiki link",
    );
  });

  it("handles fragments in markdown links", () => {
    expect(
      transformWikiLinks("See [doc](/roles/head.md#responsibilities)"),
    ).toBe("See [doc](/wiki/roles/head)");
  });
});

/* ── prepareWikiMarkdown integration ── */

describe("prepareWikiMarkdown with markdown links", () => {
  it("converts both link types in markdown", () => {
    const result = prepareWikiMarkdown(
      [
        "---",
        "tags: [demo]",
        "---",
        "",
        "# Title",
        "",
        "See [[LLMs]] and [K8s](/skills/kubernetes.md).",
      ].join("\n"),
    );

    expect(result.contentMarkdown).toContain("[LLMs](/wiki/LLMs)");
    expect(result.contentMarkdown).toContain("[K8s](/wiki/skills/kubernetes)");
  });

  it("preserves external links in prepared markdown", () => {
    const result = prepareWikiMarkdown(
      [
        "---",
        "title: Test",
        "---",
        "",
        "See [Google](https://google.com) and [[internal]].",
      ].join("\n"),
    );

    expect(result.contentMarkdown).toContain("[Google](https://google.com)");
    expect(result.contentMarkdown).toContain("[internal](/wiki/internal)");
  });

  it("extracts headings correctly alongside converted links", () => {
    const result = prepareWikiMarkdown(
      [
        "---",
        "---",
        "",
        "# Overview",
        "",
        "See [K8s](/skills/kubernetes.md).",
        "",
        "## Details",
      ].join("\n"),
    );

    expect(result.headings).toHaveLength(1);
    expect(result.headings[0].text).toBe("Details");
  });

  it("detects code blocks alongside converted links", () => {
    const result = prepareWikiMarkdown(
      [
        "---",
        "---",
        "",
        "See [tool](/docs/tool.md).",
        "",
        "```ts",
        "const x = 1;",
        "```",
      ].join("\n"),
    );

    expect(result.hasCodeBlocks).toBe(true);
  });
});