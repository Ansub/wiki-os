import { isRouteErrorResponse, useRouteError } from "react-router-dom";

import { ErrorStateView } from "@/components/error-state-view";
import { NotFoundView } from "@/components/not-found-view";

function getRouteErrorMessage(error: unknown) {
  if (isRouteErrorResponse(error)) {
    if (error.status === 409) {
      return "WikiOS needs a little setup before this page is ready.";
    }

    if (error.status === 503) {
      return "WikiOS is getting things ready. Please try again in a moment.";
    }

    if (error.status >= 500) {
      return "This page could not be loaded right now. Please try again in a moment.";
    }

    return "Something went wrong while opening this page.";
  }

  return "Something went wrong while opening this page.";
}

export function RouteErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundView />;
  }

  const message = getRouteErrorMessage(error);

  return <ErrorStateView message={message} />;
}
