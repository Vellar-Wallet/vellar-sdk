// Example: add a configurable timeout budget to the policy-deployment RPC
// calls in src/policy-client.ts (`simulate`, `deployInstance`,
// `recordDeployment`), which today have no explicit timeout and can hang
// indefinitely on a stalled network request.
//
// This mirrors src/policy-client.ts's own `req<T>()` helper shape (base URL,
// injected fetch, PolicyApiError on non-2xx) but adds an AbortController-based
// timeout with a distinct error type, so a caller can tell "the server said
// no" (PolicyApiError) apart from "we gave up waiting" (PolicyDeployTimeoutError)
// and react differently — the former is not safely retryable in general, the
// latter usually is.
//
// Run with: npx tsx policy-deploy-timeout.ts

/** Thrown when a policy-deployment RPC call exceeds its timeout budget.
 * Deliberately NOT a PolicyApiError subclass — a timeout means we never
 * learned what the server decided, which is a different situation than a
 * server response we didn't like. */
export class PolicyDeployTimeoutError extends Error {
  readonly path: string;
  readonly timeoutMs: number;

  constructor(path: string, timeoutMs: number) {
    super(`Policy deployment request to "${path}" did not complete within ${timeoutMs}ms`);
    this.name = "PolicyDeployTimeoutError";
    this.path = path;
    this.timeoutMs = timeoutMs;
  }
}

/** Per-call timeout budgets (ms) for each deployment-path RPC call. Deploy
 * and record involve on-chain interaction on the server side and are given
 * more room than the lighter simulate call. Every value is overridable. */
export interface PolicyDeployTimeoutBudgets {
  simulate: number;
  deployInstance: number;
  recordDeployment: number;
}

export const DEFAULT_POLICY_DEPLOY_TIMEOUTS: PolicyDeployTimeoutBudgets = {
  simulate: 10_000,
  deployInstance: 30_000,
  recordDeployment: 15_000,
};

export interface TimedPolicyDeployClientOptions {
  apiUrl: string;
  fetch?: typeof fetch;
  timeouts?: Partial<PolicyDeployTimeoutBudgets>;
}

/** Minimal stand-ins for the real GeneratedPolicy/SimulateResult shapes
 * (src/policy-types.ts) — kept local so this example has no dependency on
 * src/, per the contrib sandbox rules. */
export interface SimulateResultLike {
  ok: boolean;
  minResourceFee?: string;
  error?: string;
}

/**
 * A timeout-aware wrapper around the policy-deployment RPC calls
 * (`simulate`, `deployInstance`, `recordDeployment`), demonstrating the
 * budget-per-call pattern that should be applied to `createPolicyClient` in
 * src/policy-client.ts.
 */
export function createTimedPolicyDeployClient(options: TimedPolicyDeployClientOptions) {
  const base = options.apiUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const budgets: PolicyDeployTimeoutBudgets = {
    ...DEFAULT_POLICY_DEPLOY_TIMEOUTS,
    ...options.timeouts,
  };

  async function reqWithTimeout<T>(path: string, timeoutMs: number, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${base}/policies${path}`, {
        headers: init?.body ? { "content-type": "application/json" } : undefined,
        ...init,
        signal: controller.signal,
      });
      const payload = (await res.json().catch(() => ({}))) as { message?: string; error?: string } & T;
      if (!res.ok) {
        throw new Error(payload.message ?? payload.error ?? `Request failed (${res.status})`);
      }
      return payload;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new PolicyDeployTimeoutError(path, timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    simulate(policyId: string, wallet: string): Promise<SimulateResultLike> {
      return reqWithTimeout<SimulateResultLike>(`/${policyId}/simulate`, budgets.simulate, {
        method: "POST",
        body: JSON.stringify({ wallet }),
      });
    },
    async deployInstance(policyId: string, wallet: string): Promise<{ contractId: string }> {
      const { contractId } = await reqWithTimeout<{ contractId: string }>(
        `/${policyId}/deploy-instance`,
        budgets.deployInstance,
        { method: "POST", body: JSON.stringify({ wallet }) },
      );
      return { contractId };
    },
    recordDeployment(policyId: string, txHash: string, contractId?: string): Promise<unknown> {
      return reqWithTimeout(`/deploy`, budgets.recordDeployment, {
        method: "POST",
        body: JSON.stringify({ policyId, txHash, contractId }),
      });
    },
  };
}

async function main() {
  const slowFetch: typeof fetch = (async (_url: string, init?: RequestInit) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify({ ok: true }))), 5000);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted", "AbortError"));
      });
    });
  }) as typeof fetch;

  const client = createTimedPolicyDeployClient({
    apiUrl: "https://api.example.com",
    fetch: slowFetch,
    timeouts: { simulate: 200 },
  });

  try {
    await client.simulate("policy-1", "GWALLET...");
  } catch (err) {
    if (err instanceof PolicyDeployTimeoutError) {
      console.log(`Timed out as expected: ${err.message}`);
    } else {
      throw err;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
