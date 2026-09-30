# Honesty & Posture

Vellar is a production system. **Vellar runs on `stellar:pubnet`**. 

The live facilitator advertises `stellar:pubnet` in the `/supported` endpoint.

> ⚠️ **WARNING: REAL FUNDS**
> Following the quickstart or paying a live seller endpoint will move **real USDC on the Stellar Mainnet** (Contract: `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`). 

## Mainnet Readiness Gates

To protect participants, the following gates were cleared before `pubnet` integration went live:
- [x] **Security Audit:** A mainnet security audit of the spending-limit policy contract and SDK signing path has been completed and findings resolved.
- [x] **Rate Limiting:** Network-level protections are enforced on the facilitator.
- [x] **Deterministic Builds:** Smart account contracts are reproducibly built.