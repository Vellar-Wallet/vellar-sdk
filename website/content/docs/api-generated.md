# Generated API Reference

The pages under **Reference** are hand-written guides. This page instead
links to a reference generated directly from the SDK's TypeScript source via
[TypeDoc](https://typedoc.org) — every public export, so it can never drift
from the code the way hand-written prose can.

**[Open the generated API reference →](/api/index.html)**

It covers both published entry points:

- the root `vellar-sdk` module (`createVellarWallet` and everything it composes)
- the `vellar-sdk/rpc` subpath (RPC-backed balance and transaction-status readers)

Internal modules are not included — only what the package actually exports.

## Regenerating it

The reference is a build artifact (like `dist/`) — not committed. From the
repository root:

```sh
npm run docs:api
```

This writes static HTML to `website/public/api`, which the docs site serves
as-is. CI runs the same command on every push to catch a broken/unresolvable
public export before it ships.
