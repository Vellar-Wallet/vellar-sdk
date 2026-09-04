# Policy Template Picker CLI

A self-contained reference example that lists mock Vellar policy templates and prints the parameter schema for a caller-selected template.

## How to run

```bash
# From the repo root — list all templates
npx ts-node contrib/examples/issue-95-policy-template-picker/picker.ts

# Pick a specific template by zero-based index
npx ts-node contrib/examples/issue-95-policy-template-picker/picker.ts 0
npx ts-node contrib/examples/issue-95-policy-template-picker/picker.ts 2

# Run the bundled sample (list + two valid picks + one out-of-range)
npx ts-node contrib/examples/issue-95-policy-template-picker/run-sample.ts
```

## Sample output — listing

```
Available policy templates:

  [0] Daily Spending Limit (spending-limit-daily)
      Caps total spend per rolling 24-hour window; enforced on-chain by a deployed policy contract.
  [1] Session-Key Signer Limits (session-key-only)
      Restricts a session key to a fixed set of contract calls; enforced by the wallet's signer limits.
  [2] Multi-Signer Approval (multi-signer-approval)
      Requires M-of-N signers to approve a transaction before it is submitted.
  [3] No Policy (unrestricted)
      No spending restriction is attached; the wallet's normal signer thresholds apply.

Run with an index (0–3) to view that template's parameter schema.
```

## Sample output — valid index (`picker.ts 0`)

```
Template [0]: Daily Spending Limit
Type        : spending-limit-daily
Description : Caps total spend per rolling 24-hour window; enforced on-chain by a deployed policy contract.
Enforcement : {"kind":"policy-contract","wasmHash":"mock-wasm-hash-spending-limit","constructorArgs":{"dailyLimitStroops":"10000000","windowSeconds":86400}}

Parameter schema:
  dailyLimitStroops
    type     : string (stroops)
    required : required
    desc     : Maximum spend in stroops per rolling 24-hour window (1 XLM = 10,000,000 stroops).
  windowSeconds
    type     : number
    required : optional
    desc     : Length of the rolling window in seconds. Defaults to 86400 (24 hours).
```

## Sample output — out-of-range index (`picker.ts 9`)

```
Error: index "9" is out of range. Valid range is 0–3.
```

The process exits with code 1 on an out-of-range index.
