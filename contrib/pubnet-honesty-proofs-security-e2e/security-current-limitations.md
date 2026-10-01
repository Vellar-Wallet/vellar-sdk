Proposed replacement for the "Current limitations" section of
`website/content/docs/security.md` (issue #533).

---

## Current limitations

Be aware while the SDK is pre-`1.0`:

- **Testnet only, by design — mainnet readiness is not enforced by the code.**
  The Vellar facilitator advertises stellar:testnet in `/supported`. Mainnet is
  gated on three items, but nothing in this SDK or the facilitator technically
  prevents a pubnet deployment before all three are done:
  1. A persistent-disk deployment.
  2. A funded pubnet sponsor account.
  3. A mainnet security audit of the spending-limit policy contract.
- **Review scope is split by component, and item 3 above is that split.** The
  pre-mainnet security review covered the facilitator service and its
  cryptographic validation. It did **not** cover the spending-limit policy
  contract — that is separate, unfinished work. If a pubnet facilitator is
  live while item 3 is still open, its spending-limit policy contract is
  running on mainnet unaudited: the completed facilitator review does not
  extend to it. Do not point production traffic, or a buyer's real funds, at
  any facilitator until all three items are complete. See [policies &
  provenance](./agent-tooling/policies.md) and
  [Honesty](./reference/honesty.md) for what the policy does and does not
  enforce.
- You are responsible for securing your own backend (the submission surface) —
  rate limiting, auth, and abuse protection are your app's concern.
