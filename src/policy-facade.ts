import type { Network, PolicyDefinition } from "./types";
import { createPolicyClient, type CacheInvalidationEvent, type PolicyClient } from "./policy-client";
import type {
  DeployPolicyResult,
  GeneratedPolicy,
  PolicyTemplateInfo,
  SimulateResult,
} from "./policy-types";

// The policy surface on the wallet handle (vellar.policies). Read/prepare go
// through the HTTP client; deploy() is the headline — it runs the full
// passkey-signed attach the dapp does:
//   1. deploy the per-user policy contract instance (server-side, sponsor-funded)
//   2. passkey-sign kit.addPolicy to attach it  ← the ONLY passkey prompt
//   3. record the completed attach
// No silent signing; the backend is required for simulate/deploy (sponsor keys
// live server-side), so those fail loudly when unconfigured.
//
// Per-wallet ordering (#242): each of deploy()'s three steps touches shared
// on-chain wallet state (the instance deploy consumes a sponsor-side slot;
// the passkey attach reads/advances the wallet's own signer set). Two deploy()
// calls for the SAME wallet running concurrently — e.g. attaching several
// policies back-to-back, or a caller firing deployBatch() items without
// awaiting each — can interleave their steps and land in an inconsistent
// order (e.g. wallet B's attach lands before wallet A's, even though A was
// requested first). Every deploy() (including each item of deployBatch())
// is therefore run through a per-accountId sequential queue: operations for
// the SAME wallet always complete in the order they were called, one at a
// time; operations for DIFFERENT wallets are unaffected and run concurrently.

/** The passkey-attach capability the deploy step needs. The host wires this to
 * `kit.addPolicy(contractId) → kit.sign(tx) → backend.submitTransaction(...)`;
 * kept as a narrow seam so the core kit type doesn't have to grow addPolicy and
 * so it's trivially mockable in tests. */
export interface PolicyAttachRuntime {
  /** Resume the connected passkey for a keyId without prompting, when possible. */
  resume?(keyId: string): Promise<void>;
  /** Build kit.addPolicy(contractId), passkey-sign it, submit it. Returns the
   * on-chain tx hash. This is where the WebAuthn prompt happens. */
  attachPolicy(policyContractId: string): Promise<{ hash: string }>;
}

/**
 * Fired when a queued per-wallet operation is detected running out of
 * sequence (#242) — i.e. the queue itself misbehaved, or something bypassed
 * it. Should never fire under normal operation; it exists as a defense-in-
 * depth signal, not an expected event. Purely observational, matching
 * `CacheInvalidationEvent`'s injectable-callback shape (see policy-client.ts)
 * rather than a hardcoded `console.debug` call.
 */
export interface OutOfOrderOperationEvent {
  accountId: string;
  /** The sequence number assigned when this operation was enqueued. */
  sequence: number;
  /** The highest sequence number already completed for this wallet at the
   * time this one started running — expected to be exactly `sequence - 1`. */
  lastCompletedSequence: number;
  at: string;
}

export interface PolicyFacade {
  listTemplates(): Promise<PolicyTemplateInfo[]>;
  /** Invalidate the cached template listing and re-fetch. See `PolicyClient.refreshTemplates`. */
  refreshTemplates(): Promise<PolicyTemplateInfo[]>;
  /** Validate + generate the deployable artifacts for a definition. */
  generate(definition: PolicyDefinition): Promise<GeneratedPolicy>;
  /** Dry-run the on-chain deploy for the connected wallet (no submit). */
  simulate(policyId: string): Promise<SimulateResult>;
  /**
   * Attach a generated policy to the connected wallet (passkey-signed).
   * Queued per-wallet (#242): concurrent `deploy()` calls for the SAME
   * wallet complete in call order, one at a time. Calls for different
   * wallets are unaffected.
   */
  deploy(policyId: string): Promise<DeployPolicyResult>;
  /**
   * Deploy several policies for the connected wallet, guaranteed to run
   * STRICTLY in the given order — each `deploy()` fully completes before the
   * next starts. Equivalent to `for (const id of policyIds) await deploy(id)`
   * plus the shared per-wallet queue's ordering guarantee against any other
   * concurrent `deploy()`/`deployBatch()` call for the same wallet.
   *
   * Fails fast: if any item throws, the remaining items are NOT attempted —
   * returns the successfully deployed results up to (not including) the
   * failure, via the thrown `BatchDeployError`, so a caller can see what
   * actually landed on-chain before the failure.
   */
  deployBatch(policyIds: string[]): Promise<DeployPolicyResult[]>;
  /** The lower-level HTTP client, for custom flows. */
  readonly client: PolicyClient;
}

export interface PolicyFacadeDeps {
  apiUrl: string;
  network: Network;
  /** Returns the connected wallet's account id + keyId, or throws if not ready. */
  requireSession(): { accountId: string; keyId?: string };
  /** The passkey-attach runtime (undefined ⇒ deploy() throws a clear error). */
  attach?: PolicyAttachRuntime;
  fetch?: typeof fetch;
  /** Forwarded to `createPolicyClient` — see `PolicyClientOptions.onCacheInvalidated`. */
  onCacheInvalidated?: (event: CacheInvalidationEvent) => void;
  /** Called if the per-wallet operation queue ever detects out-of-order
   * execution (#242) — see {@link OutOfOrderOperationEvent}. Should never
   * fire in practice. */
  onOutOfOrderOperation?: (event: OutOfOrderOperationEvent) => void;
  /** Injected clock (tests only); defaults to `() => new Date()`. */
  now?: () => Date;
}

export class PolicyNotDeployableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyNotDeployableError";
  }
}

/** Thrown by `deployBatch` when one item fails; carries what succeeded before it. */
export class BatchDeployError extends Error {
  constructor(
    /** The policy id that failed. */
    readonly policyId: string,
    /** Results for the items before it that succeeded, in order. */
    readonly succeeded: DeployPolicyResult[],
    readonly cause: unknown,
  ) {
    super(
      `deployBatch: policy ${policyId} failed after ${succeeded.length} prior ` +
        `deployment(s) succeeded — ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "BatchDeployError";
  }
}

/** Per-wallet FIFO operation queue (#242): schedules `run` after every
 * previously-scheduled operation for the same `accountId` has settled
 * (success or failure — a failed prior operation does not block later ones,
 * it just doesn't hold up the queue). Assigns each operation a monotonic
 * sequence number and reports via `onOutOfOrder` if one is ever run before
 * the immediately-preceding sequence number for that wallet has completed —
 * which should be structurally impossible given the queue below, but is
 * checked explicitly as a defense-in-depth signal rather than assumed. */
function createPerWalletQueue(deps: {
  now: () => Date;
  onOutOfOrder?: (event: OutOfOrderOperationEvent) => void;
}) {
  const tailByAccount = new Map<string, Promise<unknown>>();
  const nextSequenceByAccount = new Map<string, number>();
  const lastCompletedSequenceByAccount = new Map<string, number>();

  return function enqueue<T>(accountId: string, run: () => Promise<T>): Promise<T> {
    const sequence = nextSequenceByAccount.get(accountId) ?? 0;
    nextSequenceByAccount.set(accountId, sequence + 1);

    const previousTail = tailByAccount.get(accountId) ?? Promise.resolve();

    // A prior operation's REJECTION must not abort this one — `.catch(() =>
    // {})` here just lets the chain continue past it, since we don't want
    // one wallet's failed operation to permanently wedge every later
    // operation for the same wallet. Chaining `run` off THIS settled promise
    // (rather than passing two handlers to one `.then`) keeps the resulting
    // type exactly `Promise<T>`, not `Promise<T | void>`.
    const task = previousTail.catch(() => {}).then(async () => {
      const lastCompleted = lastCompletedSequenceByAccount.get(accountId) ?? -1;
      if (sequence !== lastCompleted + 1) {
        deps.onOutOfOrder?.({
          accountId,
          sequence,
          lastCompletedSequence: lastCompleted,
          at: deps.now().toISOString(),
        });
      }
      try {
        return await run();
      } finally {
        lastCompletedSequenceByAccount.set(accountId, sequence);
      }
    });

    // Every operation (success or failure) becomes the new tail so the next
    // enqueue() waits on IT — not on whichever earlier task happened to
    // resolve first, which is what `tailByAccount.get` would otherwise still
    // point at if we forgot to update it here.
    tailByAccount.set(accountId, task);

    return task;
  };
}

export function createPolicyFacade(deps: PolicyFacadeDeps): PolicyFacade {
  const client = createPolicyClient({
    apiUrl: deps.apiUrl,
    network: deps.network,
    fetch: deps.fetch,
    onCacheInvalidated: deps.onCacheInvalidated,
  });
  const now = deps.now ?? (() => new Date());
  const enqueueForWallet = createPerWalletQueue({ now, onOutOfOrder: deps.onOutOfOrderOperation });

  async function deployOne(policyId: string): Promise<DeployPolicyResult> {
    const session = deps.requireSession();
    if (!deps.attach) {
      throw new PolicyNotDeployableError(
        "Policy deploy needs a passkey-attach runtime. This wallet was created without one — provide `policyAttach` in the config (or use the web app runtime).",
      );
    }
    // 1. server-side, sponsor-funded instance deploy bound to the wallet.
    const { contractId } = await client.deployInstance(policyId, session.accountId);
    // 2. passkey-sign the attach (the ONLY prompt).
    if (session.keyId && deps.attach.resume) await deps.attach.resume(session.keyId);
    const { hash } = await deps.attach.attachPolicy(contractId);
    // 3. record the completed attach.
    const policy = await client.recordDeployment(policyId, hash, contractId);
    return { policy, contractId, attachTxHash: hash };
  }

  return {
    client,
    listTemplates() {
      return client.listTemplates();
    },
    refreshTemplates() {
      return client.refreshTemplates();
    },
    generate(definition) {
      return client.generate(definition);
    },
    simulate(policyId) {
      const { accountId } = deps.requireSession();
      return client.simulate(policyId, accountId);
    },
    deploy(policyId) {
      // requireSession() is called again inside deployOne() once the queue
      // actually runs it — calling it here too would only validate the
      // session at ENQUEUE time, which could be stale by the time an earlier
      // queued operation for the same wallet finishes.
      const accountId = deps.requireSession().accountId;
      return enqueueForWallet(accountId, () => deployOne(policyId));
    },
    async deployBatch(policyIds) {
      const accountId = deps.requireSession().accountId;
      const results: DeployPolicyResult[] = [];
      for (const policyId of policyIds) {
        try {
          // Each item goes through the SAME per-wallet queue as deploy(), so
          // a deployBatch() call correctly orders against any concurrent
          // standalone deploy() call for the same wallet too, not just
          // against its own other items.
          results.push(await enqueueForWallet(accountId, () => deployOne(policyId)));
        } catch (err) {
          throw new BatchDeployError(policyId, results, err);
        }
      }
      return results;
    },
  };
}
