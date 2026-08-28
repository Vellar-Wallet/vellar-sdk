// Example: build a spending-limit policy request body from a daily limit
// (in stroops) and a rolling window (in seconds), given as CLI arguments.
// Mirrors vellar-sdk's SpendingConstructor shape (src/policy-types.ts).
//
// Run with: npx tsx generate-policy-body.ts <dailyLimitStroops> <windowSeconds>
// Example:  npx tsx generate-policy-body.ts 1000000000 86400

export interface SpendingPolicyBody {
  type: "spending-limit";
  constructorArgs: {
    dailyLimitStroops: string;
    windowSeconds: number;
  };
}

function parsePositiveInteger(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer, got "${raw}"`);
  }
  return value;
}

export function buildSpendingPolicyBody(
  dailyLimitStroops: string,
  windowSeconds: string,
): SpendingPolicyBody {
  // dailyLimitStroops is validated as a positive integer but kept as a string
  // in the body — spending limits are i128 stroop amounts, too large for a
  // JS number to represent exactly.
  parsePositiveInteger(dailyLimitStroops, "limit");
  const window = parsePositiveInteger(windowSeconds, "windowSeconds");

  return {
    type: "spending-limit",
    constructorArgs: {
      dailyLimitStroops,
      windowSeconds: window,
    },
  };
}

function main() {
  const [limitArg, windowArg] = process.argv.slice(2);
  if (!limitArg || !windowArg) {
    console.error("Usage: npx tsx generate-policy-body.ts <dailyLimitStroops> <windowSeconds>");
    process.exitCode = 1;
    return;
  }

  try {
    const body = buildSpendingPolicyBody(limitArg, windowArg);
    console.log(JSON.stringify(body, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
