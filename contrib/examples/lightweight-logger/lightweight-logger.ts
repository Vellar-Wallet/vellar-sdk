// Example: a minimal logging wrapper with info/warn/error levels that can
// be silenced entirely — handy for keeping test output clean without
// deleting the log calls from the code under test.
//
// Run with: npx tsx lightweight-logger.ts

let silent = false;

/** Suppresses all output from info/warn/error until called again with false. */
export function setSilent(value: boolean): void {
  silent = value;
}

export function info(message: string): void {
  if (!silent) console.log(`[INFO] ${message}`);
}

export function warn(message: string): void {
  if (!silent) console.warn(`[WARN] ${message}`);
}

export function error(message: string): void {
  if (!silent) console.error(`[ERROR] ${message}`);
}

function main() {
  info("Starting up");
  warn("Cache miss, falling back to network");
  error("Request failed after 3 retries");

  console.log("--- now silenced ---");
  setSilent(true);
  info("This should not print");
  warn("Neither should this");
  error("Nor this");
  setSilent(false);

  info("Logging resumed");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
