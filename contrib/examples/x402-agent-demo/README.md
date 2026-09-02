# x402 agent demo (end to end, mock)

A self-contained, end-to-end demo of an agent using a session key signer to
pay a mock x402 resource within a tracked budget. Combines three pieces in
one script:

- a **mock session key signer** (`createMockSessionKeySigner`) — signs
  payment payloads with a fake signature, no real cryptography;
- a **mock x402 resource server** (`requestResource`) — returns 402 until a
  `PAYMENT-SIGNATURE` header is present, then 200;
- a **budget tracker** (`BudgetTracker`) — a client-side spending guard that
  approves or rejects each payment against a fixed total budget.

These mirror the ideas in the `mock-x402-resource`, `headless-agent-signer`,
and `x402-budget-tracker` examples, reimplemented here as self-contained
mocks so this demo has no dependency on any other example directory.

## Flow

`runAgentPayments(signer, budget, resources)` pays for each resource in
order:

1. Request the resource with no payment header — expect `402`.
2. Ask the budget tracker to approve the resource's quoted price.
   - If **rejected** (would exceed the remaining budget), stop here — no
     signature is produced and no paid request is ever sent.
   - If **approved**, continue.
3. Sign a payment payload with the session key signer.
4. Retry the request with the signature in the `PAYMENT-SIGNATURE` header —
   expect `200`.

## Run it

```sh
npx tsx x402-agent-demo.ts
```

The sample run pays for one resource (600,000 stroops, fits in a
1,000,000-stroop budget) and is rejected for a second identically-priced
resource (would exceed the 400,000 stroops left):

```
x402 agent demo (mock signer + mock resource server + budget tracker)

1. Agent wallet : CAGENTWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
2. Total budget : 1000000 stroops

3. weather-api: PAID — Paid 600000 stroops, remaining budget 400000 stroops
4. market-data-api: REJECTED — Payment of 600000 stroops would exceed remaining budget of 400000 stroops (total 1000000)

Final remaining budget: 400000 stroops
```

## Tests

```sh
npx vitest run contrib/examples/x402-agent-demo
```
