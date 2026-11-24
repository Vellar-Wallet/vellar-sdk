// Structural classifier for the explorer's four x402 conditions (#877).
// Reference implementation under contrib/ because external PRs may only change
// that directory.
//
// The explorer classifies a transaction from structure alone. This evaluator
// mirrors the four rules documented in
// website/content/docs/reference/explorer.md against a narrow typed input. It
// deliberately does not parse XDR: that keeps it cheap, deterministic, and
// usable as a pre-flight diagnostic on a transaction the SDK just built.

const INVOKE_HOST_FUNCTION = "invoke_host_function";
const TRANSFER = "transfer";

export interface HostFunctionOperationLike {
  type: string;
  functionName?: string;
  contractId?: string;
  args?: readonly unknown[];
  /** Authorizer of the transfer, when it can be derived from the operation. */
  from?: string;
}

export interface AuthEntryLike {
  credentialType: string;
  address?: string;
  /** Detached credentials are the form the explorer expects. */
  detached?: boolean;
}

/** Only the fields the four conditions inspect. A real envelope must be mapped
 * into this shape by the caller; no XDR parsing happens here. */
export interface StructuralEnvelope {
  operations: readonly HostFunctionOperationLike[];
  authEntries: readonly AuthEntryLike[];
  operationSource: string;
  transactionSource: string;
  /** Fee-bump fee source, when the transaction is fee-bumped. */
  feeSource?: string;
  /** The watched USDC SAC contract id. */
  watchedAsset: string;
}

export interface StructuralClassification {
  x402Shaped: boolean;
  /** Explorer condition numbers that failed, in ascending order. */
  failedConditions: number[];
  reasons: string[];
}

/** Evaluate all four explorer conditions in a single pass over operations and
 * a single pass over auth entries. */
export function classifyX402Shape(envelope: StructuralEnvelope): StructuralClassification {
  const failedConditions: number[] = [];
  const reasons: string[] = [];

  let transferFrom: string | undefined;
  for (const operation of envelope.operations) {
    if (operation.type !== INVOKE_HOST_FUNCTION) continue;
    if (operation.functionName !== TRANSFER) continue;
    if (operation.contractId !== envelope.watchedAsset) continue;
    if (!operation.args || operation.args.length < 3) continue;
    transferFrom = operation.from ?? (typeof operation.args[0] === "string" ? operation.args[0] : undefined);
    break;
  }

  if (!envelope.operations.some((operation) => operation.type === INVOKE_HOST_FUNCTION)) {
    failedConditions.push(1);
    reasons.push("condition 1: no invoke_host_function operation");
  }
  if (transferFrom === undefined) {
    failedConditions.push(2);
    reasons.push("condition 2: no transfer(from, to, amount) on the watched USDC SAC");
  }

  const authorized = envelope.authEntries.some(
    (entry) =>
      entry.credentialType.toLowerCase().includes("address") &&
      entry.detached !== false &&
      entry.address !== undefined &&
      entry.address === transferFrom,
  );
  if (!authorized) {
    failedConditions.push(3);
    reasons.push("condition 3: no detached address credential authorizing the transfer source");
  }

  if (
    transferFrom !== undefined &&
    (transferFrom === envelope.operationSource ||
      transferFrom === envelope.transactionSource ||
      transferFrom === envelope.feeSource)
  ) {
    failedConditions.push(4);
    reasons.push(
      "condition 4: the authorizer is also the operation source, transaction source or fee source",
    );
  }

  return {
    x402Shaped: failedConditions.length === 0,
    failedConditions,
    reasons,
  };
}
