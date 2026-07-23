/**
 * Twin connection and per-twin operations for `@ontomorph/dtp-sdk`.
 *
 * A grant token (`POST /grants/:id/token`) authorizes access to exactly one
 * twin. {@link TwinsClient.connect} decodes the token to bind a {@link Twin}
 * handle, and all twin operations map to the platform's grant-authed provider
 * routes (`Authorization: Bearer <grantToken>`).
 */

import { EventsClient } from "./events.ts";
import { DTPApiError, DTPConfigError, DTPErrorCode, type DTPHttpClient } from "./http.ts";
import { SystemsClient } from "./systems.ts";
import type {
  FlagInput,
  GrantClaims,
  HealthEvent,
  SimulationResult,
  SimulationType,
} from "./types.ts";

/** Wire shape of a simulation run/result response — sandbox returns the full result inline
 * (`status: "completed"`, `scalar_outputs` present); a real twin returns `status: "queued"`
 * from the POST and only fills `scalar_outputs` once the queued job finishes. */
interface SimulationWireResult {
  jobId: string;
  status: string;
  type?: string;
  scalar_outputs?: Record<string, unknown> | null;
  disclaimer?: string | null;
  narration?: { narrative: string; key_findings: string[]; caveats: string[] } | null;
  /** Set once a queued job fails. Absent on the sandbox host (nothing to fail asynchronously). */
  error?: string | null;
}

interface SimulationAnimationWire {
  animation: unknown | null;
}

const SIMULATION_POLL_INTERVAL_MS = 2000;
const SIMULATION_POLL_TIMEOUT_MS = 120_000;

function toSimulationResult(
  simulationType: SimulationType,
  wire: SimulationWireResult,
  animation: unknown | null
): SimulationResult {
  return {
    type: (wire.type as SimulationType | undefined) ?? simulationType,
    scalarOutputs: wire.scalar_outputs ?? {},
    disclaimer: wire.disclaimer ?? "",
    narration: wire.narration
      ? {
          narrative: wire.narration.narrative,
          keyFindings: wire.narration.key_findings,
          caveats: wire.narration.caveats,
        }
      : null,
    animation,
  };
}

/** Decode a base64url segment to a UTF-8 string across browser and Node/Bun runtimes. */
function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(padded, "base64").toString("utf8");
}

/**
 * Decode (WITHOUT verifying) the claims of a grant JWT. Signature verification
 * happens server-side; the client only needs `twin_id` to route requests.
 * Exported for unit testing.
 */
export function decodeGrantToken(grantToken: string): GrantClaims {
  const parts = grantToken.split(".");
  const payloadSegment = parts[1];
  if (parts.length !== 3 || !payloadSegment) {
    throw new DTPConfigError("Invalid grant token: expected a three-part JWT");
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(decodeBase64Url(payloadSegment)) as Record<string, unknown>;
  } catch {
    throw new DTPConfigError("Invalid grant token: payload is not valid base64url JSON");
  }

  const twinId = payload.twin_id;
  const grantId = payload.grant_id;
  const sub = payload.sub;
  if (typeof twinId !== "string" || typeof grantId !== "string" || typeof sub !== "string") {
    throw new DTPConfigError("Invalid grant token: missing twin_id, grant_id, or sub claim");
  }

  const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");

  return {
    twinId,
    grantId,
    sub,
    eventTypes: isStringArray(payload.event_types) ? payload.event_types : null,
    systems: isStringArray(payload.systems) ? payload.systems : null,
  };
}

/**
 * A handle bound to one twin via a grant token. Exposes the twin's systems and
 * events, and the ability to flag findings back onto the twin.
 */
export class Twin {
  /** Systems view for this twin (derived from grant-scoped events). */
  readonly systems: SystemsClient;
  /** Event access for this twin (grant-scoped list + polling stream). */
  readonly events: EventsClient;

  constructor(
    private readonly http: DTPHttpClient,
    /** The grant token authorizing access to this twin. */
    private readonly grantToken: string,
    /** Claims decoded from the grant token, including the bound `twinId`. */
    readonly grant: GrantClaims
  ) {
    this.systems = new SystemsClient(http, grant.twinId, grantToken);
    this.events = new EventsClient(http, grant.twinId, grantToken);
  }

  /** The twin id this handle is bound to. */
  get id(): string {
    return this.grant.twinId;
  }

  /**
   * Flag a finding onto the twin by creating a clinically-verified event tagged
   * with `system`.
   *
   * Maps to `POST /provider/twins/:id/events`. The created event's
   * `data.system` is set to `system`, so the grant MUST permit that system (and
   * the resolved event type, default `"clinical_note"`) or the platform responds
   * 403 `SCOPE_DENIED`. Any {@link HealthEvent} can be passed as `event` to
   * forward a streamed signal directly.
   */
  async flag(system: string, event: FlagInput): Promise<HealthEvent> {
    if (!system) {
      throw new DTPApiError("flag() requires a non-empty system", DTPErrorCode.VALIDATION_ERROR, {
        status: 0,
        body: null,
      });
    }

    const flaggedLabel = event.code ?? event.title ?? system;
    const body = {
      // "flag" is not a platform event type — the platform validates eventType
      // against a fixed clinical-category enum, and "flag"-ness is already
      // carried in data.flaggedCode/flaggedValue below, not the type itself.
      eventType: event.eventType ?? "clinical_note",
      occurredAt: event.occurredAt ?? new Date().toISOString(),
      title: event.title ?? `Flag: ${flaggedLabel}`,
      ...(event.description !== undefined ? { description: event.description } : {}),
      data: {
        ...(event.data ?? {}),
        system,
        ...(event.code !== undefined ? { flaggedCode: event.code } : {}),
        ...(event.value !== undefined ? { flaggedValue: event.value } : {}),
        ...(event.id !== undefined ? { flaggedEventId: event.id } : {}),
      },
    };

    return this.http.requestData<HealthEvent>(
      `/provider/twins/${encodeURIComponent(this.grant.twinId)}/events`,
      { method: "POST", body, auth: { bearer: this.grantToken } }
    );
  }

  /**
   * Run a what-if trajectory simulation and return its result.
   *
   * Maps to `POST /provider/twins/:id/simulations`. Baseline values (e.g. the
   * starting LDL for `"ldl_trajectory"`) are auto-derived from the twin's own
   * recent lab results when not supplied in `params` — pass them explicitly to
   * override. Against a real twin this polls until the queued job completes
   * (up to 2 minutes) and includes AI narration + 3D animation; against the
   * sandbox host it resolves immediately with `narration`/`animation` both
   * `null` (see {@link SimulationResult}). Only `"ldl_trajectory"` and
   * `"hba1c_trajectory"` are implemented on the sandbox host.
   */
  async simulate(
    simulationType: SimulationType,
    params: Record<string, unknown> = {}
  ): Promise<SimulationResult> {
    const basePath = `/provider/twins/${encodeURIComponent(this.grant.twinId)}/simulations`;
    const initial = await this.http.requestData<SimulationWireResult>(basePath, {
      method: "POST",
      body: { simulationType, params },
      auth: { bearer: this.grantToken },
    });

    if (initial.status === "completed") {
      return toSimulationResult(simulationType, initial, null);
    }

    const deadline = Date.now() + SIMULATION_POLL_TIMEOUT_MS;
    let latest = initial;
    while (latest.scalar_outputs == null) {
      if (latest.error != null) {
        throw new DTPApiError(
          `simulate() job ${initial.jobId} failed: ${latest.error}`,
          DTPErrorCode.INTERNAL_ERROR,
          { status: 0, body: null }
        );
      }
      if (Date.now() >= deadline) {
        throw new DTPApiError(
          `simulate() timed out waiting for job ${initial.jobId} to complete`,
          DTPErrorCode.TIMEOUT,
          { status: 0, body: null }
        );
      }
      await new Promise((resolve) => setTimeout(resolve, SIMULATION_POLL_INTERVAL_MS));
      latest = await this.http.requestData<SimulationWireResult>(
        `${basePath}/${initial.jobId}/result`,
        {
          method: "GET",
          auth: { bearer: this.grantToken },
        }
      );
    }

    const animationResult = await this.http.requestData<SimulationAnimationWire>(
      `${basePath}/${initial.jobId}/animation`,
      { method: "GET", auth: { bearer: this.grantToken } }
    );
    return toSimulationResult(simulationType, latest, animationResult.animation ?? null);
  }
}

/** Entry point for connecting to twins via grant tokens. */
export class TwinsClient {
  constructor(private readonly http: DTPHttpClient) {}

  /**
   * Connect to the twin authorized by `grantToken` and return a {@link Twin}
   * handle bound to it.
   *
   * The token is decoded locally to read its `twin_id` (signature verification
   * is enforced server-side on every subsequent request). No network call is
   * made by `connect` itself.
   */
  connect(grantToken: string): Twin {
    const grant = decodeGrantToken(grantToken);
    return new Twin(this.http, grantToken, grant);
  }
}
