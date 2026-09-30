Proposed replacement for the "Upstream contributions" section of
`website/content/docs/reference/proofs.md`. Every status below was re-checked
live against the GitHub API on 2026-09-30 — see README.md for the exact
commands.

---

## Upstream contributions

One PR has merged. The rest remain open and signed.

| Contribution | Status |
|---|---|
| stellar/stellar-docs PR #2836, community facilitators section | **Merged 2026-09-28** |
| x402-foundation/x402 PR #3428, upto convergence spec, 349 lines | Open, signed, 0 reviews |
| x402-foundation/x402 issue #3125, settle discards RPC status | Open |
| x402-foundation/x402 PR #3293, fix for #3125, by wakqasahmed | Open |
| x402-foundation/x402 issue #3158, canonical client cannot sign for smart accounts | Open |

PR #2836 adds Vellar to the Stellar ecosystem facilitator list — the first
external validation of this kind. Verify it yourself:

```bash
curl -s "https://api.github.com/repos/stellar/stellar-docs/pulls/2836" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('state:', d['state']); \
  print('merged:', d['merged']); \
  print('merged_at:', d['merged_at'])"
```

Expected:

```
state: closed
merged: True
merged_at: 2026-09-28T15:49:26Z
```
