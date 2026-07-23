# @ontomorph/dtp-sdk

The official TypeScript SDK for the DTP digital-twin platform. With one typed
client you can connect to a patient's digital twin through a consent grant, read
their health data by body system, watch for new events, flag findings back onto
the twin, manage your API keys, and reach the
[HOLON clinical-knowledge API](https://www.npmjs.com/package/@ontomorph/holon-client).

Runs on Node.js 18+, Bun, Deno, and any modern browser or edge runtime with
`fetch`. Fully typed, with no runtime dependencies beyond the bundled HOLON
client.

> **The [wiki](https://github.com/ontomorph-core/dtp-sdk/wiki) has the full guide:** getting started, concepts, guides, use cases, API reference, and FAQ.

```bash
npm install @ontomorph/dtp-sdk
# pnpm add @ontomorph/dtp-sdk
# yarn add @ontomorph/dtp-sdk
# bun add @ontomorph/dtp-sdk
```

## Concepts

New to the platform? These are the terms this SDK uses, and why each one exists.

**Digital twin.** A living model of one patient's body, assembled from their
health data and organized by body system. You never touch raw records; you read
and write the twin.

**Body system.** A physiological grouping such as `cardiovascular` or
`respiratory`. Systems are how you slice a twin into the part you care about
instead of pulling everything at once.

**Health event.** One timestamped entry on a twin: a lab result, an observation,
a flag you raised. The clinical fields (the measurement code, its value, its
unit, its body system) live inside the event's `data` object rather than at the
top level, because the platform stays agnostic about which coding system you use.

**Grant, and grant token.** Consent, encoded. A patient issues a grant that
authorizes you to reach exactly one twin, scoped to the body systems and event
types they approved. The grant token is the signed proof of that consent, and it
is what you pass to `dtp.twins.connect()`. No grant, no patient data.

**DTP API key.** Identifies your application to the platform. A key beginning
`dtp_live_` talks to production; `dtp_test_` talks to the sandbox. On its own a
key never unlocks patient data. It says who you are, not what you may see.

**Flag.** A finding you write back onto a twin as a new event, for example
marking an LDL result as above target. Flagging is how your integration
contributes back rather than only reading.

**HOLON.** The clinical-knowledge service behind the platform: drug interactions,
concept lookups across SNOMED / RxNorm / LOINC, reference ranges, and phenotype
similarity. The SDK exposes it under `dtp.holon` so one client covers both a
patient's data and the knowledge to interpret it.

## Quick start

```ts
import { DTP } from "@ontomorph/dtp-sdk";

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

The SDK uses two credentials for two different jobs:

| Credential | Passed as | Needed for |
| --- | --- | --- |
| DTP API key (`dtp_live_…` / `dtp_test_…`) | `apiKey` in the constructor, sent as `X-DTP-API-Key` | every twin-core request (`twins`) |
| Grant token (a signed JWT the patient issues) | `dtp.twins.connect(grantToken)` | access to a specific twin's data |

An API key alone never reaches patient data. It identifies you. A grant token,
issued by the patient through their consent flow, authorizes access to one twin,
scoped to the body systems and event types they approved.

Get an API key from the [developer dashboard](https://developer.ontomorph.com/dashboard/keys).

Three features need extra credentials, supplied in the same constructor:

- `dtp.keys` (manage your own API keys) is user-authed, so it needs a
  `sessionToken` (a Zitadel user JWT), not just the API key.
- `dtp.sandbox` (mint synthetic demo grant tokens) is also user-authed, same
  `sessionToken` requirement.
- `dtp.holon` (clinical knowledge) needs `holonApiUrl` and `holonApiKey`.

## Configuration

```ts
new DTP({
  apiKey:       "dtp_live_…",  // required, X-DTP-API-Key on twin requests
  baseUrl:      "https://api.ontomorph.com",  // twin-core (default shown)
  identityUrl:  "https://api.ontomorph.com",  // identity-consent, for dtp.keys (default shown)
  sandboxUrl:   "https://sandbox-api.ontomorph.com", // sandbox service, for dtp.sandbox (default shown)
  sessionToken: "<zitadel user jwt>",          // required only for dtp.keys.* and dtp.sandbox.*
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
not hit the network (the token is verified server-side on the first data
request), so it returns fast, and the `twin.grant` claims (`grantId`, `twinId`,
`systems`, `eventTypes`) are available right away.

```ts
const twin = await dtp.twins.connect(grantToken);
twin.grant.twinId;  // the twin this grant authorizes
twin.grant.systems; // e.g. ["cardiovascular"], or null for all
```

### `twin.systems`

```ts
const view = await twin.systems.get("cardiovascular");
// SystemView: { system, twinId, events: HealthEvent[] }
```

A `SystemView` is built from the twin's grant-scoped events filtered by
`event.data.system`. Clinical fields (`code`, `value`, `unit`, `system`) live
inside each event's `data` object, not at the top level.

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

> How `stream` works: twin-core has no grant-scoped push stream, so `stream`
> polls `list` on an interval (every 5s by default, set by `intervalMs`) and
> emits only events it has not seen before. For high-frequency needs, poll
> `list` yourself on your own schedule.

### `twin.flag`

Write a flag event back onto the twin. Any `HealthEvent` satisfies `FlagInput`,
so a streamed event can be forwarded straight through:

```ts
await twin.flag("cardiovascular", {
  code: "LDL",
  value: 190,
  title: "LDL above target",
  description: "Consider statin review",
});
```

The grant must permit the flag's `eventType`, which defaults to `"clinical_note"`.

### `twin.simulate`

Run a what-if trajectory simulation. Baseline values (e.g. starting LDL for
`"ldl_trajectory"`) auto-derive from the twin's own recent lab results unless
you pass them in `params`:

```ts
const result = await twin.simulate("ldl_trajectory", {});
console.log(result.scalarOutputs, result.disclaimer);
```

Against a real twin this polls until the queued job completes (up to 2
minutes) and returns AI `narration` plus a 3D `animation`; against the
sandbox host it resolves immediately with `narration`/`animation` both
`null`. Only `"ldl_trajectory"` and `"hba1c_trajectory"` are implemented on
the sandbox host. Throws `DTPApiError` (code `TIMEOUT` or the job's real
failure reason) if the run doesn't succeed.

### `dtp.sandbox` (try it with synthetic data)

Requires `sessionToken` in the constructor. Mints fresh grant tokens for a
standing cohort of synthetic demo twins, physically isolated from real
patient data — pair with a `dtp_test_…` API key to build against the platform
before you have a real patient's grant.

```ts
const [grant] = await dtp.sandbox.grants();
const twin = await dtp.twins.connect(grant.grantToken);
const events = await twin.events.list();
```

Each token is valid for `grant.expiresIn` seconds; call `dtp.sandbox.grants()`
again to mint a fresh one once it expires.

### `dtp.keys` (manage your API keys)

Requires `sessionToken` in the constructor.

```ts
const keys = await dtp.keys.list();
const created = await dtp.keys.create({
  name: "CI pipeline",
  keyType: "personal",        // personal | org | device | research
  scopes: ["twins:read"],
  environment: "live",        // live | test
});
console.log(created.key);      // the raw key, shown exactly once
await dtp.keys.revoke(created.id);
```

### `dtp.holon` (clinical knowledge)

Requires `holonApiUrl` and `holonApiKey`. Returns a configured
[`@ontomorph/holon-client`](https://www.npmjs.com/package/@ontomorph/holon-client):

```ts
const results = await dtp.holon.concepts.search("atorvastatin");
const drugA = results.hits[0].conceptId;
// check a pair of drug concept ids for a known interaction
const interaction = await dtp.holon.interactions.check(drugA, otherDrugId);
```

See the [`@ontomorph/holon-client` docs](https://www.npmjs.com/package/@ontomorph/holon-client) for
the full clinical-knowledge surface.

## Error handling

Every failed request throws a `DTPApiError` with a machine-readable code.
Configuration mistakes throw `DTPConfigError`.

```ts
import { DTP, DTPApiError, DTPConfigError, DTPErrorCode } from "@ontomorph/dtp-sdk";

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

`err.code` is one of `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`VALIDATION_ERROR`, `SCOPE_DENIED`, `RATE_LIMITED`, `INTERNAL_ERROR`,
`NETWORK_ERROR`, or `TIMEOUT`. `err.details` carries `{ status, body }`, where
`status` is `0` for transport-level failures such as a network drop or timeout.

## Helpers

The SDK exports a few pure utilities it uses internally, in case they are useful
to you:

- `decodeGrantToken(token)` reads grant claims without verifying (client-side only).
- `filterBySystem(events, system)` filters a `HealthEvent[]` by `data.system`.
- `diffNewEvents(events, seen)` is the set difference the `stream` loop uses.

## TypeScript

Every public shape is exported: `DTPConfig`, `HealthEvent`, `SystemView`,
`EventFilter`, `StreamOptions`, `StreamHandle`, `FlagInput`, `GrantClaims`,
`ApiKeyRecord`, `CreateApiKeyInput`, `CreateApiKeyResult`, `SandboxDemoGrant`,
and more. Import them directly:

```ts
import type { HealthEvent, SystemView, GrantClaims } from "@ontomorph/dtp-sdk";
```

## Related packages

- [`@ontomorph/holon-client`](https://www.npmjs.com/package/@ontomorph/holon-client): the HOLON clinical-knowledge client, re-exported here as `dtp.holon`.
- [`@ontomorph/holon-types`](https://www.npmjs.com/package/@ontomorph/holon-types): shared HOLON types, enums, and error classes.

## Documentation and support

- Developer docs: <https://developer.ontomorph.com/docs>
- API reference: <https://developer.ontomorph.com/api-reference>
- Issues: <https://github.com/ontomorph-core/dtp-sdk/issues>

## License

UNLICENSED. © OntoMorph. Usage is governed by your OntoMorph platform agreement.
