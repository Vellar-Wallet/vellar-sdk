// Machine-readable CLI error contract (#411).
//
// Success `--json` already prints a structured object. Failures used to be a
// human line on stderr plus exit 1, so a script wrapping the CLI cannot tell
// an over-budget refusal from a network failure from a malformed argument
// without string matching.
//
// Lift into packages/cli/src/commands/* via fail() + handleCommandError().

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

/** The four CLI commands this contract covers. */
export const CLI_COMMANDS = ["search", "quote", "pay", "inspect"] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

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

/** Typical failure of each class, per command — the codes a wrapper switches on. */
export const COMMAND_FAILURES: Record<
  CliCommand,
  Partial<Record<CliErrorCode, { message: string; retryable: boolean }>>
> = {
  search: {
    USAGE: { message: "--limit must be a positive integer", retryable: false },
    NETWORK: { message: "Search failed: 503 Service Unavailable", retryable: true },
  },
  quote: {
    NETWORK: { message: "Unexpected status: 500 Internal Server Error", retryable: true },
  },
  pay: {
    USAGE: { message: "provide --secret-file (preferred), --secret, or the VELLAR_SECRET env var.", retryable: false },
    REFUSED: { message: "price exceeds --max. Nothing was signed.", retryable: false },
    NETWORK: { message: "Unexpected status: 500 Internal Server Error", retryable: true },
    PAYMENT_MAY_HAVE_SETTLED: {
      message: "Not unlocked: HTTP 402. A payment may already have settled; inspect before retrying.",
      retryable: false,
    },
  },
  inspect: {
    USAGE: { message: "not a transaction hash (expected 64 hex characters).", retryable: false },
    NETWORK: { message: "Transaction not found on testnet", retryable: true },
  },
};

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
