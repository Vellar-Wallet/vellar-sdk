import { Address, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { expirationOffsetFor } from "../issue-508-expiration-override/expiration";

export interface UptoRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface UptoSigner {
  readonly address: string;
  signAuthEntry(
    entryXdr: string,
    opts: { networkPassphrase: string; expirationLedger: number },
  ): Promise<string>;
}

export interface UptoPayloadOptions {
  requirements: UptoRequirements;
  maxAmount: bigint;
  trustedContract: string;
  signer: UptoSigner;
  simulationSourceAccount: string;
  rpcUrl: string;
  networkPassphrase: string;
  ledgerSecondsEstimate?: number;
}

export interface UptoPaymentPayload {
  x402Version: 2;
  accepted: UptoRequirements;
  payload: { transaction: string };
}

export interface UptoSettlement {
  transaction: string;
  ceiling: bigint;
  settledAmount: bigint;
}

const TRANSACTION_HASH = /^[0-9a-f]{64}$/i;

/**
 * Validate an experimental upto option before building or signing.
 * The challenge amount is the authorization ceiling, never the settled charge.
 */
export function assertUptoRequirement(
  requirement: UptoRequirements,
  maxAmount: bigint,
  trustedContract: string,
): bigint {
  if (requirement.scheme !== "upto") throw new Error("Unsupported payment scheme; expected upto.");
  if (requirement.extra?.areFeesSponsored !== true) {
    throw new Error("Refusing upto payment without explicit fee sponsorship.");
  }
  if (requirement.extra.uptoContract !== trustedContract) {
    throw new Error("The seller's uptoContract does not match the trusted contract.");
  }
  if (!/^\d+$/.test(requirement.amount)) throw new Error("The upto ceiling must be a non-negative integer.");
  const ceiling = BigInt(requirement.amount);
  if (ceiling > maxAmount) throw new Error(`Upto ceiling ${ceiling} exceeds maxAmount ${maxAmount}.`);
  return ceiling;
}

/**
 * Build the Vellar 8-argument `settle` invocation and sign only the matching
 * payer auth entry. `actual_amount` is simulated at the ceiling; the facilitator
 * substitutes the metered actual at settlement. This is an experimental wire
 * format pending x402 standardization (x402-foundation/x402 PR #3134).
 */
export async function createUptoPaymentPayload(
  options: UptoPayloadOptions,
): Promise<{ payload: UptoPaymentPayload; ceiling: bigint }> {
  const {
    requirements,
    maxAmount,
    trustedContract,
    signer,
    simulationSourceAccount,
    rpcUrl,
    networkPassphrase,
    ledgerSecondsEstimate,
  } = options;
  const ceiling = assertUptoRequirement(requirements, maxAmount, trustedContract);
  const server = new rpc.Server(rpcUrl);
  const latest = await server.getLatestLedger();
  const expirationLedger = latest.sequence + expirationOffsetFor(
    requirements.maxTimeoutSeconds,
    { ledgerSecondsEstimate },
  );
  const nonce = new Uint8Array(32);
  globalThis.crypto.getRandomValues(nonce);

  const tx = await AssembledTransaction.build({
    contractId: trustedContract,
    method: "settle",
    args: [
      nativeToScVal(requirements.asset, { type: "address" }),
      nativeToScVal(signer.address, { type: "address" }),
      nativeToScVal(requirements.payTo, { type: "address" }),
      nativeToScVal(ceiling, { type: "i128" }),
      nativeToScVal(expirationLedger, { type: "u32" }),
      nativeToScVal(nonce, { type: "bytes" }),
      nativeToScVal(ceiling, { type: "i128" }),
      xdr.ScVal.scvVoid(),
    ],
    networkPassphrase,
    rpcUrl,
    publicKey: simulationSourceAccount,
    parseResultXdr: (result: unknown) => result,
  });
  if (!tx.built) throw new Error("Could not simulate the upto settle invocation.");

  const operation = tx.built.operations[0] as { auth?: xdr.SorobanAuthorizationEntry[] };
  const auth = operation.auth ?? [];
  let signed = 0;
  for (let index = 0; index < auth.length; index++) {
    const entry = auth[index]!;
    if (entry.credentials().switch().name !== "sorobanCredentialsAddress") continue;
    const credentialAddress = Address.fromScAddress(entry.credentials().address().address()).toString();
    if (credentialAddress !== signer.address) continue;

    assertExpectedUptoInvocation(entry, {
      contract: trustedContract,
      token: requirements.asset,
      from: signer.address,
      to: requirements.payTo,
      ceiling,
      expirationLedger,
      nonce,
    });
    const signedXdr = await signer.signAuthEntry(entry.toXDR("base64"), {
      networkPassphrase,
      expirationLedger,
    });
    auth[index] = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
    signed++;
  }
  if (signed === 0) throw new Error("No payer authorization entry was returned by simulation.");
  operation.auth = auth;

  return {
    payload: {
      x402Version: 2,
      accepted: requirements,
      payload: { transaction: tx.built.toXDR() },
    },
    ceiling,
  };
}

/**
 * Parse the facilitator's payment-response header without confusing the signed
 * ceiling in the challenge with the actual amount charged at settlement.
 */
export function decodeUptoSettlement(
  response: Response,
  ceiling: bigint,
): UptoSettlement | undefined {
  const header = response.headers.get("X-PAYMENT-RESPONSE") ?? response.headers.get("PAYMENT-RESPONSE");
  if (!header) return undefined;

  let value: unknown;
  try {
    const decoded = atob(header);
    value = JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, (char) => char.charCodeAt(0))));
  } catch {
    try {
      value = JSON.parse(header);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object") return undefined;
  const result = value as { success?: unknown; transaction?: unknown; amount?: unknown };
  if (result.success === false || typeof result.transaction !== "string" || !TRANSACTION_HASH.test(result.transaction)) {
    return undefined;
  }
  if (typeof result.amount !== "string" || !/^\d+$/.test(result.amount)) return undefined;
  const settledAmount = BigInt(result.amount);
  if (settledAmount > ceiling) throw new Error("Reported upto settlement exceeds the buyer-authorized ceiling.");
  return { transaction: result.transaction, ceiling, settledAmount };
}

/** Serialize upto settlements that share a facilitator's unpooled channel account. */
export class UptoSettlementQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(settlement: () => Promise<T>): Promise<T> {
    const current = this.tail.then(settlement);
    this.tail = current.then(() => undefined, () => undefined);
    return current;
  }
}

function assertExpectedUptoInvocation(
  entry: xdr.SorobanAuthorizationEntry,
  expected: {
    contract: string;
    token: string;
    from: string;
    to: string;
    ceiling: bigint;
    expirationLedger: number;
    nonce: Uint8Array;
  },
): void {
  const authorizedFunction = entry.rootInvocation().function();
  if (authorizedFunction.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") {
    throw new Error("Refusing to sign upto auth entry: expected a contract invocation.");
  }
  const call = authorizedFunction.contractFn();
  const args = call.args();
  if (
    Address.fromScAddress(call.contractAddress()).toString() !== expected.contract ||
    call.functionName().toString() !== "settle" ||
    args.length !== 8
  ) {
    throw new Error("Refusing to sign upto auth entry: contract invocation did not match settle.");
  }
  const addressAt = (index: number) => Address.fromScVal(args[index]!).toString();
  const integerAt = (index: number) => BigInt(scValToNative(args[index]!) as bigint | number | string);
  if (
    addressAt(0) !== expected.token ||
    addressAt(1) !== expected.from ||
    addressAt(2) !== expected.to ||
    integerAt(3) !== expected.ceiling ||
    integerAt(4) !== BigInt(expected.expirationLedger) ||
    integerAt(6) !== expected.ceiling ||
    !args[5]!.toXDR().equals(nativeToScVal(expected.nonce, { type: "bytes" }).toXDR()) ||
    !args[7]!.toXDR().equals(xdr.ScVal.scvVoid().toXDR())
  ) {
    throw new Error("Refusing to sign upto auth entry: signed tuple differed from the requested payment.");
  }
}