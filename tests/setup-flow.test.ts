import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJson = vi.fn();

vi.mock("../src/client/api", () => ({
  fetchJson,
  isSetupRequiredResponse: (error: unknown) => error instanceof Response && error.status === 409,
}));

function expectRedirect(error: unknown, location: string) {
  expect(error).toBeInstanceOf(Response);
  expect((error as Response).status).toBe(302);
  expect((error as Response).headers.get("Location")).toBe(location);
}

function loaderArgs(url: string) {
  return {
    request: new Request(url),
    params: {},
    context: undefined,
    unstable_pattern: "/setup",
    unstable_url: new URL(url),
  } as const;
}

describe("setup flow routes", () => {
  beforeEach(() => {
    fetchJson.mockReset();
  });

  it("redirects the home loader to /setup when the API requires setup", async () => {
    fetchJson.mockRejectedValue(new Response("Vault setup required", { status: 409 }));

    const { loader } = await import("../src/client/routes/home-route");
    const thrown = await loader().catch((error: unknown) => error);

    expectRedirect(thrown, "/setup");
  });

  it("keeps the setup route accessible when the app is not configured", async () => {
    fetchJson.mockResolvedValue({
      configured: false,
      wikiRoot: null,
      wikiRootSource: "none",
      hasEnvOverride: false,
      sampleVaultPath: null,
      configError: null,
    });

    const { loader } = await import("../src/client/routes/setup-route");
    const status = await loader(loaderArgs("http://localhost/setup"));

    expect(status).toMatchObject({
      configured: false,
      wikiRoot: null,
      wikiRootSource: "none",
    });
  });

  it("redirects the setup loader back home once a vault is configured", async () => {
    fetchJson.mockResolvedValue({
      configured: true,
      wikiRoot: "/Users/example/Vault",
      wikiRootSource: "saved",
      hasEnvOverride: false,
      sampleVaultPath: null,
      configError: null,
    });

    const { loader } = await import("../src/client/routes/setup-route");
    const thrown = await loader(loaderArgs("http://localhost/setup")).catch(
      (error: unknown) => error,
    );

    expectRedirect(thrown, "/");
  });

  it("keeps the setup route available in change mode when a vault is already configured", async () => {
    fetchJson.mockResolvedValue({
      configured: true,
      wikiRoot: "/Users/example/Vault",
      wikiRootSource: "saved",
      hasEnvOverride: false,
      sampleVaultPath: "/tmp/sample-vault",
      configError: null,
    });

    const { loader } = await import("../src/client/routes/setup-route");
    const status = await loader(loaderArgs("http://localhost/setup?change=1"));

    expect(status).toMatchObject({
      configured: true,
      wikiRoot: "/Users/example/Vault",
      mode: "change",
    });
  });
});
