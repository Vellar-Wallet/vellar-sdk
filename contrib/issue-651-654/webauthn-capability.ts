import type { WalletConnector } from "../../src/connector";
import { PasskeyBrowserRequiredError } from "../../src/passkeykit-connector";

// Capability pre-check for passkey ceremonies (#651). Core already refuses a
// ceremony when navigator.credentials is missing (PasskeyBrowserRequiredError);
// this adds a caller-facing check and an error that tells the caller to check
// capability before attempting create or connect.

interface WebAuthnGlobals {
  window?: unknown;
  navigator?: { credentials?: unknown };
}

/** True when this environment can run a WebAuthn ceremony (window + navigator.credentials). */
export function isWebAuthnAvailable(env: WebAuthnGlobals = globalThis as WebAuthnGlobals): boolean {
  return env.window !== undefined && !!env.navigator?.credentials;
}

/** Capability error for environments without navigator.credentials (embedded webviews, older browsers). */
export class WebAuthnUnavailableError extends PasskeyBrowserRequiredError {
  constructor(operation: string) {
    super(operation);
    this.name = "WebAuthnUnavailableError";
    this.message =
      `${operation} needs WebAuthn, but navigator.credentials is unavailable here ` +
      "(embedded webview, older browser, or non-browser runtime). Check " +
      "isWebAuthnAvailable() before calling create or connect, and hide or replace " +
      "the passkey UI when it returns false.";
  }
}

/**
 * Wraps a connector so createWallet/connectWallet fail up front with
 * WebAuthnUnavailableError, before any passkey-kit call, rather than a raw
 * TypeError from deep inside the kit. `env` is injectable for tests.
 */
export function withWebAuthnCapabilityCheck(
  connector: WalletConnector,
  env?: WebAuthnGlobals,
): WalletConnector {
  const check = (operation: string) => {
    if (!isWebAuthnAvailable(env ?? (globalThis as WebAuthnGlobals))) {
      throw new WebAuthnUnavailableError(operation);
    }
  };
  return {
    ...connector,
    async createWallet(input) {
      check("createWallet()");
      return connector.createWallet(input);
    },
    async connectWallet(network) {
      check("connectWallet()");
      return connector.connectWallet(network);
    },
    signTransaction: (input) => connector.signTransaction(input),
  };
}
