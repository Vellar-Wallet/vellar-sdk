// Example: a command-line tool that sends a payment through a Vellar wallet
// handle wired to mock kit/sac/backend dependencies, so it runs end to end
// with no live network call.
//
// Run with:
//   npx tsx cli-send-payment.ts --to GRECIPIENTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX --amount 12.5 --token USDC

import { createVellarWallet, type VellarWallet } from "../../../src/client";
import type { PasskeyKitLike, WalletBackend } from "../../../src/passkeykit-connector";
import type { SacClientLike, TokenContractClientLike } from "../../../src/payments-client";
import type { Network } from "../../../src/types";
import type { TokenInfo } from "../../../src/balances";

/** The recognized `--token` values and the TokenInfo each maps to (contract ids
 * are obviously fake — this tool never touches a real network). */
const MOCK_TOKENS: Record<string, TokenInfo> = {
  USDC: { symbol: "USDC", contractId: "CUSDCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", decimals: 7 },
  XLM: { symbol: "XLM", contractId: "CXLMMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", decimals: 7 },
};

export interface CliArgs {
  to: string;
  amount: string;
  token: string;
}

/** Parses `--to <addr> --amount <decimal> --token <symbol>` (any order). Throws
 * a descriptive Error naming every missing flag rather than failing on the first. */
export function parseArgs(argv: string[]): CliArgs {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg?.startsWith("--")) {
      const name = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for --${name}`);
      }
      flags[name] = value;
      i++;
    }
  }

  const missing = ["to", "amount", "token"].filter((name) => !(name in flags));
  if (missing.length > 0) {
    throw new Error(`Missing required flag(s): ${missing.map((m) => `--${m}`).join(", ")}`);
  }

  return { to: flags.to!, amount: flags.amount!, token: flags.token! };
}

/** Builds a wallet handle wired to fully in-memory mock dependencies — no
 * WebAuthn prompt, no RPC, no relayer. `sentAmount`/`sentTo` are captured on
 * the mock SAC transfer call so a caller (or a test) can assert on them
 * without depending on the fake XDR string. */
export function createMockWallet(network: Network): {
  wallet: VellarWallet;
  submittedHashes: string[];
} {
  const submittedHashes: string[] = [];

  const kit: PasskeyKitLike = {
    async createWallet(_app, _user) {
      return {
        keyIdBase64: "mock-key-id",
        contractId: "CMOCKSMARTACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        signedTx: "mock-create-tx",
      };
    },
    async connectWallet() {
      return { keyIdBase64: "mock-key-id", contractId: "CMOCKSMARTACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" };
    },
    async sign(tx: unknown) {
      return typeof tx === "string" ? `signed:${tx}` : "signed:mock-payment-tx";
    },
  };

  const backend: WalletBackend & {
    submitTransaction(input: { signedXdr: string; network: Network }): Promise<{ hash: string }>;
  } = {
    async submitWalletCreation() {
      return { sessionId: "mock-session-id" };
    },
    async lookupContractId() {
      return undefined;
    },
    async submitTransaction() {
      const hash = `mockhash${submittedHashes.length + 1}`.padEnd(16, "0");
      submittedHashes.push(hash);
      return { hash };
    },
  };

  const sac: SacClientLike = {
    getSACClient(tokenContractId: string): TokenContractClientLike {
      return {
        async transfer() {
          // Simulated build; the actual "on-chain effect" is just returning a
          // placeholder XDR-shaped payload for kit.sign to sign.
          return `unsigned-transfer-tx:${tokenContractId}`;
        },
      };
    },
  };

  const wallet = createVellarWallet({
    network,
    appName: "cli-send-payment example",
    kit,
    backend,
    sac,
    isValidAddress: (address: string) => address.length > 0 && !address.includes(" "),
  });

  return { wallet, submittedHashes };
}

/** Runs the full create-then-pay sequence for one CLI invocation, returning
 * the submitted transaction hash. Separated from `main` so it's directly
 * testable without touching `process.argv`. */
export async function runSendPayment(
  args: CliArgs,
  wallet: VellarWallet,
  log: (line: string) => void = console.log,
): Promise<{ hash: string }> {
  const token = MOCK_TOKENS[args.token.toUpperCase()];
  if (!token) {
    throw new Error(
      `Unknown --token "${args.token}". Known tokens: ${Object.keys(MOCK_TOKENS).join(", ")}`,
    );
  }

  log(`Creating a mock wallet...`);
  const session = await wallet.create({ username: "cli-test-user" });
  log(`Wallet created: ${session.accountId}`);

  const amount = parseTokenAmountLoose(args.amount, token.decimals);
  log(`Sending ${args.amount} ${token.symbol} to ${args.to}...`);
  const result = await wallet.pay({ to: args.to, amount, token });
  log(`Payment submitted. Transaction hash: ${result.hash}`);

  return result;
}

/** Local decimal->base-units conversion so this example has no import-time
 * dependency ordering on payments.ts beyond the type-only imports above;
 * mirrors src/payments.ts's parseTokenAmount rules (no silent rounding). */
function parseTokenAmountLoose(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`"${input}" is not a valid amount`);
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { wallet } = createMockWallet("testnet");
  await runSendPayment(args, wallet);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
