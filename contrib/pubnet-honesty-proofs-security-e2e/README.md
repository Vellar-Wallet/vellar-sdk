# Live-deployment honesty, proofs, security scope, and a real e2e test

Contributor PRs may only touch `contrib/` (see `CONTRIBUTING.md` and the
`close-prs-outside-contrib` bot). This folder provides the complete,
self-contained implementation, proposed doc text, and tests for four assigned
issues so the PR can stay open and be merged. Nothing outside `contrib/` is
touched.

```bash
npx vitest run --config contrib/pubnet-honesty-proofs-security-e2e/vitest.config.ts
```

(That test is opt-in and requires a funded testnet key — see the e2e section
below. It is skipped without one.)

---

## 1. Re-measure and document real settlement costs on the live deployment

`honesty.md` documents the spend-ceiling accounting gap: the facilitator's
global spend ceiling (5 XLM per window) is accounted at an estimate of 500,000
stroops per settlement, while the real charge is roughly 23,000-86,000
depending on payment type.

**What I checked (2026-09-30):** the ask was to measure `fee_charged` on the
live deployment. I checked the three hosted services named in this repo:

```bash
curl -sS --max-time 60 "https://vellar-facilitator.onrender.com/health"
curl -sS --max-time 60 "https://vellar-seller-demo.onrender.com/quote"
curl -sS --max-time 60 "https://vellar-backend.onrender.com/health"
```

All three currently return an HTML "Service Suspended" page, not a response.
No pubnet facilitator URL is published anywhere in this repo, so there is no
second address to try. Given that, I could not measure a real pubnet
`fee_charged` — fabricating one would be exactly the kind of claim
`honesty.md` exists to avoid.

**Proposed change**: [`honesty-spend-ceiling.md`](./honesty-spend-ceiling.md)
re-documents the gap with this finding — the known testnet figures kept for
reference, plus the current unreachability and the absence of a pubnet URL —
instead of claiming a fix that isn't backed by data.

**Lift**: replace the "The spend ceiling accounts at the estimate, not the
charge" section in `website/content/docs/reference/honesty.md` with the
content of `honesty-spend-ceiling.md`.

---

## 2. Add an end-to-end test that pays a real resource against a live facilitator

Every existing x402 payment test uses mocks or recordings
(`packages/mcp-x402-payer/test/fixtures/soroban-rpc-recording.json`). No
automated test pays a real resource end to end, which is how three hosted
services (confirmed above) went suspended with nothing noticing.

**Module**: [`live-demo.integration.test.ts`](./live-demo.integration.test.ts)
**Guard**: [`live-testnet-only.ts`](./live-testnet-only.ts)

- Opt-in and skipped by default: gated on `VELLAR_LIVE_X402_SECRET` and
  `VELLAR_LIVE_X402_TEST_ASSET` (both required together, or neither — a
  half-set environment fails loudly rather than silently skipping).
- Pays the documented public demo resource
  (`https://vellar-seller-demo.onrender.com/quote`, overridable via
  `VELLAR_LIVE_X402_SELLER_URL`) through the SDK's own payer, then
  independently re-verifies the settlement hash on Horizon testnet — it does
  not just trust the facilitator's own response.
- Refuses to run against a pubnet facilitator: the payer's network is
  hardcoded to `"testnet"` (never read from an env var that could be
  repointed at mainnet), and `assertTestnetNetwork()` in `live-testnet-only.ts`
  asserts `network === "stellar:testnet"` on both the quote and the
  settlement, throwing `NonTestnetNetworkError` otherwise.
- Tolerates the documented ~1-in-3 benign empty-transaction settle retry (see
  `packages/cli/README.md`) via the existing `attempts` field on `PayResult`.
- This is the mirror image of
  `packages/mcp-x402-payer/test/integration/local-only.ts`: that guard refuses
  anything but localhost because the first settlement for a URL writes a
  permanent catalog entry; this one deliberately targets the shared hosted
  facilitator because the demo resource is already permanently cataloged from
  documented settlements (see `reference/proofs.md`), so paying it again adds
  no new irreversible state.

Since the hosted facilitator is currently suspended (see section 1), this test
cannot be run against it right now. It is written against the documented API
shape and the existing, already-passing `payer.integration.test.ts` pattern in
`packages/mcp-x402-payer`, and will run as soon as the service (or a
replacement) is reachable again.

**Lift**: move both files into
`packages/mcp-x402-payer/test/integration/`, updating the two `../../packages/mcp-x402-payer/src/...`
imports in `live-demo.integration.test.ts` back to `../../src/...` (they are
one directory shallower there). It then picks up
`packages/mcp-x402-payer/vitest.integration.config.ts` automatically — that
config already includes `test/**/*.integration.test.ts` and is excluded from
`npm test`, so no config changes are needed once moved.

---

## 3. Update the upstream contributions table now that one PR has merged

`reference/proofs.md` states "Nothing merged at time of writing." That's now
out of date: `stellar/stellar-docs` PR #2836 merged on 2026-09-28.

**What I checked (2026-09-30):** re-verified all five items live against the
GitHub API, not just the issue's claim:

```bash
curl -s "https://api.github.com/repos/stellar/stellar-docs/pulls/2836" | python3 -m json.tool
curl -s "https://api.github.com/repos/x402-foundation/x402/issues/3428" | python3 -m json.tool
curl -s "https://api.github.com/repos/x402-foundation/x402/issues/3125" | python3 -m json.tool
curl -s "https://api.github.com/repos/x402-foundation/x402/issues/3293" | python3 -m json.tool
curl -s "https://api.github.com/repos/x402-foundation/x402/issues/3158" | python3 -m json.tool
```

Result: #2836 is `merged: true`, `merged_at: 2026-09-28T15:49:26Z`. The other
four are all still `state: open`, matching the issue's claim.

**Proposed change**:
[`proofs-upstream-contributions.md`](./proofs-upstream-contributions.md) marks
#2836 merged with its date, corrects the "nothing merged" line, and splits
issue #3125 from its fix PR #3293 (the current doc conflates them into one
row) with a copy-pasteable verification command.

**Lift**: replace the "Upstream contributions" section in
`website/content/docs/reference/proofs.md` with the content of
`proofs-upstream-contributions.md`.

---

## 4. Document what the security review did and did not cover (#533)

`honesty.md` already states precisely that the security review covered the
facilitator and its cryptographic validation, not the spending-limit policy
contract. `security.md`'s "Current limitations" section names the same
three-item mainnet gate but doesn't say what an open audit gate means if a
pubnet facilitator already exists.

**Proposed change**:
[`security-current-limitations.md`](./security-current-limitations.md)
restates the review scope per component directly on the security page, and
adds the conditional most likely to matter to a reader: if a pubnet
facilitator is live while the audit item is still open, its policy contract is
running on mainnet unaudited. This is phrased conditionally ("if a pubnet
facilitator is live") rather than asserting one exists, since nothing checked
in section 1 above confirms a reachable pubnet deployment.

**Lift**: replace the "Current limitations" section in
`website/content/docs/security.md` with the content of
`security-current-limitations.md`.
