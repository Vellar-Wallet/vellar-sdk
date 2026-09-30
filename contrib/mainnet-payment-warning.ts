// Reference implementation for "warn loudly before any mainnet payment".
//
// Neither `vellar pay` (packages/cli/src/commands/pay.ts) nor the MCP payer
// distinguish mainnet from testnet at the point of spending: the same command
// that is free on testnet moves real USDC once --network mainnet is pointed
// at a live pubnet facilitator. This module is the standalone piece meant to
// be wired into packages/cli/src/commands/pay.ts before the build-and-sign
// step (see "Integration into Core" in contrib/README.md) — it is not
// imported by any in-scope package itself.

const BANNER_RULE = "=".repeat(64);

/** Networks that move real funds and therefore require the loud path. */
const REAL_FUNDS_NETWORKS = new Set(["mainnet"]);

export function isRealFundsNetwork(network: string): boolean {
  return REAL_FUNDS_NETWORKS.has(network);
}

export interface MainnetWarningInput {
  network: string;
  asset: string;
  /** Human-readable amount, already formatted in display units (e.g. "1.00"). */
  amount: string;
}

/**
 * An unmistakable, unambiguous notice shown before anything is signed. Shown
 * unconditionally on mainnet — even when --yes is passed, so a scripted run's
 * logs still record that real funds were spent and how much.
 */
export function formatMainnetWarning(input: MainnetWarningInput): string {
  return [
    BANNER_RULE,
    "MAINNET PAYMENT -- THIS SPENDS REAL FUNDS AND CANNOT BE REVERSED",
    BANNER_RULE,
    `  Network: ${input.network}`,
    `  Amount:  ${input.amount} ${input.asset}`,
    BANNER_RULE,
  ].join("\n");
}

export class RealFundsConfirmationDeclinedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealFundsConfirmationDeclinedError";
  }
}

export interface ConfirmMainnetPaymentOptions extends MainnetWarningInput {
  /** --yes on the CLI, or the equivalent explicit opt-in for scripted/non-interactive use. */
  assumeYes: boolean;
  /** Defaults to whether stdin is a TTY. Overridable for tests. */
  isInteractive?: boolean;
  /** Defaults to a readline prompt on stdin/stderr. Overridable for tests. */
  promptFn?: (question: string) => Promise<string>;
  /** Defaults to writing to stderr (stdout is reserved for paid content). Overridable for tests. */
  writeFn?: (line: string) => void;
}

async function defaultPrompt(question: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * Gate a mainnet payment behind an explicit confirmation. No-op on any
 * non-mainnet network — the warning and the prompt only ever fire for real
 * funds.
 *
 * - `assumeYes: true` (the CLI's --yes) still prints the warning, but skips
 *   the prompt, so non-interactive/scripted use stays scriptable.
 * - Otherwise, in a non-interactive context (no TTY, e.g. piped/CI), this
 *   refuses rather than hanging on a prompt nobody can answer — fails closed.
 * - Otherwise, prompts and requires the literal input "YES".
 *
 * Throws `RealFundsConfirmationDeclinedError` when the payment must not
 * proceed; the caller should treat that exactly like any other pre-flight
 * refusal (print the message, exit non-zero, nothing was signed).
 */
export async function confirmMainnetPayment(opts: ConfirmMainnetPaymentOptions): Promise<void> {
  if (!isRealFundsNetwork(opts.network)) return;

  const write = opts.writeFn ?? ((line: string) => process.stderr.write(`${line}\n`));
  write(formatMainnetWarning(opts));

  if (opts.assumeYes) return;

  const interactive = opts.isInteractive ?? Boolean(process.stdin.isTTY);
  if (!interactive) {
    throw new RealFundsConfirmationDeclinedError(
      "Refusing to pay on mainnet without --yes: input is not interactive, so no confirmation " +
        "prompt is possible. Pass --yes to confirm explicitly.",
    );
  }

  const prompt = opts.promptFn ?? defaultPrompt;
  const answer = await prompt('Type "YES" to confirm this mainnet payment, or anything else to abort: ');
  if (answer.trim() !== "YES") {
    throw new RealFundsConfirmationDeclinedError("Mainnet payment was not confirmed. Nothing was signed.");
  }
}

/**
 * Merge `network` onto an MCP payer result so every quote/pay/pay_and_call
 * response carries it at the top level, not only inside `settlement` (which
 * is absent whenever `paid`/`requiresPayment` is false). Pure and
 * side-effect-free so it composes with whatever shape payer.ts already
 * returns — see "Integration into Core" for exact call sites.
 */
export function withNetwork<T extends object>(result: T, network: string): T & { network: string } {
  return { ...result, network };
}
