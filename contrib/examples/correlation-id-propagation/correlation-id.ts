/**
 * Correlation ID propagation utility & HTTP middleware (Issue #248).
 * Ensures distributed tracing correlation IDs flow across client calls and backend headers.
 */

export interface CorrelationIdOptions {
  correlationId?: string | (() => string);
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export function generateCorrelationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function resolveCorrelationId(
  explicit?: string,
  configured?: string | (() => string),
): string | undefined {
  if (explicit) return explicit;
  if (typeof configured === "function") return configured();
  return configured;
}

export function createCorrelatedFetch(
  baseFetch: FetchFn = fetch,
  defaultCorrelationId?: string | (() => string),
): FetchFn {
  return async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const existing = headers.get("x-correlation-id");

    if (!existing) {
      const cid = resolveCorrelationId(undefined, defaultCorrelationId) ?? generateCorrelationId();
      headers.set("x-correlation-id", cid);
    }

    return baseFetch(url, {
      ...init,
      headers,
    });
  };
}
