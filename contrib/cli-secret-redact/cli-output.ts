// CLI output redaction — the same discipline as the MCP payer's output.ts,
// applied to every CLI output path: stdout, stderr, the --json envelope, and
// error messages from dependencies.
//
// WHY A SEPARATE MODULE: the CLI uses `console.log` / `console.error` directly
// (it owns the process — stdout is NOT a protocol channel here). The MCP
// payer's output.ts is wired to its own `registerSecret` / `redact` and cannot
// be imported by the CLI without pulling in the payer's dependency tree. This
// module reuses the SAME APPROACH (exact-match registry + shape pattern) so the
// two implementations stay in sync, and documents the shared reasoning.
//
// Re-exported from a single choke point so every CLI command routes through it.

/** Any Stellar ed25519 secret seed shape, not just the one we hold. */
const STELLAR_SECRET_PATTERN = /\bS[A-Z2-7]{55}\b/g;

const REDACTED = "[REDACTED]";

/** Exact strings that must never appear in output. Registered once at startup. */
const registeredSecrets = new Set<string>();

/**
 * Register a secret for redaction. Call once, at startup, before anything can
 * be emitted. The value itself is never logged by this call.
 */
export function registerSecret(secret: string): void {
  if (secret) registeredSecrets.add(secret);
}

/** Test-only: drop registered secrets so cases don't leak into one another. */
export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

/** Replace any registered secret, or anything secret-shaped, with a placeholder. */
export function redact(text: string): string {
  let out = text;
  for (const secret of registeredSecrets) {
    if (secret) out = out.split(secret).join(REDACTED);
  }
  return out.replace(STELLAR_SECRET_PATTERN, REDACTED);
}

/**
 * Format an error for output: name and message only, redacted, never a stack.
 *
 * Stack frames can carry argument values, and library errors are verbose enough
 * to quote their inputs — so nothing but the shape of the failure gets out.
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) {
    const message = redact(err.message);
    return err.name && err.name !== "Error" ? `${err.name}: ${message}` : message;
  }
  return redact(typeof err === "string" ? err : JSON.stringify(err) ?? String(err));
}

/** Emit a line to stderr, redacted. */
export function logStderr(message: string): void {
  process.stderr.write(`${redact(message)}\n`);
}

/** Emit a line to stdout, redacted. */
export function logStdout(message: string): void {
  process.stdout.write(`${redact(message)}\n`);
}

/** Emit JSON to stdout, redacted. */
export function jsonStdout(data: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(data, null, 2);
  } catch {
    serialized = JSON.stringify(String(data));
  }
  process.stdout.write(`${redact(serialized)}\n`);
}