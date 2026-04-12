import { useEffect, useState } from "react";

/**
 * Fetches a person's portrait thumbnail from Wikipedia's REST Summary API
 * and caches URLs (including misses as `null`) in localStorage so each name
 * is looked up at most once per browser.
 *
 * Endpoint: https://en.wikipedia.org/api/rest_v1/page/summary/{title}
 *   • CORS-enabled, no API key required
 *   • Follows Wikipedia redirects (e.g. "Mao Tse-tung" → Mao Zedong)
 *   • Returns JSON with `thumbnail.source` pointing at a 330px image on commons
 */

const IMAGE_CACHE_KEY = "wiki-os:person-images";

type ImageCache = Record<string, string | null>;

function readImageCache(): ImageCache {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeImageCache(cache: ImageCache) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage full / disabled — silently ignore */
  }
}

export function usePersonImage(name: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() => {
    if (!name) return null;
    return readImageCache()[name] ?? null;
  });

  useEffect(() => {
    if (!name) {
      setUrl(null);
      return;
    }

    const cache = readImageCache();
    if (name in cache) {
      setUrl(cache[name]);
      return;
    }

    const controller = new AbortController();
    const endpoint = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;

    fetch(endpoint, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { thumbnail?: { source?: string } } | null) => {
        const imageUrl = data?.thumbnail?.source ?? null;
        const next = { ...readImageCache(), [name]: imageUrl };
        writeImageCache(next);
        setUrl(imageUrl);
      })
      .catch(() => {
        /* network error / aborted — leave unresolved so we can retry later */
      });

    return () => controller.abort();
  }, [name]);

  return url;
}
