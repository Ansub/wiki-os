import { redirect, useLoaderData } from "react-router-dom";

import { HomepageContent } from "@/components/homepage-content";
import { SearchBox } from "@/components/search-box";
import type { HomepageData } from "@/lib/wiki-shared";

import { fetchJson, isSetupRequiredResponse } from "../api";
import { RouteErrorBoundary } from "../route-error-boundary";

export async function loader() {
  try {
    return await fetchJson<HomepageData>("/api/home");
  } catch (error) {
    if (isSetupRequiredResponse(error)) {
      throw redirect("/setup");
    }

    throw error;
  }
}

export function Component() {
  const homepage = useLoaderData() as HomepageData;

  return (
    <SearchBox totalPages={homepage.totalPages}>
      {(onBrowseTopic) => <HomepageContent homepage={homepage} onBrowseTopic={onBrowseTopic} />}
    </SearchBox>
  );
}

export const ErrorBoundary = RouteErrorBoundary;
