# Compare two policy definitions for equality

`policiesEqual(a, b)` compares two `PolicyDefinition` objects field by field
and reports whether they describe the same policy. Array-valued fields
(`owners`, `allowlistedContracts`) are compared **as sets** — two policies
listing the same owners in a different order are still equal.

## Example input pairs

| `a` | `b` | `policiesEqual(a, b)` | Why |
| --- | --- | --- | --- |
| `owners: ["GALICE", "GBOB"]` | `owners: ["GBOB", "GALICE"]` (all else identical) | `true` | Same owners, different order |
| `threshold: 2` | `threshold: 1` (all else identical) | `false` | Different threshold |
| `owners: ["GALICE", "GBOB"]` | `owners: ["GALICE", "GCAROL"]` | `false` | Different owner set, not just reordered |
| `spendingLimits: { dailyXlm: "500" }` | `spendingLimits: { dailyXlm: "999" }` | `false` | Different spending limit |

## Run it

```sh
npx tsx compare-policies.ts
```

Expected output:

```
policyA vs policyB (owners reordered): true
policyA vs policyC (different threshold): false
```

## Tests

```sh
npx vitest run contrib/examples/compare-policies
```
