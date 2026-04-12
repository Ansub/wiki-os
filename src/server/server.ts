import { buildServer, warmWikiSnapshot } from "./app";
import { maybeOpenBrowser } from "./browser-launch";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? "5211");

async function start() {
  try {
    await warmWikiSnapshot();
    const app = await buildServer();
    await app.listen({ host: HOST, port: PORT });
    const browserLaunch = await maybeOpenBrowser({ host: HOST, port: PORT });
    if (browserLaunch.attempted && !browserLaunch.opened && browserLaunch.url) {
      console.warn(
        `WikiOS could not open your browser automatically. Open ${browserLaunch.url} manually.`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    console.error(message);
    process.exit(1);
  }
}

void start();
