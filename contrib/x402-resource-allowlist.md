# x402 Resource Allowlist (#437)

This reference implementation demonstrates adding an optional URL allowlist to the MCP x402 payer server.

## Problem

The MCP payer accepts `resource_url` as a tool argument and will attempt payment against any host the model names, including URLs introduced through prompt injection.

## Solution

Add an optional origin-based allowlist configured via environment variable at startup.

## Implementation Guide

### 1. Configuration (packages/mcp-x402-payer/src/config.ts)

Add environment variable parsing:

```typescript
/**
 * Parse `VELLAR_X402_RESOURCE_ALLOWLIST`: comma-separated URLs or origins.
 * Matched strictly on origin (scheme + host + optional port), never by substring.
 * When unset or empty, returns undefined (all hosts permitted).
 */
export function parseResourceAllowlist(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const origins: string[] = [];
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    let origin: string;
    try {
      const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
      origin = parsed.origin.toLowerCase();
    } catch {
      throw new ConfigError(
        `VELLAR_X402_RESOURCE_ALLOWLIST entry ${JSON.stringify(trimmed)} is not a valid URL or origin.`,
      );
    }
    if (!origins.includes(origin)) {
      origins.push(origin);
    }
  }
  if (origins.length === 0) return undefined;
  return Object.freeze(origins);
}

/**
 * Check if a resource URL's origin matches the server's allowlist.
 * When allowlist is undefined or empty, returns true (unchanged behavior).
 * Matches strictly on origin, never substring.
 */
export function isOriginAllowed(url: string, allowedOrigins?: readonly string[]): boolean {
  if (!allowedOrigins || allowedOrigins.length === 0) return true;
  try {
    const origin = new URL(url).origin.toLowerCase();
    return allowedOrigins.includes(origin);
  } catch {
    return false;
  }
}
```

Add to `PayerConfig`:

```typescript
export interface PayerConfig {
  // ... existing fields
  /**
   * Optional resource URL allowlist, matched strictly by origin (scheme + host + port).
   * When unset, behavior is unchanged and all resource URLs are permitted.
   */
  readonly allowedResourceOrigins?: readonly string[];
}
```

Load in `loadConfig()`:

```typescript
const allowedResourceOrigins = parseResourceAllowlist(env.VELLAR_X402_RESOURCE_ALLOWLIST);
```

### 2. Payer Integration (packages/mcp-x402-payer/src/payer.ts)

Check before any network operation:

```typescript
async function quote(url: string): Promise<QuoteResult> {
  if (config.allowedResourceOrigins && !isOriginAllowed(url, config.allowedResourceOrigins)) {
    let host = url;
    try {
      host = new URL(url).origin;
    } catch {
      // preserve fallback url
    }
    return {
      url,
      requiresPayment: false,
      payable: false,
      refusal: `The server configuration disallowed the host "${host}". Request refused without connecting or signing.`,
      status: 0,
    };
  }
  // ... continue with normal flow
}

async function payExclusively(url: string, maxAmount: string): Promise<PayResult> {
  if (config.allowedResourceOrigins && !isOriginAllowed(url, config.allowedResourceOrigins)) {
    let host = url;
    try {
      host = new URL(url).origin;
    } catch {
      // preserve fallback url
    }
    throw new DisallowedResourceHostError(host, url);
  }
  // ... continue with normal flow
}
```

### 3. Pay-and-Call Integration (packages/mcp-x402-payer/src/pay-and-call.ts)

Filter catalog results:

```typescript
export function selectCandidates(
  data: SearchResponse,
  config: Pick<PayerConfig, "caip2" | "allowedAssets" | "allowedResourceOrigins">,
): { payable: Candidate[]; resultsFound: number } {
  const resources = data.resources ?? [];
  const payable: Candidate[] = [];

  for (const r of resources) {
    const url = r.resource;
    if (!url) continue;
    
    // Check allowlist
    if (config.allowedResourceOrigins && !isOriginAllowed(url, config.allowedResourceOrigins)) {
      continue;
    }
    
    // ... rest of filtering logic
  }
  
  return { payable, resultsFound: resources.length };
}
```

### 4. Error Type (packages/mcp-x402-payer/src/errors.ts)

```typescript
export class DisallowedResourceHostError extends Error {
  constructor(host: string, url: string) {
    super(
      `The server configuration disallowed the host "${host}". Request refused without connecting or signing. ` +
      `Full URL: ${url}`
    );
    this.name = "DisallowedResourceHostError";
  }
}
```

## Testing

```typescript
describe("resource allowlist", () => {
  it("allows requests when allowlist permits the origin", async () => {
    const config = { ...baseConfig, allowedResourceOrigins: ["https://api.example.com"] };
    const result = await payer.pay("https://api.example.com/resource", "1000");
    expect(result.paid).toBe(true);
  });

  it("refuses a disallowed host without signing", async () => {
    const config = { ...baseConfig, allowedResourceOrigins: ["https://allowed.org"] };
    await expect(payer.pay("https://evil.org/resource", "1000")).rejects.toThrow(
      DisallowedResourceHostError
    );
  });

  it("refuses a host embedding the allowed origin as a substring", async () => {
    const config = { ...baseConfig, allowedResourceOrigins: ["https://api.com"] };
    await expect(payer.pay("https://api.com.attacker.net/resource", "1000")).rejects.toThrow(
      DisallowedResourceHostError
    );
  });
});
```

## Key Design Decisions

1. **Origin-based matching**: Uses `URL.origin` which includes scheme, host, and port. This prevents substring attacks like `allowed.org.attacker.com`.

2. **Optional by default**: When unset, all origins are allowed (backward compatible).

3. **Early rejection**: Checks before any network call or signing operation.

4. **Clear error messages**: Distinguishes between "host disallowed by config" vs "resource unavailable".

5. **Applies everywhere**: Both direct `pay()` calls and catalog results from `pay_and_call` are filtered.
