import type { Network, WalletSession } from "./types";
import type { TokenInfo } from "./balances";
import {
  createPasskeyKitConnector,
  defaultSignedToXdr,
  type PasskeyKitLike,
  type WalletBackend,
} from "./passkeykit-connector";
import {
  createCircuitBreakingBackend,
  createCircuitBreaker,
  type CircuitBreaker,
  type CircuitBreakerOptions,
} from "./circuit-breaker";
import { createPaymentClient, type PaymentClient, type SacClientLike } from "./payments-client";
import type { WalletConnector } from "./connector";
import { createPolicyFacade, type PolicyAttachRuntime, type PolicyFacade } from "./policy-facade";
import { createAgentsFacade, type AgentKeyRuntime, type AgentsFacade } from "./agents-facade";
import { createX402Facade } from "./x402-facade";
import type { FetchLike } from "./x402-client";
import {
  assertValidX402RpcUrl,
  X402NotConfiguredError,
  type SmartAccountX402Signer,
  type X402Client,
} from "./x402-types";
import {
  createInMemoryBudgetAttributeTracker,
  type BudgetAttributeRule,
  type BudgetAttributeTracker,
} from "./x402-budget-attributes";

// ─────────────────────────────────────────────────────────────────────────────
// Vellar Wallet SDK — public client facade.
//
// This is the entry point third-party developers use. It composes the internal
// connector + payment client behind ONE object so callers never touch
// PasskeyKit, the backend seam, or the connector interface directly:
//
//   const vellar = createVellarWallet({ network, appName, backend, kit, sac });
//   const session = await vellar.connect();          // or vellar.create({ username })
//   await vellar.pay({ to, amount, token });
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
  /**
   * Gateway base URL for the policy API (`wallet.policies`). Required to use
   * policies; templates/generate are read-only, deploy is sponsor-funded.
   * Never inferred from the backend's URL — pass it explicitly.
   */
  apiUrl?: string;
  /**
   * Passkey-attach runtime for `wallet.policies.deploy` — wires
   * kit.addPolicy → passkey sign → backend submit. Without it, read/generate
   * still work but deploy() throws a clear error. (The web app supplies its
   * connector-factory runtime; a headless integrator supplies their own.)
   */
  policyAttach?: PolicyAttachRuntime;
  /**
   * Passkey-signed wallet-admin runtime for `wallet.agents` (mint/revoke scoped
   * agent session keys). Wire to kit.addEd25519 / kit.remove + kit.sign +
   * backend submit; without it `wallet.agents` calls throw a clear error.
   */
  agentKeys?: AgentKeyRuntime;
  /**
   * x402 config for `wallet.x402` (agentic payments, technical-doc.md §17).
   * Without it, `wallet.x402` throws a clear error. The `signer` is chosen by the
   * caller: `createSessionKeySigner` (agent/headless ed25519) or
   * `createPasskeyX402Signer` (human passkey). Its `address` must be this
   * wallet's C-address. `simulationSourceAccount` is a funded G-account used only
   * as the tx simulation source (never charged; the facilitator rebuilds + pays).
   */
  x402?: {
    signer: SmartAccountX402Signer;
    simulationSourceAccount: string;
    /** Override the RPC URL used for x402 simulation (defaults to the backend's). */
    rpcUrl?: string;
    fetchImpl?: FetchLike;
    expirationLedgerOffset?: number;
    /**
     * Attribute-based scoping for the session key's x402 budget (#225):
     * merchant, category, and time-window rules checked before a payment is
     * built or signed, on top of (never instead of) each call's `maxAmount`
     * and the on-chain spending-limit policy. See
     * ./x402-budget-attributes.ts for what this does and does not guarantee.
     */
    budgetAttributes?: readonly BudgetAttributeRule[];
    /** Running-spend accounting for `budgetAttributes` rules with a
     * `periodMaxAmount`. Defaults to an in-memory, process-lifetime tracker
     * when `budgetAttributes` includes one and no tracker is supplied. */
    budgetAttributeTracker?: BudgetAttributeTracker;
  };
  /** RPC URL for x402 simulation when `x402.rpcUrl` is not given. */
  rpcUrl?: string;
  /**
   * Circuit breaker for calls to the vellar-facilitator backend (create,
   * connect, and payment submission). Protects consumers from a downstream
   * outage turning every call into a slow failure. Omit for the defaults
   * (threshold 5, open 30s); pass `null` to disable the breaker entirely.
   */
  circuitBreaker?: CircuitBreakerOptions | null;
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
  /**
   * Programmable account policies (idea.md §6.2): list templates, generate the
   * deployable artifacts, simulate, and deploy — attaching a policy (e.g. a
   * spending limit) to this wallet with a single passkey signature. Requires
   * `apiUrl`; `deploy` additionally requires `policyAttach`.
   */
  readonly policies: PolicyFacade;
  /** Agent session keys: mint/revoke policy-limited signers ("give your agent
   * a budget, not your keys"). Requires `agentKeys` in the config. */
  readonly agents: AgentsFacade;
  /**
   * x402 agentic payments (technical-doc.md §17): fetch a resource, transparently
   * paying an HTTP-402 challenge from this smart account. The budget is enforced
   * on-chain by the spending-limit policy attached to the signing key — the
   * client-side `maxAmount` is only a per-request guard, not the budget. Requires
   * `x402` config; otherwise every call throws `X402NotConfiguredError`.
   */
  readonly x402: X402Client;
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

  // The backend carries every call the SDK makes to the vellar-facilitator
  // (deploy submission, reconnect lookup, payment submission). Funnel them
  // through a circuit breaker so a downstream outage fast-fails instead of
  // hanging every consumer call. `config.circuitBreaker === null` opts out; any
  // other value (or omission) uses the defaults or the supplied options.
  const breaker: CircuitBreaker | null =
    config.circuitBreaker === null
      ? null
      : createCircuitBreaker(config.circuitBreaker ?? {});
  const backend = breaker
    ? createCircuitBreakingBackend(config.backend, breaker)
    : config.backend;

  const connector = createPasskeyKitConnector({
    kit: config.kit,
    backend,
    network: config.network,
    appName: config.appName,
    signedToXdr,
  });

  const payments = createPaymentClient({
    kit: config.kit,
    sac: config.sac,
    backend,
    network: config.network,
    isValidAddress: config.isValidAddress,
    signedToXdr,
  });

  let session: WalletSession | null = null;

  // Validate at construction so a missing/malformed RPC URL fails here, next to
  // the config that caused it — not later inside wallet.x402.fetch(). (The
  // facade re-validates on every call via createX402Client, in case the config
  // object is mutated after construction.)
  const x402RpcUrl = config.x402 ? (config.x402.rpcUrl ?? config.rpcUrl) : undefined;
  if (config.x402) assertValidX402RpcUrl(x402RpcUrl);

  const x402 = createX402Facade({
    config: config.x402
      ? {
          rpcUrl: x402RpcUrl as string,
          network: config.network,
          simulationSourceAccount: config.x402.simulationSourceAccount,
          fetchImpl: config.x402.fetchImpl,
          expirationLedgerOffset: config.x402.expirationLedgerOffset,
          budgetAttributes: config.x402.budgetAttributes,
          budgetAttributeTracker:
            config.x402.budgetAttributeTracker ??
            (config.x402.budgetAttributes?.length
              ? createInMemoryBudgetAttributeTracker()
              : undefined),
        }
      : undefined,
    resolveSigner: () => {
      if (!config.x402) {
        throw new X402NotConfiguredError(
          "wallet.x402 requires `x402` config in createVellarWallet.",
        );
      }
      // The signer's address must be the connected wallet; if a session exists,
      // enforce it (a signer for a different wallet is a configuration error).
      if (session && config.x402.signer.address !== session.accountId) {
        throw new X402NotConfiguredError(
          `x402 signer address ${config.x402.signer.address} does not match the connected wallet ${session.accountId}.`,
        );
      }
      return config.x402.signer;
    },
  });

  const agents = createAgentsFacade({
    requireSession: () => {
      if (!session) {
        throw new WalletNotReadyError("Call create() or connect() before using agents");
      }
      return { accountId: session.accountId, keyId: session.keyId };
    },
    runtime: config.agentKeys,
  });

  const policies = createPolicyFacade({
    // Policies need a gateway; if apiUrl is omitted every policy call fails
    // loudly with a clear message rather than hitting an empty base URL.
    apiUrl: config.apiUrl ?? "",
    network: config.network,
    requireSession: () => {
      if (!session) {
        throw new WalletNotReadyError("Call create() or connect() before using policies");
      }
      return { accountId: session.accountId, keyId: session.keyId };
    },
    attach: config.policyAttach,
  });

  return {
    get session() {
      return session;
    },
    get agents(): AgentsFacade {
      return agents;
    },
    get policies() {
      if (!config.apiUrl) {
        throw new WalletNotReadyError(
          "wallet.policies requires `apiUrl` in createVellarWallet config (the policy API gateway).",
        );
      }
      return policies;
    },
    get x402() {
      return x402;
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
