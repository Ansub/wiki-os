import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { fetchJson } from "@/client/api";
import { WikiConfigProvider, applyThemeVariables } from "@/client/wiki-config";
import { DEFAULT_WIKI_OS_CONFIG, type WikiOsConfig } from "@/lib/wiki-config";

import "./globals.css";
import { router } from "./router";

const container = document.getElementById("root");

if (!(container instanceof HTMLElement)) {
  throw new Error("Root container not found");
}

const rootContainer: HTMLElement = container;

async function bootstrap() {
  const config = await fetchJson<WikiOsConfig>("/api/config").catch(() => DEFAULT_WIKI_OS_CONFIG);

  applyThemeVariables(config);
  document.title = config.siteTitle;

  createRoot(rootContainer).render(
    <StrictMode>
      <WikiConfigProvider config={config}>
        <RouterProvider router={router} />
      </WikiConfigProvider>
    </StrictMode>,
  );
}

void bootstrap();
