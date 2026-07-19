import { afterEach, describe, expect, test } from "bun:test";

import {
  DTP,
  DTPApiError,
  DTPConfigError,
  decodeGrantToken,
  diffNewEvents,
  filterBySystem,
  type HealthEvent,
} from "../../src/index.ts";

const API_KEY = "dtp_live_testkey0000000000000000";
const SESSION = "session.jwt.token";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Base64url-encode a JSON payload (no padding), for building fake grant JWTs. */
function base64UrlJson(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Build a fake three-part grant JWT with the given claims (signature is ignored client-side). */
function fakeGrantToken(claims: Record<string, unknown>): string {
  return `${base64UrlJson({ alg: "HS256", typ: "JWT" })}.${base64UrlJson(claims)}.sig`;
}

const TWIN_ID = "11111111-1111-1111-1111-111111111111";
const GRANT_TOKEN = fakeGrantToken({
  grant_id: "grant-1",
  sub: "did:dtp:provider",
  twin_id: TWIN_ID,
  systems: ["cardiovascular", "vascular"],
});

interface StubCall {
  url: string;
  init: RequestInit | undefined;
}

/** Replace global fetch with a per-call handler and record every call. */
function stubFetch(handler: (call: StubCall, index: number) => Response): { calls: StubCall[] } {
  const calls: StubCall[] = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const call: StubCall = { url: String(url), init };
    const response = handler(call, calls.length);
    calls.push(call);
    return Promise.resolve(response);
  }) as typeof globalThis.fetch;
  return { calls };
}

/** JSON `{ data }` envelope response, matching twin-core route output. */
function dataResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status });
}

function makeEvent(id: string, system: string, extra: Record<string, unknown> = {}): HealthEvent {
  return {
    id,
    twinId: TWIN_ID,
    eventType: "lab_result",
    occurredAt: "2026-07-19T00:00:00.000Z",
    recordedAt: "2026-07-19T00:00:00.000Z",
    title: "LDL",
    data: { system, ...extra },
  };
}

function headersOf(call: StubCall): Record<string, string> {
  return (call.init?.headers ?? {}) as Record<string, string>;
}

describe("decodeGrantToken", () => {
  test("extracts twin_id, grant_id, sub and scope arrays", () => {
    const claims = decodeGrantToken(GRANT_TOKEN);
    expect(claims.twinId).toBe(TWIN_ID);
    expect(claims.grantId).toBe("grant-1");
    expect(claims.sub).toBe("did:dtp:provider");
    expect(claims.systems).toEqual(["cardiovascular", "vascular"]);
    expect(claims.eventTypes).toBeNull();
  });

  test("throws DTPConfigError on a non-JWT string", () => {
    expect(() => decodeGrantToken("not-a-jwt")).toThrow(DTPConfigError);
  });

  test("throws DTPConfigError when twin_id is missing", () => {
    const bad = fakeGrantToken({ grant_id: "g", sub: "s" });
    expect(() => decodeGrantToken(bad)).toThrow(DTPConfigError);
  });
});

describe("DTP constructor", () => {
  test("throws DTPConfigError without an apiKey", () => {
    expect(() => new DTP({ apiKey: "" })).toThrow(DTPConfigError);
  });

  test("exposes twins and keys", () => {
    const dtp = new DTP({ apiKey: API_KEY });
    expect(dtp.twins).toBeDefined();
    expect(dtp.keys).toBeDefined();
  });
});

describe("Twin via grant token", () => {
  test("connect binds the twin id from the grant", () => {
    const dtp = new DTP({ apiKey: API_KEY });
    const twin = dtp.twins.connect(GRANT_TOKEN);
    expect(twin.id).toBe(TWIN_ID);
    expect(twin.grant.grantId).toBe("grant-1");
  });

  test("events.list hits the grant-scoped provider endpoint with both credentials", async () => {
    const { calls } = stubFetch(() => dataResponse([makeEvent("e1", "cardiovascular")]));
    const dtp = new DTP({ apiKey: API_KEY, baseUrl: "https://api.test" });
    const twin = dtp.twins.connect(GRANT_TOKEN);

    const events = await twin.events.list({ limit: 10 });

    expect(events).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://api.test/provider/twins/${TWIN_ID}/events?limit=10`);
    const headers = headersOf(calls[0] as StubCall);
    expect(headers.Authorization).toBe(`Bearer ${GRANT_TOKEN}`);
    expect(headers["X-DTP-API-Key"]).toBe(API_KEY);
  });

  test("events.list applies the system filter client-side", async () => {
    stubFetch(() => dataResponse([makeEvent("e1", "cardiovascular"), makeEvent("e2", "renal")]));
    const dtp = new DTP({ apiKey: API_KEY, baseUrl: "https://api.test" });
    const twin = dtp.twins.connect(GRANT_TOKEN);

    const events = await twin.events.list({ system: "renal" });
    expect(events.map((e) => e.id)).toEqual(["e2"]);
  });

  test("systems.get returns a derived view filtered by data.system", async () => {
    const { calls } = stubFetch(() =>
      dataResponse([makeEvent("e1", "cardiovascular"), makeEvent("e2", "renal")])
    );
    const dtp = new DTP({ apiKey: API_KEY, baseUrl: "https://api.test" });
    const twin = dtp.twins.connect(GRANT_TOKEN);

    const view = await twin.systems.get("cardiovascular");
    expect(view.system).toBe("cardiovascular");
    expect(view.twinId).toBe(TWIN_ID);
    expect(view.events.map((e) => e.id)).toEqual(["e1"]);
    expect(calls[0]?.url).toContain(`/provider/twins/${TWIN_ID}/events`);
  });

  test("flag posts a verified event tagged with the system", async () => {
    const { calls } = stubFetch(() =>
      dataResponse(makeEvent("flag-1", "vascular", { flaggedCode: "LDL" }), 201)
    );
    const dtp = new DTP({ apiKey: API_KEY, baseUrl: "https://api.test" });
    const twin = dtp.twins.connect(GRANT_TOKEN);

    const created = await twin.flag("vascular", { code: "LDL", value: 165, id: "e1" });

    expect(created.id).toBe("flag-1");
    const call = calls[0] as StubCall;
    expect(call.url).toBe(`https://api.test/provider/twins/${TWIN_ID}/events`);
    expect(call.init?.method).toBe("POST");
    const body = JSON.parse(String(call.init?.body)) as {
      eventType: string;
      data: Record<string, unknown>;
    };
    expect(body.eventType).toBe("flag");
    expect(body.data.system).toBe("vascular");
    expect(body.data.flaggedCode).toBe("LDL");
    expect(body.data.flaggedValue).toBe(165);
    expect(body.data.flaggedEventId).toBe("e1");
  });

  test("maps a non-2xx response to DTPApiError with code and status", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: "SCOPE_DENIED", message: "system denied" } }),
          {
            status: 403,
          }
        )
    );
    const dtp = new DTP({ apiKey: API_KEY, baseUrl: "https://api.test" });
    const twin = dtp.twins.connect(GRANT_TOKEN);

    const err = (await twin.events.list().catch((e) => e)) as DTPApiError;
    expect(err).toBeInstanceOf(DTPApiError);
    expect(err.code).toBe("SCOPE_DENIED");
    expect(err.details.status).toBe(403);
    expect(err.message).toContain("system denied");
  });
});

describe("events.stream (polling fallback)", () => {
  test("seeds a silent baseline then delivers newly appearing events", async () => {
    // Call 0 (baseline) returns nothing; later polls return one new event.
    stubFetch((_call, index) =>
      dataResponse(index === 0 ? [] : [makeEvent("new-1", "cardiovascular")])
    );
    const dtp = new DTP({ apiKey: API_KEY, baseUrl: "https://api.test" });
    const twin = dtp.twins.connect(GRANT_TOKEN);

    const received: HealthEvent[] = [];
    const handle = twin.events.stream({ system: "cardiovascular", intervalMs: 5 }, (e) =>
      received.push(e)
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    handle.stop();

    expect(received.map((e) => e.id)).toEqual(["new-1"]);
  });
});

describe("pure helpers", () => {
  test("filterBySystem keeps only matching events", () => {
    const events = [makeEvent("a", "cardiovascular"), makeEvent("b", "renal")];
    expect(filterBySystem(events, "renal").map((e) => e.id)).toEqual(["b"]);
    expect(filterBySystem(events, undefined)).toHaveLength(2);
  });

  test("diffNewEvents excludes seen ids and non-matching systems", () => {
    const events = [makeEvent("a", "cardiovascular"), makeEvent("b", "cardiovascular")];
    const fresh = diffNewEvents(events, new Set(["a"]), "cardiovascular");
    expect(fresh.map((e) => e.id)).toEqual(["b"]);
  });
});

describe("dtp.keys (user-authed)", () => {
  test("throws DTPConfigError when no sessionToken is configured", async () => {
    const dtp = new DTP({ apiKey: API_KEY });
    const err = (await dtp.keys.list().catch((e) => e)) as DTPConfigError;
    expect(err).toBeInstanceOf(DTPConfigError);
  });

  test("list sends the session bearer and NO api-key header to identity-consent", async () => {
    const { calls } = stubFetch(() => dataResponse([]));
    const dtp = new DTP({
      apiKey: API_KEY,
      identityUrl: "https://id.test",
      sessionToken: SESSION,
    });

    await dtp.keys.list();

    const call = calls[0] as StubCall;
    expect(call.url).toBe("https://id.test/api-keys");
    const headers = headersOf(call);
    expect(headers.Authorization).toBe(`Bearer ${SESSION}`);
    expect(headers["X-DTP-API-Key"]).toBeUndefined();
  });

  test("create posts the key request to identity-consent", async () => {
    const { calls } = stubFetch(() =>
      dataResponse({ id: "k1", key: "dtp_live_raw", name: "ci" }, 201)
    );
    const dtp = new DTP({
      apiKey: API_KEY,
      identityUrl: "https://id.test",
      sessionToken: SESSION,
    });

    const result = await dtp.keys.create({
      name: "ci",
      keyType: "personal",
      scopes: ["twin:read"],
    });
    expect(result.key).toBe("dtp_live_raw");
    const call = calls[0] as StubCall;
    expect(call.init?.method).toBe("POST");
    expect(call.url).toBe("https://id.test/api-keys");
  });
});

describe("dtp.holon", () => {
  test("throws DTPConfigError without HOLON credentials", () => {
    const dtp = new DTP({ apiKey: API_KEY });
    expect(() => dtp.holon).toThrow(DTPConfigError);
  });

  test("returns a configured HOLON client when credentials are present", () => {
    const dtp = new DTP({
      apiKey: API_KEY,
      holonApiUrl: "https://holon.test",
      holonApiKey: "holon-key",
    });
    expect(dtp.holon.concepts).toBeDefined();
    expect(dtp.holon.interactions).toBeDefined();
  });
});
