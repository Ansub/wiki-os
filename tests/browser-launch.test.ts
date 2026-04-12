import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  maybeOpenBrowser,
  resolveBrowserLaunchUrl,
  shouldAutoOpenBrowser,
} from "../src/server/browser-launch";

class FakeChildProcess extends EventEmitter {
  unref = vi.fn();
}

describe("browser launch", () => {
  it("opens only when the opt-in env flag is enabled", () => {
    expect(shouldAutoOpenBrowser({})).toBe(false);
    expect(shouldAutoOpenBrowser({ WIKIOS_OPEN_BROWSER: "0" })).toBe(false);
    expect(shouldAutoOpenBrowser({ WIKIOS_OPEN_BROWSER: "1" })).toBe(true);
    expect(shouldAutoOpenBrowser({ WIKIOS_OPEN_BROWSER: "true" })).toBe(true);
  });

  it("uses localhost for wildcard hosts and honors an explicit browser URL", () => {
    expect(resolveBrowserLaunchUrl("0.0.0.0", 5211, {})).toBe("http://localhost:5211");
    expect(
      resolveBrowserLaunchUrl("0.0.0.0", 5211, {
        WIKIOS_BROWSER_URL: "http://127.0.0.1:9999/custom",
      }),
    ).toBe("http://127.0.0.1:9999/custom");
  });

  it("does not spawn a browser process when auto-open is disabled", async () => {
    const spawnImpl = vi.fn();

    const result = await maybeOpenBrowser({
      env: {},
      host: "0.0.0.0",
      port: 5211,
      spawnImpl: spawnImpl as never,
    });

    expect(result).toEqual({
      attempted: false,
      opened: false,
      url: null,
    });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("spawns the platform opener when auto-open is enabled", async () => {
    const child = new FakeChildProcess();
    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });

    const result = await maybeOpenBrowser({
      env: { WIKIOS_OPEN_BROWSER: "1" },
      host: "0.0.0.0",
      platform: "darwin",
      port: 5211,
      spawnImpl: spawnImpl as never,
    });

    expect(spawnImpl).toHaveBeenCalledWith(
      "open",
      ["http://localhost:5211"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
      }),
    );
    expect(child.unref).toHaveBeenCalled();
    expect(result).toEqual({
      attempted: true,
      opened: true,
      url: "http://localhost:5211",
    });
  });
});
