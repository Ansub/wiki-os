import { promises as fs } from "node:fs";
import path from "node:path";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";

import { getBuiltClientRoot, getVersionInfoPath } from "./app-paths";
import { configureServerWikiCore } from "./wiki-core-adapter";
import { getWikiOsConfig } from "./wiki-config";
import {
  getWikiSetupStatus,
  loadWikiRuntimeConfig,
  saveWikiPersonOverride,
  saveWikiRuntimeConfig,
  validateWikiRootPath,
  WikiRuntimeConfigFileError,
  type WikiSetupStatus,
} from "./wiki-runtime";
import { isFinderFolderPickerAvailable, pickFolderWithFinder } from "./folder-picker";
import {
  getWikiRootPath,
  getGraphData,
  getHomepageData,
  getWikiHealthStatus,
  getWikiPage,
  getWikiStats,
  isWikiConfigured,
  isWikiSetupRequiredError,
  primeWikiSnapshot,
  reindexWikiSnapshot,
  reloadWikiRuntime,
  searchWiki,
} from "../lib/wiki";

interface BuildServerOptions {
  clientRoot?: string;
  logger?: boolean;
  serveClient?: boolean;
}

interface VersionInfo {
  commit: string;
  commitShort: string;
  deployedAt: string | null;
}

configureServerWikiCore();

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function canServeClient(clientRoot: string) {
  try {
    const stat = await fs.stat(path.join(clientRoot, "index.html"));
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readVersionInfo(): Promise<VersionInfo> {
  const fallback: VersionInfo = {
    commit: "unknown",
    commitShort: "unknown",
    deployedAt: null,
  };

  try {
    const raw = await fs.readFile(getVersionInfoPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<VersionInfo>;

    return {
      commit: parsed.commit ?? fallback.commit,
      commitShort: parsed.commitShort ?? fallback.commitShort,
      deployedAt: parsed.deployedAt ?? fallback.deployedAt,
    };
  } catch {
    return fallback;
  }
}

function buildSetupRequiredResponse(setup: Pick<WikiSetupStatus, "wikiRoot" | "configError">) {
  const hasConfigError = setup.configError !== null;

  return {
    ok: false,
    error: hasConfigError ? "Local config needs attention" : "Vault setup required",
    code: hasConfigError ? "CONFIG_ERROR" : "SETUP_REQUIRED",
    configured: false,
    totalPages: 0,
    wikiRoot: setup.wikiRoot,
    configError: setup.configError,
    sync: {
      lastSyncAtMs: null,
      lastSyncAt: null,
      lastSyncSource: null,
      lastSyncError: null,
      periodicReconcileMs: null,
      periodicReconcileScheduled: false,
      periodicReconcileInFlight: false,
      pendingPaths: 0,
      pendingFullReconcile: false,
      watcherActive: false,
      watcherStarting: false,
      watcherFlushInFlight: false,
      revision: 0,
      cacheRevision: -1,
    },
    integrity: {
      ok: null,
      lastCheckAt: null,
      error: null,
      dbReady: false,
      pagesCount: null,
      ftsCount: null,
    },
  };
}

function replyForWikiError(
  error: unknown,
  reply: FastifyReply,
  fallback: string,
  notFoundStatus = 500,
) {
  if (isWikiSetupRequiredError(error)) {
    return reply.code(409).send({
      error: "Vault setup required",
      code: "SETUP_REQUIRED",
    });
  }

  return reply.code(notFoundStatus).send({ error: errorMessage(error, fallback) });
}

export async function warmWikiSnapshot() {
  if (!(await isWikiConfigured())) {
    return null;
  }

  try {
    await primeWikiSnapshot();
  } catch (error) {
    const wikiRoot = await getWikiRootPath();
    throw new Error(
      `Failed to load wiki from ${wikiRoot ?? "unconfigured vault"}: ${errorMessage(error, "Unknown error")}`,
    );
  }
}

export async function buildServer({
  clientRoot = getBuiltClientRoot(),
  logger = true,
  serveClient = true,
}: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger });

  app.get("/api/health", async (_request, reply) => {
    try {
      const setup = await getWikiSetupStatus();
      if (!setup.configured) {
        return reply.code(409).send(buildSetupRequiredResponse(setup));
      }

      const [stats, healthStatus] = await Promise.all([getWikiStats(), getWikiHealthStatus()]);
      return {
        ok: true,
        configured: true,
        totalPages: stats.total_pages,
        wikiRoot: setup.wikiRoot,
        ...healthStatus,
      };
    } catch (error) {
      return reply.code(500).send({ error: errorMessage(error, "Health check failed") });
    }
  });

  app.get("/api/version", async () => readVersionInfo());

  app.get("/api/config", async () => getWikiOsConfig());

  app.get("/api/setup/status", async () => getWikiSetupStatus());

  app.post<{ Body: { currentPath?: string } }>("/api/setup/pick-folder", async (request, reply) => {
    if (!isFinderFolderPickerAvailable()) {
      return reply.code(501).send({
        error: "Finder folder picker is available on macOS only.",
      });
    }

    try {
      const selectedPath = await pickFolderWithFinder(request.body?.currentPath);

      if (!selectedPath) {
        return {
          ok: true,
          cancelled: true,
          wikiRoot: null,
        };
      }

      return {
        ok: true,
        cancelled: false,
        wikiRoot: selectedPath,
      };
    } catch (error) {
      return reply.code(500).send({
        error: errorMessage(error, "Could not open Finder."),
      });
    }
  });

  app.post<{ Body: { wikiRoot?: string; useSampleVault?: boolean; resetCorruptConfig?: boolean } }>(
    "/api/setup/config",
    async (request, reply) => {
      try {
        const setupStatus = await getWikiSetupStatus();
        const shouldResetCorruptConfig = request.body?.resetCorruptConfig === true;

        if (setupStatus.hasEnvOverride) {
          return reply.code(409).send({
            error: "A vault path is already locked by environment variables for this process.",
          });
        }

        if (setupStatus.configError && !shouldResetCorruptConfig) {
          return reply.code(409).send({
            error: setupStatus.configError.message,
            code: "CONFIG_ERROR",
            configError: setupStatus.configError,
          });
        }

        const requestedPath = request.body?.useSampleVault
          ? setupStatus.sampleVaultPath
          : request.body?.wikiRoot;

        if (!requestedPath) {
          return reply.code(400).send({ error: "Enter the path to your Obsidian vault." });
        }

        const wikiRoot = await validateWikiRootPath(requestedPath);
        let existingConfig = {};
        let rollbackConfig = {};

        if (!setupStatus.configError) {
          existingConfig = await loadWikiRuntimeConfig();
          rollbackConfig = existingConfig;
        }

        try {
          await saveWikiRuntimeConfig({
            ...existingConfig,
            wikiRoot,
          }, {
            overwriteCorrupt: shouldResetCorruptConfig,
          });
          await reloadWikiRuntime();
          await warmWikiSnapshot();
        } catch (error) {
          try {
            await saveWikiRuntimeConfig(rollbackConfig, {
              overwriteCorrupt: shouldResetCorruptConfig,
            });
            await reloadWikiRuntime();
          } catch (rollbackError) {
            request.log.error(
              rollbackError,
              "Failed to restore the previous wiki runtime config after setup error",
            );
          }

          return reply.code(500).send({ error: errorMessage(error, "Setup failed") });
        }

        return {
          ok: true,
          wikiRoot,
          source: "saved",
        };
      } catch (error) {
        if (error instanceof WikiRuntimeConfigFileError) {
          return reply.code(409).send({
            error: error.configError.message,
            code: "CONFIG_ERROR",
            configError: error.configError,
          });
        }

        return reply.code(400).send({ error: errorMessage(error, "Setup failed") });
      }
    },
  );

  app.post<{ Body: { file?: string; override?: "person" | "not-person" | null } }>(
    "/api/setup/person-override",
    async (request, reply) => {
      try {
        const wikiRoot = await getWikiRootPath();
        if (!wikiRoot) {
          return reply.code(409).send({
            error: "Vault setup required",
            code: "SETUP_REQUIRED",
          });
        }

        const file = request.body?.file?.trim();
        if (!file) {
          return reply.code(400).send({ error: "Choose a valid wiki page first." });
        }

        const override = request.body?.override;
        if (override !== null && override !== undefined && override !== "person" && override !== "not-person") {
          return reply.code(400).send({ error: "Invalid person override." });
        }

        const nextOverride = await saveWikiPersonOverride(wikiRoot, file, override ?? null);
        await reloadWikiRuntime();
        await reindexWikiSnapshot();

        return {
          ok: true,
          file,
          override: nextOverride,
        };
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error, "Could not save person override") });
      }
    },
  );

  app.post("/api/admin/reindex", async (request, reply) => {
    const requiredToken = process.env.WIKIOS_ADMIN_TOKEN?.trim();
    const providedHeader = request.headers["x-admin-token"];
    const providedToken = Array.isArray(providedHeader) ? providedHeader[0] : providedHeader;

    if (requiredToken && providedToken !== requiredToken) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    try {
      const stats = await reindexWikiSnapshot();
      return {
        ok: true,
        rebuiltAt: new Date().toISOString(),
        totalPages: stats.total_pages,
        totalWords: stats.total_words,
      };
    } catch (error) {
      return replyForWikiError(error, reply, "Manual reindex failed");
    }
  });

  app.get("/api/home", async (_request, reply) => {
    try {
      return await getHomepageData();
    } catch (error) {
      return replyForWikiError(error, reply, "Homepage data failed");
    }
  });

  app.get<{ Querystring: { q?: string } }>("/api/search", async (request, reply) => {
    try {
      const q = request.query.q ?? "";
      return { query: q, results: await searchWiki(q) };
    } catch (error) {
      return replyForWikiError(error, reply, "Search failed");
    }
  });

  app.get("/api/stats", async (_request, reply) => {
    try {
      return await getWikiStats();
    } catch (error) {
      return replyForWikiError(error, reply, "Stats failed");
    }
  });

  app.get("/api/graph", async (_request, reply) => {
    try {
      return await getGraphData();
    } catch (error) {
      return replyForWikiError(error, reply, "Graph data failed");
    }
  });

  app.get<{ Params: { "*": string } }>("/api/wiki/*", async (request, reply) => {
    try {
      const slugParts = request.params["*"]?.split("/").filter(Boolean) ?? [];
      return await getWikiPage(slugParts);
    } catch (error) {
      return replyForWikiError(error, reply, "Wiki page not found", 404);
    }
  });

  if (serveClient && (await canServeClient(clientRoot))) {
    await app.register(fastifyStatic, {
      root: clientRoot,
      prefix: "/",
      decorateReply: false,
    });

    const indexHtml = await fs.readFile(path.join(clientRoot, "index.html"), "utf8");

    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith("/api/")) {
        return reply.code(404).send({ error: "Not found" });
      }

      reply.header("cache-control", "no-cache");
      return reply.type("text/html; charset=utf-8").send(indexHtml);
    });
  } else {
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith("/api/")) {
        return reply.code(404).send({ error: "Not found" });
      }

      return reply.code(503).send({ error: "Client build not found" });
    });
  }

  return app;
}
