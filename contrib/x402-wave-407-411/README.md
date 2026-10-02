# x402 Wave issues #407, #408, #410, #411

Contributor PRs may only touch `contrib/` (see `CONTRIBUTING.md` and the
`close-prs-outside-contrib` bot). The four assigned issues pre-approve `src/`
and `packages/cli/` paths, but the bot does not read that exception — it closed
[#465](https://github.com/Vellar-Wallet/vellar-sdk/pull/465). This folder is
the same work, scoped so a PR can stay open.

The core wiring that belongs in `src/` / `packages/cli/` is still on the
closed PR branch `fix/x402-capability-abort-cli-replay-window` (commit
`3411f39`) if a maintainer wants to lift it.

```bash
npx vitest run contrib/x402-wave-407-411
```

## #408 — capability checks on the signer

`withCapabilityGuard` wraps any `SmartAccountX402Signer` so `assertCapability`
runs as the first thing `signAuthEntry` does, before the inner signer hashes.
A caller that bypasses `x402-client.ts` cannot skip it. Empty rules permit
everything (non-breaking).

Lift: move the check into `createSessionKeySigner` / `createPasskeyX402Signer`
in `src/x402-signer.ts` (the dead-code call after the try/catch).

## #410 — abort signal for the whole payment flow

`withAbortSignal` refuses an already-aborted `requestInit.signal` before any
network call, and maps mid-flow `AbortError` to `X402AbortedError`. After a
signature has been produced the error's `paymentMayHaveBeenSigned` is `true`
so a caller can tell a clean cancel from "do not assume nothing was spent".

Lift: thread the signal through `AssembledTransaction.build` and
`getLatestLedger` in `src/x402-client.ts` as well.

## #411 — CLI machine-readable error contract

`CLI_ERROR_CODES` + `{ code, message, retryable }` on `--json` stdout.
Exit codes: usage 2, refused (nothing spent) 3, network 4, payment may have
settled 5. Secrets and stack frames are stripped.

Lift: import `fail` / `handleCommandError` from this module into
`packages/cli/src/commands/*`.

## #407 — request-auth replay-window contract

`REQUEST_AUTH_VERIFIER_CONTRACT` is the written spec (field order, separator,
absent body, 300s skew, nonce window, replay reject). `REQUEST_AUTH_VECTORS`
are frozen input + expected signature pairs. `verifyWithReplayWindow` rejects
a nonce already seen inside the window.

Lift: publish as `vellar-sdk/x402-request-auth-vectors` and re-export from
`src/x402-request-auth.ts`.
