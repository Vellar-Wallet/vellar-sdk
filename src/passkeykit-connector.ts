import type { CreateWalletInput, Network, SignTransactionInput, WalletSession } from "./types";
import type { SignedTransaction, WalletConnector } from "./connector";

// PasskeyKit-backed WalletConnector (docs/decisions.md 2026-07-16, option 1A).
// Structural subset of passkey-kit v0.13 so this package stays free of the
// real dependency; apps/web instantiates the real PasskeyKit and passes it in.

export interface PasskeyKitLike {
  createWallet(
    app: string,
    user: string,
  ): Promise<{ keyIdBase64: string; contractId: string; signedTx: unknown }>;
  connectWallet(opts?: {
    /** Connect a specific credential, skipping the WebAuthn discovery ceremony. */
    keyId?: string;
    getContractId?: (keyId: string) => Promise<string | undefined>;
  }): Promise<{ keyIdBase64: string; contractId: string }>;
  sign(tx: unknown): Promise<unknown>;
  /** The connected wallet client, if any (set by createWallet/connectWallet). */
  readonly wallet?: unknown;
}

/**
 * Re-attaches a fresh PasskeyKit instance (e.g. after a page reload) to the
 * session's wallet without prompting: connectWallet({ keyId }) skips the
 * discovery ceremony and verifies the key is still a signer on the wallet.
 * No-op when the kit is already connected. Signer operations (kit.sign) throw
 * WalletNotConnectedError without this.
 */
export async function resumeKitConnection(
  kit: Pick<PasskeyKitLike, "connectWallet" | "wallet">,
  keyId: string,
): Promise<void> {
  if (kit.wallet) return;
  await kit.connectWallet({ keyId });
}

// Backend seam (idea.md §11 Wallet API). The relayer API key lives server-side
// only, so deployment/submission always round-trips through our backend.
export interface WalletBackend {
  /** POST /wallet/create — submit the deployment tx and persist the keyId→contractId mapping. */
  submitWalletCreation(input: {
    keyId: string;
    contractId: string;
    network: Network;
    signedTx: unknown;
  }): Promise<{ sessionId: string }>;
  /** POST /wallet/connect — reverse lookup for reconnect flows; opens a server session record. */
  lookupContractId(input: {
    keyId: string;
    network: Network;
  }): Promise<{ contractId: string; sessionId: string } | undefined>;
}

/**
 * Rotates the agent session key bound to a wallet on re-authentication (#223).
 * Optional: a connector built without this still works, it just never rotates
 * — the previous session key (if any) stays valid until it expires or is
 * revoked some other way (e.g. `wallet.agents.revoke`).
 *
 * Wire this to the same passkey-signed admin plumbing `wallet.agents` uses
 * (mint a fresh ed25519 signer, revoke the old one) — rotation is itself an
 * admin action on the wallet, so it goes through the same seam as
 * `AgentKeyRuntime` in agents-facade.ts, not a new one.
 */
export interface SessionKeyRotationRuntime {
  /** Mint a new session key scoped the same way the previous one was (or a
   * host-chosen default when there was none), returning its public key. */
  mint(): Promise<{ publicKey: string }>;
  /** Revoke a previously-issued session key. Best-effort from the caller's
   * side: connectWallet still returns the fresh session even if this throws,
   * so a re-auth is never blocked by a stale key failing to revoke (that
   * failure is surfaced to `onDebugLog`, not swallowed silently). */
  revoke(publicKey: string): Promise<void>;
}

export interface PasskeyKitConnectorOptions {
  kit: PasskeyKitLike;
  backend: WalletBackend;
  network: Network;
  /** Shown in the platform passkey prompt (WebAuthn RP display name). */
  appName: string;
  now?: () => Date;
  /** Converts kit.sign output to XDR. Default handles strings and objects with toXDR(). */
  signedToXdr?: (signed: unknown) => string;
  /**
   * When set, `connectWallet` rotates the wallet's agent session key on every
   * successful re-authentication (#223): mints a fresh key, then revokes
   * whichever key was previously active for this wallet (tracked in-memory,
   * per connector instance — nothing to configure). Omit for no rotation.
   */
  sessionKeyRotation?: SessionKeyRotationRuntime;
  /** Debug-log sink for rotation events (and their failures). Defaults to a
   * no-op — this SDK does not assume a logging library. */
  onDebugLog?: (event: string, details: Record<string, unknown>) => void;
}

export function defaultSignedToXdr(signed: unknown): string {
  if (typeof signed === "string") return signed;
  if (
    typeof signed === "object" &&
    signed !== null &&
    "toXDR" in signed &&
    typeof (signed as { toXDR: unknown }).toXDR === "function"
  ) {
    return (signed as { toXDR: () => string }).toXDR();
  }
  throw new TypeError("Cannot convert signed transaction to XDR");
}

export class WalletNetworkMismatchError extends Error {
  constructor(expected: Network, actual: Network) {
    super(`Connector is configured for ${expected} but was asked to operate on ${actual}`);
    this.name = "WalletNetworkMismatchError";
  }
}

/** A passkey (WebAuthn) ceremony was attempted outside a browser. */
export class PasskeyBrowserRequiredError extends Error {
  constructor(operation: string) {
    super(
      `${operation} runs a passkey (WebAuthn) ceremony, which needs a browser — this ` +
        "environment has no WebAuthn credentials API (typical for a Node script or SSR). " +
        "For headless, CLI, or agent flows: mint an agent session key from a browser " +
        "session (wallet.agents.mint), then sign with createSessionKeySigner and pay " +
        "via wallet.x402.",
    );
    this.name = "PasskeyBrowserRequiredError";
  }
}

/**
 * Passkey ceremonies die deep inside the kit with a raw WebAuthnError when run
 * outside a browser; this guard fails first, with the actionable message.
 * Checked per ceremony (not at construction) so SSR apps can still construct
 * the client on the server and only ceremony calls demand the browser.
 */
function assertBrowserWebAuthnContext(operation: string): void {
  const g = globalThis as { window?: unknown; navigator?: { credentials?: unknown } };
  if (g.window === undefined || !g.navigator?.credentials) {
    throw new PasskeyBrowserRequiredError(operation);
  }
}

export function createPasskeyKitConnector(options: PasskeyKitConnectorOptions): WalletConnector {
  const { kit, backend, network, appName } = options;
  const now = options.now ?? (() => new Date());
  const signedToXdr = options.signedToXdr ?? defaultSignedToXdr;
  const onDebugLog = options.onDebugLog ?? (() => {});

  // Tracks the session key most recently minted for THIS wallet by rotation,
  // so the next re-auth knows what to revoke. In-memory and per connector
  // instance: a fresh page load has nothing to revoke against (the previous
  // key, if any, is still discoverable/revocable via wallet.agents.revoke),
  // which is the same "best-effort, chain is the source of truth" posture as
  // the rest of this module's session bookkeeping.
  let activeSessionKeyPublicKey: string | undefined;

  function assertNetwork(requested: Network): void {
    if (requested !== network) throw new WalletNetworkMismatchError(network, requested);
  }

  /**
   * Issue a fresh session key and revoke whatever key rotation last minted
   * for this wallet, in that order — mint-then-revoke so a revoke failure
   * never leaves the wallet with NO valid session key. Never throws: a
   * rotation failure is logged, not surfaced, so it can't block re-auth
   * itself (the old key, if revoke failed, simply stays valid until the next
   * successful rotation or an explicit `wallet.agents.revoke`).
   */
  async function rotateSessionKey(rotation: SessionKeyRotationRuntime): Promise<void> {
    const previousPublicKey = activeSessionKeyPublicKey;
    let minted: { publicKey: string };
    try {
      minted = await rotation.mint();
    } catch (err) {
      onDebugLog("session-key-rotation-mint-failed", {
        previousPublicKey,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    activeSessionKeyPublicKey = minted.publicKey;
    onDebugLog("session-key-rotated", {
      previousPublicKey,
      newPublicKey: minted.publicKey,
    });

    if (!previousPublicKey) return; // nothing to invalidate yet
    try {
      await rotation.revoke(previousPublicKey);
      onDebugLog("session-key-revoked", { publicKey: previousPublicKey });
    } catch (err) {
      onDebugLog("session-key-revoke-failed", {
        publicKey: previousPublicKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function sessionFor(
    contractId: string,
    keyId: string | undefined,
    serverSessionId: string | undefined,
  ): WalletSession {
    const timestamp = now().toISOString();
    return {
      accountId: contractId,
      network,
      connected: true,
      authMethod: "passkey",
      createdAt: timestamp,
      lastActiveAt: timestamp,
      ...(keyId !== undefined && { keyId }),
      ...(serverSessionId !== undefined && { serverSessionId }),
    };
  }

  return {
    async createWallet(input: CreateWalletInput): Promise<WalletSession> {
      assertBrowserWebAuthnContext("createWallet() (vellar.create())");
      assertNetwork(input.network);
      const username = input.username?.trim() || "Vellar user";
      const { keyIdBase64, contractId, signedTx } = await kit.createWallet(appName, username);
      // Backend submission must succeed before we report a wallet as created —
      // otherwise the user would hold a session for an undeployed account.
      const { sessionId } = await backend.submitWalletCreation({
        keyId: keyIdBase64,
        contractId,
        network,
        signedTx,
      });
      return sessionFor(contractId, keyIdBase64, sessionId);
    },

    async connectWallet(requested: Network): Promise<WalletSession> {
      assertBrowserWebAuthnContext("connectWallet() (vellar.connect())");
      assertNetwork(requested);
      // The lookup that resolves the wallet also opens the server session
      // record; capture its id for device management.
      let serverSessionId: string | undefined;
      const { contractId, keyIdBase64 } = await kit.connectWallet({
        getContractId: async (keyId) => {
          const found = await backend.lookupContractId({ keyId, network });
          serverSessionId = found?.sessionId;
          return found?.contractId;
        },
      });
      if (options.sessionKeyRotation) await rotateSessionKey(options.sessionKeyRotation);
      return sessionFor(contractId, keyIdBase64, serverSessionId);
    },

    async signTransaction(input: SignTransactionInput): Promise<SignedTransaction> {
      assertNetwork(input.network);
      const signed = await kit.sign(input.xdr);
      return { signedXdr: signedToXdr(signed) };
    },
  };
}
