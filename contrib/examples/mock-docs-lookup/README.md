# Mock docs page lookup

`getDocPage(slug)` is a small in-memory stand-in for the docs site's page
registry — same shape (`{ slug, title }`), no dependency on the real
website content. Useful in tests of tooling that consumes a doc-page lookup
(e.g. a link checker or a "related docs" widget) without needing the real
site built.

## Usage

```ts
import { getDocPage } from "./mock-docs-lookup";

getDocPage("passkeys"); // { slug: "passkeys", title: "Passkeys & Smart Accounts" }
getDocPage("does-not-exist"); // undefined — never throws
```

## Run it

```sh
npx tsx mock-docs-lookup.ts
```

Expected output:

```
Known page: { slug: 'passkeys', title: 'Passkeys & Smart Accounts' }
Unknown page: undefined
```

## Tests

```sh
npx vitest run contrib/examples/mock-docs-lookup
```
