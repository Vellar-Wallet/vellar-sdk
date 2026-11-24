// Fresh throwaway CHANNEL_ACCOUNT_SECRET_KEYS fixture generator (#870).
//
// Prints exactly 50 newly generated Stellar classic secrets in the comma
// separated format consumed by a local facilitator. Nothing is written to disk
// unless --out is passed, and no fixture file is committed to this repository.
// Every invocation generates new keys, so a key used in one local run is never
// reused by the generator on a later run.
//
//   node channel-account-keys.mjs
//   node channel-account-keys.mjs --out /tmp/local-facilitator-keys.txt

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";

export const CHANNEL_ACCOUNT_COUNT = 50;

/** Generate a fresh, comma separated CHANNEL_ACCOUNT_SECRET_KEYS value.
 * Throws unless asked for exactly the documented count, so a typo cannot
 * silently produce a value the facilitator will reject at startup. */
export function generateChannelAccountSecrets(
  count = CHANNEL_ACCOUNT_COUNT,
) {
  if (count !== CHANNEL_ACCOUNT_COUNT) {
    throw new Error(
      `CHANNEL_ACCOUNT_SECRET_KEYS requires exactly ${CHANNEL_ACCOUNT_COUNT} keys, got ${count}`,
    );
  }
  return Array.from({ length: count }, () => Keypair.random().secret()).join(",");
}

function main() {
  const args = process.argv.slice(2);
  let outPath;
  if (args.length > 0) {
    if (args.length !== 2 || args[0] !== "--out" || !args[1]) {
      throw new Error("usage: node channel-account-keys.mjs [--out <path>]");
    }
    outPath = args[1];
  }

  const value = generateChannelAccountSecrets();
  if (!outPath) {
    process.stdout.write(`${value}\n`);
    return;
  }

  // "wx" refuses to overwrite an existing file (which might hold keys that
  // were actually funded during a previous run). Mode 0600 keeps it private.
  writeFileSync(outPath, `${value}\n`, { mode: 0o600, flag: "wx", encoding: "utf8" });
  process.stderr.write(
    `Wrote ${CHANNEL_ACCOUNT_COUNT} throwaway secrets to ${outPath} (mode 0600).\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
