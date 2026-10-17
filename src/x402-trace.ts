import fs from "node:fs";
import path from "node:path";

export type X402TraceStepName =
  | "discovery"
  | "quote"
  | "sign"
  | "submit"
  | "settlement";

export const REDACTED_SECRET = "[REDACTED:SECRET]";
export const REDACTED_SIGNED_MATERIAL = "[REDACTED:SIGNED_MATERIAL]";

/** Matches a 56-character Stellar StrKey secret seed (`S...`). */
const STELLAR_SECRET_SEED_REGEX = /\bS[A-Z0-9]{55}\b/g;

/** Keys whose values carry raw secrets or credentials. */
const SECRET_KEY_PATTERN =
  /^(?:secret|secretkey|privatekey|seed|sessionsecret|authorization|x-api-key|api_key|apikey|token|password)$/i;

/** Keys whose values carry raw signed XDRs, auth-entry signatures, or payment signature headers. */
const SIGNED_MATERIAL_KEY_PATTERN =
  /^(?:payment-signature|paymentsignature|x-payment|x-vellar-signature|signature|signatures|signedxdr|entryxdr|signedauthentry|rawxdr|authxdr|transactionxdr|envelope)$/i;

function redactStringValue(value: string, keyHint?: string): string {
  if (keyHint && SECRET_KEY_PATTERN.test(keyHint)) {
    return REDACTED_SECRET;
  }
  if (keyHint && SIGNED_MATERIAL_KEY_PATTERN.test(keyHint)) {
    return REDACTED_SIGNED_MATERIAL;
  }
  // In payload objects, `transaction` is a base64 XDR (whereas in settlement it is a 64-hex tx hash)
  if (
    keyHint &&
    /^transaction$/i.test(keyHint) &&
    !/^[0-9a-fA-F]{64}$/.test(value)
  ) {
    return REDACTED_SIGNED_MATERIAL;
  }

  let out = value.replace(STELLAR_SECRET_SEED_REGEX, REDACTED_SECRET);

  // Redact Bearer / HMAC tokens embedded in strings
  if (/^(?:Bearer|HMAC-SHA256)\s+\S+/i.test(out)) {
    out = out.replace(
      /^((?:Bearer|HMAC-SHA256)\s+)\S+/i,
      `$1${REDACTED_SIGNED_MATERIAL}`
    );
  }

  // Redact raw base64 Soroban XDR blobs (typically starting with AAAA...)
  if (out.length > 48 && /^AAAA[A-Za-z0-9+/=]+$/.test(out)) {
    return REDACTED_SIGNED_MATERIAL;
  }

  return out;
}

/**
 * Recursively sanitize an arbitrary trace payload **before** it is stored in
 * memory or written to disk so a crash mid-recording can never leak a secret
 * or raw signing material.
 */
export function redactSensitiveTraceData(
  input: unknown,
  keyHint?: string
): unknown {
  if (input === null || input === undefined) {
    return input;
  }
  if (typeof input === "bigint") {
    return input.toString();
  }
  if (typeof input === "string") {
    return redactStringValue(input, keyHint);
  }
  if (typeof input === "number" || typeof input === "boolean") {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveTraceData(item, keyHint));
  }
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k)) {
        out[k] = REDACTED_SECRET;
      } else if (SIGNED_MATERIAL_KEY_PATTERN.test(k)) {
        out[k] = REDACTED_SIGNED_MATERIAL;
      } else {
        out[k] = redactSensitiveTraceData(v, k);
      }
    }
    return out;
  }
  return String(input);
}

export interface X402TraceStepEntry {
  index: number;
  step: X402TraceStepName;
  timestamp: string;
  durationMs?: number;
  outcome: "ok" | "error";
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  error?: string;
}

export interface X402DiagnosticTrace {
  traceVersion: 1;
  redacted: true;
  createdAt: string;
  updatedAt: string;
  network?: string;
  resourceUrl?: string;
  steps: X402TraceStepEntry[];
}

export interface X402TraceRecorderOptions {
  network?: string;
  resourceUrl?: string;
  /**
   * Optional file path to flush the redacted trace after every recorded step.
   * Redaction is applied BEFORE each step is added or written to disk.
   */
  outputFilePath?: string;
  now?: () => Date;
}

export interface RecordTraceStepInput {
  step: X402TraceStepName;
  durationMs?: number;
  outcome?: "ok" | "error";
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  error?: unknown;
}

export interface X402TraceRecorder {
  recordStep(input: RecordTraceStepInput): X402TraceStepEntry;
  getTrace(): X402DiagnosticTrace;
  exportToJson(pretty?: boolean): string;
  writeToFile(filePath: string): void;
}

/**
 * Create an opt-in x402 payment flow trace recorder that redacts secrets and
 * signing material before storing in memory or flushing to disk (#680).
 */
export function createX402TraceRecorder(
  options: X402TraceRecorderOptions = {}
): X402TraceRecorder {
  const now = options.now ?? (() => new Date());
  const createdAt = now().toISOString();
  let updatedAt = createdAt;
  let resourceUrl = options.resourceUrl;
  const network = options.network;
  const steps: X402TraceStepEntry[] = [];

  function buildSnapshot(): X402DiagnosticTrace {
    return {
      traceVersion: 1,
      redacted: true,
      createdAt,
      updatedAt,
      ...(network ? { network } : {}),
      ...(resourceUrl ? { resourceUrl } : {}),
      steps: [...steps],
    };
  }

  function flushIfConfigured(): void {
    if (!options.outputFilePath) return;
    const absPath = path.resolve(options.outputFilePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(
      absPath,
      JSON.stringify(buildSnapshot(), null, 2) + "\n",
      "utf8"
    );
  }

  return {
    recordStep(input: RecordTraceStepInput): X402TraceStepEntry {
      const ts = now().toISOString();
      updatedAt = ts;

      if (
        !resourceUrl &&
        input.request &&
        typeof input.request.url === "string"
      ) {
        resourceUrl = redactStringValue(input.request.url);
      }

      const sanitizedRequest = input.request
        ? (redactSensitiveTraceData(input.request) as Record<string, unknown>)
        : undefined;
      const sanitizedResponse = input.response
        ? (redactSensitiveTraceData(input.response) as Record<string, unknown>)
        : undefined;
      const rawError =
        input.error instanceof Error
          ? input.error.message
          : input.error !== undefined
            ? String(input.error)
            : undefined;
      const sanitizedError =
        rawError !== undefined ? redactStringValue(rawError) : undefined;

      const entry: X402TraceStepEntry = {
        index: steps.length + 1,
        step: input.step,
        timestamp: ts,
        ...(input.durationMs !== undefined
          ? { durationMs: Math.round(input.durationMs * 1000) / 1000 }
          : {}),
        outcome: input.outcome ?? (sanitizedError ? "error" : "ok"),
        ...(sanitizedRequest ? { request: sanitizedRequest } : {}),
        ...(sanitizedResponse ? { response: sanitizedResponse } : {}),
        ...(sanitizedError ? { error: sanitizedError } : {}),
      };

      steps.push(entry);
      flushIfConfigured();
      return entry;
    },

    getTrace(): X402DiagnosticTrace {
      return buildSnapshot();
    },

    exportToJson(pretty = true): string {
      return JSON.stringify(buildSnapshot(), null, pretty ? 2 : 0) + "\n";
    },

    writeToFile(filePath: string): void {
      const absPath = path.resolve(filePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(
        absPath,
        JSON.stringify(buildSnapshot(), null, 2) + "\n",
        "utf8"
      );
    },
  };
}
