import type { Network, WalletSession } from "./types";
import type { TokenInfo } from "./balances";
import {
  createPasskeyKitConnector,
  defaultSignedToXdr,
  type PasskeyKitLike,
  type WalletBackend,
} from "./passkeykit-connector";
import { createPaymentClient, type PaymentClient, type SacClientLike } from "./payments-client";
import type { WalletConnector } from "./connector";

// ─────────────────────────────────────────────────────────────────────────────
// Vellar Wallet SDK — public client facade.
//
// This is the entry point third-party developers use. It composes the internal
// connector + payment client behind ONE object so callers never touch
// PasskeyKit, the backend seam, or the connector interface directly:
//
//   const vela = createVellarWallet({ network, appName, backend, kit, sac });
//   const session = await vela.connect();          // or vela.create({ username })
//   await vela.pay({ to, amount, token });
//
// The lower-level building blocks remain exported from the package for advanced
// integrators who want to swap pieces; this facade is the paved road.
// ─────────────────────────────────────────────────────────────────────────────

export interface VellarWalletConfig {
  /** Which Stellar network this client operates on. */
  network: Network;
  /** Display name shown in the platform passkey prompt (WebAuthn RP name). */
  appName: string;
  /**
   * The passkey smart-wallet engine (a `PasskeyKit` instance). Supplied by the
   * host so the SDK stays free of a hard dependency on a specific version and so
   * browser-only code is never imported during SSR.
   */
  kit: PasskeyKitLike;
  /**
   * The backend the SDK talks to for submission and keyId→contractId lookup.
   * The relayer/sponsor keys live server-side, so all submission round-trips
   * through here — the SDK never holds secrets.
   */
  backend: WalletBackend & {
    submitTransaction(input: { signedXdr: string; network: Network }): Promise<{ hash: string }>;
  };
  /** Soroban token client factory, used for payments (a `SACClient`). */
  sac: SacClientLike;
  /** Validates a Stellar address before a payment is ever signed. */
  isValidAddress: (address: string) => boolean;
  /** Test/advanced hook: convert the kit's signed output to XDR. */
  signedToXdr?: (signed: unknown) => string;
}

export interface PayInput {
  /** Recipient — a Stellar account or contract address. */
  to: string;
  /** Amount in the token's base units (bigint, decimals-aware via the token). */
  amount: bigint;
  /** The token to send (contract id + decimals). */
  token: TokenInfo;
}

/**
 * The public wallet handle. One per connected user. Methods map to the four
 * things an app needs: bring a wallet into existence, restore it, send value,
 * and read the current session.
 */
export interface VellarWallet {
  /** The current session, or null before create/connect. */
  readonly session: WalletSession | null;
  /** Register a passkey and create the smart account. Prompts WebAuthn. */
  create(input?: { username?: string }): Promise<WalletSession>;
  /** Reconnect with an existing passkey. Prompts WebAuthn (or resumes silently
   * if the host wired keyId resumption into `kit`). */
  connect(): Promise<WalletSession>;
  /**
   * Send a payment: builds + simulates, then signs with the passkey and submits.
   * Simulation happens inside `prepare`, so failures surface before the passkey
   * prompt. Returns the network transaction hash.
   *
   * Signing is ALWAYS explicit — this resolves only after the user approves the
   * WebAuthn prompt. There is no silent-signing path.
   */
  pay(input: PayInput): Promise<{ hash: string }>;
  /** Lower-level: the composed connector, for flows beyond the paved road. */
  readonly connector: WalletConnector;
  /** Lower-level: the composed payment client. */
  readonly payments: PaymentClient;
}

/**
 * Create a Vellar wallet client. This is the single public entry point.
 */
export function createVellarWallet(config: VellarWalletConfig): VellarWallet {
  const signedToXdr = config.signedToXdr ?? defaultSignedToXdr;

  const connector = createPasskeyKitConnector({
    kit: config.kit,
    backend: config.backend,
    network: config.network,
    appName: config.appName,
    signedToXdr,
  });

  const payments = createPaymentClient({
    kit: config.kit,
    sac: config.sac,
    backend: config.backend,
    network: config.network,
    isValidAddress: config.isValidAddress,
    signedToXdr,
  });

  let session: WalletSession | null = null;

  return {
    get session() {
      return session;
    },
    get connector() {
      return connector;
    },
    get payments() {
      return payments;
    },

    async create(input) {
      session = await connector.createWallet({
        network: config.network,
        username: input?.username,
      });
      return session;
    },

    async connect() {
      session = await connector.connectWallet(config.network);
      return session;
    },

    async pay({ to, amount, token }) {
      if (!session) {
        throw new WalletNotReadyError("Call create() or connect() before pay()");
      }
      const prepared = await payments.preparePayment({
        from: session.accountId,
        to,
        token,
        amount,
      });
      return prepared.confirm();
    },
  };
}

export class WalletNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletNotReadyError";
  }
}
