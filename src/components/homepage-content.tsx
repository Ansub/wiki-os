import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { useWikiConfig } from "@/client/wiki-config";
import { type HomepageData, type PageSummary } from "@/lib/wiki-shared";
import { type HomepageSectionKey } from "@/lib/wiki-config";
import { usePersonImage } from "@/client/use-person-image";
import { type TopicBrowseState } from "@/components/search-box";

const categoryAccents = [
  "chip-teal",
  "chip-peach",
  "chip-lavender",
];

const personAvatarAccents = [
  "bg-[var(--teal-soft)] text-[#3e6978]",
  "bg-[var(--peach-soft)] text-[#9a5a2f]",
  "bg-[var(--lavender-soft)] text-[#5b4a7a]",
];

function PersonCard({ person, index }: { person: PageSummary; index: number }) {
  const imageUrl = usePersonImage(person.title);
  const accentBg = personAvatarAccents[index % personAvatarAccents.length];
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <Link
      to={`/wiki/${person.slug}`}
      className="surface hover-lift flex flex-col items-center gap-3 rounded-2xl px-4 py-4 text-center"
    >
      <span
        className={`relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full ${accentBg} font-display text-2xl font-medium`}
      >
        {/* Fallback initial is always painted; image overlays once it loads */}
        <span aria-hidden={imageUrl !== null && imgLoaded}>{person.title.charAt(0)}</span>
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setImgLoaded(true)}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
              imgLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        )}
      </span>
      <div className="min-w-0">
        <p className="truncate font-display text-[0.95rem] text-[var(--foreground)]">
          {person.title}
        </p>
        <p className="text-[0.7rem] font-medium text-[var(--muted-foreground)]">
          {person.backlinkCount} connections
        </p>
      </div>
    </Link>
  );
}

function PageChip({ page, index }: { page: PageSummary; index: number }) {
  const accent = categoryAccents[index % categoryAccents.length];
  return (
    <Link
      to={`/wiki/${page.slug}`}
      className={`${accent} group inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-10px_rgba(21,19,26,0.2)] active:scale-[0.97]`}
    >
      <span className="font-display text-[0.95rem]">{page.title}</span>
      <span className="rounded-full bg-white/60 px-1.5 py-0.5 text-[0.65rem] font-semibold tabular-nums">
        {page.backlinkCount}
      </span>
    </Link>
  );
}

export function HomepageContent({
  homepage,
  onBrowseTopic,
}: {
  homepage: HomepageData;
  onBrowseTopic: (topic: TopicBrowseState | null) => void;
}) {
  const config = useWikiConfig();
  const labels = config.homepage.labels;
  const orderedSections = config.homepage.sectionOrder.filter((section): section is HomepageSectionKey => {
    if (section === "people") {
      return homepage.people.length > 0;
    }

    if (section === "categories") {
      return homepage.categories.length > 0;
    }

    return true;
  });
  const midpoint = Math.ceil(orderedSections.length / 2);
  const columns = [orderedSections.slice(0, midpoint), orderedSections.slice(midpoint)];

  const sectionViews: Record<HomepageSectionKey, ReactNode> = {
    featured: (
      <div>
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--peach)] shadow-[0_0_12px_var(--peach)]" />
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            {labels.featured}
          </p>
        </div>
        <Link
          to={`/wiki/${homepage.featured.slug}`}
          className="surface-raised hover-lift relative block w-full overflow-hidden rounded-3xl p-5 text-left sm:p-7"
        >
          <div
            aria-hidden
            className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[var(--peach)] opacity-30 blur-3xl"
          />
          <div
            aria-hidden
            className="absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-[var(--lavender)] opacity-25 blur-3xl"
          />
          <div className="relative">
            <span className="chip-peach mb-4 inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider">
              {labels.spotlightBadge}
            </span>
            <h3 className="font-display text-[1.55rem] leading-tight tracking-tight text-[var(--foreground)] sm:text-[1.75rem]">
              {homepage.featured.title}
            </h3>
            <p className="mt-3 line-clamp-3 text-[0.95rem] leading-relaxed text-[var(--muted-foreground)]">
              {homepage.featured.summary}
            </p>
            <div className="mt-5 flex items-center gap-3 text-xs font-medium text-[var(--muted-foreground)]">
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-[var(--teal)]" />
                {homepage.featured.wordCount.toLocaleString()} words
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-[var(--lavender)]" />
                {homepage.featured.backlinkCount} backlinks
              </span>
            </div>
          </div>
        </Link>
      </div>
    ),
    topConnected: (
      <div>
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--teal)] shadow-[0_0_12px_var(--teal)]" />
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            {labels.topConnected}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {homepage.topConnected.map((page, index) => (
            <PageChip key={page.file} page={page} index={index} />
          ))}
        </div>
      </div>
    ),
    people: homepage.people.length > 0 ? (
      <div>
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--lavender)] shadow-[0_0_12px_var(--lavender)]" />
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            {labels.people}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {homepage.people.map((person, index) => (
            <PersonCard key={person.file} person={person} index={index} />
          ))}
        </div>
      </div>
    ) : null,
    categories: homepage.categories.length > 0 ? (
      <div>
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--teal)] shadow-[0_0_12px_var(--teal)]" />
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            {labels.categories}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {homepage.categories.map((category, index) => {
            const accent = categoryAccents[index % categoryAccents.length];
            return (
              <button
                key={category.name}
                type="button"
                onClick={() =>
                  onBrowseTopic({
                    name: category.name,
                    emoji: category.emoji,
                    pages: category.pages,
                  })
                }
                className={`${accent} group inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-10px_rgba(21,19,26,0.2)] active:scale-[0.97]`}
              >
                <span className="font-semibold">
                  {category.emoji} {category.name}
                </span>
                <span className="rounded-full bg-white/60 px-1.5 py-0.5 text-[0.65rem] font-semibold tabular-nums">
                  {category.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    ) : null,
    recentPages: (
      <div>
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--peach)] shadow-[0_0_12px_var(--peach)]" />
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            {labels.recentPages}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {homepage.recentPages.map((page, index) => {
            const accentRail = [
              "before:bg-[var(--teal)]",
              "before:bg-[var(--peach)]",
              "before:bg-[var(--lavender)]",
            ][index % 3];
            return (
              <Link
                key={page.file}
                to={`/wiki/${page.slug}`}
                className={`animate-in hover-lift surface relative overflow-hidden rounded-2xl px-5 py-4 text-left before:absolute before:left-0 before:top-0 before:h-full before:w-1 ${accentRail} stagger-${Math.min(index + 1, 8)}`}
              >
                <p className="truncate pl-1 font-display text-[1.05rem] text-[var(--foreground)]">
                  {page.title}
                </p>
                <p className="mt-1 line-clamp-1 pl-1 text-[0.78rem] text-[var(--muted-foreground)]">
                  {page.summary}
                </p>
              </Link>
            );
          })}
        </div>
      </div>
    ),
  };

  return (
    <div
      className="w-full space-y-10 pt-4 sm:space-y-12 sm:pt-6"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 4rem)" }}
    >
      <div className="grid grid-cols-1 gap-8 sm:gap-10 lg:grid-cols-2">
        {columns.map((column, index) => (
          <section key={index} className="space-y-8 sm:space-y-10">
            {column.map((section) => sectionViews[section])}
          </section>
        ))}
      </div>
    </div>
  );
}
