/**
 * Thin `fetch` transport for `@dtp/sdk` with a request timeout and typed errors.
 *
 * Mirrors the `@dtp/holon-sdk` transport style: uses `globalThis.fetch`
 * directly (this is a standalone client library, so the repo's
 * `@dtp/http-client` rule does not apply) and throws {@link DTPApiError} on any
 * non-2xx response, decoding twin-core's `{ error: { code, message } }`
 * envelope.
 */

/** DTP error codes surfaced by the SDK on non-2xx responses. */
export const DTPErrorCode = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  SCOPE_DENIED: "SCOPE_DENIED",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
} as const;

/** Union of DTP error code string values. */
export type DTPErrorCode = (typeof DTPErrorCode)[keyof typeof DTPErrorCode];

/** Error thrown when the SDK is misconfigured (missing credential or base URL). */
export class DTPConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DTPConfigError";
  }
}

/** Error thrown by the SDK on a non-2xx response, network failure, or timeout. */
export class DTPApiError extends Error {
  constructor(
    message: string,
    /** DTP error code from the response envelope, or a transport code. */
    public readonly code: string,
    /** HTTP status (0 for transport-level failures) and the raw response body. */
    public readonly details: { status: number; body: unknown }
  ) {
    super(message);
    this.name = "DTPApiError";
  }
}

/** Shape of twin-core / identity-consent error response bodies. */
interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
}

/** Bearer credential and optional per-request overrides for a single request. */
export interface RequestAuth {
  /** Value for the `Authorization: Bearer <token>` header (grant or session token). */
  bearer?: string;
}

/** Options for {@link DTPHttpClient.request}. */
interface RequestInitLite {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: RequestAuth;
  query?: Record<string, string | number | undefined>;
}

/** Configuration for a {@link DTPHttpClient} bound to one service base URL. */
export interface HttpClientConfig {
  baseUrl: string;
  /** Ambient DTP api key sent as `X-DTP-API-Key`. Omit for user-authed services. */
  apiKey?: string;
  timeout: number;
}

/** Build a query string (with leading `?`) from defined params, or "" when empty. */
function buildQuery(query: Record<string, string | number | undefined> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * A `fetch` wrapper bound to one service base URL. Sends `X-DTP-API-Key` when an
 * api key is configured and `Authorization: Bearer <token>` when a per-request
 * bearer is supplied. Unwraps the `{ data }` envelope via {@link DTPHttpClient.requestData}.
 */
export class DTPHttpClient {
  constructor(private readonly config: HttpClientConfig) {}

  /** Perform a request and return the parsed JSON body typed as `T`. */
  async request<T>(path: string, init: RequestInitLite): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.config.apiKey) headers["X-DTP-API-Key"] = this.config.apiKey;
    if (init.auth?.bearer) headers.Authorization = `Bearer ${init.auth.bearer}`;

    const url = `${this.config.baseUrl}${path}${buildQuery(init.query)}`;
    const requestInit: RequestInit = {
      method: init.method,
      headers,
      signal: AbortSignal.timeout(this.config.timeout),
    };
    if (init.body !== undefined) requestInit.body = JSON.stringify(init.body);

    let res: Response;
    try {
      res = await globalThis.fetch(url, requestInit);
    } catch (e) {
      const isTimeout = e instanceof Error && e.name === "TimeoutError";
      throw new DTPApiError(
        `Request to ${init.method} ${path} failed: ${e instanceof Error ? e.message : String(e)}`,
        isTimeout ? DTPErrorCode.TIMEOUT : DTPErrorCode.NETWORK_ERROR,
        { status: 0, body: null }
      );
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ErrorEnvelope | null;
      throw new DTPApiError(
        `${init.method} ${path}: ${body?.error?.message ?? `HTTP ${res.status}`}`,
        body?.error?.code ?? DTPErrorCode.INTERNAL_ERROR,
        { status: res.status, body }
      );
    }

    return (await res.json()) as T;
  }

  /** Perform a request and return the unwrapped `data` field of the `{ data }` envelope. */
  async requestData<T>(path: string, init: RequestInitLite): Promise<T> {
    const envelope = await this.request<{ data: T }>(path, init);
    return envelope.data;
  }
}
