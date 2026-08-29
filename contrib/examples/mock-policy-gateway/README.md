# Mock policy API gateway

A mock `fetch` implementation covering the policy API gateway's
list-templates, generate, and simulate routes — wired into the SDK's real
`createPolicyClient()` (`src/policy-client.ts`) via its injectable `fetch`
option, for offline tests that don't need a live gateway.

## Covered routes

| Route | Response shape |
| --- | --- |
| `GET /policies/templates` | `PolicyTemplateInfo[]` |
| `POST /policies/generate` | `{ policy: GeneratedPolicy }` |
| `POST /policies/:id/simulate` | `SimulateResult` |

Any other route returns a 404 with an explanatory error body.

## Run it

```sh
npx tsx mock-policy-gateway.ts
```

Exercises all three covered routes through the real `PolicyClient` and
prints each response.

## Tests

```sh
npx vitest run contrib/examples/mock-policy-gateway
```
