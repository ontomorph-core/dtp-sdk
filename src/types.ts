/**
 * Public wire types and configuration shapes for `@ontomorph/dtp-sdk`. They are
 * re-declared here rather than imported from the platform's internal types
 * package so the published client stays self-contained.
 */

/** The public DTP API gateway (Traefik host `api.ontomorph.com`) for twin access. */
export const DEFAULT_BASE_URL = "https://api.ontomorph.com";

/** The public DTP API gateway for account/key management. Same host as {@link DEFAULT_BASE_URL}. */
export const DEFAULT_IDENTITY_URL = "https://api.ontomorph.com";

/** The public sandbox service (Traefik host `sandbox-api.ontomorph.com`) for demo grant issuance. */
export const DEFAULT_SANDBOX_URL = "https://sandbox-api.ontomorph.com";

/** Default per-request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Configuration for a {@link DTP} client instance.
 *
 * `apiKey` is the ambient DTP credential (`dtp_...`) sent as `X-DTP-API-Key` on
 * every twin request. Twin access additionally requires a grant token passed
 * to `dtp.twins.connect()`. `sessionToken` (a Zitadel user JWT) is only needed
 * for `dtp.keys.*`, which is user-authed, not api-key-authed.
 */
export interface DTPConfig {
  /** DTP API key (`dtp_...`). Sent as `X-DTP-API-Key` on twin requests. */
  apiKey: string;
  /**
   * Twin API base URL. Defaults to {@link DEFAULT_BASE_URL} (`https://api.ontomorph.com`)
   * for a `dtp_live_...` key, or {@link DEFAULT_SANDBOX_URL} for a `dtp_test_...` key.
   * Set explicitly to override this inference.
   */
  baseUrl?: string;
  /** Account/key-management base URL for `dtp.keys.*`. Defaults to {@link DEFAULT_IDENTITY_URL}. */
  identityUrl?: string;
  /** Sandbox service base URL for `dtp.sandbox.*`. Defaults to {@link DEFAULT_SANDBOX_URL}. */
  sandboxUrl?: string;
  /** Zitadel user session JWT required by `dtp.keys.*` and `dtp.sandbox.*` (both are user-authed). */
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
  /** Max events to fetch per page (1 to 200). Defaults to 50 (platform default). */
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
 * streamed event can be forwarded directly. `eventType` defaults to `"clinical_note"`.
 */
export interface FlagInput {
  /** Event type for the created flag. Must be permitted by the grant. Defaults to `"clinical_note"`. */
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

/**
 * What-if trajectory simulation model. All seven run against a real twin
 * (`dtp.twins.connect()` against `api.ontomorph.com`); the sandbox host
 * (`sandbox-api.ontomorph.com`) only implements `ldl_trajectory` and
 * `hba1c_trajectory` — the two models the seeded demo cohort has lab data for.
 */
export type SimulationType =
  | "ldl_trajectory"
  | "bp_trajectory"
  | "hba1c_trajectory"
  | "weight_bmi"
  | "cv_risk"
  | "pk_one_compartment"
  | "aging";

/**
 * Result of {@link Twin.simulate}. `narration` and `animation` are null on the
 * sandbox host (no AI narration or 3D asset pipeline there) and populated
 * against a real twin.
 */
export interface SimulationResult {
  type: SimulationType;
  scalarOutputs: Record<string, unknown>;
  disclaimer: string;
  narration: { narrative: string; keyFindings: string[]; caveats: string[] } | null;
  animation: unknown | null;
}

/**
 * A freshly-minted sandbox demo grant token bound to one synthetic sandbox
 * twin. Mirrors the sandbox service's `SandboxDemoGrantSchema`.
 */
export interface SandboxDemoGrant {
  /** Scoped grant JWT — pass to `dtp.twins.connect(grantToken)`. */
  grantToken: string;
  /** The synthetic twin this token grants read/write access to. */
  twinId: string;
  /** The underlying standing sandbox grant row id. */
  grantId: string;
  /** Token lifetime in seconds. */
  expiresIn: number;
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
 * Response from {@link KeysClient.create}, where the raw `key` is shown exactly once.
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
