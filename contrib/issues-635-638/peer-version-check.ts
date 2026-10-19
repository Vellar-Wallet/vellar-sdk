// Runtime peer-version warning for @stellar/stellar-sdk (#637).
//
// npm only warns about a mismatched peer at install time. This check runs at
// SDK initialization and logs an actionable warning if the resolved
// @stellar/stellar-sdk is outside the declared peer range. It never throws —
// the SDK should still attempt to function.
//
// Current @stellar/stellar-sdk releases do not export a `version` constant, so
// `readStellarSdkVersion` reads a `version` export when present and returns
// null otherwise (the check then stays silent). Hosts that can resolve the
// package.json themselves pass `readVersion`. Core integration should wire one.

import * as stellarSdk from "@stellar/stellar-sdk";
import { satisfies } from "./semver-range.mjs";

export const STELLAR_SDK_PEER_RANGE = "^16.0.0";

export interface PeerVersionCheckResult {
  ok: boolean;
  installed: string | null;
  range: string;
  message?: string;
}

export interface PeerVersionCheckOptions {
  range?: string;
  readVersion?: () => string | null;
  warn?: (message: string) => void;
}

export function readStellarSdkVersion(): string | null {
  const exported = (stellarSdk as { version?: unknown }).version;
  if (typeof exported === "string") return exported;
  return null;
}

export function checkStellarSdkPeerVersion(
  options: PeerVersionCheckOptions = {},
): PeerVersionCheckResult {
  const range = options.range ?? STELLAR_SDK_PEER_RANGE;
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const installed = (options.readVersion ?? readStellarSdkVersion)();

  // Unknown version: nothing actionable to say, and a false alarm is worse.
  if (installed === null) return { ok: true, installed, range };

  if (satisfies(installed, range)) return { ok: true, installed, range };

  const message =
    `[vellar-sdk] @stellar/stellar-sdk ${installed} is outside the supported peer range ` +
    `"${range}". The SDK will still try to run, but behaviour is untested on this version. ` +
    `Install a supported version, e.g. \`npm install @stellar/stellar-sdk@"${range}"\`.`;
  warn(message);
  return { ok: false, installed, range, message };
}
