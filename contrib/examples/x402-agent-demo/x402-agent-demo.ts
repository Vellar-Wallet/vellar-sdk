// Example: an end-to-end mock x402 agent demo. An agent holding a mock
// session key signer pays for a series of mock x402-protected resources
// while a budget tracker enforces a spending cap client-side. Demonstrates
// both a successful payment and a payment rejected for exceeding the
// remaining budget.
//
// Ties together the ideas behind the mock-x402-resource,
// headless-agent-signer, and x402-budget-tracker examples into a single
// self-contained script.
//
// Run with: npx tsx x402-agent-demo.ts

// ---- Mock session key signer ----

export interface MockSessionKeySigner {
  address: string;
  /** Signs a payment payload, returning a mock signature string. Never does
   * real cryptography — this is a reference mock, not a real signer. */
  sign(payload: string): string;
}

export function createMockSessionKeySigner(address: string): MockSessionKeySigner {
  return {
    address,
    sign(payload: string) {
      return `mock-sig:${address}:${payload.length}`;
    },
  };
}

// ---- Mock x402 resource server ----

export interface MockResource {
  name: string;
  /** Price of this resource, in stroops. */
  priceStroops: bigint;
}

export interface ResourceRequest {
  headers: Record<string, string>;
}

export interface ResourceResponse {
  status: number;
  body: unknown;
}

const PAYMENT_HEADER = "PAYMENT-SIGNATURE";

/** Handles a request to a mock protected resource: 402 without a payment
 * header, 200 with the resource once one is present. Never validates the
 * signature itself — a real facilitator would. */
export function requestResource(resource: MockResource, request: ResourceRequest): ResourceResponse {
  const paymentHeader = request.headers[PAYMENT_HEADER];
  if (!paymentHeader) {
    return {
      status: 402,
      body: { error: "Payment required", priceStroops: resource.priceStroops.toString() },
    };
  }
  return { status: 200, body: { data: `${resource.name} content` } };
}

// ---- Budget tracker ----

export interface BudgetDecision {
  approved: boolean;
  /** Present only when approved is false. */
  reason?: string;
  /** Remaining allowance after this decision (unchanged if rejected). */
  remainingBudget: bigint;
}

/** Tracks spend against a fixed total budget (in stroops). A rejected
 * payment is never partially recorded — the tracked spend only changes on
 * approval. */
export class BudgetTracker {
  private spent = 0n;

  constructor(private readonly totalBudget: bigint) {
    if (totalBudget < 0n) {
      throw new RangeError("totalBudget must not be negative");
    }
  }

  get remainingBudget(): bigint {
    return this.totalBudget - this.spent;
  }

  tryRecordPayment(amount: bigint): BudgetDecision {
    if (amount < 0n) {
      throw new RangeError("amount must not be negative");
    }
    if (amount > this.remainingBudget) {
      return {
        approved: false,
        reason: `Payment of ${amount} stroops would exceed remaining budget of ${this.remainingBudget} stroops (total ${this.totalBudget})`,
        remainingBudget: this.remainingBudget,
      };
    }
    this.spent += amount;
    return { approved: true, remainingBudget: this.remainingBudget };
  }
}

// ---- Agent flow ----

export interface AgentPaymentAttempt {
  resource: string;
  outcome: "paid" | "rejected";
  detail: string;
}

/**
 * Runs an agent through paying for `resources` in order, using `signer` to
 * sign each payment and `budget` to guard spend. For each resource: request
 * without payment (expect 402), check the quoted price against the
 * remaining budget, and only if the budget approves it, sign a payment and
 * retry the request (expect 200). A resource whose price would exceed the
 * remaining budget is rejected by the budget tracker *before* a signature
 * is ever produced or a paid request ever sent.
 */
export function runAgentPayments(
  signer: MockSessionKeySigner,
  budget: BudgetTracker,
  resources: MockResource[],
): AgentPaymentAttempt[] {
  const attempts: AgentPaymentAttempt[] = [];

  for (const resource of resources) {
    const unpaidResponse = requestResource(resource, { headers: {} });
    if (unpaidResponse.status !== 402) {
      throw new Error(`Expected 402 for an unpaid request to ${resource.name}`);
    }

    const decision = budget.tryRecordPayment(resource.priceStroops);
    if (!decision.approved) {
      attempts.push({ resource: resource.name, outcome: "rejected", detail: decision.reason ?? "rejected" });
      continue;
    }

    const signature = signer.sign(`pay:${resource.name}:${resource.priceStroops}`);
    const paidResponse = requestResource(resource, { headers: { [PAYMENT_HEADER]: signature } });
    if (paidResponse.status !== 200) {
      throw new Error(`Expected 200 for a paid request to ${resource.name}`);
    }

    attempts.push({
      resource: resource.name,
      outcome: "paid",
      detail: `Paid ${resource.priceStroops} stroops, remaining budget ${decision.remainingBudget} stroops`,
    });
  }

  return attempts;
}

function main() {
  console.log("x402 agent demo (mock signer + mock resource server + budget tracker)\n");

  const signer = createMockSessionKeySigner("CAGENTWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
  const budget = new BudgetTracker(1_000_000n);
  const resources: MockResource[] = [
    { name: "weather-api", priceStroops: 600_000n },
    { name: "market-data-api", priceStroops: 600_000n },
  ];

  console.log(`1. Agent wallet : ${signer.address}`);
  console.log(`2. Total budget : ${budget.remainingBudget} stroops`);
  console.log();

  const attempts = runAgentPayments(signer, budget, resources);
  attempts.forEach((attempt, i) => {
    const step = i + 3;
    if (attempt.outcome === "paid") {
      console.log(`${step}. ${attempt.resource}: PAID — ${attempt.detail}`);
    } else {
      console.log(`${step}. ${attempt.resource}: REJECTED — ${attempt.detail}`);
    }
  });

  console.log();
  console.log(`Final remaining budget: ${budget.remainingBudget} stroops`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
