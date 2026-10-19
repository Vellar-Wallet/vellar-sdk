// Issue #659 — `policies.simulate` when the dry-run call itself hangs.
//
// THE GAP. `createPolicyClient().simulate` is a single `fetch` to the gateway's
// `POST /policies/:id/simulate` (which runs the Soroban simulation server-side)
// with no timeout and no abort signal. If the gateway or its RPC never answers,
// the promise never settles — `vellar.policies.simulate()` hangs forever. And
// because policy-client wraps any transport throw as `PolicyApiError(…, 0)`, an
// abort added inside the fetch would surface as a generic status-0 error rather
// than something a caller can recognise as a timeout.
//
// THE GUARD. Race `simulate` against its own timer, OUTSIDE policy-client's
// error wrapping:
//  - Timer wins → abort the in-flight request (so the socket is released) and
//    reject with PolicySimulateTimeoutError.
//  - A simulation FAILURE is a successful response: `{ ok: false, error }`
//    resolves exactly as before — it is the dry run's answer, not a timeout.
//  - An HTTP error stays a PolicyApiError with its real status.
// Only `simulate` is timed; every other method is the unmodified client.

import { createPolicyClient, type PolicyClient, type PolicyClientOptions } from "../../src/policy-client.js";
import type { SimulateResult } from "../../src/policy-types.js";

/** Default bound on a simulate dry run (the gateway's own simulation included). */
export const DEFAULT_SIMULATE_TIMEOUT_MS = 30_000;

/** `simulate` did not get any response within its timeout. */
export class PolicySimulateTimeoutError extends Error {
  readonly policyId: string;
  readonly timeoutMs: number;

  constructor(policyId: string, timeoutMs: number) {
    super(
      `policies.simulate("${policyId}") got no response within ${timeoutMs} ms; the request was ` +
        "aborted. This is a transport timeout, not a simulation failure — nothing was simulated or submitted.",
    );
    this.name = "PolicySimulateTimeoutError";
    this.policyId = policyId;
    this.timeoutMs = timeoutMs;
  }
}

export interface PolicyClientWithTimeoutOptions extends PolicyClientOptions {
  /** Milliseconds before `simulate` gives up (default 30 000). */
  simulateTimeoutMs?: number;
}

export function createPolicyClientWithSimulateTimeout(
  options: PolicyClientWithTimeoutOptions,
): PolicyClient {
  const timeoutMs = options.simulateTimeoutMs ?? DEFAULT_SIMULATE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`simulateTimeoutMs must be a positive number of ms, got ${timeoutMs}`);
  }
  const baseFetch = options.fetch ?? fetch;
  const client = createPolicyClient(options);

  return {
    ...client,
    simulate(policyId, wallet) {
      const controller = new AbortController();
      // A per-call client whose fetch carries this call's abort signal.
      const timed = createPolicyClient({
        ...options,
        fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
          baseFetch(input, { ...init, signal: controller.signal })) as typeof fetch,
      });

      return new Promise<SimulateResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new PolicySimulateTimeoutError(policyId, timeoutMs));
          controller.abort();
        }, timeoutMs);
        timed.simulate(policyId, wallet).then(
          (result) => {
            clearTimeout(timer);
            resolve(result);
          },
          (err: unknown) => {
            clearTimeout(timer);
            reject(err); // no-op if the timeout already rejected
          },
        );
      });
    },
  };
}
