/**
 * `@dtp/sdk` — the official TypeScript client for the DTP digital-twin platform.
 *
 * @example
 * ```ts
 * import { DTP } from "@dtp/sdk";
 *
 * const dtp = new DTP({ apiKey: "dtp_live_..." });
 * const twin = await dtp.twins.connect(grantToken);
 * const cardio = await twin.systems.get("cardiovascular");
 *
 * twin.events.stream({ system: "cardiovascular" }, (e) => {
 *   if (e.data.code === "LDL" && Number(e.data.value) > 130) twin.flag("vascular", e);
 * });
 * ```
 */

import { createHolonClient, type HolonClient } from "@dtp/holon-sdk";
import { DTPConfigError, DTPHttpClient } from "./http.ts";
import { KeysClient } from "./keys.ts";
import { TwinsClient } from "./twins.ts";
import {
  DEFAULT_BASE_URL,
  DEFAULT_IDENTITY_URL,
  DEFAULT_TIMEOUT_MS,
  type DTPConfig,
} from "./types.ts";

/**
 * The DTP platform client.
 *
 * Authenticates with a DTP api key (sent as `X-DTP-API-Key` on twin
 * requests) and passes grant tokens for twin access via {@link TwinsClient.connect}.
 * `keys` requires a user session token; `holon` requires HOLON credentials.
 */
export class DTP {
  /** Connect to and operate on twins via grant tokens. */
  readonly twins: TwinsClient;
  /** Manage the authenticated user's DTP api keys (requires `sessionToken`). */
  readonly keys: KeysClient;

  private readonly config: DTPConfig;
  private holonClient: HolonClient | undefined;

  constructor(config: DTPConfig) {
    if (!config.apiKey) {
      throw new DTPConfigError("DTP requires an `apiKey`");
    }
    this.config = config;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;

    const twinHttp = new DTPHttpClient({
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: config.apiKey,
      timeout,
    });
    // Account/key management is user-authed: no X-DTP-API-Key, session token only.
    const identityHttp = new DTPHttpClient({
      baseUrl: config.identityUrl ?? DEFAULT_IDENTITY_URL,
      timeout,
    });

    this.twins = new TwinsClient(twinHttp);
    this.keys = new KeysClient(identityHttp, config.sessionToken);
  }

  /**
   * The configured HOLON clinical-knowledge client (concepts, drug interactions,
   * cross-vocabulary mappings, reference ranges, phenotype similarity).
   *
   * Re-exports `@dtp/holon-sdk` configured with `holonApiUrl`/`holonApiKey`.
   * Throws {@link DTPConfigError} if those were not provided.
   */
  get holon(): HolonClient {
    if (!this.holonClient) {
      if (!this.config.holonApiUrl || !this.config.holonApiKey) {
        throw new DTPConfigError(
          "dtp.holon requires `holonApiUrl` and `holonApiKey` in the DTP constructor config"
        );
      }
      this.holonClient = createHolonClient({
        apiUrl: this.config.holonApiUrl,
        apiKey: this.config.holonApiKey,
        timeout: this.config.timeout ?? DEFAULT_TIMEOUT_MS,
      });
    }
    return this.holonClient;
  }
}

export { createHolonClient, type HolonClient } from "@dtp/holon-sdk";
export { diffNewEvents, EventsClient, filterBySystem } from "./events.ts";
export { DTPApiError, DTPConfigError, DTPErrorCode } from "./http.ts";
export { KeysClient } from "./keys.ts";
export { SystemsClient } from "./systems.ts";
export { decodeGrantToken, Twin, TwinsClient } from "./twins.ts";
export {
  type ApiKeyEnvironment,
  type ApiKeyRecord,
  type ApiKeyType,
  type CreateApiKeyInput,
  type CreateApiKeyResult,
  type DataEnvelope,
  DEFAULT_BASE_URL,
  DEFAULT_IDENTITY_URL,
  DEFAULT_TIMEOUT_MS,
  type DTPConfig,
  type EventFilter,
  type FlagInput,
  type GrantClaims,
  type HealthEvent,
  type HealthEventSource,
  type StreamHandle,
  type StreamOptions,
  type SystemView,
} from "./types.ts";
