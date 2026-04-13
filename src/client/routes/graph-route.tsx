import { useCallback, useEffect, useRef, useState } from "react";
import { Link, redirect, useLoaderData, useNavigate } from "react-router-dom";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import SigmaLib from "sigma";

import { useWikiConfig } from "@/client/wiki-config";
import { getTopicColor, type TopicAliasConfig } from "@/lib/wiki-config";
import type { GraphData, GraphNode } from "@/lib/wiki-shared";
import { fetchJson, isSetupRequiredResponse } from "../api";
import { RouteErrorBoundary } from "../route-error-boundary";

/* ── Colors ── */

const DEFAULT_NODE_COLOR = "#c8c4d0";
const EDGE_DEFAULT = "#e8ebe9";
const EDGE_HOVER = "rgba(47, 127, 146, 0.82)";
const LABEL_COLOR = "#4a4752";
const BG_COLOR = "#f5f9f7";

function getCategoryColor(
  categories: string[],
  aliases: Record<string, TopicAliasConfig>,
): string {
  for (const cat of categories) {
    return getTopicColor(cat, aliases);
  }
  return DEFAULT_NODE_COLOR;
}

/* ── Graph building ── */

function buildGraph(
  data: GraphData,
  aliases: Record<string, TopicAliasConfig>,
): Graph {
  const graph = new Graph();

  for (const node of data.nodes) {
    const size = Math.max(2.5, Math.min(16, 2.5 + Math.sqrt(node.backlinkCount) * 2));
    graph.addNode(node.slug, {
      label: node.title,
      size,
      color: getCategoryColor(node.categories, aliases),
      originalColor: getCategoryColor(node.categories, aliases),
      x: Math.random() * 1000,
      y: Math.random() * 1000,
      categories: node.categories,
      backlinkCount: node.backlinkCount,
      wordCount: node.wordCount,
    });
  }

  for (const edge of data.edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      const key = `${edge.source}->${edge.target}`;
      if (!graph.hasEdge(key)) {
        graph.addEdgeWithKey(key, edge.source, edge.target, {
          weight: edge.weight,
          size: 0.3,
          color: EDGE_DEFAULT,
        });
      }
    }
  }

  return graph;
}

function runLayout(graph: Graph) {
  forceAtlas2.assign(graph, {
    iterations: 500,
    settings: {
      gravity: 1,
      scalingRatio: 10,
      barnesHutOptimize: true,
      strongGravityMode: true,
      slowDown: 3,
      outboundAttractionDistribution: false,
      linLogMode: true,
    },
  });
}

/* ── Search ── */

function GraphSearch({
  graph,
  sigmaRef,
  onSelect,
}: {
  graph: Graph | null;
  sigmaRef: React.RefObject<SigmaLib | null>;
  onSelect: (slug: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ slug: string; label: string }[]>([]);

  useEffect(() => {
    if (!graph || !query.trim()) {
      setResults([]);
      return;
    }
    const q = query.toLowerCase();
    const matched: { slug: string; label: string }[] = [];
    graph.forEachNode((slug, attrs) => {
      if (attrs.label?.toLowerCase().includes(q)) {
        matched.push({ slug, label: attrs.label });
      }
    });
    matched.sort((a, b) => a.label.localeCompare(b.label));
    setResults(matched.slice(0, 8));
  }, [graph, query]);

  const handleSelect = (slug: string) => {
    const sigma = sigmaRef.current;
    if (sigma) {
      const pos = sigma.getNodeDisplayData(slug);
      if (pos) {
        sigma.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.3 }, { duration: 400 });
      }
    }
    onSelect(slug);
    setQuery("");
    setResults([]);
  };

  return (
    <div
      className="absolute left-4 right-4 z-10 sm:right-auto sm:w-64"
      style={{ top: "calc(env(safe-area-inset-top) + 4.75rem)" }}
    >
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a concept..."
        className="surface w-full rounded-full px-4 py-2.5 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
      />
      {results.length > 0 && (
        <div className="surface-raised mt-2 overflow-hidden rounded-2xl">
          {results.map((r) => (
            <button
              key={r.slug}
              type="button"
              onClick={() => handleSelect(r.slug)}
              className="block w-full px-4 py-2 text-left text-sm font-display text-[var(--foreground)] transition-colors hover:bg-[var(--teal-soft)]/50"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Info panel (shown when a node is focused) ── */

function InfoPanel({
  node,
  neighborNodes,
  onClose,
  onClickNeighbor,
  onNavigate,
  aliases,
}: {
  node: GraphNode;
  neighborNodes: GraphNode[];
  onClose: () => void;
  onClickNeighbor: (slug: string) => void;
  onNavigate: (slug: string) => void;
  aliases: Record<string, TopicAliasConfig>;
}) {
  const catColor = getCategoryColor(node.categories, aliases);

  return (
    <div
      className="surface-raised absolute left-4 right-4 z-20 overflow-hidden rounded-3xl sm:left-auto sm:right-4 sm:w-80"
      style={{ top: "calc(env(safe-area-inset-top) + 4.75rem)" }}
    >
      {/* Header */}
      <div className="border-b border-[var(--border)] px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-display text-[1.1rem] text-[var(--foreground)]">
              {node.title}
            </h3>
            <div className="mt-1.5 flex items-center gap-2">
              {node.categories.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: catColor, boxShadow: `0 0 8px ${catColor}80` }}
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {node.categories[0]}
                  </span>
                </div>
              )}
              <span className="text-[10px] text-[var(--muted-foreground)]">
                {node.backlinkCount} · {node.wordCount}w
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3 3l8 8M11 3l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Summary */}
      {node.summary && (
        <div className="border-b border-[var(--border)] px-5 py-3">
          <p className="line-clamp-3 text-[0.8rem] leading-relaxed text-[var(--muted-foreground)]">
            {node.summary}
          </p>
        </div>
      )}

      {/* Open article button */}
      <div className="border-b border-[var(--border)] px-5 py-3">
        <button
          type="button"
          onClick={() => onNavigate(node.slug)}
          className="w-full rounded-full bg-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--background)] transition-[background,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[var(--teal)] active:scale-[0.97]"
        >
          Open article →
        </button>
      </div>

      {/* Connections list */}
      {neighborNodes.length > 0 && (
        <div className="max-h-56 overflow-y-auto">
          <p className="px-5 pb-1.5 pt-3 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
            Connections ({neighborNodes.length})
          </p>
          {neighborNodes.map((n) => (
            <button
              key={n.slug}
              type="button"
              onClick={() => onClickNeighbor(n.slug)}
              className="group flex w-full items-center gap-2.5 px-5 py-2 text-left transition-colors hover:bg-white/60"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full transition-all duration-200 group-hover:scale-125"
                style={{
                  backgroundColor: getCategoryColor(n.categories, aliases),
                  boxShadow: `0 0 6px ${getCategoryColor(n.categories, aliases)}60`,
                }}
              />
              <span className="truncate font-display text-[0.85rem] text-[var(--foreground)]">
                {n.title}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Tooltip ── */

function NodeTooltip({
  node,
  position,
  aliases,
}: {
  node: { label: string; categories: string[]; backlinkCount: number; wordCount: number } | null;
  position: { x: number; y: number };
  aliases: Record<string, TopicAliasConfig>;
}) {
  if (!node) return null;
  const catColor = getCategoryColor(node.categories, aliases);

  return (
    <div
      className="surface-raised pointer-events-none absolute z-20 max-w-xs rounded-2xl px-4 py-2.5"
      style={{ left: position.x + 14, top: position.y - 12 }}
    >
      <p className="font-display text-[0.95rem] text-[var(--foreground)]">{node.label}</p>
      <div className="mt-1 flex items-center gap-1.5 text-[0.7rem] font-medium text-[var(--muted-foreground)]">
        <span>{node.backlinkCount} connections</span>
        <span>·</span>
        <span>{node.wordCount} words</span>
      </div>
      {node.categories.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: catColor, boxShadow: `0 0 8px ${catColor}80` }}
          />
          <span className="text-[0.7rem] font-semibold text-[var(--muted-foreground)]">
            {node.categories.join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Main Component ── */

export async function loader() {
  try {
    return await fetchJson<GraphData>("/api/graph");
  } catch (error) {
    if (isSetupRequiredResponse(error)) {
      throw redirect("/setup");
    }

    throw error;
  }
}

export function Component() {
  const data = useLoaderData() as GraphData;
  const config = useWikiConfig();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<SigmaLib | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const focusedRef = useRef<string | null>(null);
  const [focusedSlug, setFocusedSlug] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    node: { label: string; categories: string[]; backlinkCount: number; wordCount: number };
    position: { x: number; y: number };
  } | null>(null);
  const [graphReady, setGraphReady] = useState(false);

  // Build a lookup map for node data
  const nodeMap = useRef(new Map<string, GraphNode>());
  useEffect(() => {
    const map = new Map<string, GraphNode>();
    for (const n of data.nodes) map.set(n.slug, n);
    nodeMap.current = map;
  }, [data]);

  const focusedNode = focusedSlug ? nodeMap.current.get(focusedSlug) ?? null : null;
  const focusedNeighbors = focusedNode
    ? focusedNode.neighbors
        .map((s) => nodeMap.current.get(s))
        .filter((n): n is GraphNode => n !== undefined)
        .sort((a, b) => b.backlinkCount - a.backlinkCount)
    : [];

  const handleSearchSelect = useCallback((slug: string) => {
    focusedRef.current = slug;
    setFocusedSlug(slug);
    sigmaRef.current?.refresh();
  }, []);

  const handleInfoClose = useCallback(() => {
    focusedRef.current = null;
    setFocusedSlug(null);
    sigmaRef.current?.refresh();
  }, []);

  const handleInfoNeighborClick = useCallback((slug: string) => {
    focusedRef.current = slug;
    setFocusedSlug(slug);
    sigmaRef.current?.refresh();
    const pos = sigmaRef.current?.getNodeDisplayData(slug);
    if (pos) {
      sigmaRef.current?.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.5 }, { duration: 300 });
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const graph = buildGraph(data, config.categories.aliases);
    runLayout(graph);
    graphRef.current = graph;

    const sigma = new SigmaLib(graph, containerRef.current, {
      allowInvalidContainer: true,
      renderLabels: true,
      renderEdgeLabels: false,
      labelColor: { color: LABEL_COLOR },
      labelFont: '"Urbanist", -apple-system, BlinkMacSystemFont, sans-serif',
      labelSize: 11,
      labelWeight: "500",
      labelRenderedSizeThreshold: 6,
      defaultEdgeColor: EDGE_DEFAULT,
      defaultEdgeType: "line",
      defaultNodeColor: DEFAULT_NODE_COLOR,
      stagePadding: 60,
      edgeReducer(edge, data) {
        const active = focusedRef.current ?? hoveredRef.current;
        const res = { ...data };

        if (active) {
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          if (src === active || tgt === active) {
            res.color = EDGE_HOVER;
            res.size = 1;
          } else {
            res.hidden = true;
          }
        }
        return res;
      },
      nodeReducer(node, data) {
        const active = focusedRef.current ?? hoveredRef.current;
        const selected = selectedRef.current;
        const res = { ...data };

        if (active) {
          const isActive = node === active;
          const isNeighbor = graph.hasEdge(active, node) || graph.hasEdge(node, active);

          if (isActive) {
            res.highlighted = true;
            res.zIndex = 2;
            res.size = (res.size ?? 4) * 1.3;
          } else if (isNeighbor) {
            res.zIndex = 1;
            if (focusedRef.current) res.forceLabel = true;
          } else {
            res.color = "#e8e3d4";
            res.label = "";
            res.zIndex = 0;
          }
        }

        if (selected === node) {
          res.highlighted = true;
          res.zIndex = 3;
          res.size = (res.size ?? 4) * 1.4;
        }

        return res;
      },
    });

    sigmaRef.current = sigma;
    setGraphReady(true);

    sigma.on("enterNode", ({ node }) => {
      hoveredRef.current = node;
      sigma.refresh();
      containerRef.current!.style.cursor = "pointer";
    });

    sigma.on("leaveNode", () => {
      hoveredRef.current = null;
      sigma.refresh();
      setTooltip(null);
      containerRef.current!.style.cursor = "default";
    });

    sigma.on("clickNode", ({ node }) => {
      const focused = focusedRef.current;

      if (focused === node) {
        navigate(`/wiki/${node}`);
        return;
      }

      if (focused && (graph.hasEdge(focused, node) || graph.hasEdge(node, focused))) {
        navigate(`/wiki/${node}`);
        return;
      }

      focusedRef.current = node;
      setFocusedSlug(node);
      sigma.refresh();

      const pos = sigma.getNodeDisplayData(node);
      if (pos) {
        sigma.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.5 }, { duration: 300 });
      }
    });

    sigma.on("clickStage", () => {
      if (focusedRef.current) {
        focusedRef.current = null;
        setFocusedSlug(null);
        sigma.refresh();
      }
    });

    return () => {
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [config.categories.aliases, data, navigate]);

  // Tooltip tracking
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseMove = (e: MouseEvent) => {
      const hovered = hoveredRef.current;
      if (!hovered || !graphRef.current || focusedRef.current) {
        if (!focusedRef.current) setTooltip(null);
        return;
      }
      const attrs = graphRef.current.getNodeAttributes(hovered);
      setTooltip({
        node: {
          label: attrs.label,
          categories: attrs.categories ?? [],
          backlinkCount: attrs.backlinkCount ?? 0,
          wordCount: attrs.wordCount ?? 0,
        },
        position: { x: e.clientX, y: e.clientY },
      });
    };

    container.addEventListener("mousemove", handleMouseMove);
    return () => container.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <div className="fixed inset-0" style={{ background: BG_COLOR }}>
      {/* Header */}
      <header className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between gap-2 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:gap-3 sm:px-6 sm:pb-4 sm:pt-[calc(env(safe-area-inset-top)+1.25rem)]">
        <Link to="/" className="font-display text-lg text-[var(--foreground)] sm:text-xl">
          {config.siteTitle}
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <span className="surface hidden items-center gap-2 rounded-full px-3.5 py-2 text-xs text-[var(--muted-foreground)] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--lavender)]" />
            <span className="font-semibold tabular-nums text-[var(--foreground)]">
              {data.nodes.length}
            </span>
            <span>{config.navigation.conceptsLabel}</span>
            <span>·</span>
            <span className="font-semibold tabular-nums text-[var(--foreground)]">
              {data.edges.length}
            </span>
            <span>{config.navigation.connectionsLabel}</span>
          </span>
          <Link
            to="/"
            className="surface rounded-full px-3.5 py-2 text-sm font-medium text-[var(--foreground)] transition-[transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] sm:px-4"
          >
            <span className="sm:hidden">Back</span>
            <span className="hidden sm:inline">{config.navigation.backToWikiLabel}</span>
          </Link>
        </div>
      </header>

      {/* Search */}
      <GraphSearch
        graph={graphReady ? graphRef.current : null}
        sigmaRef={sigmaRef}
        onSelect={handleSearchSelect}
      />

      {/* Tooltip (only when not focused) */}
      {!focusedSlug && (
        <NodeTooltip
          node={tooltip?.node ?? null}
          position={tooltip?.position ?? { x: 0, y: 0 }}
          aliases={config.categories.aliases}
        />
      )}

      {/* Info panel (when focused) */}
      {focusedNode && (
        <InfoPanel
          node={focusedNode}
          neighborNodes={focusedNeighbors}
          onClose={handleInfoClose}
          onClickNeighbor={handleInfoNeighborClick}
          onNavigate={(slug) => navigate(`/wiki/${slug}`)}
          aliases={config.categories.aliases}
        />
      )}

      {/* Sigma canvas */}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

export const ErrorBoundary = RouteErrorBoundary;
