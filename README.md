# @dtp/sdk

The official TypeScript SDK for the **DTP digital-twin platform**. Connect to a
patient's digital twin through a consent grant, read their health data by body
system, watch for new events, flag findings back onto the twin, manage your API
keys, and reach the [HOLON clinical-knowledge API](https://www.npmjs.com/package/@holon/client)
— all from one typed client.

Works in Node.js 18+, Bun, Deno, and any modern browser or edge runtime with
`fetch`. Ships with full type definitions; no runtime dependencies beyond the
bundled HOLON client.

```bash
npm install @dtp/sdk
# pnpm add @dtp/sdk
# yarn add @dtp/sdk
# bun add @dtp/sdk
```

## Quick start

```ts
import { DTP } from "@dtp/sdk";

const dtp = new DTP({ apiKey: process.env.DTP_API_KEY }); // dtp_live_… or dtp_test_…

// A patient issues you a grant token; connect to their twin with it.
const twin = await dtp.twins.connect(grantToken);

// Read one body system.
const cardio = await twin.systems.get("cardiovascular");
console.log(cardio.events.length, "cardiovascular events");

// Watch for new events and flag anything abnormal back onto the twin.
const stream = twin.events.stream({ system: "cardiovascular" }, (event) => {
  if (event.data.code === "LDL" && Number(event.data.value) > 130) {
    twin.flag("cardiovascular", event);
  }
});

// later…
stream.stop();
```

## Authentication

The SDK uses two credentials, for two different things:

| Credential | Passed as | Needed for |
| --- | --- | --- |
| **DTP API key** (`dtp_live_…` / `dtp_test_…`) | `apiKey` in the constructor, sent as `X-DTP-API-Key` | every twin-core request (`twins`) |
| **Grant token** (a signed JWT the patient issues) | `dtp.twins.connect(grantToken)` | access to a specific twin's data |

An API key alone never grants access to patient data — it identifies *you*. A
grant token, issued by the patient through their consent flow, authorizes access
to exactly one twin, scoped to the body systems and event types they approved.

Get an API key from the [developer dashboard](https://developer.ontomorph.com/dashboard/keys).

Two features need extra credentials, supplied in the same constructor:

- **`dtp.keys`** (manage your own API keys) is user-authed, so it needs a
  `sessionToken` (a Zitadel user JWT), not just the API key.
- **`dtp.holon`** (clinical knowledge) needs `holonApiUrl` and `holonApiKey`.

## Configuration

```ts
new DTP({
  apiKey:       "dtp_live_…",  // required — X-DTP-API-Key on twin requests
  baseUrl:      "https://api.ontomorph.com",  // twin-core (default shown)
  identityUrl:  "https://api.ontomorph.com",  // identity-consent, for dtp.keys (default shown)
  sessionToken: "<zitadel user jwt>",          // required only for dtp.keys.*
  holonApiUrl:  "https://holon.ontomorph.com", // required only for dtp.holon
  holonApiKey:  "holon_…",                      // required only for dtp.holon
  timeout:      30_000,                          // per-request ms (default)
});
```

Only `apiKey` is required. Everything else has a sensible default or is only
needed for the feature that uses it.

## API

### `dtp.twins`

`connect(grantToken)` decodes the grant locally and returns a `Twin`. It does
not hit the network — the token is verified server-side on the first data
request — so it is synchronous-fast and the returned `twin.grant` claims
(`grantId`, `twinId`, `systems`, `eventTypes`) are available immediately.

```ts
const twin = await dtp.twins.connect(grantToken);
twin.grant.twinId;  // the twin this grant authorizes
twin.grant.systems; // e.g. ["cardiovascular"] or null for all
```

### `twin.systems`

```ts
const view = await twin.systems.get("cardiovascular");
// SystemView: { system, twinId, events: HealthEvent[] }
```

A `SystemView` is assembled from the twin's grant-scoped events filtered by
`event.data.system`. Clinical fields (`code`, `value`, `unit`, `system`) live
inside each event's untyped `data` record, not at the top level.

### `twin.events`

```ts
// One-shot list (paginated).
const events = await twin.events.list({ system: "cardiovascular", limit: 50 });

// Continuous watch. Returns a handle; call stop() to end it.
const handle = twin.events.stream(
  { system: "cardiovascular", intervalMs: 5_000 },
  (event) => console.log("new event", event.id),
);
handle.stop();
```

> **How `stream` works:** twin-core exposes no grant-scoped push stream, so
> `stream` is a **polling loop** over `list` (default every 5s, configurable via
> `intervalMs`). It emits only events it has not seen before. For high-frequency
> needs, poll `list` yourself on your own schedule.

### `twin.flag`

Write a flag event back onto the twin. Any `HealthEvent` satisfies `FlagInput`,
so a streamed event can be forwarded directly:

```ts
await twin.flag("cardiovascular", {
  code: "LDL",
  value: 190,
  title: "LDL above target",
  description: "Consider statin review",
});
```

The grant must permit the flag's `eventType` (defaults to `"flag"`).

### `dtp.keys` — manage your API keys

Requires `sessionToken` in the constructor.

```ts
const keys = await dtp.keys.list();
const created = await dtp.keys.create({
  name: "CI pipeline",
  keyType: "personal",        // personal | org | device | research
  scopes: ["twins:read"],
  environment: "live",        // live | test
});
console.log(created.key);      // the raw key — shown exactly once
await dtp.keys.revoke(created.id);
```

### `dtp.holon` — clinical knowledge

Requires `holonApiUrl` and `holonApiKey`. Returns a configured
[`@holon/client`](https://www.npmjs.com/package/@holon/client):

```ts
const results = await dtp.holon.concepts.search("atorvastatin");
const drugA = results.hits[0].conceptId;
// check a pair of drug concept ids for a known interaction
const interaction = await dtp.holon.interactions.check(drugA, otherDrugId);
```

See the [`@holon/client` docs](https://www.npmjs.com/package/@holon/client) for
the full clinical-knowledge surface.

## Error handling

Every failed request throws a `DTPApiError` with a machine-readable code;
configuration mistakes throw `DTPConfigError`.

```ts
import { DTP, DTPApiError, DTPConfigError, DTPErrorCode } from "@dtp/sdk";

try {
  const twin = await dtp.twins.connect(grantToken);
  await twin.systems.get("cardiovascular");
} catch (err) {
  if (err instanceof DTPApiError) {
    console.error(err.code, err.details.status, err.message); // e.g. FORBIDDEN 403 …
    if (err.code === DTPErrorCode.UNAUTHORIZED) refreshCredentials();
  } else if (err instanceof DTPConfigError) {
    console.error("SDK misconfigured:", err.message);
  }
}
```

`err.code` is one of: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`VALIDATION_ERROR`, `SCOPE_DENIED`, `RATE_LIMITED`, `INTERNAL_ERROR`,
`NETWORK_ERROR`, `TIMEOUT`. `err.details` carries `{ status, body }` — `status`
is `0` for transport-level failures (network, timeout).

## Helpers

The SDK exports a few pure utilities used internally, in case you want them:

- `decodeGrantToken(token)` — decode grant claims without verifying (client-side only).
- `filterBySystem(events, system)` — filter a `HealthEvent[]` by `data.system`.
- `diffNewEvents(events, seen)` — the set difference the `stream` loop uses.

## TypeScript

Every public shape is exported: `DTPConfig`, `HealthEvent`, `SystemView`,
`EventFilter`, `StreamOptions`, `StreamHandle`, `FlagInput`, `GrantClaims`,
`ApiKeyRecord`, `CreateApiKeyInput`, `CreateApiKeyResult`, and more. Import them
directly:

```ts
import type { HealthEvent, SystemView, GrantClaims } from "@dtp/sdk";
```

## Related packages

- [`@holon/client`](https://www.npmjs.com/package/@holon/client) — the HOLON clinical-knowledge client, re-exported here as `dtp.holon`.
- [`@holon/types`](https://www.npmjs.com/package/@holon/types) — shared HOLON types, enums, and error classes.

## Documentation & support

- Developer docs: <https://developer.ontomorph.com/docs>
- API reference: <https://developer.ontomorph.com/api-reference>
- Issues: <https://github.com/ontomorph-core/dtp-sdk/issues>

## License

UNLICENSED — © OntoMorph. Usage governed by your OntoMorph platform agreement.
