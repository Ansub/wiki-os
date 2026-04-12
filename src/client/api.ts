export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      accept: "application/json",
      ...init?.headers,
    },
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? (await response.json()) as unknown
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : payload &&
            typeof payload === "object" &&
            "error" in payload &&
            typeof payload.error === "string"
          ? payload.error
          : response.statusText;

    throw new Response(message, {
      status: response.status,
      statusText: response.statusText,
    });
  }

  return payload as T;
}

export function isSetupRequiredResponse(error: unknown) {
  return error instanceof Response && error.status === 409;
}
