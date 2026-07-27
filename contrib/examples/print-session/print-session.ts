// Example: pretty-print a WalletSession's fields to the console with clear
// labels. Uses a hardcoded sample session (see the WalletSession shape from
// vellar-sdk's src/types.ts).
//
// Run with: npx tsx print-session.ts

export interface WalletSession {
  accountId: string;
  network: "testnet" | "mainnet";
  connected: boolean;
  authMethod: "passkey";
  createdAt: string;
  lastActiveAt: string;
  serverSessionId?: string;
  keyId?: string;
}

const sampleSession: WalletSession = {
  accountId: "CABC123SAMPLEWALLETCONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXX",
  network: "testnet",
  connected: true,
  authMethod: "passkey",
  createdAt: "2026-01-15T09:30:00.000Z",
  lastActiveAt: "2026-01-15T10:12:45.000Z",
  serverSessionId: "sess_7f3a9c2e",
  keyId: "keyid-abc123base64url",
};

export function printSession(session: WalletSession): void {
  console.log("Wallet session");
  console.log("  Account ID:        ", session.accountId);
  console.log("  Network:           ", session.network);
  console.log("  Connected:         ", session.connected);
  console.log("  Auth method:       ", session.authMethod);
  console.log("  Created at:        ", session.createdAt);
  console.log("  Last active at:    ", session.lastActiveAt);
  console.log("  Server session ID: ", session.serverSessionId ?? "(none)");
  console.log("  Key ID:            ", session.keyId ?? "(none)");
}

// Only run when executed directly (not when imported by the test file).
if (import.meta.url === `file://${process.argv[1]}`) {
  printSession(sampleSession);
}
