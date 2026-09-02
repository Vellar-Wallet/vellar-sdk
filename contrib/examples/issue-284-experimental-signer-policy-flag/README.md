# Experimental feature flag for x402 signer policies

Self-contained reference for issue [#284](https://github.com/Vellar-Wallet/vellar-sdk/issues/284): a feature-flag pattern for gating experimental x402 signer policy behavior, so early adopters can opt in without a hard breaking change for everyone else.

## The pattern

An experimental signer policy change ships behind a named `experimental*`
boolean on the signer config:

1. The new behavior lives behind a named `experimental*` flag.
2. Omitted / `false` reproduces today's behavior **exactly**.
3. `true` opts into the new (here, stricter) behavior.
4. Validation runs at **construction**, not sign time, so a bad config fails
   loudly before it can ever sign.

## The behavior being gated

The real vellar-sdk signers (`src/x402-signer.ts`) accept a `capabilities`
rule set whose `resourceType` / `action` fields each allow a `"*"` wildcard.
A wildcard left behind after copy-pasting an example silently widens what a
session key will sign. Tightening that by default would break every existing
config that relies on wildcards — so it's gated:

```ts
const signer = createMockSigner({
  address: walletCAddress,
  capabilities: [{ resourceType: usdcSac, action: "transfer" }],
  // Any rule using "*" now throws InvalidCapabilityRuleError at construction,
  // instead of being silently accepted.
  experimentalStrictWildcardCapabilities: true,
});
```

| Config | Unflagged (default) | Flagged (`true`) |
| ------ | ------------------- | ---------------- |
| `[{ resourceType: usdc, action: "*" }]` | accepted, signs | **rejected at construction** |
| `[{ resourceType: usdc, action: "transfer" }]` | accepted, signs | accepted, signs (unchanged) |
| `capabilities` omitted entirely | permits everything | permits everything (unchanged) |

## Risks of enabling the flag

- **Experimental.** It may change shape or be removed in a future release
  without a major-version bump, per this package's pre-1.0 status.
- **Breaking for the signer you enable it on.** If that config currently
  relies on a wildcard rule, construction throws instead of succeeding. Only
  enable it once your `capabilities` list is already fully explicit, or use it
  as a CI check ahead of tightening a config for production.
- **No effect without wildcard rules.** A config with no `capabilities`, or
  with fully explicit ones, behaves exactly as before — so enabling it there
  buys nothing and costs nothing.
- **Client-side only.** This narrows what the SDK will attempt to sign in this
  process. It is not a substitute for the on-chain `SignerLimits` / Policy
  mechanism, which is the only check a compromised host process cannot bypass.

## Run it

```sh
npx tsx experimental-signer-policy-flag.ts
```

## Tests

```sh
npx vitest run contrib/examples/issue-284-experimental-signer-policy-flag
```
