---
title: OKF Link Compatibility
tags:
  - okf
  - links
  - demo
---

# OKF Link Compatibility

WikiOS now supports Obsidian-flavored knowledge format (OKF) links. This page demonstrates every valid link variant.

## Expected markdown links

OKF uses standard markdown links with absolute paths. These now produce backlinks and graph edges:

- See [Getting Started](/getting-started.md) (absolute, .md extension)
- See [WikiOS topic](/topics/wiki-os) (absolute, no .md extension)
- See [Reading List](/notes/reading-list.md) (absolute, .md extension, subdirectory)
- See [Link Variants](/links/link-variants.md) (absolute, same directory)
- See [External References](/links/external-references.md)

## Combined with wikilinks

- [[getting-started]]
- [[topics/wiki-os]]
- [[notes/reading-list]]

## Same page, both syntaxes

Both link types point to the same target and both produce backlinks.

## Related

- [Getting Started](/getting-started.md)
- [[topics/wiki-os]]
- [Understanding Link Variants](/links/link-variants.md)