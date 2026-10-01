# Horizon-First Proofs

Standalone reference for issue #504. The transaction hashes are independently verifiable from Horizon and must not depend on a facilitator health check.

## Page order

1. List the requirements and state that the hash commands below contact Horizon only.
2. Present all transaction-hash checks and their expected ledger, fee, and account fields.
3. Put facilitator liveness last in an explicitly optional section.

Use Horizon URLs for transaction checks, for example:

```sh
curl -fsS "https://horizon-testnet.stellar.org/transactions/$HASH" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["successful"], d["ledger"], d["fee_charged"])'
```

## Optional facilitator probe

```sh
FACILITATOR_BASE="${FACILITATOR_BASE:-https://vellar-facilitator.onrender.com}"
curl -fsS --max-time 120 "$FACILITATOR_BASE/health" | python3 -m json.tool
curl -fsS --max-time 120 "$FACILITATOR_BASE/supported" | python3 -m json.tool
```

This probe is for current service state only. A 503, timeout, or cold start is not evidence against any preceding Horizon hash. `FACILITATOR_BASE` can target a replacement host without editing the hash-verification commands.

**Host verification note:** On 2026-09-30, `https://vellar-facilitator.onrender.com/health` returned 503 with a suspended-service page. No alternate live host was verified during this contribution, so the default is explicitly a configurable target, not a claim that it is presently live. Update it only after confirming the replacement `/health` and `/supported` endpoints.