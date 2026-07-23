/**
 * DTP api-key management for `@ontomorph/dtp-sdk`.
 *
 * AUTH NOTE — these routes are USER-authed, not api-key-authed. A `dtp_...` api
 * key cannot manage keys (that would be a bootstrap loop), so every method here
 * requires a Zitadel user session JWT (`sessionToken` on {@link DTPConfig}), sent
 * as `Authorization: Bearer <sessionToken>` with NO `X-DTP-API-Key` header.
 * Without a session token, every method throws {@link DTPConfigError}.
 */

import { DTPConfigError, type DTPHttpClient } from "./http.ts";
import type { ApiKeyRecord, CreateApiKeyInput, CreateApiKeyResult } from "./types.ts";

const API_KEYS_PATH = "/api-keys";

/**
 * User-authed api-key lifecycle operations. Requires a session token — see
 * the module auth note.
 */
export class KeysClient {
  constructor(
    private readonly http: DTPHttpClient,
    private readonly sessionToken: string | undefined
  ) {}

  /** Resolve the session bearer, throwing a clear config error when it is absent. */
  private requireSession(): string {
    if (!this.sessionToken) {
      throw new DTPConfigError(
        "dtp.keys.* requires a user session token. Pass `sessionToken` to the DTP constructor — api-key management is user-authed, not api-key-authed."
      );
    }
    return this.sessionToken;
  }

  /** List the authenticated user's api keys. Maps to `GET /api-keys`. */
  async list(query?: { limit?: number; offset?: number }): Promise<ApiKeyRecord[]> {
    return this.http.requestData<ApiKeyRecord[]>(API_KEYS_PATH, {
      method: "GET",
      auth: { bearer: this.requireSession() },
      query: { limit: query?.limit, offset: query?.offset },
    });
  }

  /**
   * Create a new api key. The raw `key` in the result is shown exactly once.
   *
   * Maps to `POST /api-keys`.
   */
  async create(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    return this.http.requestData<CreateApiKeyResult>(API_KEYS_PATH, {
      method: "POST",
      body: input,
      auth: { bearer: this.requireSession() },
    });
  }

  /** Revoke an api key by id and return the revoked record. Maps to `DELETE /api-keys/:id`. */
  async revoke(id: string): Promise<ApiKeyRecord> {
    return this.http.requestData<ApiKeyRecord>(`${API_KEYS_PATH}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      auth: { bearer: this.requireSession() },
    });
  }
}
