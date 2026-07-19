# @dtp/sdk

The official TypeScript SDK for the Ontomorph platform: digital twins, systems, events, and self-serve API keys, with the HOLON clinical knowledge API re-exported under `dtp.holon`.

```bash
npm install @dtp/sdk
```

```ts
import { DTP } from "@dtp/sdk";

const dtp = new DTP({ apiKey: process.env.DTP_KEY });

// connect a patient's twin via a grant they issued, then read a body system
const twin = await dtp.twins.connect(grantToken);
const cardio = await twin.systems.get("cardiovascular");

// the HOLON clinical knowledge API is available under dtp.holon
const hits = await dtp.holon.concepts.search("atorvastatin");
```

See the developer docs at https://developer.ontomorph.com/docs.

> This repository is a published mirror of the `packages/sdk` workspace in the Ontomorph monorepo. Source of truth lives there; issues and PRs are triaged upstream.
