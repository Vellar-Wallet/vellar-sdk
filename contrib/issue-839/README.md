# Issue #839: classify `unverifiableEntries` vs `reverifyPending`

`classifyCatalogHealth()` in [`health-classification.ts`](health-classification.ts)
extends the SDK's health helper (`src/health.ts`) so the two catalog counters in
the facilitator `/health` response get **distinct, named classifications**
instead of one generic "catalog trouble" flag.

| Field | Classification | Meaning | Action |
| --- | --- | --- | --- |
| `reverifyPending` > 0 | `transiently-settling` | Ownership re-verification checks still in flight after a restart | Wait and re-check; it drains on its own |
| `unverifiableEntries` > 0 | `permanent-unverifiable` | Entries whose URLs can structurally never be verified | Correct or remove the entries; waiting does not help |

Both can be true at once; then **both** classifications are reported (state
`settling-with-permanent-issue`) and neither masks the other. `unverifiableEntries`
is absent when zero (documented in
[`operators/limits.md`](../../website/content/docs/operators/limits.md)), so
absence is read as `0`.

```ts
import { classifyHealthResponse } from "./health-classification";

const summary = classifyHealthResponse(await (await fetch(`${url}/health`)).json());
if (summary.issues.includes("permanent-unverifiable")) alertOperator(summary.guidance);
```

Tests (`health-classification.test.ts`): only `reverifyPending` is transient, only
`unverifiableEntries` is permanent, both surface together, absent field is zero,
invalid values are rejected, and a raw `/health` body parses through
`parseHealthResponse`.

**Integration into core:** a maintainer can move the module next to
`src/health.ts` and export it. Nothing outside `contrib/` is changed here.
