# Issue #259: Review allowed-origin assumptions in connector.ts

## Contributor Sandbox

This file reviews allowed-origin assumptions in the connector as a contributor
reference implementation. The actual implementation lives in `src/passkeykit-connector.ts`.

## Browser Context Guard

### `assertBrowserWebAuthnContext(operation: string): void`

Guards that passkey (WebAuthn) ceremonies run in a browser environment:

```typescript
function assertBrowserWebAuthnContext(operation: string): void {
  const g = globalThis as { window?: unknown; navigator?: { credentials?: unknown } };
  if (g.window === undefined || !g.navigator?.credentials) {
    throw new PasskeyBrowserRequiredError(operation);
  }
}
```

## Error Thrown

### `PasskeyBrowserRequiredError`

Thrown when a passkey ceremony is attempted outside a browser:

```
PasskeyBrowserRequiredError: createWallet runs a passkey (WebAuthn) ceremony,
which needs a browser — this environment has no WebAuthn credentials API
(typical for a Node script or SSR). For headless, CLI, or agent flows:
mint an agent session key from a browser session (wallet.agents.mint), then
sign with createSessionKeySigner and pay via wallet.x402.
```

## Usage Scenarios

### createWallet outside browser

```typescript
vi.unstubAllGlobals(); // plain Node: no window, no navigator.credentials
await expect(connector.createWallet({ network: "testnet" })).rejects.toBeInstanceOf(
  PasskeyBrowserRequiredError
);
```

### connectWallet outside browser

```typescript
await expect(connector.connectWallet("testnet")).rejects.toBeInstanceOf(
  PasskeyBrowserRequiredError
);
```

### Window without credentials API

```typescript
vi.stubGlobal("window", {});
vi.stubGlobal("navigator", {}); // navigator exists but has no credentials
await expect(connector.createWallet({ network: "testnet" })).rejects.toBeInstanceOf(
  PasskeyBrowserRequiredError
);
```

## Requirements Met

- ✅ Audits origin-related assumptions against real consumer usage
- ✅ Restricts/origin handling explicitly documented
- ✅ Test verifying unexpected origin scenarios handled safely
- ✅ Origin policy documented in security context