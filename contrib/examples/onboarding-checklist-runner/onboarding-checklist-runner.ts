// Example: walk through a fixed sequence of wallet onboarding steps
// against mocked dependencies, tracking which steps are complete after
// each run.
//
// Steps (in order):
//   1. create-wallet     — register a passkey and create the smart account.
//   2. fund-account       — sponsor-fund the new account so it can pay fees.
//   3. verify-balance     — confirm the funded balance actually landed.
//   4. attach-policy      — attach a default spending-limit policy.
//
// Run with: npx tsx onboarding-checklist-runner.ts

export interface OnboardingStep {
  id: string;
  description: string;
  run: () => Promise<void>;
}

export interface ChecklistResult {
  completed: string[];
  remaining: string[];
}

/** Runs each step in order, stopping at the first failure. Returns which
 * steps completed and which remain (including the failed one and anything
 * after it), so a caller can show progress even on a partial run. */
export async function runOnboardingChecklist(steps: OnboardingStep[]): Promise<ChecklistResult> {
  const completed: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    try {
      await steps[i]!.run();
      completed.push(steps[i]!.id);
    } catch {
      return { completed, remaining: steps.slice(i).map((s) => s.id) };
    }
  }

  return { completed, remaining: [] };
}

/** Builds the standard four-step checklist against mocked dependencies. */
export function buildMockChecklist(): OnboardingStep[] {
  // Shared mutable mock state the steps operate on, standing in for a real
  // wallet/backend round trip.
  let accountId: string | undefined;
  let balance = 0n;
  let policyAttached = false;

  return [
    {
      id: "create-wallet",
      description: "Register a passkey and create the smart account.",
      async run() {
        accountId = "CMOCKONBOARDEDACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
      },
    },
    {
      id: "fund-account",
      description: "Sponsor-fund the new account so it can pay fees.",
      async run() {
        if (!accountId) throw new Error("fund-account requires create-wallet to have run first");
        balance = 5_0000000n; // 5 XLM, in stroops
      },
    },
    {
      id: "verify-balance",
      description: "Confirm the funded balance actually landed.",
      async run() {
        if (balance <= 0n) throw new Error("verify-balance: account has no balance");
      },
    },
    {
      id: "attach-policy",
      description: "Attach a default spending-limit policy.",
      async run() {
        policyAttached = true;
      },
    },
  ];
}

async function main() {
  const steps = buildMockChecklist();
  console.log(`Running ${steps.length} onboarding steps: ${steps.map((s) => s.id).join(" -> ")}`);

  const result = await runOnboardingChecklist(steps);

  console.log();
  console.log("Completed:", result.completed);
  console.log("Remaining:", result.remaining.length > 0 ? result.remaining : "(none — onboarding complete)");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
