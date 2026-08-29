// Example: take a mock cleanup plan object and render a readable step by
// step view of its blockers, each clearly marked as resolved or
// outstanding.
//
// Run with: npx tsx cleanup-plan-viewer.ts

export interface CleanupBlocker {
  id: string;
  description: string;
  resolved: boolean;
}

export interface CleanupPlan {
  title: string;
  blockers: CleanupBlocker[];
}

/**
 * Renders `plan` as a numbered, step-by-step list of its blockers, each
 * marked `[RESOLVED]` or `[OUTSTANDING]`. A plan with zero blockers prints a
 * clear all-clear message instead of an empty list.
 */
export function renderCleanupPlan(plan: CleanupPlan): string {
  if (plan.blockers.length === 0) {
    return `${plan.title}\n\nAll clear — no blockers remaining.`;
  }

  const lines = [plan.title, ""];
  plan.blockers.forEach((blocker, index) => {
    const status = blocker.resolved ? "RESOLVED" : "OUTSTANDING";
    lines.push(`${index + 1}. [${status}] ${blocker.description} (${blocker.id})`);
  });
  return lines.join("\n");
}

function main() {
  const plan: CleanupPlan = {
    title: "Testnet contract cleanup",
    blockers: [
      { id: "blocker-1", description: "Revoke unused deployer signer key", resolved: true },
      { id: "blocker-2", description: "Migrate policy-contract owners off the legacy multisig", resolved: false },
      { id: "blocker-3", description: "Remove stale allowlist entries from spending-limit policy", resolved: true },
      { id: "blocker-4", description: "Confirm no active sessions reference the retired signer", resolved: false },
    ],
  };

  console.log(renderCleanupPlan(plan));

  console.log();
  console.log(renderCleanupPlan({ title: "Mainnet migration cleanup", blockers: [] }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
