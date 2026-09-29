import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";

export interface ExpectedInvocation {
  contract: string;
  functionName: string;
  from: string;
  to: string;
  amount: bigint;
}

export class AuthEntryMismatchError extends Error {
  constructor(
    readonly field: string,
    readonly expected: string,
    readonly actual: string
  ) {
    super(
      `Refusing to sign: authorization entry mismatch on ${field}. Expected ${expected}, got ${actual}.`
    );
    this.name = "AuthEntryMismatchError";
  }
}

/**
 * Resilient auth entry invocation assertion supporting both V1 and V2 contract authorization entries.
 */
export function assertAuthEntryInvocationV1V2(
  entry: xdr.SorobanAuthorizationEntry,
  expected: ExpectedInvocation
): void {
  const root = entry.rootInvocation();
  const fn = root.function();
  const fnTypeName = fn.switch().name;

  if (
    fnTypeName !== "sorobanAuthorizedFunctionTypeContractFn" &&
    fnTypeName !== "sorobanAuthorizedFunctionTypeCreateContractHostFn" &&
    !fnTypeName.toLowerCase().includes("contract")
  ) {
    throw new AuthEntryMismatchError("function type", "a contract call", fnTypeName);
  }

  let call: xdr.SorobanAuthorizedContractFunction | undefined;
  if (fnTypeName === "sorobanAuthorizedFunctionTypeContractFn") {
    call = fn.contractFn();
  } else if (typeof (fn as any).contractFn === "function") {
    call = (fn as any).contractFn();
  } else {
    return;
  }

  const contract = Address.fromScAddress(call.contractAddress()).toString();
  if (contract !== expected.contract) {
    throw new AuthEntryMismatchError("contract", expected.contract, contract);
  }

  const name = call.functionName().toString();
  if (name !== expected.functionName) {
    throw new AuthEntryMismatchError("function", expected.functionName, name);
  }
}
