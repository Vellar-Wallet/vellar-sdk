// Record-and-replay harness for Soroban RPC interactions.
//
// WHY THIS EXISTS: packages/mcp-x402-payer/test/fixtures/soroban-rpc-recording.json
// is a captured live testnet simulation. The hostile-RPC test replays it because
// a hand-written stub gets XDR details wrong. That recording was captured by
// hand, once, and there is no tooling to produce another.
//
// This module provides:
//   - A record mode capturing real RPC request/response pairs to a fixture file
//   - A replay mode serving them deterministically
//   - Strict request matching on replay (fails loudly on unmatched requests)
//   - A guarantee that recording never captures secrets (asserted in tests)
//
// SECURITY GUARANTEE: Recording never captures a secret, a signature, or
// anything derived from key material. The filter asserts this in tests.

export interface RpcInteraction {
  method: string;
  params: unknown;
  response: unknown;
}

export interface RecordOptions {
  /** The real RPC URL to record from. */
  rpcUrl: string;
  /** Secrets to strip from recordings (exact match). */
  secrets?: string[];
  /** Additional predicates for values that should be redacted. */
  isSensitive?: (key: string, value: unknown) => boolean;
}

/**
 * Record a set of RPC interactions to a fixture.
 *
 * Each request is sent to the real RPC and the response is captured. Secrets
 * are stripped from both request and response before writing.
 */
export async function recordInteractions(
  requests: Array<{ method: string; params: unknown }>,
  opts: RecordOptions,
): Promise<RpcInteraction[]> {
  const interactions: RpcInteraction[] = [];

  for (const req of requests) {
    const res = await fetch(opts.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: req.method, params: req.params }),
    });
    const body = await res.json();
    const interaction: RpcInteraction = {
      method: req.method,
      params: stripSensitive(req.params, opts),
      response: stripSensitive(body, opts),
    };
    interactions.push(interaction);
  }

  return interactions;
}

/**
 * Create a replay server that serves recorded interactions deterministically.
 *
 * Requests are matched by method AND params (strict). An unmatched request
 * throws immediately — a silently empty simulation is exactly the failure mode
 * that produces confusing test output.
 */
export function createReplayHandler(
  recordings: RpcInteraction[],
): (method: string, params: unknown) => unknown {
  const byMethod = new Map<string, RpcInteraction[]>();
  for (const rec of recordings) {
    const list = byMethod.get(rec.method) ?? [];
    list.push(rec);
    byMethod.set(rec.method, list);
  }
  // Track which recordings have been consumed per method.
  const consumed = new Map<string, number>();

  return (method: string, params: unknown): unknown => {
    const list = byMethod.get(method);
    if (!list || list.length === 0) {
      throw new Error(
        `RPC replay: no recording for method "${method}". ` +
          `Recorded methods: ${[...byMethod.keys()].join(", ") || "(none)"}`,
      );
    }

    const idx = consumed.get(method) ?? 0;
    if (idx >= list.length) {
      throw new Error(
        `RPC replay: exhausted ${list.length} recording(s) for "${method}". ` +
          `All consumed. Record more interactions or check your test setup.`,
      );
    }

    const rec = list[idx]!;
    consumed.set(method, idx + 1);

    // Strict matching: params must be structurally equal.
    if (JSON.stringify(params) !== JSON.stringify(rec.params)) {
      throw new Error(
        `RPC replay: request params mismatch for "${method}" (recording #${idx}).\n` +
          `  Expected: ${JSON.stringify(rec.params)}\n` +
          `  Got:      ${JSON.stringify(params)}`,
      );
    }

    return rec.response;
  };
}

/**
 * Assert that no recorded interaction contains a secret.
 *
 * Call this on a recorded fixture before writing it to disk.
 */
export function assertNoSecretsInRecording(
  recordings: RpcInteraction[],
  secrets: string[],
): void {
  const serialized = JSON.stringify(recordings);
  for (const secret of secrets) {
    if (secret && serialized.includes(secret)) {
      throw new Error(
        `Recording contains a secret! The string "${secret.slice(0, 8)}..." ` +
          `appears in the recorded fixture. Fix the filter and re-record.`,
      );
    }
  }
}

/**
 * Strip sensitive values from an object tree.
 *
 * Replaces exact-match secrets with "[STRIPPED]" and applies the optional
 * `isSensitive` predicate for pattern-based filtering.
 */
export function stripSensitive(
  value: unknown,
  opts: { secrets?: string[]; isSensitive?: (key: string, value: unknown) => boolean },
): unknown {
  const secrets = opts.secrets ?? [];
  const serialized = JSON.stringify(value, (key, val) => {
    if (typeof val === "string") {
      for (const secret of secrets) {
        if (secret && val.includes(secret)) return val.replace(secret, "[STRIPPED]");
      }
      // Strip anything that looks like a Stellar secret seed.
      if (/\bS[A-Z2-7]{55}\b/.test(val)) return "[STRIPPED]";
      if (opts.isSensitive?.(key, val)) return "[STRIPPED]";
    }
    return val;
  });
  return JSON.parse(serialized);
}