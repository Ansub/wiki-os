import { useState } from "react";
import { Link, redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router-dom";

import { useWikiConfig } from "@/client/wiki-config";

import { fetchJson } from "../api";
import { RouteErrorBoundary } from "../route-error-boundary";

interface SetupStatus {
  configured: boolean;
  wikiRoot: string | null;
  wikiRootSource: "env" | "saved" | "none";
  hasEnvOverride: boolean;
  sampleVaultPath: string | null;
  folderPickerAvailable: boolean;
  configError: {
    code: "INVALID_JSON" | "INVALID_CONFIG";
    message: string;
    path: string;
  } | null;
}

interface SetupLoaderData extends SetupStatus {
  mode: "setup" | "change";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const requestUrl = new URL(request.url);
  const mode = requestUrl.searchParams.get("change") === "1" ? "change" : "setup";
  const status = await fetchJson<SetupStatus>("/api/setup/status");

  if (status.configured && mode !== "change" && status.configError === null) {
    throw redirect("/");
  }

  return {
    ...status,
    mode,
  } satisfies SetupLoaderData;
}

export function Component() {
  const config = useWikiConfig();
  const setupStatus = useLoaderData() as SetupLoaderData;
  const navigate = useNavigate();
  const [wikiRoot, setWikiRoot] = useState(setupStatus.wikiRoot ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isChangeMode = setupStatus.mode === "change";
  const primaryActionLabel = setupStatus.configError
    ? isSaving
      ? "Repairing..."
      : "Repair config and continue"
    : isChangeMode
      ? isSaving
        ? "Switching..."
        : "Switch vault"
      : isSaving
        ? "Saving..."
        : "Next";

  async function submitSetup(body: {
    wikiRoot?: string;
    useSampleVault?: boolean;
    resetCorruptConfig?: boolean;
  }) {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/setup/config", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Setup failed");
      }

      navigate("/", { replace: true });
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Setup failed");
    } finally {
      setIsSaving(false);
    }
  }

  async function pickFolder() {
    setIsPickingFolder(true);
    setError(null);

    try {
      const response = await fetch("/api/setup/pick-folder", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          currentPath: wikiRoot || setupStatus.wikiRoot || undefined,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; cancelled?: boolean; wikiRoot?: string | null }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not open Finder");
      }

      if (!payload?.cancelled && payload?.wikiRoot) {
        setWikiRoot(payload.wikiRoot);
      }
    } catch (pickerError) {
      setError(pickerError instanceof Error ? pickerError.message : "Could not open Finder");
    } finally {
      setIsPickingFolder(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(133,185,201,0.18),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(244,177,131,0.16),_transparent_30%)]"
      />

      <header className="relative flex items-center justify-between gap-2 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:gap-3 sm:px-6 sm:pb-4 sm:pt-[calc(env(safe-area-inset-top)+1.25rem)]">
        <Link
          to="/"
          className="font-display text-lg text-[var(--foreground)] sm:text-xl"
        >
          {config.siteTitle}
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <Link
            to="/graph"
            className="surface rounded-full px-3.5 py-2 text-sm font-medium text-[var(--foreground)] transition-[transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] sm:px-4"
          >
            {config.navigation.graphLabel}
          </Link>
          <Link
            to="/stats"
            className="surface rounded-full px-3.5 py-2 text-sm font-medium text-[var(--foreground)] transition-[transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] sm:px-4"
          >
            {config.navigation.statsLabel}
          </Link>
        </div>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 py-20 sm:px-6">
      <div className="w-full max-w-md space-y-6">
        {setupStatus.configured && (
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-[var(--muted-foreground)]">
              Current vault
            </p>
            <p className="mt-1 break-all text-sm leading-relaxed text-[var(--foreground)]">
              {setupStatus.wikiRoot}
            </p>
          </div>
        )}

        {setupStatus.hasEnvOverride && (
          <div className="rounded-2xl bg-[var(--teal-soft)] px-4 py-3 text-sm text-[var(--foreground)]">
            Session locked by environment override. Restart without <code>WIKI_ROOT</code> or{" "}
            <code>WIKIOS_FORCE_WIKI_ROOT</code> to change.
          </div>
        )}

        {setupStatus.configError && (
          <div className="rounded-2xl bg-[var(--peach-soft)] px-4 py-3 text-sm text-[var(--foreground)]">
            <p className="font-medium">Local config needs attention.</p>
            <p className="mt-1 leading-relaxed">{setupStatus.configError.message}</p>
            <p className="mt-2 break-all text-xs text-[var(--muted-foreground)]">
              {setupStatus.configError.path}
            </p>
          </div>
        )}

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
              {isChangeMode ? "Choose a new path" : "Vault path"}
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={wikiRoot}
                onChange={(event) => setWikiRoot(event.target.value)}
                placeholder="/Users/you/Documents/My Vault"
                className="surface min-w-0 flex-1 rounded-xl px-4 py-2.5 text-[0.9rem] text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              {setupStatus.folderPickerAvailable && (
                <button
                  type="button"
                  onClick={() => void pickFolder()}
                  disabled={isPickingFolder || isSaving || setupStatus.hasEnvOverride}
                  className="surface shrink-0 rounded-xl px-3 py-2.5 text-sm font-medium text-[var(--foreground)] transition-[transform,opacity] duration-150 hover:opacity-80 active:scale-[0.97] disabled:cursor-wait disabled:opacity-60"
                >
                  {isPickingFolder ? "Opening..." : "Browse"}
                </button>
              )}
            </div>
          </label>

          <button
            type="button"
            onClick={() =>
              void submitSetup({
                wikiRoot,
                resetCorruptConfig: setupStatus.configError !== null,
              })
            }
            disabled={isSaving || isPickingFolder || setupStatus.hasEnvOverride}
            className="w-full rounded-xl bg-[var(--foreground)] px-5 py-2.5 text-sm font-semibold text-[var(--background)] transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
          >
            {primaryActionLabel}
          </button>

          {error && (
            <p className="rounded-xl bg-[var(--peach-soft)] px-4 py-3 text-sm text-[var(--foreground)]">
              {error}
            </p>
          )}
        </div>

        {setupStatus.sampleVaultPath && (
          <button
            type="button"
            onClick={() =>
              void submitSetup({
                useSampleVault: true,
                resetCorruptConfig: setupStatus.configError !== null,
              })
            }
            disabled={isSaving || isPickingFolder || setupStatus.hasEnvOverride}
            className="w-full text-center text-sm text-[var(--muted-foreground)] transition-colors duration-150 hover:text-[var(--foreground)] disabled:cursor-wait disabled:opacity-60"
          >
            Or use the demo vault
          </button>
        )}
      </div>
      </main>
    </div>
  );
}

export const ErrorBoundary = RouteErrorBoundary;
