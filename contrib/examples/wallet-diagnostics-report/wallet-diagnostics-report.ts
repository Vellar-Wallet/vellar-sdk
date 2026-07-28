// Example: runs a handful of mock diagnostic checks against a wallet
// handle — session validity, network match, and backend reachability — and
// prints a combined report that clearly separates passing checks from
// failing ones, with a reason for each failure.
//
// Run with: npx tsx wallet-diagnostics-report.ts

import { createVellarWallet, type VellarWallet } from "../../../src/client";
import type { PasskeyKitLike, WalletBackend } from "../../../src/passkeykit-connector";
import type { SacClientLike } from "../../../src/payments-client";
import type { Network } from "../../../src/types";

export interface DiagnosticCheck {
  name: string;
  passed: boolean;
  /** Present only when passed is false. */
  reason?: string;
}

export interface DiagnosticsReport {
  checks: DiagnosticCheck[];
  allPassed: boolean;
}

export interface DiagnosticsDeps {
  wallet: VellarWallet;
  expectedNetwork: Network;
  pingBackend: () => Promise<boolean>;
}

function checkSessionExists(wallet: VellarWallet): DiagnosticCheck {
  if (!wallet.session) {
    return { name: "Session exists", passed: false, reason: "No active session — call create() or connect() first" };
  }
  return { name: "Session exists", passed: true };
}

function checkSessionConnected(wallet: VellarWallet): DiagnosticCheck {
  if (!wallet.session?.connected) {
    return { name: "Session connected", passed: false, reason: "Session exists but is not marked connected" };
  }
  return { name: "Session connected", passed: true };
}

function checkNetworkMatches(wallet: VellarWallet, expected: Network): DiagnosticCheck {
  if (!wallet.session) {
    return { name: "Network matches expected", passed: false, reason: "No session to check the network against" };
  }
  if (wallet.session.network !== expected) {
    return {
      name: "Network matches expected",
      passed: false,
      reason: `Session is on "${wallet.session.network}", expected "${expected}"`,
    };
  }
  return { name: "Network matches expected", passed: true };
}

async function checkBackendReachable(pingBackend: () => Promise<boolean>): Promise<DiagnosticCheck> {
  try {
    const ok = await pingBackend();
    if (!ok) return { name: "Backend reachable", passed: false, reason: "Backend ping returned false" };
    return { name: "Backend reachable", passed: true };
  } catch (err) {
    return { name: "Backend reachable", passed: false, reason: `Backend ping threw: ${(err as Error).message}` };
  }
}

/** Runs every diagnostic check (at least four) and returns a combined report. */
export async function runDiagnostics(deps: DiagnosticsDeps): Promise<DiagnosticsReport> {
  const checks = [
    checkSessionExists(deps.wallet),
    checkSessionConnected(deps.wallet),
    checkNetworkMatches(deps.wallet, deps.expectedNetwork),
    await checkBackendReachable(deps.pingBackend),
  ];
  return { checks, allPassed: checks.every((c) => c.passed) };
}

/** Renders a DiagnosticsReport as readable text, passing checks first, then
 * a separate failing section listing each one's reason. */
export function formatReport(report: DiagnosticsReport): string {
  const passing = report.checks.filter((c) => c.passed);
  const failing = report.checks.filter((c) => !c.passed);

  const lines: string[] = [`Diagnostics: ${passing.length}/${report.checks.length} passed`, ""];
  lines.push("Passing:");
  for (const c of passing) lines.push(`  ✓ ${c.name}`);
  if (failing.length > 0) {
    lines.push("");
    lines.push("Failing:");
    for (const c of failing) lines.push(`  ✗ ${c.name} — ${c.reason}`);
  }
  return lines.join("\n");
}

export function createMockWallet(network: Network): VellarWallet {
  const kit: PasskeyKitLike = {
    async createWallet() {
      return { keyIdBase64: "mock-key-id", contractId: "CMOCKACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", signedTx: "mock-tx" };
    },
    async connectWallet() {
      return { keyIdBase64: "mock-key-id", contractId: "CMOCKACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" };
    },
    async sign(tx) {
      return typeof tx === "string" ? `signed:${tx}` : "signed:mock";
    },
  };
  const backend: WalletBackend & { submitTransaction: (i: { signedXdr: string; network: Network }) => Promise<{ hash: string }> } = {
    async submitWalletCreation() {
      return { sessionId: "mock-session" };
    },
    async lookupContractId() {
      return undefined;
    },
    async submitTransaction() {
      return { hash: "mockhash" };
    },
  };
  const sac: SacClientLike = {
    getSACClient() {
      return { async transfer() { return "unsigned-tx"; } };
    },
  };

  return createVellarWallet({ network, appName: "diagnostics demo", kit, backend, sac, isValidAddress: () => true });
}

async function main() {
  const wallet = createMockWallet("testnet");

  console.log("Report before connecting (session checks should fail):\n");
  const before = await runDiagnostics({
    wallet,
    expectedNetwork: "testnet",
    pingBackend: async () => true,
  });
  console.log(formatReport(before));

  await wallet.create({ username: "demo-user" });

  console.log("\n\nReport after connecting (everything should pass):\n");
  const after = await runDiagnostics({
    wallet,
    expectedNetwork: "testnet",
    pingBackend: async () => true,
  });
  console.log(formatReport(after));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
