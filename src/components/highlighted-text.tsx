import { useMemo } from "react";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface HighlightQuery {
  pattern: RegExp;
  terms: Set<string>;
}

export function buildHighlightQuery(query: string): HighlightQuery | null {
  const terms = query
    .split(/\s+/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);

  if (terms.length === 0) {
    return null;
  }

  return {
    pattern: new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi"),
    terms: new Set(terms),
  };
}

export function HighlightedText({
  text,
  query,
  highlight,
}: {
  text: string;
  query?: string;
  highlight?: HighlightQuery | null;
}) {
  const resolvedHighlight = useMemo(
    () => highlight ?? buildHighlightQuery(query ?? ""),
    [highlight, query],
  );

  if (!resolvedHighlight) {
    return <>{text}</>;
  }

  const parts = text.split(resolvedHighlight.pattern);

  return (
    <>
      {parts.map((part, index) => {
        const shouldHighlight = resolvedHighlight.terms.has(part.toLowerCase());
        return shouldHighlight ? (
          <mark key={`${part}-${index}`} className="rounded bg-amber-200/60 px-0.5 text-[var(--foreground)]">
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        );
      })}
    </>
  );
}
