/**
 * Public wire types and configuration shapes for `@dtp/sdk`. They are
 * re-declared here rather than imported from the platform's internal types
 * package so the published client stays self-contained, matching the vendored
 * `@dtp/holon-sdk` approach.
 */

/** The public DTP API gateway (Traefik host `api.ontomorph.com`) for twin access. */
export const DEFAULT_BASE_URL = "https://api.ontomorph.com";

/** The public DTP API gateway for account/key management. Same host as {@link DEFAULT_BASE_URL}. */
export const DEFAULT_IDENTITY_URL = "https://api.ontomorph.com";

/** Default per-request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Configuration for a {@link DTP} client instance.
 *
 * `apiKey` is the ambient DTP credential (`dtp_...`) sent as `X-DTP-API-Key` on
 * every twin request. Twin access additionally requires a grant token passed
 * to `dtp.twins.connect()`. `sessionToken` (a Zitadel user JWT) is only
 * needed for `dtp.keys.*`, which is user-authed, not api-key-authed.
 */
export interface DTPConfig {
  /** DTP API key (`dtp_...`). Sent as `X-DTP-API-Key` on twin requests. */
  apiKey: string;
  /** Twin API base URL. Defaults to {@link DEFAULT_BASE_URL} (`https://api.ontomorph.com`). */
  baseUrl?: string;
  /** Account/key-management base URL for `dtp.keys.*`. Defaults to {@link DEFAULT_IDENTITY_URL}. */
  identityUrl?: string;
  /** Zitadel user session JWT required by `dtp.keys.*` (api-key management is user-authed). */
  sessionToken?: string;
  /** HOLON knowledge API base URL. Required to use `dtp.holon`. */
  holonApiUrl?: string;
  /** HOLON API key. Required to use `dtp.holon`. */
  holonApiKey?: string;
  /** Per-request timeout in milliseconds. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeout?: number;
}

/** Provenance/source stamp attached to health events created by importers. */
export interface HealthEventSource {
  plugin: string;
  externalId?: string;
  rawRef?: string;
}

/**
 * A health event as returned by the twin API.
 *
 * Clinical fields such as the measurement code, value, unit and body system
 * live inside `data` (an untyped `Record`), not at the top level.
 */
export interface HealthEvent {
  id: string;
  twinId: string;
  eventType: string;
  occurredAt: string;
  recordedAt: string;
  title: string;
  description?: string;
  data: Record<string, unknown>;
  bodyCoord?: unknown;
  blobRefs?: string[];
  tags?: string[];
  source?: HealthEventSource;
}

/**
 * A derived per-system view of a twin.
 *
 * There is no dedicated "systems" endpoint on the platform; this is assembled
 * client-side from grant-scoped events filtered by `event.data.system`. See
 * {@link SystemsClient.get}.
 */
export interface SystemView {
  /** The body system this view is scoped to (e.g. `"cardiovascular"`). */
  system: string;
  /** The twin the view belongs to. */
  twinId: string;
  /** Grant-scoped events whose `data.system` equals {@link SystemView.system}. */
  events: HealthEvent[];
}

/** Filter for listing/streaming a twin's grant-scoped events. */
export interface EventFilter {
  /** Only include events whose `data.system` equals this value (applied client-side). */
  system?: string;
  /** Max events to fetch per page (1–200). Defaults to 50 (platform default). */
  limit?: number;
  /** Pagination offset. Defaults to 0. */
  offset?: number;
}

/** Options controlling the {@link EventsClient.stream} polling loop. */
export interface StreamOptions extends EventFilter {
  /** Poll interval in milliseconds. Defaults to 5000. */
  intervalMs?: number;
}

/** Handle returned by {@link EventsClient.stream}; call `stop()` to end the loop. */
export interface StreamHandle {
  /** Stop polling and release the interval timer. */
  stop: () => void;
}

/**
 * Input to {@link Twin.flag}. Any {@link HealthEvent} satisfies this shape, so a
 * streamed event can be forwarded directly. `eventType` defaults to `"flag"`.
 */
export interface FlagInput {
  /** Event type for the created flag. Must be permitted by the grant. Defaults to `"flag"`. */
  eventType?: string;
  /** ISO-8601 occurrence time. Defaults to now. */
  occurredAt?: string;
  /** Human-readable title. Derived from `code`/system when absent. */
  title?: string;
  /** Optional longer description. */
  description?: string;
  /** Measurement/observation code being flagged (e.g. `"LDL"`). */
  code?: string;
  /** Measurement value being flagged. */
  value?: number | string;
  /** Extra structured payload merged into the created event's `data`. */
  data?: Record<string, unknown>;
  /** Source event id, when flagging an existing event. */
  id?: string;
}

/** Claims decoded (unverified) from a grant JWT. Mirrors `GrantTokenPayload`. */
export interface GrantClaims {
  /** The grant record id. */
  grantId: string;
  /** The grantee DID (JWT `sub`). */
  sub: string;
  /** The twin this grant authorizes access to. */
  twinId: string;
  /** Event types the grant is scoped to, or null for all. */
  eventTypes: string[] | null;
  /** Body systems the grant is scoped to, or null for all. */
  systems: string[] | null;
}

/** DTP api-key type. */
export type ApiKeyType = "personal" | "org" | "device" | "research";

/** Deployment environment an api key is scoped to. */
export type ApiKeyEnvironment = "live" | "test";

/**
 * A stored DTP api-key record (never includes the raw key).
 */
export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  environment: ApiKeyEnvironment;
  keyType: ApiKeyType;
  scopes: string[];
  rateLimit: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Request body for {@link KeysClient.create}. Mirrors `CreateApiKeyRequest`. */
export interface CreateApiKeyInput {
  name: string;
  keyType: ApiKeyType;
  scopes: string[];
  environment?: ApiKeyEnvironment;
  expiresAt?: string;
}

/**
 * Response from {@link KeysClient.create} — the raw `key` is shown exactly once.
 *
 * Mirrors `CreateApiKeyResponse` in `packages/dtp-types/src/api-key.ts`.
 */
export interface CreateApiKeyResult {
  id: string;
  key: string;
  name: string;
  keyPrefix: string;
  keyType: ApiKeyType;
  scopes: string[];
  environment: ApiKeyEnvironment;
  rateLimit: number;
  expiresAt: string | null;
  createdAt: string;
}

/** The `{ data: T }` envelope every DTP JSON route returns. */
export interface DataEnvelope<T> {
  data: T;
}
