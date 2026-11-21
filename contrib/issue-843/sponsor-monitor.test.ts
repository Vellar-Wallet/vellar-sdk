import { describe, it, expect, vi } from "vitest";
import {
  checkSponsor,
  classifySponsorBalance,
  DEFAULT_FLOORS,
  monitorSponsor,
  planTopUp,
  xlmToStroops,
  type SponsorEvent,
  type SponsorMonitorDeps,
} from "./sponsor-monitor";
import {
  SPONSOR_HARD_FLOOR_STROOPS,
  SPONSOR_SOFT_FLOOR_STROOPS,
} from "../../src/config";

const SOFT = BigInt(SPONSOR_SOFT_FLOOR_STROOPS);
const HARD = BigInt(SPONSOR_HARD_FLOOR_STROOPS);

function depsFor(balances: bigint[], extra: Partial<SponsorMonitorDeps> = {}) {
  const events: SponsorEvent[] = [];
  let i = 0;
  const deps: SponsorMonitorDeps = {
    getBalanceStroops: async () => balances[Math.min(i++, balances.length - 1)],
    notify: (event) => {
      events.push(event);
    },
    ...extra,
  };
  return { deps, events };
}

describe("classifySponsorBalance", () => {
  it("uses the documented defaults", () => {
    expect(DEFAULT_FLOORS.softFloorStroops).toBe(250_000_000n);
    expect(DEFAULT_FLOORS.hardFloorStroops).toBe(100_000_000n);
  });

  it.each([
    [SOFT + 1n, "above-soft-floor"],
    [SOFT, "above-soft-floor"], // exactly at the floor is not below it
    [SOFT - 1n, "below-soft-floor"],
    [HARD, "below-soft-floor"],
    [HARD - 1n, "below-hard-floor"],
    [0n, "below-hard-floor"],
  ] as const)("balance %s is %s", (balance, expected) => {
    expect(classifySponsorBalance(balance)).toBe(expected);
  });
});

describe("a mocked balance sequence crossing the soft floor", () => {
  const sequence = [300_000_000n, 260_000_000n, 240_000_000n, 90_000_000n, 300_000_000n];

  it("identifies the soft-floor-crossed condition at exactly the right readings", async () => {
    const { deps } = depsFor(sequence);
    const results = await monitorSponsor(deps, { maxChecks: sequence.length, sleep: async () => {} });

    expect(results.map((r) => r.state)).toEqual([
      "above-soft-floor",
      "above-soft-floor",
      "below-soft-floor",
      "below-hard-floor",
      "above-soft-floor",
    ]);
    expect(results.map((r) => r.softFloorCrossed)).toEqual([false, false, true, true, false]);
  });

  it("alerts on each state change (including escalation), then reports recovery", async () => {
    const { deps, events } = depsFor(sequence);
    await monitorSponsor(deps, { maxChecks: sequence.length, sleep: async () => {} });

    expect(events.map((e) => e.kind)).toEqual(["soft-floor-crossed", "soft-floor-crossed", "recovered"]);
    expect(events[0]).toMatchObject({ balanceStroops: 240_000_000n, state: "below-soft-floor" });
    expect(events[1]).toMatchObject({ balanceStroops: 90_000_000n, state: "below-hard-floor" });
  });

  it("does not repeat the alert while the balance stays in the same state", async () => {
    const { deps, events } = depsFor([240_000_000n, 235_000_000n, 230_000_000n]);
    await monitorSponsor(deps, { maxChecks: 3, sleep: async () => {} });

    expect(events.filter((e) => e.kind === "soft-floor-crossed")).toHaveLength(1);
  });

  it("never moves funds by default, even below the hard floor", async () => {
    const fund = vi.fn().mockResolvedValue("hash");
    const { deps } = depsFor(sequence, { fund });
    const results = await monitorSponsor(deps, { maxChecks: sequence.length, sleep: async () => {} });

    expect(fund).not.toHaveBeenCalled();
    expect(results.filter((r) => r.softFloorCrossed).map((r) => r.action)).toEqual(["notified", "notified"]);
  });
});

describe("optional, guarded funding", () => {
  it("tops up toward the target (soft floor + 10 XLM), capped by maxTopUpStroops", async () => {
    const fund = vi.fn().mockResolvedValue("tx-1");
    const { deps, events } = depsFor([200_000_000n], { fund });

    const result = await checkSponsor(deps, { autoFund: true, maxTopUpStroops: 1_000_000_000n });

    // target = 250M + 100M = 350M; needed = 150M.
    expect(fund).toHaveBeenCalledExactlyOnceWith(150_000_000n);
    expect(result).toMatchObject({ action: "funded", topUpStroops: 150_000_000n, txHash: "tx-1" });
    expect(events.map((e) => e.kind)).toEqual(["soft-floor-crossed", "funded"]);
  });

  it("caps a single top-up at maxTopUpStroops", async () => {
    const fund = vi.fn().mockResolvedValue("tx-2");
    const { deps } = depsFor([50_000_000n], { fund });

    const result = await checkSponsor(deps, { autoFund: true, maxTopUpStroops: 20_000_000n });

    expect(fund).toHaveBeenCalledExactlyOnceWith(20_000_000n);
    expect(result.topUpStroops).toBe(20_000_000n);
  });

  it("refuses to fund without a cap, and says why", async () => {
    const fund = vi.fn();
    const { deps, events } = depsFor([200_000_000n], { fund });

    const result = await checkSponsor(deps, { autoFund: true });

    expect(fund).not.toHaveBeenCalled();
    expect(result.action).toBe("fund-skipped");
    expect(events.at(-1)).toMatchObject({ kind: "fund-skipped" });
  });

  it("refuses to fund without a fund callback", async () => {
    const { deps } = depsFor([200_000_000n]);

    expect((await checkSponsor(deps, { autoFund: true, maxTopUpStroops: 1n })).action).toBe("fund-skipped");
  });

  it("does not fund when the balance is above the soft floor", async () => {
    const fund = vi.fn();
    const { deps } = depsFor([SOFT + 1n], { fund });

    const result = await checkSponsor(deps, { autoFund: true, maxTopUpStroops: 1_000_000_000n });

    expect(result.action).toBe("none");
    expect(fund).not.toHaveBeenCalled();
  });

  it("reports a failing fund call instead of throwing", async () => {
    const fund = vi.fn().mockRejectedValue(new Error("tx_insufficient_balance"));
    const { deps, events } = depsFor([200_000_000n], { fund });

    const result = await checkSponsor(deps, { autoFund: true, maxTopUpStroops: 1_000_000_000n });

    expect(result.action).toBe("fund-failed");
    expect(events.at(-1)).toMatchObject({ kind: "fund-failed", error: "tx_insufficient_balance" });
  });

  it("keeps the loop alive when a balance read fails", async () => {
    const events: SponsorEvent[] = [];
    let calls = 0;
    const deps: SponsorMonitorDeps = {
      getBalanceStroops: async () => {
        calls += 1;
        if (calls === 1) throw new Error("Horizon 503");
        return SOFT + 1n;
      },
      notify: (event) => {
        events.push(event);
      },
    };

    const results = await monitorSponsor(deps, { maxChecks: 2, sleep: async () => {} });

    expect(events[0]).toEqual({ kind: "check-failed", error: "Horizon 503" });
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe("above-soft-floor");
  });
});

describe("helpers", () => {
  it("planTopUp is zero when already at or above target and capped otherwise", () => {
    expect(planTopUp(400n, 350n, 1_000n)).toBe(0n);
    expect(planTopUp(100n, 350n, 1_000n)).toBe(250n);
    expect(planTopUp(100n, 350n, 50n)).toBe(50n);
  });

  it("xlmToStroops converts Horizon balance strings exactly", () => {
    expect(xlmToStroops("25.0000000")).toBe(250_000_000n);
    expect(xlmToStroops("10")).toBe(100_000_000n);
    expect(xlmToStroops("0.0000001")).toBe(1n);
    expect(() => xlmToStroops("abc")).toThrow(/Invalid XLM amount/);
    expect(() => xlmToStroops("-1")).toThrow(/Invalid XLM amount/);
  });
});
