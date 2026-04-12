export const HOMEPAGE_SECTION_KEYS = [
  "featured",
  "topConnected",
  "people",
  "categories",
  "recentPages",
] as const;

export type HomepageSectionKey = (typeof HOMEPAGE_SECTION_KEYS)[number];

export interface TopicAliasConfig {
  label?: string;
  emoji?: string;
  color?: string;
}

export type PeopleMode = "explicit" | "hybrid" | "off";

export interface WikiOsConfigInput {
  siteTitle?: string;
  tagline?: string;
  searchPlaceholder?: string;
  navigation?: {
    graphLabel?: string;
    statsLabel?: string;
    backToWikiLabel?: string;
    articlesLabel?: string;
    conceptsLabel?: string;
    connectionsLabel?: string;
  };
  homepage?: {
    sectionOrder?: HomepageSectionKey[];
    labels?: {
      featured?: string;
      topConnected?: string;
      people?: string;
      categories?: string;
      recentPages?: string;
      browseTopicArticles?: string;
      spotlightBadge?: string;
      statsEyebrow?: string;
      statsDescription?: string;
    };
  };
  theme?: {
    variables?: Record<string, string>;
  };
  categories?: {
    aliases?: Record<string, TopicAliasConfig>;
    hidden?: string[];
    maxTopics?: number;
    folderDepth?: number;
    frontmatterKeys?: string[];
  };
  people?: {
    enabled?: boolean;
    mode?: PeopleMode;
    frontmatterKeys?: string[];
    folderNames?: string[];
    tagNames?: string[];
  };
}

export interface WikiOsConfig {
  siteTitle: string;
  tagline: string;
  searchPlaceholder: string;
  navigation: {
    graphLabel: string;
    statsLabel: string;
    backToWikiLabel: string;
    articlesLabel: string;
    conceptsLabel: string;
    connectionsLabel: string;
  };
  homepage: {
    sectionOrder: HomepageSectionKey[];
    labels: {
      featured: string;
      topConnected: string;
      people: string;
      categories: string;
      recentPages: string;
      browseTopicArticles: string;
      spotlightBadge: string;
      statsEyebrow: string;
      statsDescription: string;
    };
  };
  theme: {
    variables: Record<string, string>;
  };
  categories: {
    aliases: Record<string, TopicAliasConfig>;
    hidden: string[];
    maxTopics: number;
    folderDepth: number;
    frontmatterKeys: string[];
  };
  people: {
    enabled: boolean;
    mode: PeopleMode;
    frontmatterKeys: string[];
    folderNames: string[];
    tagNames: string[];
  };
}

export const DEFAULT_WIKI_OS_CONFIG: WikiOsConfig = {
  siteTitle: "WikiOS",
  tagline: "Plug-and-play Obsidian wiki for search, browsing, and local knowledge graphs.",
  searchPlaceholder: "Search notes, ideas, topics, and people...",
  navigation: {
    graphLabel: "Graph",
    statsLabel: "Stats",
    backToWikiLabel: "Back to wiki",
    articlesLabel: "articles",
    conceptsLabel: "concepts",
    connectionsLabel: "connections",
  },
  homepage: {
    sectionOrder: [...HOMEPAGE_SECTION_KEYS],
    labels: {
      featured: "Discover",
      topConnected: "Most Connected",
      people: "People",
      categories: "Browse by Topic",
      recentPages: "Recently Added",
      browseTopicArticles: "articles",
      spotlightBadge: "Spotlight",
      statsEyebrow: "Wiki Snapshot",
      statsDescription: "A live view of the Obsidian wiki index and backlink graph.",
    },
  },
  theme: {
    variables: {},
  },
  categories: {
    aliases: {},
    hidden: [],
    maxTopics: 6,
    folderDepth: 2,
    frontmatterKeys: ["tags", "topics", "topic", "category", "categories"],
  },
  people: {
    enabled: true,
    mode: "explicit",
    frontmatterKeys: ["person", "people", "type", "kind", "entity"],
    folderNames: ["people", "person", "biographies", "biography"],
    tagNames: ["person", "people", "biography", "biographies"],
  },
};

const TOPIC_COLOR_PALETTE = [
  "#85b9c9",
  "#f4b183",
  "#c4a7e7",
  "#9cc5a6",
  "#d4a55c",
  "#e28c8c",
  "#7db7a1",
  "#8aa7e1",
] as const;

const TOPIC_EMOJI_PALETTE = ["🧠", "📚", "🧭", "⚙️", "🌱", "🔬", "✨", "🗂️"] as const;

function uniqueStrings(values: Iterable<string>) {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))];
}

function normalizeAliasMap(aliases: Record<string, TopicAliasConfig> | undefined) {
  const normalized: Record<string, TopicAliasConfig> = {};

  for (const [key, value] of Object.entries(aliases ?? {})) {
    const normalizedKey = normalizeTopicKey(key);
    if (!normalizedKey) {
      continue;
    }
    normalized[normalizedKey] = value;
  }

  return normalized;
}

export function normalizeTopicKey(value: string) {
  return value.trim().toLowerCase().replace(/^#/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function formatTopicLabel(value: string) {
  const normalized = value
    .trim()
    .replace(/^#/, "")
    .replace(/[\\/]+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!normalized) {
    return "";
  }

  return normalized
    .split(" ")
    .map((word) => {
      if (word === word.toUpperCase()) {
        return word;
      }

      if (/^\d+$/.test(word)) {
        return word;
      }

      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function resolvePeopleMode(mode: PeopleMode | undefined, enabled: boolean | undefined): PeopleMode {
  if (mode === "explicit" || mode === "hybrid" || mode === "off") {
    return mode;
  }

  if (enabled === false) {
    return "off";
  }

  return DEFAULT_WIKI_OS_CONFIG.people.mode;
}

export function resolveWikiOsConfig(input?: WikiOsConfigInput): WikiOsConfig {
  const peopleMode = resolvePeopleMode(input?.people?.mode, input?.people?.enabled);

  return {
    siteTitle: input?.siteTitle?.trim() || DEFAULT_WIKI_OS_CONFIG.siteTitle,
    tagline: input?.tagline?.trim() || DEFAULT_WIKI_OS_CONFIG.tagline,
    searchPlaceholder:
      input?.searchPlaceholder?.trim() || DEFAULT_WIKI_OS_CONFIG.searchPlaceholder,
    navigation: {
      graphLabel:
        input?.navigation?.graphLabel?.trim() ||
        DEFAULT_WIKI_OS_CONFIG.navigation.graphLabel,
      statsLabel:
        input?.navigation?.statsLabel?.trim() ||
        DEFAULT_WIKI_OS_CONFIG.navigation.statsLabel,
      backToWikiLabel:
        input?.navigation?.backToWikiLabel?.trim() ||
        DEFAULT_WIKI_OS_CONFIG.navigation.backToWikiLabel,
      articlesLabel:
        input?.navigation?.articlesLabel?.trim() ||
        DEFAULT_WIKI_OS_CONFIG.navigation.articlesLabel,
      conceptsLabel:
        input?.navigation?.conceptsLabel?.trim() ||
        DEFAULT_WIKI_OS_CONFIG.navigation.conceptsLabel,
      connectionsLabel:
        input?.navigation?.connectionsLabel?.trim() ||
        DEFAULT_WIKI_OS_CONFIG.navigation.connectionsLabel,
    },
    homepage: {
      sectionOrder:
        input?.homepage?.sectionOrder?.filter((section): section is HomepageSectionKey =>
          HOMEPAGE_SECTION_KEYS.includes(section),
        ) || DEFAULT_WIKI_OS_CONFIG.homepage.sectionOrder,
      labels: {
        featured:
          input?.homepage?.labels?.featured?.trim() ||
          DEFAULT_WIKI_OS_CONFIG.homepage.labels.featured,
        topConnected:
          input?.homepage?.labels?.topConnected?.trim() ||
          DEFAULT_WIKI_OS_CONFIG.homepage.labels.topConnected,
        people:
          input?.homepage?.labels?.people?.trim() ||
          DEFAULT_WIKI_OS_CONFIG.homepage.labels.people,
        categories:
          input?.homepage?.labels?.categories?.trim() ||
          DEFAULT_WIKI_OS_CONFIG.homepage.labels.categories,
        recentPages:
          input?.homepage?.labels?.recentPages?.trim() ||
          DEFAULT_WIKI_OS_CONFIG.homepage.labels.recentPages,
        browseTopicArticles:
          input?.homepage?.labels?.browseTopicArticles?.trim() ||
          DEFAULT_WIKI_OS_CONFIG.homepage.labels.browseTopicArticles,
        spotlightBadge:
          input?.homepage?.labels?.spotlightBadge?.trim() ||
          DEFAULT_WIKI_OS_CONFIG.homepage.labels.spotlightBadge,
        statsEyebrow:
          input?.homepage?.labels?.statsEyebrow?.trim() ||
          DEFAULT_WIKI_OS_CONFIG.homepage.labels.statsEyebrow,
        statsDescription:
          input?.homepage?.labels?.statsDescription?.trim() ||
          DEFAULT_WIKI_OS_CONFIG.homepage.labels.statsDescription,
      },
    },
    theme: {
      variables: { ...DEFAULT_WIKI_OS_CONFIG.theme.variables, ...input?.theme?.variables },
    },
    categories: {
      aliases: normalizeAliasMap(input?.categories?.aliases),
      hidden: uniqueStrings(
        (input?.categories?.hidden ?? DEFAULT_WIKI_OS_CONFIG.categories.hidden).map(
          normalizeTopicKey,
        ),
      ),
      maxTopics: Math.max(
        1,
        Math.floor(input?.categories?.maxTopics ?? DEFAULT_WIKI_OS_CONFIG.categories.maxTopics),
      ),
      folderDepth: Math.max(
        0,
        Math.floor(input?.categories?.folderDepth ?? DEFAULT_WIKI_OS_CONFIG.categories.folderDepth),
      ),
      frontmatterKeys: uniqueStrings(
        input?.categories?.frontmatterKeys ?? DEFAULT_WIKI_OS_CONFIG.categories.frontmatterKeys,
      ),
    },
    people: {
      enabled: peopleMode !== "off",
      mode: peopleMode,
      frontmatterKeys: uniqueStrings(
        input?.people?.frontmatterKeys ?? DEFAULT_WIKI_OS_CONFIG.people.frontmatterKeys,
      ).map(normalizeTopicKey),
      folderNames: uniqueStrings(
        input?.people?.folderNames ?? DEFAULT_WIKI_OS_CONFIG.people.folderNames,
      ).map(normalizeTopicKey),
      tagNames: uniqueStrings(
        input?.people?.tagNames ?? DEFAULT_WIKI_OS_CONFIG.people.tagNames,
      ).map(normalizeTopicKey),
    },
  };
}

function hashString(value: string) {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

export function getTopicAlias(
  topic: string,
  aliases: Record<string, TopicAliasConfig>,
) {
  return aliases[normalizeTopicKey(topic)];
}

export function getTopicLabel(topic: string, aliases: Record<string, TopicAliasConfig>) {
  return getTopicAlias(topic, aliases)?.label ?? formatTopicLabel(topic);
}

export function getTopicColor(topic: string, aliases: Record<string, TopicAliasConfig>) {
  const aliasColor = getTopicAlias(topic, aliases)?.color;
  if (aliasColor) {
    return aliasColor;
  }

  const key = normalizeTopicKey(topic) || topic;
  return TOPIC_COLOR_PALETTE[hashString(key) % TOPIC_COLOR_PALETTE.length];
}

export function getTopicEmoji(topic: string, aliases: Record<string, TopicAliasConfig>) {
  const aliasEmoji = getTopicAlias(topic, aliases)?.emoji;
  if (aliasEmoji) {
    return aliasEmoji;
  }

  const key = normalizeTopicKey(topic) || topic;
  return TOPIC_EMOJI_PALETTE[hashString(key) % TOPIC_EMOJI_PALETTE.length];
}

export function isTopicHidden(topic: string, hiddenTopics: string[]) {
  const normalized = normalizeTopicKey(topic);
  return hiddenTopics.includes(normalized);
}
