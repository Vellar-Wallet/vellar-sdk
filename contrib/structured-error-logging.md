# Structured Error Logging Hook (#247)

This reference implementation demonstrates adding an injectable structured logging hook to the HTTP backend.

## Problem

`http-backend.ts` logs request failures using plain `console.error()`, making it hard to parse and route in consumer log pipelines.

## Solution

Add an optional `onErrorLog` hook that receives structured error data (method, url, status, duration).

## Implementation Guide

### 1. Define Error Log Entry Type (src/http-backend.ts)

```typescript
/**
 * Structured error log entry for HTTP backend failures.
 * Passed to the optional `onErrorLog` hook on request failures.
 */
export interface HttpErrorLogEntry {
  /** HTTP method */
  method: string;
  /** Full URL of the failed request */
  url: string;
  /** HTTP status code (0 for network/fetch failures) */
  status: number;
  /** Request duration in milliseconds */
  durationMs: number;
  /** Optional error message */
  message?: string;
  /** Timestamp of the error */
  timestamp: string;
}

/**
 * Optional hook for structured error logging.
 * Called on HTTP errors (status >= 400) and network failures.
 */
export type HttpErrorLogger = (entry: HttpErrorLogEntry) => void;
```

### 2. Update Backend Options (src/http-backend.ts)

```typescript
export interface HttpWalletBackendOptions {
  /**
   * Custom fetch implementation (for testing or custom transports).
   * Defaults to globalThis.fetch.
   */
  fetchImpl?: typeof fetch;
  
  /**
   * Optional structured error logging hook.
   * Called on HTTP errors (status >= 400) and network failures.
   * Receives method, url, status, duration, and timestamp.
   * 
   * @example
   * ```typescript
   * const backend = createHttpWalletBackend(API_URL, {
   *   onErrorLog: (entry) => {
   *     console.error('[HTTP]', {
   *       method: entry.method,
   *       url: entry.url,
   *       status: entry.status,
   *       duration: entry.durationMs,
   *     });
   *   },
   * });
   * ```
   */
  onErrorLog?: HttpErrorLogger;
}
```

### 3. Implement Logging in Backend (src/http-backend.ts)

```typescript
export function createHttpWalletBackend(
  baseUrl: string,
  options?: HttpWalletBackendOptions,
): WalletBackend {
  const doFetch = options?.fetchImpl ?? fetch;
  const onErrorLog = options?.onErrorLog;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const startTime = Date.now();
    
    try {
      const res = await doFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      
      const durationMs = Date.now() - startTime;
      
      if (!res.ok) {
        // HTTP error (status >= 400)
        if (onErrorLog) {
          onErrorLog({
            method,
            url,
            status: res.status,
            durationMs,
            message: `HTTP ${res.status} ${res.statusText}`,
            timestamp: new Date().toISOString(),
          });
        }
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      return (await res.json()) as T;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      
      // Network or fetch failure
      if (onErrorLog) {
        onErrorLog({
          method,
          url,
          status: 0,  // 0 indicates network failure
          durationMs,
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
      }
      
      throw err;
    }
  }

  return {
    async submitWalletCreation(input) {
      return request<{ sessionId: string }>("POST", "/wallet/create", input);
    },

    async lookupContractId(input) {
      return request<{ contractId: string; sessionId: string } | undefined>(
        "POST",
        "/wallet/connect",
        input,
      );
    },
  };
}
```

## Testing

```typescript
describe("createHttpWalletBackend structured error logging hook (#247)", () => {
  it("invokes onErrorLog with method, url, status, and duration on HTTP error", async () => {
    const errorLogs: HttpErrorLogEntry[] = [];
    const mockFetch = vi.fn(async () =>
      Response.json({ error: "Not Found" }, { status: 404, statusText: "Not Found" }),
    );

    const backend = createHttpWalletBackend(API_URL, {
      fetchImpl: mockFetch as unknown as typeof fetch,
      onErrorLog: (entry) => errorLogs.push(entry),
    });

    await expect(
      backend.submitWalletCreation({
        keyId: "key123",
        contractId: "C...",
        network: "testnet",
        signedTx: {},
      }),
    ).rejects.toThrow("HTTP 404");

    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]).toMatchObject({
      method: "POST",
      url: `${API_URL}/wallet/create`,
      status: 404,
    });
    expect(errorLogs[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(errorLogs[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("invokes onErrorLog with status 0 on network/fetch failure", async () => {
    const errorLogs: HttpErrorLogEntry[] = [];
    const mockFetch = vi.fn(async () => {
      throw new Error("Network error");
    });

    const backend = createHttpWalletBackend(
      API_URL,
      mockFetch as unknown as typeof fetch,
      { onErrorLog: (entry) => errorLogs.push(entry) },
    );

    await expect(
      backend.lookupContractId({ keyId: "key123", network: "testnet" }),
    ).rejects.toThrow("Network error");

    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]).toMatchObject({
      method: "POST",
      url: `${API_URL}/wallet/connect`,
      status: 0,  // 0 indicates network failure
      message: "Network error",
    });
  });

  it("does not invoke onErrorLog when requests succeed", async () => {
    const errorLogs: HttpErrorLogEntry[] = [];
    const mockFetch = vi.fn(async () =>
      Response.json({ sessionId: "session123" }),
    );

    const backend = createHttpWalletBackend(API_URL, {
      fetchImpl: mockFetch as unknown as typeof fetch,
      onErrorLog: (entry) => errorLogs.push(entry),
    });

    await backend.submitWalletCreation({
      keyId: "key123",
      contractId: "C...",
      network: "testnet",
      signedTx: {},
    });

    expect(errorLogs).toHaveLength(0);
  });
});
```

## Key Design Decisions

1. **Optional hook**: `onErrorLog` is optional, so existing code without logging continues to work.

2. **Structured data**: Passes a typed object instead of a formatted string, letting consumers decide how to log it.

3. **Status 0 for network failures**: HTTP errors have real status codes; network failures use 0 (standard convention).

4. **Duration tracking**: Measures `durationMs` for both successes and failures, useful for timeout debugging.

5. **ISO timestamps**: Uses `toISOString()` for consistent, parseable timestamps.

6. **No console.error fallback**: If `onErrorLog` isn't provided, errors are thrown but not logged. This avoids duplicate logging in apps with global error handlers.

## Usage Example

```typescript
// JSON logging (for structured log pipelines)
const backend = createHttpWalletBackend(API_URL, {
  onErrorLog: (entry) => {
    console.error(JSON.stringify({
      level: "error",
      service: "vellar-backend",
      ...entry,
    }));
  },
});

// Custom logger integration (e.g., Winston, Pino)
const backend = createHttpWalletBackend(API_URL, {
  onErrorLog: (entry) => {
    logger.error("HTTP request failed", {
      method: entry.method,
      url: entry.url,
      status: entry.status,
      duration_ms: entry.durationMs,
    });
  },
});

// Metrics tracking
const backend = createHttpWalletBackend(API_URL, {
  onErrorLog: (entry) => {
    metrics.increment("http.errors", {
      method: entry.method,
      status: entry.status,
    });
    metrics.histogram("http.duration", entry.durationMs, {
      status: entry.status >= 500 ? "5xx" : "4xx",
    });
  },
});
```

## README Update

Add to the main README:

```markdown
### Structured Error Logging

The HTTP backend accepts an optional `onErrorLog` hook for structured error logging:

\`\`\`typescript
import { createHttpWalletBackend } from 'vellar-sdk';

const backend = createHttpWalletBackend('https://api.example.com', {
  onErrorLog: (entry) => {
    console.error('[HTTP Error]', {
      method: entry.method,
      url: entry.url,
      status: entry.status,      // 0 for network failures
      duration: entry.durationMs,
      timestamp: entry.timestamp,
    });
  },
});
\`\`\`

The hook receives structured error data for:
- HTTP errors (status ≥ 400)
- Network failures (status = 0)

This makes it easy to integrate with logging pipelines, metrics systems, or error tracking services.
```
