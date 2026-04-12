import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const cacheKey = "__wikiUiCache";

async function loadServerModule({
  root,
  setupConfigPath,
}: {
  root?: string;
  setupConfigPath?: string;
} = {}) {
  if (root) {
    process.env.WIKI_ROOT = root;
    process.env.WIKIOS_FORCE_WIKI_ROOT = root;
  } else {
    delete process.env.WIKI_ROOT;
    delete process.env.WIKIOS_FORCE_WIKI_ROOT;
  }

  if (setupConfigPath) {
    process.env.WIKIOS_SETUP_CONFIG = setupConfigPath;
  } else {
    delete process.env.WIKIOS_SETUP_CONFIG;
  }

  vi.resetModules();
  delete (globalThis as typeof globalThis & { __wikiUiCache?: unknown })[cacheKey];
  return import("../src/server/app");
}

afterEach(() => {
  delete process.env.WIKI_ROOT;
  delete process.env.WIKIOS_FORCE_WIKI_ROOT;
  delete process.env.WIKIOS_ADMIN_TOKEN;
  delete process.env.WIKIOS_SETUP_CONFIG;
  vi.doUnmock("../src/server/folder-picker");
  vi.resetModules();
  delete (globalThis as typeof globalThis & { __wikiUiCache?: unknown })[cacheKey];
});

describe("server app", () => {
  it("serves the migrated JSON contracts from the in-memory wiki snapshot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wiki-ui-server-"));

    try {
      await writeFile(
        path.join(root, "Alpha.md"),
        "# Alpha\n\nAlpha links to [[Beta]].\n",
      );
      await writeFile(path.join(root, "Beta.md"), "# Beta\n\nBeta returns the link.\n");

      const server = await loadServerModule({ root });
      await server.warmWikiSnapshot();
      const app = await server.buildServer({ logger: false, serveClient: false });

      await app.ready();

      const health = await app.inject({ method: "GET", url: "/api/health" });
      const config = await app.inject({ method: "GET", url: "/api/config" });
      const version = await app.inject({ method: "GET", url: "/api/version" });
      const reindex = await app.inject({ method: "POST", url: "/api/admin/reindex" });
      const home = await app.inject({ method: "GET", url: "/api/home" });
      const search = await app.inject({ method: "GET", url: "/api/search?q=alpha" });
      const wiki = await app.inject({ method: "GET", url: "/api/wiki/Alpha" });
      const missing = await app.inject({ method: "GET", url: "/api/wiki/Missing" });

      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual(
        expect.objectContaining({
          ok: true,
          totalPages: 2,
          wikiRoot: root,
          sync: expect.objectContaining({
            lastSyncAt: expect.any(String),
            lastSyncSource: expect.any(String),
            lastSyncError: null,
            pendingPaths: 0,
            pendingFullReconcile: false,
            watcherActive: false,
            watcherStarting: false,
            watcherFlushInFlight: false,
          }),
          integrity: expect.objectContaining({
            ok: true,
            lastCheckAt: expect.any(String),
            error: null,
            dbReady: true,
            pagesCount: 2,
            ftsCount: 2,
          }),
        }),
      );

      expect(version.statusCode).toBe(200);
      expect(version.json()).toEqual(
        expect.objectContaining({
          commit: expect.any(String),
          commitShort: expect.any(String),
        }),
      );

      expect(config.statusCode).toBe(200);
      expect(config.json()).toEqual(
        expect.objectContaining({
          siteTitle: "WikiOS",
          people: expect.objectContaining({
            mode: "explicit",
          }),
          navigation: expect.objectContaining({
            graphLabel: expect.any(String),
            statsLabel: expect.any(String),
          }),
        }),
      );

      expect(reindex.statusCode).toBe(200);
      expect(reindex.json()).toMatchObject({ ok: true, totalPages: 2 });

      expect(home.statusCode).toBe(200);
      expect(home.json().totalPages).toBe(2);
      expect(home.json().topConnected[0]?.file).toBe("Beta.md");

      expect(search.statusCode).toBe(200);
      expect(search.json().results[0]?.file).toBe("Alpha.md");

      expect(wiki.statusCode).toBe(200);
      expect(wiki.json().contentMarkdown).toContain("[Beta](/wiki/Beta)");

      expect(missing.statusCode).toBe(404);

      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires x-admin-token for reindex when admin token is configured", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wiki-ui-server-"));
    process.env.WIKIOS_ADMIN_TOKEN = "secret-token";

    try {
      await writeFile(path.join(root, "Alpha.md"), "# Alpha\n\nAlpha page.\n");

      const server = await loadServerModule({ root });
      await server.warmWikiSnapshot();
      const app = await server.buildServer({ logger: false, serveClient: false });
      await app.ready();

      const unauthorized = await app.inject({ method: "POST", url: "/api/admin/reindex" });
      const authorized = await app.inject({
        method: "POST",
        url: "/api/admin/reindex",
        headers: { "x-admin-token": "secret-token" },
      });

      expect(unauthorized.statusCode).toBe(401);
      expect(authorized.statusCode).toBe(200);
      expect(authorized.json()).toMatchObject({ ok: true, totalPages: 1 });

      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("guides first-run setup and persists a saved vault path", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiki-ui-setup-"));
    const root = path.join(tempDir, "vault");
    const setupConfigPath = path.join(tempDir, "config.json");

    try {
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, "Alpha.md"), "# Alpha\n\nSetup flow page.\n");

      const server = await loadServerModule({ setupConfigPath });
      const app = await server.buildServer({ logger: false, serveClient: false });
      await app.ready();

      const setupStatus = await app.inject({ method: "GET", url: "/api/setup/status" });
      const healthBefore = await app.inject({ method: "GET", url: "/api/health" });
      const homeBefore = await app.inject({ method: "GET", url: "/api/home" });
      const setupResponse = await app.inject({
        method: "POST",
        url: "/api/setup/config",
        payload: { wikiRoot: root },
      });
      const setupStatusAfter = await app.inject({ method: "GET", url: "/api/setup/status" });
      const homeAfter = await app.inject({ method: "GET", url: "/api/home" });
      const savedConfig = JSON.parse(await readFile(setupConfigPath, "utf8")) as {
        wikiRoot?: string;
      };

      expect(setupStatus.statusCode).toBe(200);
      expect(setupStatus.json()).toMatchObject({
        configured: false,
        wikiRoot: null,
        wikiRootSource: "none",
        hasEnvOverride: false,
        folderPickerAvailable: process.platform === "darwin",
      });

      expect(healthBefore.statusCode).toBe(409);
      expect(healthBefore.json()).toMatchObject({
        ok: false,
        code: "SETUP_REQUIRED",
        configured: false,
        wikiRoot: null,
      });

      expect(homeBefore.statusCode).toBe(409);
      expect(homeBefore.json()).toMatchObject({
        code: "SETUP_REQUIRED",
        error: "Vault setup required",
      });

      expect(setupResponse.statusCode).toBe(200);
      expect(setupResponse.json()).toMatchObject({
        ok: true,
        wikiRoot: root,
        source: "saved",
      });

      expect(setupStatusAfter.statusCode).toBe(200);
      expect(setupStatusAfter.json()).toMatchObject({
        configured: true,
        wikiRoot: root,
        wikiRootSource: "saved",
        hasEnvOverride: false,
        folderPickerAvailable: process.platform === "darwin",
      });

      expect(homeAfter.statusCode).toBe(200);
      expect(homeAfter.json()).toMatchObject({
        totalPages: 1,
      });

      expect(savedConfig).toEqual({ wikiRoot: root });

      await app.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("surfaces a corrupt saved config and requires an explicit reset before replacing it", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiki-ui-config-error-"));
    const root = path.join(tempDir, "vault");
    const setupConfigPath = path.join(tempDir, "config.json");

    try {
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, "Alpha.md"), "# Alpha\n\nConfig repair page.\n");
      await writeFile(setupConfigPath, '{"wikiRoot":', "utf8");

      const server = await loadServerModule({ setupConfigPath });
      const app = await server.buildServer({ logger: false, serveClient: false });
      await app.ready();

      const setupStatus = await app.inject({ method: "GET", url: "/api/setup/status" });
      const health = await app.inject({ method: "GET", url: "/api/health" });
      const rejectedSetup = await app.inject({
        method: "POST",
        url: "/api/setup/config",
        payload: { wikiRoot: root },
      });
      const repairedSetup = await app.inject({
        method: "POST",
        url: "/api/setup/config",
        payload: { wikiRoot: root, resetCorruptConfig: true },
      });

      expect(setupStatus.statusCode).toBe(200);
      expect(setupStatus.json()).toMatchObject({
        configured: false,
        wikiRoot: null,
        configError: {
          code: "INVALID_JSON",
          path: setupConfigPath,
        },
      });

      expect(health.statusCode).toBe(409);
      expect(health.json()).toMatchObject({
        ok: false,
        code: "CONFIG_ERROR",
        configError: {
          code: "INVALID_JSON",
          path: setupConfigPath,
        },
      });

      expect(rejectedSetup.statusCode).toBe(409);
      expect(rejectedSetup.json()).toMatchObject({
        code: "CONFIG_ERROR",
        configError: {
          code: "INVALID_JSON",
          path: setupConfigPath,
        },
      });

      expect(repairedSetup.statusCode).toBe(200);
      expect(repairedSetup.json()).toMatchObject({
        ok: true,
        wikiRoot: root,
        source: "saved",
      });

      await app.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("switches to a different saved vault when setup is reopened later", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiki-ui-switch-"));
    const firstRoot = path.join(tempDir, "demo-vault");
    const secondRoot = path.join(tempDir, "personal-vault");
    const setupConfigPath = path.join(tempDir, "config.json");

    try {
      await mkdir(firstRoot, { recursive: true });
      await mkdir(secondRoot, { recursive: true });
      await writeFile(path.join(firstRoot, "Alpha.md"), "# Alpha\n\nDemo vault page.\n");
      await writeFile(path.join(secondRoot, "Beta.md"), "# Beta\n\nPersonal vault page.\n");
      await writeFile(path.join(secondRoot, "Gamma.md"), "# Gamma\n\nAnother page.\n");

      const server = await loadServerModule({ setupConfigPath });
      const app = await server.buildServer({ logger: false, serveClient: false });
      await app.ready();

      const firstSetup = await app.inject({
        method: "POST",
        url: "/api/setup/config",
        payload: { wikiRoot: firstRoot },
      });
      const secondSetup = await app.inject({
        method: "POST",
        url: "/api/setup/config",
        payload: { wikiRoot: secondRoot },
      });
      const setupStatus = await app.inject({ method: "GET", url: "/api/setup/status" });
      const health = await app.inject({ method: "GET", url: "/api/health" });
      const home = await app.inject({ method: "GET", url: "/api/home" });
      const savedConfig = JSON.parse(await readFile(setupConfigPath, "utf8")) as {
        wikiRoot?: string;
      };

      expect(firstSetup.statusCode).toBe(200);
      expect(secondSetup.statusCode).toBe(200);

      expect(setupStatus.json()).toMatchObject({
        configured: true,
        wikiRoot: secondRoot,
        wikiRootSource: "saved",
      });

      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({
        ok: true,
        wikiRoot: secondRoot,
        totalPages: 2,
      });

      expect(home.statusCode).toBe(200);
      expect(home.json()).toMatchObject({
        totalPages: 2,
      });

      expect(savedConfig).toEqual({ wikiRoot: secondRoot });

      await app.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns the selected path from the Finder picker route", async () => {
    vi.doMock("../src/server/folder-picker", () => ({
      isFinderFolderPickerAvailable: () => true,
      pickFolderWithFinder: vi.fn().mockResolvedValue("/Users/example/Obsidian Vault"),
    }));

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiki-ui-picker-"));
    const setupConfigPath = path.join(tempDir, "config.json");

    try {
      const server = await loadServerModule({ setupConfigPath });
      const app = await server.buildServer({ logger: false, serveClient: false });
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/api/setup/pick-folder",
        payload: { currentPath: "/Users/example" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ok: true,
        cancelled: false,
        wikiRoot: "/Users/example/Obsidian Vault",
      });

      await app.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("saves a local person override and reapplies it through the wiki API", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiki-ui-person-override-"));
    const root = path.join(tempDir, "vault");
    const setupConfigPath = path.join(tempDir, "config.json");

    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        path.join(root, "Reading People.md"),
        "# Reading People\n\nA concept note about understanding other people accurately.\n",
      );

      const server = await loadServerModule({ setupConfigPath });
      const app = await server.buildServer({ logger: false, serveClient: false });
      await app.ready();

      await app.inject({
        method: "POST",
        url: "/api/setup/config",
        payload: { wikiRoot: root },
      });

      const before = await app.inject({ method: "GET", url: "/api/wiki/Reading%20People" });
      const overrideResponse = await app.inject({
        method: "POST",
        url: "/api/setup/person-override",
        payload: {
          file: "Reading People.md",
          override: "person",
        },
      });
      const after = await app.inject({ method: "GET", url: "/api/wiki/Reading%20People" });
      const savedConfig = JSON.parse(await readFile(setupConfigPath, "utf8")) as {
        personOverridesByVault?: Record<string, Record<string, "person" | "not-person">>;
      };

      expect(before.statusCode).toBe(200);
      expect(before.json()).toMatchObject({
        isPerson: false,
        personOverride: null,
      });

      expect(overrideResponse.statusCode).toBe(200);
      expect(overrideResponse.json()).toEqual({
        ok: true,
        file: "Reading People.md",
        override: "person",
      });

      expect(after.statusCode).toBe(200);
      expect(after.json()).toMatchObject({
        isPerson: true,
        personOverride: "person",
      });
      expect(savedConfig.personOverridesByVault?.[root]).toEqual({
        "Reading People.md": "person",
      });

      await app.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
