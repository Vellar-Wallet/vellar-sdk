# Issues #651, #652, #653, #654

Everything here lives in `contrib/`; nothing in `src/` is changed.

## #651 WebAuthn unavailable

`webauthn-capability.ts` adds `isWebAuthnAvailable()` and
`withWebAuthnCapabilityCheck(connector)`. Without `navigator.credentials`
(embedded webviews, older browsers, Node/SSR) `createWallet` / `connectWallet`
throw `WebAuthnUnavailableError` (a `PasskeyBrowserRequiredError`) before any
passkey-kit call. Its message tells the caller to check
`isWebAuthnAvailable()` before calling create or connect.

**Minimum browser capability:** `create()` / `connect()` need a browser exposing
`navigator.credentials` (WebAuthn, secure context such as HTTPS).

Integration into core: fold the "check before calling create or connect" hint
into `PasskeyBrowserRequiredError` in `src/passkeykit-connector.ts` and mention
the requirement in the README Install/Quick start section.

## #652 zero amount

`wallet.pay({ amount: 0n })` is rejected with `InvalidAmountError`
("Amount must be greater than zero") before simulation and before any passkey
prompt. A zero amount is an explicit error, never a silent no-op. Negative
amounts are rejected the same way. Covered in `pay-guards.test.ts`.

Integration into core: state this in the `pay` / `PayInput.amount` comments in
`src/client.ts`.

## #653 self-payment

Decision: `wallet.pay` to the connected account is **rejected** with
`InvalidRecipientError` ("Recipient must differ from the sending account"),
before simulation and before any passkey prompt. It is valid on-chain, but in
practice an accidental UI-bug input that would spend a sponsored fee for
nothing. Covered in `pay-guards.test.ts`.

## #654 bigint precision

Audit: no `Number()` conversion is applied to a balance or amount in
`src/balances.ts` or the helpers it feeds. `balances-bigint.test.ts` pins this
with a value above `Number.MAX_SAFE_INTEGER` through `getBalances`,
`getBalancesBatch`, `formatTokenAmount`, and the `parseTokenAmount` round trip.

Contract (to document in `src/types.ts`): amounts are `bigint` in the token's
base units everywhere; never convert through `Number`. Use `parseTokenAmount`
for user input and `formatTokenAmount` for display.
