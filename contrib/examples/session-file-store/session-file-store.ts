// Example: save and load a wallet session to/from a local JSON file, for
// node-based tooling (a CLI, a headless agent) that needs to persist a
// session between runs without a real browser Storage API.
//
// Run with: npx tsx session-file-store.ts

import { readFile, writeFile } from "node:fs/promises";

export interface WalletSession {
  accountId: string;
  network: "testnet" | "mainnet";
  connected: boolean;
  authMethod: "passkey";
  createdAt: string;
  lastActiveAt: string;
}

/** Persists `session` as pretty-printed JSON at `filePath`. */
export async function saveSession(filePath: string, session: WalletSession): Promise<void> {
  await writeFile(filePath, JSON.stringify(session, null, 2), "utf8");
}

/** Loads a session from `filePath`. Returns null (rather than throwing) if
 * the file doesn't exist — a fresh CLI run with no prior saved session is a
 * normal case, not an error. */
export async function loadSession(filePath: string): Promise<WalletSession | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as WalletSession;
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function main() {
  const filePath = "/tmp/vellar-example-session.json";

  console.log("Load before save:", await loadSession(filePath));

  const sample: WalletSession = {
    accountId: "CABC123SAMPLEWALLETCONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXX",
    network: "testnet",
    connected: true,
    authMethod: "passkey",
    createdAt: "2026-01-15T09:30:00.000Z",
    lastActiveAt: "2026-01-15T09:30:00.000Z",
  };
  await saveSession(filePath, sample);
  console.log(`Saved session to ${filePath}`);

  console.log("Load after save: ", await loadSession(filePath));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
