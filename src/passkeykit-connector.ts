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
   * Opt-in single-use/TTL tracking for a caller-issued challenge (e.g. one
   * the backend minted for a step-up reauth before a sensitive
   * signTransaction call). When set, use the returned connector's
   * `verifyPasskeyChallenge(challenge)` to validate a challenge before/after
   * the passkey ceremony — see #230. Unset by default: this connector never
   * requires a challenge unless the caller opts in.
   */
  challengeTracker?: ChallengeTracker;
}

/**
 * The concrete connector `createPasskeyKitConnector` returns: the standard
 * `WalletConnector` interface, plus an extra method only available when
 * `challengeTracker` was configured. Kept off the shared `WalletConnector`
 * interface itself so other connector implementations aren't forced to grow
 * an unused method.
 */
export interface PasskeyKitConnector extends WalletConnector {
  /**
   * Validates and consumes `challenge` against the configured
   * `challengeTracker`. Throws `PasskeyAssertionReplayedError` if already
   * used, `PasskeyAssertionExpiredError` if past its TTL, or a plain `Error`
   * if `challengeTracker` was never configured or the challenge was never
   * registered.
   */
  verifyPasskeyChallenge(challenge: string): void;
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

/**
 * A passkey assertion's challenge is older than the tracker's TTL. Thrown by
 * `ChallengeTracker.consume` (see below) — distinct from
 * `PasskeyAssertionReplayedError` so callers can tell "the user took too
 * long" (ask them to retry) apart from "this exact assertion was already
 * used" (a genuine replay attempt, worth logging/alerting on).
 */
export class PasskeyAssertionExpiredError extends Error {
  constructor(
    public readonly challenge: string,
    public readonly issuedAt: Date,
    public readonly maxAgeMs: number,
  ) {
    super(
      `Passkey assertion challenge expired: issued at ${issuedAt.toISOString()}, ` +
        `max age ${maxAgeMs}ms`,
    );
    this.name = "PasskeyAssertionExpiredError";
  }
}

/**
 * A passkey assertion's challenge was already consumed once. Every challenge
 * is single-use: consuming it a second time — whether from a genuine replay
 * attempt or a caller accidentally re-submitting the same response — is
 * always rejected.
 */
export class PasskeyAssertionReplayedError extends Error {
  constructor(public readonly challenge: string) {
    super(`Passkey assertion challenge has already been used: ${challenge}`);
    this.name = "PasskeyAssertionReplayedError";
  }
}

/**
 * Tracks single-use passkey challenges issued to the client, so a signing
 * operation gated by `consume()` can distinguish a stale assertion (too old)
 * from a replayed one (already used) with a typed error for each — see
 * #230. Not itself a WebAuthn challenge generator: callers issue their own
 * random/opaque challenge string (e.g. one the backend minted) and register
 * it here before presenting it to the passkey ceremony.
 *
 * Entries are pruned lazily (on `register`/`consume`) rather than on a
 * timer, so this class has no background interval to clean up.
 */
export class ChallengeTracker {
  private readonly issuedAt = new Map<string, Date>();
  private readonly consumed = new Set<string>();
  private readonly maxAgeMs: number;
  private readonly now: () => Date;

  constructor(options: { maxAgeMs?: number; now?: () => Date } = {}) {
    this.maxAgeMs = options.maxAgeMs ?? 5 * 60 * 1000; // 5 minutes
    this.now = options.now ?? (() => new Date());
  }

  /** Registers a freshly-issued challenge, timestamped at the current time. */
  register(challenge: string): void {
    this.pruneExpired();
    this.issuedAt.set(challenge, this.now());
    this.consumed.delete(challenge);
  }

  /**
   * Validates and single-use-consumes `challenge`. Throws
   * `PasskeyAssertionReplayedError` if it was already consumed,
   * `PasskeyAssertionExpiredError` if it's older than `maxAgeMs`, or a plain
   * `Error` if it was never registered at all. Returns void on success.
   */
  consume(challenge: string): void {
    if (this.consumed.has(challenge)) {
      throw new PasskeyAssertionReplayedError(challenge);
    }
    const issuedAt = this.issuedAt.get(challenge);
    if (issuedAt === undefined) {
      throw new Error(`Unknown passkey assertion challenge: ${challenge}`);
    }
    const ageMs = this.now().getTime() - issuedAt.getTime();
    if (ageMs > this.maxAgeMs) {
      throw new PasskeyAssertionExpiredError(challenge, issuedAt, this.maxAgeMs);
    }
    this.consumed.add(challenge);
    this.issuedAt.delete(challenge);
  }

  /** Drops tracked challenges older than `maxAgeMs`, whether consumed or not. */
  private pruneExpired(): void {
    const cutoff = this.now().getTime() - this.maxAgeMs;
    for (const [challenge, issuedAt] of this.issuedAt) {
      if (issuedAt.getTime() < cutoff) {
        this.issuedAt.delete(challenge);
        this.consumed.delete(challenge);
      }
    }
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

export function createPasskeyKitConnector(options: PasskeyKitConnectorOptions): PasskeyKitConnector {
  const { kit, backend, network, appName, challengeTracker } = options;
  const now = options.now ?? (() => new Date());
  const signedToXdr = options.signedToXdr ?? defaultSignedToXdr;

  function assertNetwork(requested: Network): void {
    if (requested !== network) throw new WalletNetworkMismatchError(network, requested);
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
      return sessionFor(contractId, keyIdBase64, serverSessionId);
    },

    async signTransaction(input: SignTransactionInput): Promise<SignedTransaction> {
      assertNetwork(input.network);
      const signed = await kit.sign(input.xdr);
      return { signedXdr: signedToXdr(signed) };
    },

    verifyPasskeyChallenge(challenge: string): void {
      if (!challengeTracker) {
        throw new Error(
          "verifyPasskeyChallenge() called but no challengeTracker was configured on " +
            "createPasskeyKitConnector — pass { challengeTracker: new ChallengeTracker() } to use it.",
        );
      }
      challengeTracker.consume(challenge);
    },
  };
}
