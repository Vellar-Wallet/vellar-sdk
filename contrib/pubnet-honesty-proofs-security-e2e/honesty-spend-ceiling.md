Proposed replacement for the "The spend ceiling accounts at the estimate, not
the charge" section of `website/content/docs/reference/honesty.md`. See
README.md for how the current live-deployment state was checked.

---

## The spend ceiling accounts at the estimate, not the charge

The facilitator's global spend ceiling (5 XLM per window by default) is
accounted at the spend estimate of 500,000 stroops per settlement, not at the
actual charge. So the ceiling trips after roughly 100 settlements per window
while actually spending a small fraction of the 5 XLM it names.

Measured testnet charges, for reference: 23,059 stroops for a keypair `exact`
settlement, 85,999 for a policy-governed smart-account settlement, and
39,949-40,144 for `upto`. Against the 500,000-stroop estimate, that is roughly
5-17% of what is accounted per settlement.

The correct fix is to account at a measured pubnet charge rather than the
estimate. That data still does not exist: as of 2026-09-30 the hosted
facilitator and its demo resources (`vellar-facilitator.onrender.com`,
`vellar-seller-demo.onrender.com`, `vellar-backend.onrender.com`) all return
"Service Suspended" rather than serving requests, and no pubnet facilitator URL
is published anywhere in this repo for an independent measurement. A pubnet
facilitator may be running elsewhere, but nothing here identifies it, so its
`fee_charged` cannot be checked from this codebase.

This remains a known open item for pubnet tuning. It fails safe: the ceiling is
more conservative than it needs to be rather than less, and until a reachable
pubnet deployment's `fee_charged` is measured, the estimate is the only number
available to account against. See [Fees and Sponsorship](./fees.md) for the
difference between the estimate, the bid and the charge.
