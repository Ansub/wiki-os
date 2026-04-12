import { useLoaderData, Link, redirect } from "react-router-dom";

import { useWikiConfig } from "@/client/wiki-config";
import type { WikiStats } from "@/lib/wiki-shared";
import { ChangeVaultLink } from "@/components/change-vault-link";

import { fetchJson, isSetupRequiredResponse } from "../api";
import { RouteErrorBoundary } from "../route-error-boundary";

export async function loader() {
  try {
    return await fetchJson<WikiStats>("/api/stats");
  } catch (error) {
    if (isSetupRequiredResponse(error)) {
      throw redirect("/setup");
    }

    throw error;
  }
}

export function Component() {
  const stats = useLoaderData() as WikiStats;
  const config = useWikiConfig();

  const statCards = [
    {
      label: "Pages",
      value: stats.total_pages.toLocaleString(),
      accent: "var(--teal)",
      soft: "var(--teal-soft)",
    },
    {
      label: "Words",
      value: stats.total_words.toLocaleString(),
      accent: "var(--peach)",
      soft: "var(--peach-soft)",
    },
    {
      label: "Avg. Words",
      value: (stats.total_pages > 0
        ? Math.round(stats.total_words / stats.total_pages)
        : 0
      ).toLocaleString(),
      accent: "var(--lavender)",
      soft: "var(--lavender-soft)",
    },
    {
      label: "Top Links",
      value: (stats.top_backlinks[0]?.count ?? 0).toLocaleString(),
      accent: "var(--teal)",
      soft: "var(--teal-soft)",
    },
  ];

  const barAccents = ["var(--teal)", "var(--peach)", "var(--lavender)"];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-2 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:gap-3 sm:px-6 sm:pb-4 sm:pt-[calc(env(safe-area-inset-top)+1.25rem)]">
        <Link to="/" className="font-display text-lg text-[var(--foreground)] sm:text-xl">
          {config.siteTitle}
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <span className="surface flex items-center gap-1.5 rounded-full px-3 py-2 text-xs text-[var(--muted-foreground)] sm:gap-2 sm:px-3.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--teal)]" />
            <span className="font-semibold tabular-nums text-[var(--foreground)]">
              {stats.total_pages.toLocaleString()}
            </span>
            <span className="hidden sm:inline">articles</span>
          </span>
          <span className="rounded-full bg-[var(--foreground)] px-3.5 py-2 text-sm font-medium text-[var(--background)] sm:px-4">
            {config.navigation.statsLabel}
          </span>
          <ChangeVaultLink />
        </div>
      </header>

      <main
        className="mx-auto w-full max-w-4xl px-4 pt-6 sm:px-6 sm:pt-10 lg:px-8"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 4rem)" }}
      >
        <div className="animate-in space-y-10 sm:space-y-12">
          <div>
            <span className="chip-peach inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.16em]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--peach)]" />
              {config.homepage.labels.statsEyebrow}
            </span>
            <h1 className="mt-3 font-display text-[2.75rem] leading-[1.05] tracking-[-0.02em] text-[var(--foreground)] sm:text-5xl">
              {config.navigation.statsLabel}
            </h1>
            <p className="mt-2 text-[0.9rem] text-[var(--muted-foreground)] sm:text-[0.95rem]">
              {config.homepage.labels.statsDescription}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            {statCards.map((card, index) => (
              <div
                key={card.label}
                className={`surface-raised hover-lift stagger-${index + 1} animate-in relative overflow-hidden rounded-2xl p-4 sm:p-5`}
              >
                <div
                  aria-hidden
                  className="absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-40 blur-2xl"
                  style={{ background: card.soft }}
                />
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: card.accent }}
                    />
                    <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                      {card.label}
                    </p>
                  </div>
                  <p className="mt-2 font-display text-[1.75rem] leading-tight text-[var(--foreground)] sm:mt-3 sm:text-4xl">
                    {card.value}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-4 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[var(--lavender)] shadow-[0_0_12px_var(--lavender)]" />
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                Most Backlinked Concepts
              </p>
            </div>
            <div className="surface-raised overflow-hidden rounded-3xl">
              {stats.top_backlinks.map((item, index) => {
                const accent = barAccents[index % barAccents.length];
                const widthPct = Math.max(
                  10,
                  (item.count / (stats.top_backlinks[0]?.count ?? 1)) * 100,
                );
                return (
                  <div
                    key={item.page}
                    className={`relative flex items-center justify-between gap-3 px-4 py-3.5 sm:gap-4 sm:px-5 sm:py-4 ${
                      index > 0 ? "border-t border-[var(--border)]" : ""
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold text-white"
                        style={{ background: accent }}
                      >
                        {index + 1}
                      </span>
                      <span className="truncate font-display text-[0.95rem] text-[var(--foreground)] sm:text-[1rem]">
                        {item.page}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                      <div className="relative hidden h-1.5 w-20 overflow-hidden rounded-full bg-[var(--secondary)] sm:block sm:w-32">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: `${widthPct}%`, background: accent }}
                        />
                      </div>
                      <span className="w-9 text-right font-mono text-xs font-semibold text-[var(--foreground)] sm:w-10">
                        {item.count}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      <footer className="pb-10" />
    </div>
  );
}

export const ErrorBoundary = RouteErrorBoundary;
