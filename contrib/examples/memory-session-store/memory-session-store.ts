// Example: a minimal in-memory store for a wallet session, with getSession
// and setSession operating on a module-level variable.
//
// NOTE: for examples and tests only — not production. A real app persists
// sessions with createWebStorageAdapter (or similar) from vellar-sdk's
// src/session.ts, not a plain module variable, which is lost on reload and
// shared across everything that imports this module.
//
// Run with: npx tsx memory-session-store.ts

export interface WalletSession {
  accountId: string;
  network: "testnet" | "mainnet";
  connected: boolean;
  authMethod: "passkey";
  createdAt: string;
  lastActiveAt: string;
}

let currentSession: WalletSession | null = null;

export function setSession(session: WalletSession): void {
  currentSession = session;
}

export function getSession(): WalletSession | null {
  return currentSession;
}

function main() {
  console.log("Before setSession:", getSession());

  setSession({
    accountId: "CABC123SAMPLEWALLETCONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXX",
    network: "testnet",
    connected: true,
    authMethod: "passkey",
    createdAt: "2026-01-15T09:30:00.000Z",
    lastActiveAt: "2026-01-15T09:30:00.000Z",
  });

  console.log("After setSession: ", getSession());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
