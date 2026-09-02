// Example: a mock fee estimation service returning fixed sample fee values
// (in stroops) for low, medium, and high priority levels.
//
// Run with: npx tsx mock-fee-service.ts

export type FeePriority = "low" | "medium" | "high";

const FEES_BY_PRIORITY: Record<FeePriority, bigint> = {
  low: 100n,
  medium: 10_000n,
  high: 1_000_000n,
};

export class UnknownFeePriorityError extends Error {
  constructor(priority: string) {
    super(
      `Unknown fee priority "${priority}" — expected one of: ${Object.keys(FEES_BY_PRIORITY).join(", ")}`,
    );
    this.name = "UnknownFeePriorityError";
  }
}

/** Returns a fixed sample fee (in stroops) for the given priority level. */
export function estimateFee(priority: FeePriority): bigint {
  const fee = FEES_BY_PRIORITY[priority];
  if (fee === undefined) {
    throw new UnknownFeePriorityError(priority);
  }
  return fee;
}

function main() {
  for (const priority of ["low", "medium", "high"] as const) {
    console.log(`${priority}: ${estimateFee(priority)} stroops`);
  }

  try {
    // Deliberately an invalid priority (cast past the type system, since a
    // real caller's input isn't statically known to be a FeePriority) to
    // demonstrate the error path.
    estimateFee("urgent" as FeePriority);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`invalid priority rejected: ${message}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
