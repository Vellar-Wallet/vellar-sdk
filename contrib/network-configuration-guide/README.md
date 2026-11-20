# Network Configuration Best Practices

## Overview

This guide covers best practices for configuring the Vellar SDK to connect to Stellar networks (testnet and mainnet). Proper network configuration is critical for security, reliability, and avoiding common pitfalls.

## Testnet Configuration

For testnet development, the SDK provides a complete `TESTNET` configuration constant:

```typescript
import { createVellarWallet, TESTNET } from "vellar-sdk";
import { PasskeyKit, SACClient } from "passkey-kit";

const vellar = createVellarWallet({
  network: "testnet",
  appName: "My App",
  kit: new PasskeyKit({
    rpcUrl: TESTNET.rpcUrl,
    networkPassphrase: TESTNET.networkPassphrase,
    walletWasmHash: TESTNET.walletWasmHash,
  }),
  sac: new SACClient({
    rpcUrl: TESTNET.rpcUrl,
    networkPassphrase: TESTNET.networkPassphrase,
  }),
  backend: createHttpWalletBackend("https://api.myapp.com"),
  isValidAddress: (a) =>
    StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a),
});
```

### Best Practices for Testnet

1. **Always use the TESTNET constant** - Don't hardcode network values; they may change with SDK updates
2. **Test with the hosted gateway** - For prototyping, use `https://vellar-backend.onrender.com` (note: free tier, first request after idle may take 30-90 seconds to wake)
3. **Verify contract IDs** - The SDK provides verified `nativeTokenContractId` and `usdcContractId` for testnet

## Mainnet Configuration

**⚠️ IMPORTANT**: Mainnet use is pending a security review. Do not use in production without understanding the risks.

Mainnet requires explicit configuration of two deployment-specific values:

```typescript
import { mainnetConfig } from "vellar-sdk";

const network = mainnetConfig({
  // 1. Your Soroban RPC provider endpoint (no free public endpoint exists)
  rpcUrl: "https://your-mainnet-soroban-rpc.example.com",
  
  // 2. Wallet WASM hash from passkey-kit deployment manifest
  // MUST match your passkey-kit version
  walletWasmHash: "your-verified-64-char-hex-hash",
});
```

### Best Practices for Mainnet

1. **Use mainnetConfig() function** - Never use the bare `MAINNET` constant directly; it has intentionally blank required fields that will cause runtime failures
2. **Verify the WASM hash** - Check against the passkey-kit mainnet deployment manifest for YOUR specific passkey-kit version. Do not copy the testnet hash
3. **Use a reliable RPC provider** - SDF does not provide free mainnet Soroban RPC. Choose a provider with appropriate SLAs for your use case
4. **Validate USDC issuer** - The SDK provides Circle's official USDC issuer (`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`). A wrong contractId fails loudly; a wrong issuer silently accepts impostor assets
5. **Test thoroughly on testnet first** - Validate all flows on testnet before attempting mainnet deployment

## Security Considerations

### RPC Endpoint Security

- Use HTTPS endpoints only
- Consider rate limiting and authentication if your RPC provider supports it
- Monitor RPC endpoint health
- Have fallback RPC endpoints configured for production

### WASM Hash Verification

The `walletWasmHash` is critical for security:

- **What it does**: Identifies the smart wallet contract code deployed on-chain
- **Why it matters**: A wrong hash could deploy a malicious or incompatible wallet contract
- **How to verify**: Check the passkey-kit GitHub releases for the deployment manifest matching your version

```typescript
// ✅ CORRECT - verified against passkey-kit deployment manifest
walletWasmHash: "fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0"

// ❌ WRONG - don't guess or copy without verification
walletWasmHash: "0000000000000000000000000000000000000000000000000000000000000000"
```

### Network Passphrase Validation

Network passphrases are hardcoded in `TESTNET` and `MAINNET` constants:

- **Testnet**: `"Test SDF Network ; September 2015"`
- **Mainnet**: `"Public Global Stellar Network ; September 2015"`

Never override these values. They're used to prevent cross-network transaction replay attacks.

## Health Check Integration

Before performing wallet operations, confirm the RPC endpoint is reachable:

```typescript
import { isReachable } from "vellar-sdk/rpc";

const health = await isReachable(config.rpcUrl, { timeoutMs: 3000 });
if (!health.reachable) {
  console.error("RPC endpoint unreachable:", health.error);
  return;
}

console.log(`RPC endpoint healthy (latency: ${health.latencyMs}ms)`);
```

## Common Pitfalls

### 1. Mixing Testnet and Mainnet Values

**Problem**: Using testnet WASM hash with mainnet network passphrase

**Solution**: Use `mainnetConfig()` which validates required fields

### 2. Hardcoding RPC URLs

**Problem**: RPC endpoints change or become unavailable

**Solution**: Use environment variables and configuration management

### 3. Not Handling RPC Failures

**Problem**: No circuit breaker or health checks lead to hanging requests

**Solution**: Use the SDK's built-in circuit breaker

## See Also

- [Stellar Soroban RPC Documentation](https://developers.stellar.org/docs/data/rpc)
- [passkey-kit Repository](https://github.com/Passkey-Kit/passkey-kit)
- [Circle USDC on Stellar](https://www.circle.com/multi-chain-usdc/stellar)
