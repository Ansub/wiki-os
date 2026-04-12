import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

type SpawnLike = typeof spawn;

interface BrowserLaunchOptions {
  env?: NodeJS.ProcessEnv;
  host: string;
  platform?: NodeJS.Platform;
  port: number;
  spawnImpl?: SpawnLike;
}

interface BrowserCommand {
  command: string;
  args: string[];
  detached?: boolean;
  windowsVerbatimArguments?: boolean;
}

export function shouldAutoOpenBrowser(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.WIKIOS_OPEN_BROWSER?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function resolveBrowserLaunchUrl(
  host: string,
  port: number,
  env: NodeJS.ProcessEnv = process.env,
) {
  const explicitUrl = env.WIKIOS_BROWSER_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const normalizedHost =
    !host || host === "0.0.0.0" || host === "::" || host === "[::]" ? "localhost" : host;

  return `http://${normalizedHost}:${port}`;
}

function getBrowserCommand(url: string, platform: NodeJS.Platform): BrowserCommand | null {
  if (platform === "darwin") {
    return {
      command: "open",
      args: [url],
      detached: true,
    };
  }

  if (platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "start", "", url],
      windowsVerbatimArguments: true,
    };
  }

  if (platform === "linux") {
    return {
      command: "xdg-open",
      args: [url],
      detached: true,
    };
  }

  return null;
}

export async function maybeOpenBrowser({
  env = process.env,
  host,
  platform = process.platform,
  port,
  spawnImpl = spawn,
}: BrowserLaunchOptions) {
  if (!shouldAutoOpenBrowser(env)) {
    return { attempted: false, opened: false, url: null as string | null };
  }

  const url = resolveBrowserLaunchUrl(host, port, env);
  const browserCommand = getBrowserCommand(url, platform);
  if (!browserCommand) {
    return { attempted: true, opened: false, url };
  }

  const opened = await new Promise<boolean>((resolve) => {
    let settled = false;

    try {
      const child = spawnImpl(browserCommand.command, browserCommand.args, {
        detached: browserCommand.detached,
        stdio: "ignore",
        windowsVerbatimArguments: browserCommand.windowsVerbatimArguments,
      }) as EventEmitter & { unref?: () => void };

      child.once("error", () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });

      child.once("spawn", () => {
        child.unref?.();
        if (!settled) {
          settled = true;
          resolve(true);
        }
      });
    } catch {
      resolve(false);
    }
  });

  return { attempted: true, opened, url };
}
