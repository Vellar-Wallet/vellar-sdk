/**
 * Sponsor-balance monitor: classify the facilitator sponsor account against
 * the documented floors and act when it drops (#843).
 *
 * The facilitator warns below `SPONSOR_SOFT_FLOOR_STROOPS` (250,000,000 = 25 XLM)
 * and refuses below `SPONSOR_HARD_FLOOR_STROOPS` (100,000,000 = 10 XLM) — see
 * `website/content/docs/operators/configuration.md`. This module turns a balance
 * reading into a state and, optionally, a funding action that brings the
 * account back ABOVE the soft floor.
 *
 * Moving funds automatically is sensitive, so funding is OFF unless the caller
 * opts in on three counts:
 *   1. `autoFund: true`,
 *   2. a `fund` callback is supplied, and
 *   3. `maxTopUpStroops` is set, which caps what any single top-up can send.
 * Without all three the monitor only notifies. A failing `fund` or `notify`
 * never throws out of the loop.
 */

import {
  SPONSOR_BALANCE_INTERVAL_MS,
  SPONSOR_HARD_FLOOR_STROOPS,
  SPONSOR_SOFT_FLOOR_STROOPS,
} from "../../src/config";

export type SponsorFloorState = "above-soft-floor" | "below-soft-floor" | "below-hard-floor";

export interface SponsorFloors {
  softFloorStroops: bigint;
  hardFloorStroops: bigint;
}

/** The documented defaults, as bigints. */
export const DEFAULT_FLOORS: SponsorFloors = {
  softFloorStroops: BigInt(SPONSOR_SOFT_FLOOR_STROOPS),
  hardFloorStroops: BigInt(SPONSOR_HARD_FLOOR_STROOPS),
};

/**
 * Classify a balance. The soft floor is an "alert below this" threshold: a
 * balance exactly at the floor is still above it.
 */
export function classifySponsorBalance(
  balanceStroops: bigint,
  floors: SponsorFloors = DEFAULT_FLOORS,
): SponsorFloorState {
  if (balanceStroops < floors.hardFloorStroops) return "below-hard-floor";
  if (balanceStroops < floors.softFloorStroops) return "below-soft-floor";
  return "above-soft-floor";
}

/**
 * Convert a Horizon XLM balance string ("123.4567890") to stroops (1 XLM =
 * 10,000,000 stroops) without floating point.
 */
export function xlmToStroops(xlm: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(xlm.trim());
  if (!match) throw new Error(`Invalid XLM amount: ${JSON.stringify(xlm)}`);
  const [, whole, fraction = ""] = match;
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, "0"));
}

export interface SponsorMonitorOptions extends Partial<SponsorFloors> {
  /** Balance to top the account up to. Default: the soft floor plus 10 XLM. */
  targetStroops?: bigint;
  /** Opt in to moving funds. Default `false`: notify only. */
  autoFund?: boolean;
  /** Hard cap on one top-up. REQUIRED for `autoFund` to take effect. */
  maxTopUpStroops?: bigint;
}

export type SponsorEvent =
  | { kind: "soft-floor-crossed"; balanceStroops: bigint; state: SponsorFloorState }
  | { kind: "recovered"; balanceStroops: bigint }
  | { kind: "funded"; balanceStroops: bigint; amountStroops: bigint; txHash: string }
  | { kind: "fund-skipped"; balanceStroops: bigint; reason: string }
  | { kind: "fund-failed"; balanceStroops: bigint; amountStroops: bigint; error: string }
  | { kind: "check-failed"; error: string };

export interface SponsorMonitorDeps {
  getBalanceStroops: () => Promise<bigint>;
  notify: (event: SponsorEvent) => void | Promise<void>;
  /** Send `amountStroops` to the sponsor; resolve with the transaction hash. */
  fund?: (amountStroops: bigint) => Promise<string>;
}

export interface SponsorCheckResult {
  state: SponsorFloorState;
  balanceStroops: bigint;
  /** True when the balance is below the soft floor. */
  softFloorCrossed: boolean;
  action: "none" | "notified" | "funded" | "fund-skipped" | "fund-failed";
  topUpStroops?: bigint;
  txHash?: string;
}

const TEN_XLM = 100_000_000n;

/**
 * Amount to send to bring `balance` up to the target, capped at `max`.
 * Returns `0n` when no top-up is needed.
 */
export function planTopUp(
  balanceStroops: bigint,
  target: bigint,
  maxTopUpStroops: bigint,
): bigint {
  const needed = target - balanceStroops;
  if (needed <= 0n) return 0n;
  return needed < maxTopUpStroops ? needed : maxTopUpStroops;
}

/**
 * One monitoring pass. Notifies when the soft floor is crossed and, if every
 * funding guard is satisfied, tops the account up.
 *
 * Alert de-duplication is the loop's job (see {@link monitorSponsor}); a single
 * check reports every time it sees a crossed floor.
 */
export async function checkSponsor(
  deps: SponsorMonitorDeps,
  options: SponsorMonitorOptions = {},
): Promise<SponsorCheckResult> {
  const floors: SponsorFloors = {
    softFloorStroops: options.softFloorStroops ?? DEFAULT_FLOORS.softFloorStroops,
    hardFloorStroops: options.hardFloorStroops ?? DEFAULT_FLOORS.hardFloorStroops,
  };
  const balanceStroops = await deps.getBalanceStroops();
  const state = classifySponsorBalance(balanceStroops, floors);

  if (state === "above-soft-floor") {
    return { state, balanceStroops, softFloorCrossed: false, action: "none" };
  }

  await deps.notify({ kind: "soft-floor-crossed", balanceStroops, state });

  // Funding guards: opt-in flag, a funder, and a hard per-top-up cap.
  if (!options.autoFund) {
    return { state, balanceStroops, softFloorCrossed: true, action: "notified" };
  }
  if (!deps.fund || options.maxTopUpStroops === undefined) {
    await deps.notify({
      kind: "fund-skipped",
      balanceStroops,
      reason: "autoFund needs both a `fund` callback and maxTopUpStroops",
    });
    return { state, balanceStroops, softFloorCrossed: true, action: "fund-skipped" };
  }

  const target = options.targetStroops ?? floors.softFloorStroops + TEN_XLM;
  const amountStroops = planTopUp(balanceStroops, target, options.maxTopUpStroops);
  if (amountStroops === 0n) {
    return { state, balanceStroops, softFloorCrossed: true, action: "notified" };
  }

  try {
    const txHash = await deps.fund(amountStroops);
    await deps.notify({ kind: "funded", balanceStroops, amountStroops, txHash });
    return {
      state,
      balanceStroops,
      softFloorCrossed: true,
      action: "funded",
      topUpStroops: amountStroops,
      txHash,
    };
  } catch (error) {
    await deps.notify({
      kind: "fund-failed",
      balanceStroops,
      amountStroops,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      state,
      balanceStroops,
      softFloorCrossed: true,
      action: "fund-failed",
      topUpStroops: amountStroops,
    };
  }
}

export interface MonitorLoopOptions extends SponsorMonitorOptions {
  /** Poll interval. Default: the facilitator's own `SPONSOR_BALANCE_INTERVAL_MS`. */
  intervalMs?: number;
  /** Stop after this many checks (tests, one-shot cron runs). Default: run until aborted. */
  maxChecks?: number;
  signal?: AbortSignal;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Run {@link checkSponsor} on an interval. Alerts are de-duplicated by state: a
 * crossed floor notifies when the state CHANGES (so a drop from the soft to the
 * hard floor still alerts, but a balance sitting below the soft floor does not
 * repeat every poll), and a `recovered` event is sent when the balance climbs
 * back above the soft floor. A failed balance read is reported as
 * `check-failed` and the loop keeps going.
 */
export async function monitorSponsor(
  deps: SponsorMonitorDeps,
  options: MonitorLoopOptions = {},
): Promise<SponsorCheckResult[]> {
  const intervalMs = options.intervalMs ?? SPONSOR_BALANCE_INTERVAL_MS;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const results: SponsorCheckResult[] = [];
  let lastState: SponsorFloorState = "above-soft-floor";

  for (let i = 0; options.maxChecks === undefined || i < options.maxChecks; i++) {
    if (options.signal?.aborted) break;

    // Suppress repeat alerts while the state has not changed.
    const quiet: SponsorMonitorDeps = {
      ...deps,
      notify: (event) =>
        event.kind === "soft-floor-crossed" && event.state === lastState
          ? undefined
          : deps.notify(event),
    };

    try {
      const result = await checkSponsor(quiet, options);
      results.push(result);
      if (lastState !== "above-soft-floor" && !result.softFloorCrossed) {
        await deps.notify({ kind: "recovered", balanceStroops: result.balanceStroops });
      }
      lastState = result.state;
    } catch (error) {
      await deps.notify({
        kind: "check-failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (options.maxChecks !== undefined && i + 1 >= options.maxChecks) break;
    await sleep(intervalMs);
  }

  return results;
}
