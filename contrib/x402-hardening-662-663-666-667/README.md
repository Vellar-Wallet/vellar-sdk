# x402 hardening: #662, #663, #666, #667

Contributor PRs may only touch `contrib/`, so each fix is a self-contained module
or test here, importing the real code from `../../src` without modifying it. Each
file says where it goes on integration.

| Issue | Files | Integrates into |
| --- | --- | --- |
| #663 negative amount | `x402-amount-vectors.ts`, `x402-amount-guard.test.ts` | vectors → `src/x402-untrusted-vectors.ts`; tests → `src/x402-untrusted.test.ts` / `src/x402-guards.test.ts` |
| #667 clock skew | `x402-expiration-skew.test.ts` | `src/x402-client.test.ts` |
| #666 nonce scope | `x402-nonce-tracker.ts`, `x402-nonce-tracker.test.ts` | `src/x402-guards.ts` / `src/x402-guards.test.ts` |
| #662 discovery size | `x402-discovery-limit.ts`, `x402-discovery-limit.test.ts` | `src/x402-client.ts`, `src/x402-types.ts` |

Run: `npx vitest run contrib/x402-hardening-662-663-666-667`

## #663 Negative amounts

`parseAmount` accepts only bare decimal digits, so `"-1"`, `"-0"`, `"+5"` and
`"-1e5"` throw `InvalidRequirementsError`. Both `selectRequirements` and
`createPayment` call it before anything is simulated, signed or counted against a
budget, so a negative can never lower tracked spend or win the "cheapest option"
comparison. **Doc text for `exact-scheme.md` and `upto-scheme.md`:** the `amount`
(or `upto` ceiling) in a challenge is untrusted; a negative, signed, decimal or
exponent value is refused with `InvalidRequirementsError` before signing.

## #667 Clock skew

Expiration is a ledger number from the RPC, not wall-clock time, so client/
facilitator clock skew cannot reject a payment. The tolerance is
`EXPIRATION_SAFETY_MARGIN = 2` ledgers (about 10s at 5s ledgers): we sign that far
inside the facilitator's `maxLedger`, absorbing drift between our ledger read and
its own. `MIN_EXPIRATION_LEDGERS = 3` is the V-13 floor. **Doc text for the
comment next to those constants and for `docs/security-audit.md`:** the two
floors are consistent: the margin bounds the top of the window, V-13 the bottom,
and neither depends on the local clock.

## #666 Nonce scope

The tracker is global per session on purpose: a nonce should be unique to one
authorization, so reuse across two resources is the anomaly a per-resource cache
would miss. Replay-window contract test: #407. The repo's audit doc has no V-11
entry to cross-reference; the nonce-width fix landed in commit `00252b1`.

## #662 Discovery response size

Limit: 1 MiB (`DISCOVERY_MAX_RESPONSE_BYTES`), far above a real catalog page
(a few KiB). `Content-Length` is checked first, then bytes are counted while
streaming, since the header can be absent or wrong. Over the limit it throws
`DiscoveryResponseTooLargeError` before `JSON.parse`; it rejects rather than
truncates because truncated JSON is not trustworthy. **Doc text for
`bazaar-and-discovery.md`:** the same paragraph.
