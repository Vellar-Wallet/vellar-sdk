# Mainnet Migration Guide

## Important Warning

**Mainnet use of this SDK is pending a security review.** This guide is provided for preparation purposes only. Do not deploy to mainnet in production without completing a thorough security audit and understanding the risks.

## Overview

This guide walks through the process of migrating a Vellar SDK application from testnet to mainnet. Follow these steps carefully to ensure a secure and successful migration.

## Prerequisites

Before migrating to mainnet, ensure you have:

1. **Thoroughly tested on testnet** - All wallet operations, payments, and policies should work correctly on testnet
2. **Soroban RPC provider** - A reliable mainnet Soroban RPC endpoint (SDF does not provide free mainnet RPC)
3. **passkey-kit version verification** - Know your exact passkey-kit version and its corresponding mainnet WASM hash
4. **Backend infrastructure** - Production-ready backend with OpenZeppelin Relayer API key and funded sponsor account
5. **Security review** - Completed security audit of your application
6. **Monitoring and alerting** - Infrastructure to monitor wallet operations and catch issues quickly

## Step-by-Step Migration

### Step 1: Verify passkey-kit Version and WASM Hash

The wallet WASM hash MUST match your passkey-kit version. A mismatch causes silent failures.

```bash
# Check your installed passkey-kit version
npm list passkey-kit

# Example output:
# passkey-kit@1.2.3
```

Visit the [passkey-kit repository](https://github.com/Passkey-Kit/passkey-kit) and locate the mainnet deployment manifest for your version. The manifest contains the verified mainnet WASM hash.

**Critical**: Do NOT copy the testnet WASM hash. Do NOT guess. Verify against the official manifest.

### Step 2: Configure Mainnet Network Settings

Replace your testnet configuration with mainnet settings using `mainnetConfig()`:

**Before (Testnet):**

```typescript
import { createVellarWallet, TESTNET } from "vellar-sdk";

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
  backend: createHttpWalletBackend("https://testnet-api.myapp.com"),
});
```

**After (Mainnet):**

```typescript
import { createVellarWallet, mainnetConfig } from "vellar-sdk";

// Use environment variables for sensitive configuration
const network = mainnetConfig({
  rpcUrl: process.env.MAINNET_RPC_URL!,
  walletWasmHash: process.env.MAINNET_WALLET_WASM_HASH!,
});

const vellar = createVellarWallet({
  network: "mainnet",
  appName: "My App",
  kit: new PasskeyKit({
    rpcUrl: network.rpcUrl,
    networkPassphrase: network.networkPassphrase,
    walletWasmHash: network.walletWasmHash,
  }),
  sac: new SACClient({
    rpcUrl: network.rpcUrl,
    networkPassphrase: network.networkPassphrase,
  }),
  backend: createHttpWalletBackend(process.env.PRODUCTION_BACKEND_URL!),
  isValidAddress: (a) =>
    StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a),
});
```

### Step 3: Environment Configuration

Create a `.env.production` file with mainnet-specific values:

```bash
# Mainnet Soroban RPC endpoint (from your provider)
MAINNET_RPC_URL=https://your-provider.com/soroban-mainnet

# Verified WASM hash from passkey-kit mainnet deployment manifest
MAINNET_WALLET_WASM_HASH=your_verified_64_char_hex_hash_here

# Production backend URL
PRODUCTION_BACKEND_URL=https://api.myapp.com

# OpenZeppelin Relayer API key (for fee sponsorship)
OZ_RELAYER_API_KEY=your_mainnet_relayer_key

# Funded sponsor account secret (NEVER commit to version control)
SPONSOR_SECRET_KEY=your_mainnet_sponsor_secret
```

**Security**: Store these values securely using a secrets management service (AWS Secrets Manager, HashiCorp Vault, etc.). Never commit secrets to version control.

### Step 4: Update Backend Configuration

Your backend must be configured for mainnet:

```typescript
// backend/config.ts
import { mainnetConfig } from "vellar-sdk";

const network = mainnetConfig({
  rpcUrl: process.env.MAINNET_RPC_URL!,
  walletWasmHash: process.env.MAINNET_WALLET_WASM_HASH!,
});

export const config = {
  network,
  ozRelayerApiKey: process.env.OZ_RELAYER_API_KEY!,
  sponsorSecretKey: process.env.SPONSOR_SECRET_KEY!,
  // Circuit breaker for production resilience
  circuitBreaker: {
    failureThreshold: 5,
    openDurationMs: 30_000,
    halfOpenMaxCalls: 2,
  },
};
```

### Step 5: Update Token Contract IDs

Replace testnet token contract IDs with mainnet equivalents:

```typescript
// Testnet (before)
const usdcToken = {
  contractId: TESTNET.usdcContractId,
  symbol: "USDC",
  decimals: 7,
};

// Mainnet (after)
const network = mainnetConfig({ rpcUrl, walletWasmHash });
const usdcToken = {
  contractId: network.usdcContractId, // Mainnet USDC
  symbol: "USDC",
  decimals: 7,
};
```

**Important**: Verify the USDC issuer matches Circle's official mainnet issuer:
- Mainnet USDC Issuer: `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`
- Source: [Circle Multi-Chain USDC](https://www.circle.com/multi-chain-usdc/stellar)

### Step 6: Enable Production Circuit Breaker

Configure the circuit breaker for production-grade resilience:

```typescript
const vellar = createVellarWallet({
  // ... other config
  circuitBreaker: {
    failureThreshold: 5,      // Open after 5 consecutive failures
    openDurationMs: 30_000,   // Stay open for 30 seconds
    halfOpenMaxCalls: 2,      // Allow 2 trial calls in half-open
  },
});
```

### Step 7: Implement Health Checks

Add RPC endpoint health checks before critical operations:

```typescript
import { isReachable } from "vellar-sdk/rpc";

async function initializeWallet() {
  const health = await isReachable(config.rpcUrl, { timeoutMs: 5000 });
  
  if (!health.reachable) {
    console.error("Mainnet RPC unreachable:", health.error);
    // Alert monitoring system
    // Show user-friendly error
    throw new Error("Network unavailable. Please try again later.");
  }
  
  console.log(`RPC healthy (${health.latencyMs}ms latency)`);
  return createVellarWallet(config);
}
```

### Step 8: Update Policy Contracts

If using policies, redeploy them to mainnet:

1. Review all policy definitions for mainnet-appropriate limits
2. Deploy policy contracts to mainnet (via your backend)
3. Test policy enforcement thoroughly in staging
4. Update frontend to reference mainnet policy contract IDs

```typescript
// Example: Spending limit policy for mainnet
const mainnetSpendingLimit = {
  version: "1.0",
  type: "spending-limit",
  owners: [walletAddress],
  spendingLimits: {
    dailyXlm: "100",      // Conservative limits for mainnet
    perTxXlm: "10",
  },
};
```

### Step 9: Testing Checklist

Before going live, verify:

- [ ] Wallet creation succeeds and deploys contract
- [ ] Passkey authentication works (creation and reconnection)
- [ ] Payments execute and settle on-chain
- [ ] Fee sponsorship works (users don't need XLM)
- [ ] Policy enforcement works correctly
- [ ] Circuit breaker opens on RPC failures
- [ ] Error handling gracefully handles edge cases
- [ ] Session persistence and restoration works
- [ ] Agent keys (if used) respect on-chain budgets
- [ ] x402 payments (if used) settle correctly

### Step 10: Monitoring and Alerts

Set up monitoring for:

1. **RPC endpoint health** - Alert on prolonged unavailability
2. **Transaction success rate** - Alert on increased failures
3. **Sponsor account balance** - Alert before funds run out
4. **Circuit breaker state** - Alert when circuit opens
5. **Error rates** - Alert on unusual error patterns
6. **Latency** - Alert on degraded performance

Example monitoring setup:

```typescript
import { CircuitOpenError, WalletApiError } from "vellar-sdk";

try {
  await vellar.pay({ to, amount, token });
  metrics.recordSuccess("wallet.payment");
} catch (error) {
  if (error instanceof CircuitOpenError) {
    alerts.send("Circuit breaker opened - RPC may be down");
    metrics.recordError("wallet.circuit_open");
  } else if (error instanceof WalletApiError) {
    alerts.send(`Backend error: ${error.code} - ${error.status}`);
    metrics.recordError("wallet.backend_error");
  } else {
    alerts.send(`Unexpected error: ${error.message}`);
    metrics.recordError("wallet.unknown_error");
  }
  throw error;
}
```

## Migration Strategies

### Strategy 1: Gradual Rollout

1. Deploy mainnet infrastructure in shadow mode (monitoring only)
2. Enable for internal team members only
3. Gradually roll out to beta users (1%, 5%, 10%, etc.)
4. Monitor each stage for 24-48 hours before expanding
5. Full rollout only after stability is proven

### Strategy 2: Parallel Operation

1. Run testnet and mainnet versions side-by-side
2. Let users opt-in to mainnet through feature flag
3. Monitor both environments for comparison
4. Gradually migrate users from testnet to mainnet
5. Deprecate testnet after successful migration

### Strategy 3: Staged Migration

1. Create dedicated staging environment using mainnet
2. Test with real users in staging for 1-2 weeks
3. Collect feedback and fix issues
4. Deploy to production only after staging is stable
5. Keep staging running for ongoing testing

## Common Migration Issues

### Issue 1: Wrong WASM Hash

**Symptom**: Wallet creation fails silently or with unclear errors

**Solution**: 
1. Verify your passkey-kit version: `npm list passkey-kit`
2. Check the passkey-kit repository for the correct mainnet WASM hash
3. Update your environment variable
4. Restart your application

### Issue 2: RPC Endpoint Failures

**Symptom**: Intermittent failures, timeouts, or circuit breaker opening frequently

**Solution**:
1. Verify your RPC provider's status page
2. Check rate limits and quotas
3. Consider upgrading to a higher-tier plan
4. Set up fallback RPC endpoints
5. Tune circuit breaker thresholds

### Issue 3: Sponsor Account Depleted

**Symptom**: Transactions fail with "insufficient fee" errors

**Solution**:
1. Set up monitoring alerts for sponsor balance
2. Automate balance top-ups
3. Keep reserve buffer (e.g., 1000 XLM minimum)
4. Document manual top-up procedure for emergencies

### Issue 4: Network Passphrase Mismatch

**Symptom**: Signature verification failures, transaction rejections

**Solution**:
1. Ensure using `mainnetConfig()` which provides correct passphrase
2. Never override the network passphrase manually
3. Verify all dependencies use matching network configuration

### Issue 5: Token Contract ID Errors

**Symptom**: Payment simulation fails, "asset not found" errors

**Solution**:
1. Verify using mainnet token contract IDs (not testnet)
2. For USDC, verify against Circle's official issuer
3. Use the contract IDs from `mainnetConfig()` output
4. Test token operations in staging first

## Rollback Plan

If issues arise after migration, have a rollback strategy:

1. **Immediate**: Switch DNS/load balancer back to testnet version
2. **Frontend**: Deploy previous testnet build
3. **Backend**: Revert to testnet configuration
4. **Database**: Mark accounts for manual review if state diverged
5. **Communication**: Notify users of temporary service interruption

Document rollback procedures and test them before mainnet launch.

## Post-Migration Checklist

After migration:

- [ ] Confirm all monitoring alerts are active
- [ ] Document mainnet-specific configuration
- [ ] Update internal runbooks with mainnet procedures
- [ ] Set up regular security audits schedule
- [ ] Review and update incident response procedures
- [ ] Establish regular sponsor account balance checks
- [ ] Document disaster recovery procedures
- [ ] Train support team on mainnet-specific issues

## Security Best Practices

1. **Secrets Management**: Use a dedicated secrets manager, never hardcode
2. **Access Control**: Limit who can access mainnet credentials
3. **Audit Logging**: Log all mainnet operations for security review
4. **Incident Response**: Have a documented plan for security incidents
5. **Regular Updates**: Keep SDK and dependencies up to date
6. **Penetration Testing**: Conduct regular security assessments
7. **Bug Bounty**: Consider a responsible disclosure program

## Support and Resources

- [Vellar SDK Documentation](https://docs.vellar.xyz)
- [Network Configuration Guide](./network-configuration.md)
- [Security Audit Documentation](./security-audit.md)
- [Stellar Soroban Documentation](https://developers.stellar.org/docs/soroban)
- [passkey-kit Repository](https://github.com/Passkey-Kit/passkey-kit)

## Conclusion

Mainnet migration is a critical process that requires careful planning and thorough testing. Take your time, test extensively in staging, and monitor closely after launch. When in doubt, consult with security experts and the Vellar community.

**Remember**: Mainnet handles real assets. One mistake can result in permanent loss. Be conservative, test thoroughly, and prioritize security over speed.
