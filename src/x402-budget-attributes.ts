// Attribute-based scoping for x402 session key budgets (#225).
//
// WHAT THIS DOES AND DOES NOT COVER — read before trusting it (same discipline
// as x402-signer-capabilities.ts, x402-auth-entry.ts, and x402-untrusted.ts).
//
//   Today the only client-side budget guard on an x402 payment is a single flat
//   `maxAmount` per call (x402-types.ts X402PayOptions) — a per-request ceiling,
//   not a budget. The durable budget is the on-chain spending-limit policy
//   attached to the signing key (x402-signer.ts policies / agents-facade.ts
//   grants), which has no concept of "per merchant" or "per category" — it only
//   sees a token contract and an amount.
//
//   This module adds a NARROWER, purely client-side guard in between: a set of
//   BudgetAttributeRule entries, each scoping a spend ceiling to a merchant
//   (payTo address), a category (an opaque tag the integrator attaches via
//   PaymentRequirements.extra.category — this SDK does not define categories,
//   the integrator's facilitator/resource-server does), and/or a time window.
//   It runs entirely inside this process, BEFORE a payment is ever signed, in
//   addition to (never instead of) maxAmount and the on-chain policy.
//
//   So: "this process refuses to build a payment outside its configured
//   attribute budgets" is true and enforced HERE. "The wallet cannot be made to
//   pay outside these budgets" is NOT covered by this module alone — like
//   x402-signer-capabilities.ts, that guarantee (if you need it to hold even
//   against a compromised host process) still requires an on-chain
//   SignerLimits/Policy contract. Client-side attribute budgets are
//   defense-in-depth narrowing and UX (fail fast, before a passkey/session-key
//   signature is ever produced), not a replacement for the chain.
//
//   Spend TRACKING (how much has been spent so far against a rule, across
//   calls) is intentionally pluggable rather than built in — a real budget
//   needs durable state (a store, possibly shared across processes/tabs), and
//   this SDK has no opinion on where that lives. `BudgetAttributeTracker` is
// the seam; `createInMemoryBudgetAttributeTracker` is a reference
//   implementation for tests and single-process use.

/** One payment's merchant/category/time attributes, as seen by budget scoping.
 * Derived from `PaymentRequirements` + the current clock — see
 * {@link budgetRequestFor} in x402-client.ts. */
export interface BudgetAttributeRequest {
  /** The payment recipient (`PaymentRequirements.payTo`). */
  merchant: string;
  /** An opaque category tag, when the server/facilitator supplies one via
   * `PaymentRequirements.extra.category`. Undefined when absent — a rule with
   * a specific (non-`"*"`) `category` never matches a request with none. */
  category?: string;
  /** Amount in the asset's base units, for spend-ceiling accounting. */
  amount: bigint;
  /** When the payment is being attempted (for time-window rules). */
  at: Date;
}

/** An hour-of-day / day-of-week time window a rule is active in, evaluated in
 * UTC (this SDK has no notion of the wallet owner's local timezone). Omit
 * either bound to leave that axis unrestricted. */
export interface BudgetTimeWindow {
  /** 0–23, inclusive start hour (UTC). */
  startHourUtc?: number;
  /** 0–23, inclusive end hour (UTC). `startHourUtc > endHourUtc` wraps past
   * midnight (e.g. 22 → 6 permits 22:00–23:59 and 00:00–06:59 UTC). */
  endHourUtc?: number;
  /** Days of week the window is active, 0 (Sunday) – 6 (Saturday) UTC. Omit
   * for every day. */
  daysUtc?: readonly number[];
}

/**
 * One attribute-scoped budget rule. `"*"` matches any value for `merchant` /
 * `category`, mirroring the wildcard convention in x402-signer-capabilities.ts.
 * A request must match `merchant`, `category` (when the rule specifies one),
 * AND `window` (when given) for the rule to apply; `maxAmount` then bounds
 * that single payment (not a running total — see `tracker` for cumulative
 * spend across calls).
 */
export interface BudgetAttributeRule {
  /** Recipient this rule scopes to, or `"*"` for any merchant. */
  merchant: string;
  /** Category tag this rule scopes to. Omit (or `"*"`) to match any category,
   * including requests with no category at all. */
  category?: string;
  /** Per-payment ceiling, in the asset's base units, for a request matching
   * this rule. */
  maxAmount: bigint;
  /** Restrict the rule to a time window (UTC). Omit for no time restriction. */
  window?: BudgetTimeWindow;
  /** Cumulative ceiling across all payments matching this rule, enforced via
   * `tracker` (see {@link BudgetAttributeTracker}). Omit for no running total —
   * only the per-payment `maxAmount` applies. */
  periodMaxAmount?: bigint;
}

/** Pluggable running-spend accounting for `periodMaxAmount` rules. Keyed by
 * whatever the caller considers one accounting period (this module does not
 * itself roll periods over — see {@link createInMemoryBudgetAttributeTracker}
 * for a simple process-lifetime implementation). */
export interface BudgetAttributeTracker {
  /** Spend recorded so far for this rule's period. */
  spent(rule: BudgetAttributeRule): Promise<bigint>;
  /** Record a successful payment's amount against this rule's period. */
  record(rule: BudgetAttributeRule, amount: bigint): Promise<void>;
}

/** Thrown when a payment request matches no configured budget rule, or
 * exceeds the matching rule's ceiling. */
export class BudgetAttributeDeniedError extends Error {
  constructor(
    readonly request: BudgetAttributeRequest,
    readonly rules: readonly BudgetAttributeRule[],
    reason: string,
  ) {
    super(
      `x402 attribute-scoped budget denied a payment of ${request.amount} to ` +
        `${request.merchant}${request.category ? ` (category ${request.category})` : ""}: ` +
        `${reason} (${rules.length} rule(s) configured). This is a client-side guard — it is ` +
        `independent of, and does not substitute for, an on-chain spending-limit policy.`,
    );
    this.name = "BudgetAttributeDeniedError";
  }
}

/** A budget rule named a malformed merchant address, a bound outside 0–23, or
 * a non-positive amount. Caught at configuration time, not at payment time, so
 * a typo'd rule fails loudly before it can either wrongly deny or (worse)
 * wrongly admit. */
export class InvalidBudgetAttributeRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBudgetAttributeRuleError";
  }
}

const CONTRACT_OR_ACCOUNT = /^[GC][A-Z2-7]{55}$/;

function assertValidWindow(window: BudgetTimeWindow | undefined): void {
  if (!window) return;
  for (const [name, value] of [
    ["startHourUtc", window.startHourUtc],
    ["endHourUtc", window.endHourUtc],
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0 || value > 23) {
      throw new InvalidBudgetAttributeRuleError(
        `budget rule window.${name} must be an integer 0–23: got ${JSON.stringify(value)}`,
      );
    }
  }
  if (window.daysUtc) {
    for (const day of window.daysUtc) {
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        throw new InvalidBudgetAttributeRuleError(
          `budget rule window.daysUtc entries must be integers 0–6 (Sunday–Saturday): got ${JSON.stringify(day)}`,
        );
      }
    }
  }
}

/** Validate a budget rule set at configuration time. Throws on the first
 * malformed rule; an empty array is valid (see {@link evaluateBudgetAttributes}). */
export function assertValidBudgetAttributeRules(rules: readonly BudgetAttributeRule[]): void {
  for (const rule of rules) {
    if (rule.merchant !== "*" && !CONTRACT_OR_ACCOUNT.test(rule.merchant)) {
      throw new InvalidBudgetAttributeRuleError(
        `budget rule merchant must be a Stellar address (G…/C…) or "*": got ${JSON.stringify(rule.merchant)}`,
      );
    }
    if (rule.maxAmount <= 0n) {
      throw new InvalidBudgetAttributeRuleError(
        `budget rule maxAmount must be positive: got ${rule.maxAmount}`,
      );
    }
    if (rule.periodMaxAmount !== undefined && rule.periodMaxAmount <= 0n) {
      throw new InvalidBudgetAttributeRuleError(
        `budget rule periodMaxAmount must be positive when set: got ${rule.periodMaxAmount}`,
      );
    }
    assertValidWindow(rule.window);
  }
}

function matchesCategory(rule: BudgetAttributeRule, request: BudgetAttributeRequest): boolean {
  if (rule.category === undefined || rule.category === "*") return true;
  return rule.category === request.category;
}

function matchesWindow(window: BudgetTimeWindow | undefined, at: Date): boolean {
  if (!window) return true;
  if (window.daysUtc && !window.daysUtc.includes(at.getUTCDay())) return false;
  const { startHourUtc, endHourUtc } = window;
  if (startHourUtc === undefined || endHourUtc === undefined) return true;
  const hour = at.getUTCHours();
  if (startHourUtc <= endHourUtc) {
    return hour >= startHourUtc && hour <= endHourUtc;
  }
  // Wraps past midnight, e.g. 22 → 6.
  return hour >= startHourUtc || hour <= endHourUtc;
}

/**
 * The first rule (in configured order) that matches `request` on merchant,
 * category, and time window — or `undefined` when none does. Exported so a
 * caller that already validated/enforced via {@link assertBudgetAttributes}
 * can find the SAME rule afterward (e.g. to record spend against it) without
 * re-implementing the matching logic and risking the two falling out of sync.
 */
export function matchingBudgetRule(
  rules: readonly BudgetAttributeRule[],
  request: BudgetAttributeRequest,
): BudgetAttributeRule | undefined {
  return rules.find(
    (rule) =>
      (rule.merchant === "*" || rule.merchant === request.merchant) &&
      matchesCategory(rule, request) &&
      matchesWindow(rule.window, request.at),
  );
}

/**
 * Does any rule in `rules` permit `request`, and if so does the amount clear
 * that rule's per-payment ceiling? An EMPTY rule set means "no attribute
 * scoping configured" and permits everything — the same opt-in-per-instance
 * posture as x402-signer-capabilities.ts's `evaluateCapability`: passing rules
 * is what turns the check on, not passing zero rules meaning "deny
 * everything" (which would silently break every existing caller that never
 * opted in).
 *
 * Only checks the PER-PAYMENT ceiling (`rule.maxAmount`); `periodMaxAmount`
 * needs the tracker and is checked separately by
 * {@link assertBudgetAttributes}.
 */
export function evaluateBudgetAttributes(
  rules: readonly BudgetAttributeRule[],
  request: BudgetAttributeRequest,
): boolean {
  if (rules.length === 0) return true;
  const rule = matchingBudgetRule(rules, request);
  if (!rule) return false;
  return request.amount <= rule.maxAmount;
}

/**
 * Enforce the rule set, throwing {@link BudgetAttributeDeniedError} when no
 * rule matches, the per-payment ceiling is exceeded, or (when `tracker` is
 * given and the matching rule has a `periodMaxAmount`) the running total for
 * the period would be exceeded. Does NOT record the spend — call
 * `tracker.record` yourself once the payment actually succeeds, so a payment
 * that fails after this check (e.g. rejected by the facilitator) doesn't
 * consume budget it never spent.
 */
export async function assertBudgetAttributes(
  rules: readonly BudgetAttributeRule[],
  request: BudgetAttributeRequest,
  tracker?: BudgetAttributeTracker,
): Promise<void> {
  if (rules.length === 0) return;
  const rule = matchingBudgetRule(rules, request);
  if (!rule) {
    throw new BudgetAttributeDeniedError(
      request,
      rules,
      "no configured budget rule matches this merchant/category/time",
    );
  }
  if (request.amount > rule.maxAmount) {
    throw new BudgetAttributeDeniedError(
      request,
      rules,
      `payment exceeds the matching rule's per-payment ceiling of ${rule.maxAmount}`,
    );
  }
  if (rule.periodMaxAmount !== undefined && tracker) {
    const spent = await tracker.spent(rule);
    if (spent + request.amount > rule.periodMaxAmount) {
      throw new BudgetAttributeDeniedError(
        request,
        rules,
        `payment would exceed the matching rule's period ceiling of ${rule.periodMaxAmount} ` +
          `(already spent ${spent} this period)`,
      );
    }
  }
}

/**
 * A process-lifetime, in-memory {@link BudgetAttributeTracker}: sums recorded
 * spend per rule (identified by reference) with no period rollover. Fine for
 * a single long-lived process or tests; a host needing spend to persist across
 * restarts, roll over daily/monthly, or be shared across processes should
 * implement `BudgetAttributeTracker` against their own store instead.
 */
export function createInMemoryBudgetAttributeTracker(): BudgetAttributeTracker {
  const spent = new WeakMap<BudgetAttributeRule, bigint>();
  return {
    async spent(rule) {
      return spent.get(rule) ?? 0n;
    },
    async record(rule, amount) {
      spent.set(rule, (spent.get(rule) ?? 0n) + amount);
    },
  };
}
