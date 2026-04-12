import type { WikiOsConfigInput } from "./src/lib/wiki-config";

const config: WikiOsConfigInput = {
  siteTitle: "WikiOS",
  tagline: "Plug-and-play Obsidian wiki for search, browsing, and local knowledge graphs.",
  searchPlaceholder: "Search notes, ideas, topics, and people...",
  homepage: {
    labels: {
      featured: "Discover",
      topConnected: "Most Connected",
      people: "People",
      categories: "Browse by Topic",
      recentPages: "Recently Added",
    },
  },
  people: {
    mode: "explicit",
  },
};

export default config;
