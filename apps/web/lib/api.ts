/** An error response from the API. `code` is stable and safe to branch on. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

function send(method: Method, path: string, body?: unknown): Promise<Response> {
  return fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function toError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { code?: string; message?: string };
    return new ApiError(
      response.status,
      body.code ?? "UNKNOWN",
      body.message ?? "Something went wrong.",
    );
  } catch {
    return new ApiError(
      response.status,
      "UNAVAILABLE",
      "The server is not responding. Try again in a moment.",
    );
  }
}

let creatingSession: Promise<void> | null = null;

/** Creates the anonymous session. Concurrent callers share one request. */
function createSession(): Promise<void> {
  creatingSession ??= send("POST", "/sessions")
    .then(async (response) => {
      if (!response.ok) throw await toError(response);
    })
    .finally(() => {
      creatingSession = null;
    });
  return creatingSession;
}

/**
 * Calls the API. The session lives in an HttpOnly cookie this code never sees: when the API
 * says there is no valid session, one is created and the request is repeated once.
 */
export async function api<T>(
  method: Method,
  path: string,
  body?: unknown,
): Promise<T> {
  let response = await send(method, path, body);
  if (response.status === 401) {
    await createSession();
    response = await send(method, path, body);
  }
  if (!response.ok) throw await toError(response);
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
