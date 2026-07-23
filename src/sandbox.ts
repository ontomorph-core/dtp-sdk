/**
 * Sandbox demo-grant issuance for `@ontomorph/dtp-sdk`.
 *
 * AUTH NOTE — mirrors `dtp.keys`: `GET /grants` on the sandbox service is
 * USER-authed, not api-key-authed (a `dtp_test_...` api key cannot mint a
 * demo grant, only authenticate requests once one is in hand). Every method
 * here requires a Zitadel user session JWT (`sessionToken` on {@link DTPConfig}),
 * sent as `Authorization: Bearer <sessionToken>`. Without a session token,
 * every method throws {@link DTPConfigError}.
 */

import { DTPConfigError, type DTPHttpClient } from "./http.ts";
import type { SandboxDemoGrant } from "./types.ts";

const GRANTS_PATH = "/grants";

/**
 * User-authed sandbox demo-grant operations. Requires a session token — see
 * the module auth note.
 */
export class SandboxClient {
  constructor(
    private readonly http: DTPHttpClient,
    private readonly sessionToken: string | undefined
  ) {}

  /** Resolve the session bearer, throwing a clear config error when it is absent. */
  private requireSession(): string {
    if (!this.sessionToken) {
      throw new DTPConfigError(
        "dtp.sandbox.* requires a user session token. Pass `sessionToken` to the DTP constructor — sandbox grant issuance is user-authed, not api-key-authed."
      );
    }
    return this.sessionToken;
  }

  /**
   * Fetch fresh demo grant tokens for the standing synthetic sandbox twins.
   * Pass one to `dtp.twins.connect()` alongside a `dtp_test_...` api key.
   *
   * Maps to `GET /grants` on the sandbox service.
   */
  async grants(): Promise<SandboxDemoGrant[]> {
    return this.http.requestData<SandboxDemoGrant[]>(GRANTS_PATH, {
      method: "GET",
      auth: { bearer: this.requireSession() },
    });
  }
}
