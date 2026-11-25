/**
 * Consumer-side preflight for the two explicit values required by
 * `mainnetConfig`. It intentionally lives in contrib: maintainers can move
 * the accompanying regression cases into src once contributor scope permits.
 */
export type MainnetConfigField = "rpcUrl" | "walletWasmHash";

export interface MainnetConfigPreflightFailure {
  readonly field: MainnetConfigField;
  readonly reason: "missing" | "malformed";
  readonly message: string;
}

const WASM_HASH_RE = /^[0-9a-fA-F]{64}$/;

/** Return field-specific failures without constructing or logging a config. */
export function inspectMainnetConfigInput(input: {
  rpcUrl?: string;
  walletWasmHash?: string;
}): readonly MainnetConfigPreflightFailure[] {
  const failures: MainnetConfigPreflightFailure[] = [];
  const rpcUrl = input.rpcUrl?.trim();
  const walletWasmHash = input.walletWasmHash?.trim();

  if (!rpcUrl) {
    failures.push({ field: "rpcUrl", reason: "missing", message: "rpcUrl is required." });
  } else {
    try {
      const url = new URL(rpcUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported protocol");
    } catch {
      failures.push({ field: "rpcUrl", reason: "malformed", message: "rpcUrl must be an http(s) URL." });
    }
  }

  if (!walletWasmHash) {
    failures.push({
      field: "walletWasmHash",
      reason: "missing",
      message: "walletWasmHash is required.",
    });
  } else if (!WASM_HASH_RE.test(walletWasmHash)) {
    failures.push({
      field: "walletWasmHash",
      reason: "malformed",
      message: "walletWasmHash must be a 64-character hexadecimal hash.",
    });
  }

  return failures;
}
