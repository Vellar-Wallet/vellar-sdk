// Example: a reusable pattern for deprecating an SDK method that has been
// superseded by a newer client, without breaking existing callers.
//
// Two parts:
//   1. A `@deprecated` JSDoc tag so IDEs strike the call through and point
//      callers at the replacement.
//   2. A one-time runtime console warning, so callers who don't read JSDoc
//      (or who called it before the tag was added) still find out — logged
//      once per process, not once per call, so a hot path doesn't spam.
//
// Run with: npx tsx deprecation-warning.ts

/** Tracks which deprecation warnings have already fired this process, keyed
 * by an id unique to each deprecated method. */
const warnedOnce = new Set<string>();

/**
 * Logs `message` to console.warn the first time it's called for a given
 * `id`; every subsequent call for that `id` is a silent no-op. Exported
 * separately from any specific deprecated method so it can be unit-tested
 * (and reset between tests) independent of what's calling it.
 */
export function warnOnce(id: string, message: string): void {
  if (warnedOnce.has(id)) return;
  warnedOnce.add(id);
  console.warn(message);
}

/** Test-only escape hatch: clears the fired-once state so each test can
 * assert on a fresh warning. Not needed in application code. */
export function _resetWarnOnceForTests(): void {
  warnedOnce.clear();
}

// --- Example: applying the pattern to a superseded method -----------------
//
// Imagine `legacySend` below lives in a "v1 client" module and has been
// superseded by a `send` method on a newer client. It still works — this
// is a deprecation notice, not a removal — but every call after the first
// nudges the caller toward the replacement.

/**
 * @deprecated Superseded by `NewClient.send()`. `legacySend` will be removed
 * in the next major version — see CHANGELOG.md for the timeline. Migrate by
 * replacing `legacySend(to, amount)` with `new NewClient(options).send({ to, amount })`.
 */
export function legacySend(to: string, amount: bigint): { to: string; amount: bigint } {
  warnOnce(
    "legacySend",
    "legacySend() is deprecated and will be removed in the next major version. " +
      "Use NewClient.send() instead. See CHANGELOG.md for the removal timeline.",
  );
  return { to, amount };
}

function main() {
  console.log("First call — warning fires:");
  legacySend("GDEST...", 100n);

  console.log("\nSecond call — same process, warning suppressed:");
  legacySend("GDEST...", 200n);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
