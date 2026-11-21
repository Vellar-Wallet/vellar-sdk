# Issue #843: funding a sponsor account above the soft floor from a monitoring script

A worked example for operators and SDK consumers who want to act on the
sponsor-balance signal instead of only reading it.

| File | Purpose |
| --- | --- |
| [`sponsor-monitor.ts`](sponsor-monitor.ts) | Pure, injectable logic: classify a balance, plan a top-up, run a polling loop |
| [`sponsor-monitor.test.ts`](sponsor-monitor.test.ts) | Tests against a mocked balance sequence |
| [`example.ts`](example.ts) | A runnable monitoring script wiring Horizon and (optionally) a funding payment |

## The floors

Documented in `website/content/docs/operators/configuration.md` and mirrored in
`src/config.ts`: `SPONSOR_SOFT_FLOOR_STROOPS` = 250,000,000 (25 XLM, warns below
this) and `SPONSOR_HARD_FLOOR_STROOPS` = 100,000,000 (10 XLM, refuses below this).
`classifySponsorBalance` returns `above-soft-floor`, `below-soft-floor` or
`below-hard-floor`; a balance exactly at a floor is not below it.

## What the loop does

1. Reads the balance on an interval (default: the facilitator's own
   `SPONSOR_BALANCE_INTERVAL_MS`).
2. Alerts when the **state changes** to a crossed floor (a drop from soft to hard
   still alerts; a balance that just stays low does not repeat every poll), and
   sends `recovered` when it climbs back above the soft floor.
3. A failed balance read becomes a `check-failed` event; the loop keeps going.

## Funding is opt-in and guarded

Automatically moving funds is sensitive, so **nothing is sent by default**. A
top-up happens only when all three are true: `autoFund: true`, a `fund` callback
is supplied, and `maxTopUpStroops` caps a single payment. The amount is the gap
to the target (default: soft floor + 10 XLM), never more than the cap. A failing
`fund` is reported as `fund-failed`, never thrown.

In `example.ts` this maps to the `--execute` flag plus `FUNDER_SECRET` and
`MAX_TOP_UP_XLM`; without `--execute` it is a dry run that only logs. Use a
dedicated, low-balance funder account, never a treasury key.

```sh
SPONSOR_ADDRESS=G... npx tsx contrib/issue-843/example.ts            # alerts only
SPONSOR_ADDRESS=G... FUNDER_SECRET=S... MAX_TOP_UP_XLM=50 \
  npx tsx contrib/issue-843/example.ts --execute                       # may top up
```

## Tests

`sponsor-monitor.test.ts` drives a mocked balance sequence
(300, 260, 240, 90, 300 million stroops) and asserts the soft-floor-crossed
condition is identified at exactly the right readings, alerts fire on state
changes only, recovery is reported, and funding never happens by default. It also
covers the three funding guards, the top-up cap, failing funders and failing
balance reads. `example.ts` itself needs a live Horizon and is not unit-tested;
its Horizon and payment wiring is the only part not covered by the suite.

**Integration into core:** a maintainer can move `sponsor-monitor.ts` next to
`src/config.ts`. Nothing outside `contrib/` is changed here.
