# Pre-submission x402 shape self-check (#877)

`preflight.ts` exposes `preflightX402Shape(envelope)`. It runs the four explorer
structural conditions against a transaction the SDK just built and returns a
clear warning if an independent observer would not classify it as x402-shaped.
It is an **optional pre-flight diagnostic**, distinct from the post-hoc
classifier in `structural-conditions.ts`, and it never blocks submission.

The four conditions, documented in
[reference/explorer.md](../../../website/content/docs/reference/explorer.md),
are:

1. an `invoke_host_function` operation exists;
2. it is `transfer(from, to, amount)` on the watched USDC SAC;
3. a detached address credential authorizes `from`;
4. `from` is not the operation source, transaction source, or fee-bump fee source.

`StructuralEnvelope` is deliberately a narrow typed shape rather than an XDR
parser. The intent is a cheap, deterministic check that can run in a CLI or MCP
payer before submission. Callers building a real Stellar envelope map the four
fields into this shape. The test uses a disclosed structural fixture of a
normally built Vellar payment, not a signed transaction.

## Maintainer follow-up

Promote both modules to `src/` and export them if this becomes public API. The
issue references a structural-conditions helper added earlier in the batch, but
no such helper exists on any upstream branch, so this folder supplies one.

## Verification

```sh
npx vitest run contrib/vellar-sdk-873-874-875-877/877-preflight-x402-shape
```
