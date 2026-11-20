# Payment Validation Best Practices

**Related to Issue #790**

## Overview

This document provides guidance on payment validation patterns and best practices when using the Vellar SDK. Proper validation ensures payments are safe, predictable, and provide clear feedback to users.

## Pre-Flight Validation

Before initiating a payment, always validate:

### 1. Recipient Address Format

```typescript
import { StrKey } from "@stellar/stellar-sdk";

function validateRecipient(address: string): boolean {
  return (
    StrKey.isValidEd25519PublicKey(address) || 
    StrKey.isValidContract(address)
  );
}

// Usage
if (!validateRecipient(recipientAddress)) {
  throw new Error("Invalid recipient address format");
}
```

### 2. Amount Boundaries

```typescript
function validateAmount(amount: bigint): void {
  if (amount <= 0n) {
    throw new Error("Amount must be positive");
  }
  
  // Check against maximum safe amount for the token
  const MAX_SAFE_AMOUNT = 9_223_372_036_854_775_807n; // i64 max
  if (amount > MAX_SAFE_AMOUNT) {
    throw new Error("Amount exceeds maximum safe value");
  }
}

// Usage
validateAmount(paymentAmount);
```

### 3. Token Configuration

```typescript
interface TokenInfo {
  contractId: string;
  symbol: string;
  decimals: number;
}

function validateToken(token: TokenInfo): void {
  if (!token.contractId || token.contractId.length !== 56) {
    throw new Error("Invalid token contract ID");
  }
  
  if (!token.symbol || token.symbol.length === 0) {
    throw new Error("Token symbol is required");
  }
  
  if (token.decimals < 0 || token.decimals > 18) {
    throw new Error("Token decimals must be between 0 and 18");
  }
}
```

## Balance Verification

Before submitting a payment, verify sufficient balance:

```typescript
async function verifyBalance(
  wallet: VellarWallet,
  token: TokenInfo,
  amount: bigint
): Promise<boolean> {
  // Get current balance
  const balances = await wallet.getBalances();
  const tokenBalance = balances.find(b => b.contractId === token.contractId);
  
  if (!tokenBalance) {
    throw new Error(`No balance found for token ${token.symbol}`);
  }
  
  // Compare with required amount
  return tokenBalance.balance >= amount;
}
```

## Simulation Before Signing

The SDK's `pay()` method automatically simulates before prompting for a passkey. For custom flows:

```typescript
// The pay method handles this internally
const { hash } = await vellar.pay({
  to: recipientAddress,
  amount: amountInStroops,
  token: tokenInfo,
});

// Simulation happens before the passkey prompt
// Failures (insufficient balance, invalid recipient) 
// are caught before user interaction
```

## Error Handling Patterns

### Handle Specific Error Types

```typescript
import { 
  InvalidRecipientError, 
  InvalidAmountError,
  InsufficientBalanceError 
} from "vellar-sdk";

try {
  await vellar.pay({ to, amount, token });
} catch (error) {
  if (error instanceof InvalidRecipientError) {
    // Show user-friendly recipient error
    console.error("Invalid recipient address");
  } else if (error instanceof InvalidAmountError) {
    // Show amount validation error
    console.error("Invalid payment amount");
  } else if (error instanceof InsufficientBalanceError) {
    // Show insufficient balance error
    console.error("Insufficient balance for this payment");
  } else {
    // Handle other errors
    console.error("Payment failed:", error);
  }
}
```

## Network-Specific Considerations

### Testnet vs Mainnet

```typescript
// Always be explicit about the network
const config = {
  network: "testnet", // or "mainnet"
  appName: "My App",
  // ... other config
};

// For mainnet, use the dedicated config function
import { mainnetConfig } from "vellar-sdk";

const mainnet = mainnetConfig({
  rpcUrl: process.env.MAINNET_RPC_URL,
  walletWasmHash: process.env.MAINNET_WALLET_HASH,
});
```

### Fee Sponsorship

Payments in Vellar SDK are fee-sponsored by your backend:

- Ensure your backend relayer is funded
- Monitor relayer balance regularly
- Set up alerts for low balance conditions
- Have a fallback relayer for high availability

## User Feedback

Provide clear feedback at each stage:

1. **Before Payment**: Show amount, recipient, and token clearly
2. **During Simulation**: Indicate checking payment feasibility
3. **During Signing**: Explain why passkey is needed
4. **After Submission**: Show transaction hash and status link
5. **On Error**: Provide actionable error messages

## Security Checklist

- ✅ Validate recipient address format before submission
- ✅ Verify amount is within safe bounds
- ✅ Check token configuration is complete
- ✅ Confirm sufficient balance exists
- ✅ Let SDK handle simulation (don't skip it)
- ✅ Never bypass passkey prompts programmatically
- ✅ Log payment attempts for audit trails
- ✅ Handle errors gracefully with user feedback

## Common Pitfalls to Avoid

1. **Skipping Amount Validation**: Always validate before calling `pay()`
2. **Ignoring Simulation Errors**: The SDK simulates for a reason
3. **Poor Error Messages**: Users need actionable feedback
4. **Missing Balance Checks**: Verify balance before initiating payment
5. **Hardcoded Decimals**: Always use token-specific decimal values

## Integration Example

```typescript
import { createVellarWallet, TESTNET } from "vellar-sdk";
import { StrKey } from "@stellar/stellar-sdk";

async function makePayment(
  to: string,
  amount: bigint,
  token: TokenInfo
) {
  // 1. Validate inputs
  if (!StrKey.isValidEd25519PublicKey(to) && 
      !StrKey.isValidContract(to)) {
    throw new Error("Invalid recipient address");
  }
  
  if (amount <= 0n) {
    throw new Error("Amount must be positive");
  }
  
  // 2. Initialize wallet
  const vellar = createVellarWallet({
    network: "testnet",
    appName: "My App",
    kit: passkeyKit,
    sac: sacClient,
    backend: backendClient,
    isValidAddress: (a) => 
      StrKey.isValidEd25519PublicKey(a) || 
      StrKey.isValidContract(a),
  });
  
  // 3. Verify balance (optional but recommended)
  const hasBalance = await verifyBalance(vellar, token, amount);
  if (!hasBalance) {
    throw new Error("Insufficient balance");
  }
  
  // 4. Execute payment (simulation happens automatically)
  const { hash } = await vellar.pay({ to, amount, token });
  
  return hash;
}
```

## References

- [Vellar SDK Documentation](https://docs.vellar.xyz)
- [Stellar SDK Documentation](https://stellar.github.io/js-stellar-sdk/)
- [Smart Account Security Model](https://docs.vellar.xyz/docs/security)
