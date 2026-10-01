# Network Switch Support for Connector (#435)

This reference implementation demonstrates adding a network-switch path to the PasskeyKit connector.

## Problem

`createPasskeyKitConnector` fixes the network at construction. Apps with testnet/mainnet toggles must tear down and rebuild the connector, but there's no safe documented order. Users get `WalletNetworkMismatchError` at signing time.

## Solution

Add a `switchNetwork()` method that clears connected wallet state and requires fresh connect.

## Implementation Guide

### 1. Add switchNetwork to Connector Interface (src/connector.ts)

```typescript
export interface WalletConnector {
  createWallet(input: CreateWalletInput): Promise<WalletSession>;
  connectWallet(network: Network): Promise<WalletSession>;
  signTransaction(input: SignTransactionInput): Promise<SignedTransaction>;
  
  /**
   * Switch the connector to a different network, clearing any connected wallet state.
   * A passkey connected to a testnet contract is meaningless on mainnet.
   * After switching, connectWallet() must be called again before signing.
   */
  switchNetwork?(newNetwork: Network): void;
}
```

### 2. Implement in PasskeyKit Connector (src/passkeykit-connector.ts)

```typescript
export function createPasskeyKitConnector(options: PasskeyKitConnectorOptions): WalletConnector {
  const { kit, backend, appName } = options;
  let network = options.network;  // Make mutable
  const now = options.now ?? (() => new Date());
  const signedToXdr = options.signedToXdr ?? defaultSignedToXdr;
  const onDebugLog = options.onDebugLog ?? (() => {});

  // Track the session key for rotation
  let activeSessionKeyPublicKey: string | undefined;

  function assertNetwork(requested: Network): void {
    if (requested !== network) throw new WalletNetworkMismatchError(network, requested);
  }

  return {
    async createWallet(input: CreateWalletInput): Promise<WalletSession> {
      assertBrowserWebAuthnContext("createWallet() (vellar.create())");
      assertNetwork(input.network);
      // ... existing implementation
    },

    async connectWallet(requested: Network): Promise<WalletSession> {
      assertBrowserWebAuthnContext("connectWallet() (vellar.connect())");
      assertNetwork(requested);
      // ... existing implementation
    },

    async signTransaction(input: SignTransactionInput): Promise<SignedTransaction> {
      assertNetwork(input.network);
      // ... existing implementation
    },

    switchNetwork(newNetwork: Network): void {
      // Switching network MUST clear connected wallet state: a passkey connected
      // to a testnet contract is meaningless on mainnet, and carrying it across
      // silently would cause signature verification or simulation failure.
      network = newNetwork;
      activeSessionKeyPublicKey = undefined;
      // Note: The kit itself doesn't track network, so we don't need to clear kit.wallet
      // The session state is managed by the client's session store, which is cleared
      // separately when switchNetwork is called on the VellarWallet client
    },
  };
}
```

### 3. Add to VellarWallet Client (src/client.ts)

```typescript
export interface VellarWallet {
  // ... existing methods
  
  /**
   * Switch to a different network (testnet ↔ mainnet).
   * Clears the current session and requires a fresh connect() before any operations.
   * This prevents accidentally using a testnet wallet on mainnet or vice versa.
   */
  switchNetwork(newNetwork: Network): void;
}

export function createVellarWallet(options: VellarWalletOptions): VellarWallet {
  const { connector, sessionStore, backend } = options;
  
  return {
    // ... existing methods
    
    switchNetwork(newNetwork: Network): void {
      // Clear session first - user must reconnect
      sessionStore.getState().end();
      
      // Switch the connector's network
      if (connector.switchNetwork) {
        connector.switchNetwork(newNetwork);
      }
      
      // Any payment clients or facades would need to be reconstructed by the caller
      // after switching, as they cache the network from construction time
    },
  };
}
```

## Testing

### Test: Session Cannot Cross Networks

```typescript
describe("switchNetwork", () => {
  it("proves a session created on one network can never be used to sign on the other", async () => {
    const kit = fakeKit();
    const connector = createPasskeyKitConnector({
      kit,
      backend: mockBackend(),
      network: "testnet",
      appName: "Test App",
    });

    // Connect on testnet
    const session = await connector.connectWallet("testnet");
    expect(session.network).toBe("testnet");
    
    // Can sign on testnet
    const tx = await connector.signTransaction({ xdr: "xdr-payload", network: "testnet" });
    expect(tx.signedXdr).toBe("signed-xdr");

    // Attempting to sign on mainnet fails with WalletNetworkMismatchError
    await expect(
      connector.signTransaction({ xdr: "xdr-payload", network: "mainnet" }),
    ).rejects.toThrow(WalletNetworkMismatchError);

    // Switch to mainnet
    connector.switchNetwork?.("mainnet");

    // Now signing on testnet is rejected
    await expect(
      connector.signTransaction({ xdr: "xdr-payload", network: "testnet" }),
    ).rejects.toThrow(WalletNetworkMismatchError);

    // And connecting on mainnet succeeds and allows signing on mainnet
    await connector.connectWallet("mainnet");
    const mainnetTx = await connector.signTransaction({ xdr: "xdr-payload", network: "mainnet" });
    expect(mainnetTx.signedXdr).toBe("signed-xdr");
  });

  it("clears connected session and forces fresh connect on the new network", async () => {
    const sessionStore = createSessionStore(createMemoryStorageAdapter());
    const wallet = createVellarWallet({
      connector: mockConnector(),
      sessionStore,
      backend: mockBackend(),
    });

    await wallet.connect({ network: "testnet" });
    expect(wallet.session?.network).toBe("testnet");

    // Switching network clears session
    wallet.switchNetwork("mainnet");
    expect(wallet.session).toBeNull();

    // Must reconnect before operations
    await wallet.connect({ network: "mainnet" });
    expect(wallet.session?.network).toBe("mainnet");
  });
});
```

## Key Design Decisions

1. **Optional method**: `switchNetwork?` is optional on the interface, so connectors that don't support switching (e.g., fixed-network test doubles) don't need to implement it.

2. **Clears state**: Resets `network` and `activeSessionKeyPublicKey` to prevent carrying testnet state to mainnet.

3. **Client-level coordination**: The `VellarWallet` client's `switchNetwork()` clears the session store AND switches the connector, ensuring consistent state.

4. **Forces reconnect**: After switching, `connectWallet()` must be called again before any operations. This prevents silent failures.

5. **Test proof**: The test explicitly verifies that a session from one network cannot be used to sign on another network.

## Alternative: Documentation Only

If you choose NOT to add `switchNetwork()`, document the safe teardown order in `website/content/docs/advanced.md`:

```markdown
### Switching Networks

To switch between testnet and mainnet:

1. Call `wallet.disconnect()` to clear the session
2. Reconstruct the connector with the new network
3. Reconstruct the VellarWallet client with the new connector
4. Call `wallet.connect()` to establish a new session

**Never** reuse a connector or session across networks. A testnet wallet address is meaningless on mainnet.
```

This implementation chooses the **switching path** because it's safer and more ergonomic than requiring reconstruction.
