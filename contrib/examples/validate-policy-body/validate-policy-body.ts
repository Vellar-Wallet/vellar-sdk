// Example: locally validate a spending-limit policy body before it would be
// sent to a generate endpoint, catching obvious mistakes early. Returns a
// list of every problem found, rather than throwing on the first one, so a
// caller can show all the issues at once.
//
// Run with: npx tsx validate-policy-body.ts

export interface PolicyBody {
  limit: number;
  windowSeconds: number;
}

// A window longer than 30 days isn't a meaningful "rolling window" for a
// spending limit — treat it as a sign the value is probably in the wrong
// unit (e.g. milliseconds instead of seconds).
const MAX_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const MIN_WINDOW_SECONDS = 1;

export function validatePolicyBody(body: PolicyBody): string[] {
  const errors: string[] = [];

  if (!Number.isFinite(body.limit) || body.limit <= 0) {
    errors.push(`limit must be a positive number, got ${body.limit}`);
  }

  if (!Number.isFinite(body.windowSeconds) || !Number.isInteger(body.windowSeconds)) {
    errors.push(`windowSeconds must be an integer, got ${body.windowSeconds}`);
  } else if (body.windowSeconds < MIN_WINDOW_SECONDS || body.windowSeconds > MAX_WINDOW_SECONDS) {
    errors.push(
      `windowSeconds must be between ${MIN_WINDOW_SECONDS} and ${MAX_WINDOW_SECONDS} (30 days), got ${body.windowSeconds}`,
    );
  }

  return errors;
}

function main() {
  const valid: PolicyBody = { limit: 100, windowSeconds: 86_400 };
  const invalid: PolicyBody = { limit: -5, windowSeconds: 99_999_999 };

  console.log("Valid body errors:  ", validatePolicyBody(valid));
  console.log("Invalid body errors:", validatePolicyBody(invalid));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
