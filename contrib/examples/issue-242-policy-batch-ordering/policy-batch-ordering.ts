/**
 * Per-wallet ordering for queued policy-facade batch operations.
 *
 * Contributed for issue #242: `PolicyFacade.deploy(policyId)` in
 * src/policy-facade.ts has no batching or queueing at all today — nothing
 * stops two concurrent `deploy()` calls for the SAME connected wallet from
 * interleaving their steps (server-side instance deploy, passkey attach,
 * record) out of the order they were requested in.
 *
 * This wraps any single-operation async function keyed by an account id
 * (the shape `PolicyFacade.deploy` has) with a per-wallet FIFO queue:
 * operations for the SAME account id always complete in call order, one at a
 * time; operations for DIFFERENT account ids are unaffected and run
 * concurrently. It also exposes a `runBatch` helper that runs a list of
 * inputs through the SAME queue, strictly in the given order.
 *
 * A failed operation does not permanently wedge the queue — later operations
 * for the same wallet still run; they just don't wait on a REJECTION, only
 * on the prior operation SETTLING (success or failure).
 *
 * Run with: npx vitest run contrib/examples/issue-242-policy-batch-ordering
 */

/**
 * Fired when a queued operation is detected running out of sequence for its
 * account id — i.e. the queue itself misbehaved. Should never fire under
 * normal operation; it exists as a defense-in-depth signal, not an expected
 * event.
 */
export interface OutOfOrderOperationEvent {
  accountId: string;
  /** The sequence number assigned when this operation was enqueued. */
  sequence: number;
  /** The highest sequence number already completed for this account at the
   * time this one started running — expected to be exactly `sequence - 1`. */
  lastCompletedSequence: number;
  at: string;
}

export interface PerWalletQueueOptions {
  /** Called if the queue ever detects out-of-order execution. Should never fire in practice. */
  onOutOfOrder?: (event: OutOfOrderOperationEvent) => void;
  /** Injected clock (tests only); defaults to `() => new Date()`. */
  now?: () => Date;
}

/** Thrown by `runBatch` when one item fails; carries what succeeded before it. */
export class BatchOperationError<TResult> extends Error {
  constructor(
    /** The 0-based index of the input that failed. */
    readonly failedIndex: number,
    /** Results for the inputs before it that succeeded, in order. */
    readonly succeeded: TResult[],
    readonly cause: unknown,
  ) {
    super(
      `runBatch: item ${failedIndex} failed after ${succeeded.length} prior ` +
        `operation(s) succeeded — ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "BatchOperationError";
  }
}

export interface PerWalletQueue<TInput, TResult> {
  /** Run `run(input)` for `accountId`, queued after any prior operation for
   * the SAME account id (different account ids run concurrently). */
  enqueue(accountId: string, input: TInput, run: (input: TInput) => Promise<TResult>): Promise<TResult>;
  /** Run `inputs` for `accountId` through the queue, STRICTLY in the given
   * order — each item fully completes before the next starts. Stops at the
   * first failure, throwing `BatchOperationError` with what succeeded. */
  runBatch(
    accountId: string,
    inputs: TInput[],
    run: (input: TInput) => Promise<TResult>,
  ): Promise<TResult[]>;
}

/**
 * Create a per-wallet FIFO operation queue. Generic over the operation's
 * input/result types so it applies to `PolicyFacade.deploy(policyId):
 * Promise<DeployPolicyResult>` (this issue's target) as well as any other
 * single-operation, per-account-scoped async call.
 */
export function createPerWalletQueue<TInput = string, TResult = unknown>(
  options: PerWalletQueueOptions = {},
): PerWalletQueue<TInput, TResult> {
  const now = options.now ?? (() => new Date());

  const tailByAccount = new Map<string, Promise<unknown>>();
  const nextSequenceByAccount = new Map<string, number>();
  const lastCompletedSequenceByAccount = new Map<string, number>();

  function enqueue(
    accountId: string,
    _input: TInput,
    run: (input: TInput) => Promise<TResult>,
  ): Promise<TResult> {
    const sequence = nextSequenceByAccount.get(accountId) ?? 0;
    nextSequenceByAccount.set(accountId, sequence + 1);

    const previousTail = tailByAccount.get(accountId) ?? Promise.resolve();

    // A prior operation's REJECTION must not abort this one — `.catch(() =>
    // {})` lets the chain continue past it, since one wallet's failed
    // operation must not permanently wedge every later operation for the
    // same wallet. Chaining `run` off this settled promise (rather than
    // passing two handlers to one `.then`) keeps the resulting type exactly
    // `Promise<TResult>`, not `Promise<TResult | void>`.
    const task = previousTail.catch(() => {}).then(async () => {
      const lastCompleted = lastCompletedSequenceByAccount.get(accountId) ?? -1;
      if (sequence !== lastCompleted + 1) {
        options.onOutOfOrder?.({
          accountId,
          sequence,
          lastCompletedSequence: lastCompleted,
          at: now().toISOString(),
        });
      }
      try {
        return await run(_input);
      } finally {
        lastCompletedSequenceByAccount.set(accountId, sequence);
      }
    });

    // Every operation (success or failure) becomes the new tail so the next
    // enqueue() waits on IT — not on whichever earlier task happened to
    // resolve first.
    tailByAccount.set(accountId, task);

    return task;
  }

  return {
    enqueue,
    async runBatch(accountId, inputs, run) {
      const results: TResult[] = [];
      for (let i = 0; i < inputs.length; i++) {
        try {
          results.push(await enqueue(accountId, inputs[i] as TInput, run));
        } catch (err) {
          throw new BatchOperationError(i, results, err);
        }
      }
      return results;
    },
  };
}
