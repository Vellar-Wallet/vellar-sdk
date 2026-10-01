# Audit wave — #525, #527, #528, #529

Contributor-scoped implementations for the 2026-09-28/29 audit follow-ups. Everything
here lives in `contrib/`; wiring into `src/`, `packages/`, `package.json` and
`tsup.config.ts` is left to a maintainer.

| Issue | File | What it does |
| --- | --- | --- |
| #529 | [CHECKLIST.md](CHECKLIST.md) | Tracked checklist of the audit findings |
| #528 | [release-check.mjs](release-check.mjs) | Runs typecheck, test, build and checks tree/tag state **before** tagging |
| #527 | [preflight.ts](preflight.ts) | Probes a facilitator and paid resources; reports reachability, suspended hosts and advertised network |
| #525 | [facilitator.ts](facilitator.ts) | Single `DEFAULT_FACILITATOR_URL` and `buildDiscoverySearchUrl` |

## Integration into core

- **#528:** add `"release:check": "node scripts/release-check.mjs"` to the root `package.json`
  (move the script to `scripts/`), and mention it in `publish.yml`.
- **#527:** wrap `runPreflight`/`formatResults` in a `vellar preflight [urls...]` command in
  `packages/cli` (`--facilitator`, `--expect-network testnet|mainnet`, `--timeout`, `--json`;
  exit 1 on any FAIL). `/supported` is assumed to be the facilitator's network listing.
- **#525:** move `facilitator.ts` to `src/x402-facilitator.ts`, add it as a `vellar-sdk/x402-facilitator`
  export and tsup entry, and import it from `packages/cli/src/commands/search.ts` and
  `packages/mcp-x402-payer/src/pay-and-call.ts` in place of their local copies. The default is
  still the Render host; change it in one place once the Railway URL is confirmed.
