// Opt-in trace of one x402 payment, for a support ticket.
//
// Redaction happens when a step is recorded, and again immediately before the
// trace is handed to the writer. A crash inside the writer can only persist
// bytes that were already redacted — nothing raw is ever passed to it.
//
// This module does not touch the filesystem. The SDK typechecks with no Node
// types so it can ship to browsers; the caller supplies the writer
// (`writeFileSync` in Node, a download helper in the browser).

export const X402_TRACE_STEPS = ["discovery", "quote", "sign", "submit", "settlement"] as const;

export type X402TraceStepName = (typeof X402_TRACE_STEPS)[number];

export interface X402TraceStep {
  step: X402TraceStepName;
  ok: boolean;
  request: unknown;
  response: unknown;
}

export interface X402Trace {
  version: 1;
  steps: X402TraceStep[];
}

export interface X402Tracer {
  record(step: X402TraceStep): void;
  /** Already-redacted copy of what has been recorded so far. */
  snapshot(): X402Trace;
  /**
   * Write one JSON document. `writeFile` is invoked only after redaction, and
   * only with the redacted document.
   */
  exportToFile(filePath: string, writeFile: (path: string, data: string) => void): void;
}

const REDACTED = "[redacted]";

function isSensitiveKey(key: string): boolean {
  const n = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    n.includes("secret") ||
    n.includes("signature") ||
    n.includes("signedxdr") ||
    n.includes("signedentry") ||
    n.includes("privatekey") ||
    n === "seed"
  );
}

function scrubString(value: string, secrets: readonly string[]): string {
  let out = value.replace(/S[A-Z2-7]{55}/g, REDACTED);
  for (const secret of secrets) {
    if (secret.length >= 8 && out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  return out;
}

/** Deep-redact secrets and signing material. Safe to call more than once. */
export function redactX402Value(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") return scrubString(value, secrets);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => redactX402Value(item, secrets));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactX402Value(inner, secrets);
    }
    return out;
  }
  return value;
}

export function redactX402Trace(trace: X402Trace, secrets: readonly string[] = []): X402Trace {
  return {
    version: 1,
    steps: trace.steps.map((step) => ({
      step: step.step,
      ok: step.ok,
      request: redactX402Value(step.request, secrets),
      response: redactX402Value(step.response, secrets),
    })),
  };
}

/**
 * JSON document for a support ticket. Throws instead of returning a document
 * that still contains a registered secret, so the caller cannot write it.
 */
export function redactedTraceJson(trace: X402Trace, secrets: readonly string[] = []): string {
  const body = `${JSON.stringify(redactX402Trace(trace, secrets), null, 2)}\n`;
  for (const secret of secrets) {
    if (secret.length >= 8 && body.includes(secret)) {
      throw new Error("refusing to write x402 trace: redaction missed a registered secret");
    }
  }
  return body;
}

export function exportX402Trace(
  trace: X402Trace,
  filePath: string,
  writeFile: (path: string, data: string) => void,
  secrets: readonly string[] = [],
): void {
  const body = redactedTraceJson(trace, secrets);
  writeFile(filePath, body);
}

function readHeader(headers: HeadersInit | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found?.[1];
  }
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

/** Deps shape `createX402Client` already accepts. The wrapper does not add fields. */
export interface X402TraceableDeps {
  signer: {
    readonly address: string;
    signAuthEntry(
      entryXdr: string,
      opts: { networkPassphrase: string; expirationLedger: number },
    ): Promise<string>;
  };
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Opt-in trace around the existing client. Wrap deps before `createX402Client`
 * so discovery, quote, sign, submit, and settlement are recorded without a
 * core change. Signing material is redacted as it is recorded.
 */
export function instrumentX402ClientDeps<T extends X402TraceableDeps>(deps: T, tracer: X402Tracer): T {
  const innerFetch = deps.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const signer = deps.signer;
  return {
    ...deps,
    signer: {
      address: signer.address,
      async signAuthEntry(entryXdr, opts) {
        try {
          const signedEntry = await signer.signAuthEntry(entryXdr, opts);
          tracer.record({
            step: "sign",
            ok: true,
            request: { address: signer.address },
            response: { signedEntry },
          });
          return signedEntry;
        } catch (err) {
          tracer.record({
            step: "sign",
            ok: false,
            request: { address: signer.address },
            response: { error: err instanceof Error ? err.message : "sign failed" },
          });
          throw err;
        }
      },
    },
    fetchImpl: async (url, init) => {
      const res = await innerFetch(url, init);
      const paymentSignature = readHeader(init?.headers, "PAYMENT-SIGNATURE");
      if (paymentSignature) {
        tracer.record({
          step: "submit",
          ok: res.status < 400,
          request: { url, headers: { "PAYMENT-SIGNATURE": paymentSignature } },
          response: { status: res.status },
        });
        tracer.record({
          step: "settlement",
          ok: res.ok,
          request: { url },
          response: { status: res.status, paymentResponse: res.headers.get("PAYMENT-RESPONSE") },
        });
        return res;
      }
      tracer.record({
        step: "discovery",
        ok: true,
        request: { url, method: init?.method ?? "GET" },
        response: { status: res.status },
      });
      if (res.status === 402) {
        tracer.record({ step: "quote", ok: true, request: { url }, response: { status: 402 } });
      }
      return res;
    },
  };
}

export function createX402Tracer(opts?: { secrets?: readonly string[] }): X402Tracer {
  const secrets = opts?.secrets ?? [];
  const steps: X402TraceStep[] = [];

  return {
    record(step) {
      // Redact before the step is retained, so the tracer never holds raw
      // signing material that a later crash could flush.
      const redacted = redactX402Trace({ version: 1, steps: [step] }, secrets).steps[0]!;
      steps.push(redacted);
    },
    snapshot() {
      return redactX402Trace({ version: 1, steps: [...steps] }, secrets);
    },
    exportToFile(filePath, writeFile) {
      exportX402Trace(this.snapshot(), filePath, writeFile, secrets);
    },
  };
}
