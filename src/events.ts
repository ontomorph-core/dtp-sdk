/**
 * Grant-scoped event access for a connected {@link Twin}.
 *
 * Maps to the platform's grant-authed provider event routes.
 */

import type { DTPHttpClient } from "./http.ts";
import type { EventFilter, HealthEvent, StreamHandle, StreamOptions } from "./types.ts";

const DEFAULT_STREAM_INTERVAL_MS = 5000;

/** Build the grant-scoped events path for a twin. */
function eventsPath(twinId: string): string {
  return `/provider/twins/${encodeURIComponent(twinId)}/events`;
}

/** Whether an event belongs to `system` (matched against `data.system`); true when no filter. */
function matchesSystem(event: HealthEvent, system: string | undefined): boolean {
  if (!system) return true;
  return event.data?.system === system;
}

/**
 * Filter events by body system using their `data.system` field. Exported for the
 * derived {@link SystemsClient} view and for unit testing.
 */
export function filterBySystem(events: HealthEvent[], system: string | undefined): HealthEvent[] {
  if (!system) return events;
  return events.filter((event) => matchesSystem(event, system));
}

/**
 * Select events not yet in `seen` (optionally filtered by system), for the
 * {@link EventsClient.stream} polling loop. Pure — does not mutate `seen`.
 */
export function diffNewEvents(
  events: HealthEvent[],
  seen: ReadonlySet<string>,
  system: string | undefined
): HealthEvent[] {
  return events.filter((event) => !seen.has(event.id) && matchesSystem(event, system));
}

/**
 * Fetch one page of grant-scoped events for a twin via
 * `GET /provider/twins/:id/events`. Shared by {@link EventsClient} and the
 * derived {@link SystemsClient}.
 */
export async function fetchGrantScopedEvents(
  http: DTPHttpClient,
  twinId: string,
  grantToken: string,
  filter: EventFilter | undefined
): Promise<HealthEvent[]> {
  const events = await http.requestData<HealthEvent[]>(eventsPath(twinId), {
    method: "GET",
    auth: { bearer: grantToken },
    query: { limit: filter?.limit, offset: filter?.offset },
  });
  return filterBySystem(events, filter?.system);
}

/**
 * Event access for a grant-connected twin.
 *
 * `list` reads the grant-scoped events endpoint. `stream` is a documented
 * polling fallback over `list` — the platform exposes no grant-scoped event
 * stream (its only SSE endpoint, `/insights/stream`, is api-key/user-scoped
 * insights, not per-twin grant-scoped events), so real-time delivery is
 * emulated by periodic polling.
 */
export class EventsClient {
  constructor(
    private readonly http: DTPHttpClient,
    private readonly twinId: string,
    private readonly grantToken: string
  ) {}

  /**
   * List grant-scoped events for the twin.
   *
   * Maps to `GET /provider/twins/:id/events`. The `system` filter is applied
   * client-side against each event's `data.system`.
   */
  async list(filter?: EventFilter): Promise<HealthEvent[]> {
    return fetchGrantScopedEvents(this.http, this.twinId, this.grantToken, filter);
  }

  /**
   * Invoke `callback` for each new event as it appears, via periodic polling of
   * {@link EventsClient.list}.
   *
   * DOCUMENTED FALLBACK: there is no grant-scoped SSE endpoint on the platform,
   * so this polls `GET /provider/twins/:id/events` every `intervalMs` (default
   * 5000). The first poll seeds a baseline silently; only events that appear
   * afterwards are delivered. Poll errors are swallowed so a transient failure
   * does not tear down the loop. Call `stop()` on the returned handle to end it.
   */
  stream(filter: StreamOptions, callback: (event: HealthEvent) => void): StreamHandle {
    const intervalMs = filter.intervalMs ?? DEFAULT_STREAM_INTERVAL_MS;
    const seen = new Set<string>();
    let stopped = false;
    let inFlight = false;

    const poll = async (isBaseline: boolean): Promise<void> => {
      if (inFlight || stopped) return;
      inFlight = true;
      try {
        // `list` already applies the system filter, so its result is the
        // authoritative set of relevant events for this twin+system.
        const events = await this.list(filter);
        if (isBaseline) {
          for (const event of events) seen.add(event.id);
          return;
        }
        for (const event of diffNewEvents(events, seen, filter.system)) {
          seen.add(event.id);
          if (!stopped) callback(event);
        }
      } catch {
        // Best-effort: a transient poll failure must not stop the loop.
      } finally {
        inFlight = false;
      }
    };

    void poll(true);
    const timer = setInterval(() => void poll(false), intervalMs);

    return {
      stop: () => {
        stopped = true;
        clearInterval(timer);
      },
    };
  }
}
