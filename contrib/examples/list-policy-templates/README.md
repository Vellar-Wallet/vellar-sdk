# List policy templates (mock backend)

A standalone example that calls a mocked `policies.listTemplates()`-style
function and prints the returned templates.

## What it does

`list-templates.ts` builds a `PolicyClient` (from `createPolicyClient` in
`src/policy-client.ts`) with an injected `fetch` that serves three hardcoded
`PolicyTemplateInfo` entries for `GET /policies/templates` instead of calling
a real gateway. `main()` calls `listTemplates()` and prints each template's
`type` (its id) and `description`.

## Run it

```sh
npx tsx contrib/examples/list-policy-templates/list-templates.ts
```

## Test it

```sh
npm test -- contrib/examples/list-policy-templates
```

## Mapping to the real policies API

In a real integration you'd construct the client the same way but point it at
your gateway and skip the `fetch` override:

```ts
const client = createPolicyClient({ apiUrl: "https://api.myapp.com", network: "mainnet" });
const templates = await client.listTemplates();
```

That issues `GET {apiUrl}/policies/templates` against your deployed
policy-service and returns the live `PolicyTemplateInfo[]` — the same shape
this example fabricates locally, so code written against the mock output
here works unchanged against the real backend.
