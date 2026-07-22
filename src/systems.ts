/**
 * Per-system view for a connected {@link Twin}.
 *
 * IMPORTANT — honest mapping: the platform exposes NO dedicated "systems" endpoint.
 * A system view is derived here from the grant-scoped events endpoint
 * (`GET /provider/twins/:id/events`) filtered by each event's `data.system`.
 * (The per-structure clinical snapshot
 * that does exist — `GET /provider/twins/:id/inspector/:fmaCode/snapshot` — is
 * keyed by anatomical FMA structure code, not by body system name, so it is not
 * a match for `systems.get("cardiovascular")`.)
 */

import { fetchGrantScopedEvents } from "./events.ts";
import type { DTPHttpClient } from "./http.ts";
import type { SystemView } from "./types.ts";

/** How many recent events to scan when assembling a system view. */
const SYSTEM_VIEW_EVENT_LIMIT = 200;

/** Assembles derived {@link SystemView} objects for a grant-connected twin. */
export class SystemsClient {
  constructor(
    private readonly http: DTPHttpClient,
    private readonly twinId: string,
    private readonly grantToken: string
  ) {}

  /**
   * Get a derived view of one body system for the twin.
   *
   * Fetches the most recent grant-scoped events and returns those whose
   * `data.system` matches `systemName`. This is NOT a dedicated systems
   * endpoint — see the module note above — so the view reflects only what the
   * grant is scoped to expose.
   */
  async get(systemName: string): Promise<SystemView> {
    const events = await fetchGrantScopedEvents(this.http, this.twinId, this.grantToken, {
      system: systemName,
      limit: SYSTEM_VIEW_EVENT_LIMIT,
    });
    return { system: systemName, twinId: this.twinId, events };
  }
}
