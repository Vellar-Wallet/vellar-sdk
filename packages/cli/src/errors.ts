// Machine-readable CLI error contract (#411).
//
// Success `--json` already prints a structured object. Failures used to be a
// human line on stderr plus exit 1, so a script wrapping the CLI could not
// tell an over-budget refusal from a network failure from a malformed
// argument without string matching. This module is the single code list and
// the single envelope those scripts can switch on.

export const CLI_ERROR_CODES = [
  /** Malformed or missing argument. Nothing was spent. */
  "USAGE",
  /** Local business-rule refusal (over-budget, no payable option). Nothing was spent. */
  "REFUSED",
  /** Transport / remote / decode failure before a payment was submitted. */
  "NETWORK",
  /** A payment was signed or submitted; settlement may have occurred. Do not blindly retry. */
  "PAYMENT_MAY_HAVE_SETTLED",
] as const;

export type CliErrorCode = (typeof CLI_ERROR_CODES)[number];

/**
 * Distinct process exit codes per failure class. 0 is success; 1 is unused
 * so a wrapper never has to guess whether 1 meant "refused" or "maybe paid".
 */
export const CLI_EXIT_CODES = {
  USAGE: 2,
  REFUSED: 3,
  NETWORK: 4,
  PAYMENT_MAY_HAVE_SETTLED: 5,
} as const;

export interface CliErrorEnvelope {
  code: CliErrorCode;
  message: string;
  retryable: boolean;
}

/** Strip secrets (S… seeds) and stack frames so a --json failure never
 * leaks either onto stdout. */
export function sanitizeCliMessage(message: string): string {
  return message.replace(/\bS[A-Z2-7]{55}\b/g, "[redacted]").replace(/\n\s*at\s+[\s\S]*/g, "");
}

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly retryable: boolean;

  constructor(code: CliErrorCode, message: string, retryable: boolean) {
    super(sanitizeCliMessage(message));
    this.name = "CliError";
    this.code = code;
    this.retryable = retryable;
  }

  get envelope(): CliErrorEnvelope {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }

  get exitCode(): number {
    return CLI_EXIT_CODES[this.code];
  }
}

export function fail(code: CliErrorCode, message: string, retryable: boolean): never {
  throw new CliError(code, message, retryable);
}

/** Emit the --json envelope (or a human line) and exit. Never prints a stack. */
export function handleCommandError(err: unknown, json?: boolean): never {
  const mapped =
    err instanceof CliError
      ? err
      : new CliError("NETWORK", err instanceof Error ? err.message : "unexpected failure", true);
  if (json) {
    console.log(JSON.stringify(mapped.envelope));
  } else {
    console.error(`Error: ${mapped.message}`);
  }
  process.exit(mapped.exitCode);
}
