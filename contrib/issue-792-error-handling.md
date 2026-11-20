# Error Handling Guide for Vellar SDK

**Related to Issue #792**

## Overview

This guide provides comprehensive error handling patterns for the Vellar SDK. Proper error handling improves user experience and makes debugging easier.

## Core Error Types

The Vellar SDK exports several typed error classes for specific failure modes:

### Payment Errors

```typescript
import {
  InvalidRecipientError,
  InvalidAmountError,
  PaymentRejectedError,
  MaxAmountExceededError,
} from "vellar-sdk";

try {
  await vellar.pay({ to, amount, token });
} catch (error) {
  if (error instanceof InvalidRecipientError) {
    console.error("The recipient address is invalid");
  } else if (error instanceof InvalidAmountError) {
    console.error("The payment amount is invalid");
  } else if (error instanceof MaxAmountExceededError) {
    console.error("Payment exceeds maximum allowed amount");
  } else if (error instanceof PaymentRejectedError) {
    console.error("Payment was rejected by the network");
  }
}
```

### Wallet Backend Errors

```typescript
import { WalletApiError } from "vellar-sdk";

try {
  const session = await vellar.create({ username: "alice" });
} catch (error) {
  if (error instanceof WalletApiError) {
    console.error(`Backend error (${error.status}): ${error.message}`);
    if (error.code) {
      console.error(`Error code: ${error.code}`);
    }
  }
}
```

### Circuit Breaker Errors

```typescript
import { CircuitOpenError } from "vellar-sdk";

try {
  await vellar.pay({ to, amount, token });
} catch (error) {
  if (error instanceof CircuitOpenError) {
    console.error("Service temporarily unavailable. Please try again later.");
    // Show user-friendly message about temporary outage
  }
}
```

### x402 Payment Errors

```typescript
import {
  MaxAmountExceededError,
  DisallowedAssetError,
  NoUsablePaymentOptionError,
  InvalidRequirementsError,
  X402NotConfiguredError,
} from "vellar-sdk";

try {
  const { response, paid } = await vellar.x402.fetch(url, { maxAmount });
} catch (error) {
  if (error instanceof MaxAmountExceededError) {
    console.error("Resource price exceeds maximum allowed");
  } else if (error instanceof DisallowedAssetError) {
    console.error("Payment asset not allowed");
  } else if (error instanceof NoUsablePaymentOptionError) {
    console.error("No compatible payment option available");
  } else if (error instanceof InvalidRequirementsError) {
    console.error("Server payment requirements are invalid");
  } else if (error instanceof X402NotConfiguredError) {
    console.error("x402 not configured in wallet");
  }
}
```

## Error Handling Patterns

### 1. Progressive Error Disclosure

Start with user-friendly messages, provide technical details on request:

```typescript
async function handlePayment(to: string, amount: bigint, token: TokenInfo) {
  try {
    const result = await vellar.pay({ to, amount, token });
    return { success: true, hash: result.hash };
  } catch (error) {
    // User-friendly message
    let userMessage = "Payment failed. Please try again.";
    let technicalDetails = "";

    if (error instanceof InvalidRecipientError) {
      userMessage = "The recipient address is not valid.";
      technicalDetails = `Address: ${to}`;
    } else if (error instanceof InvalidAmountError) {
      userMessage = "The payment amount is not valid.";
      technicalDetails = `Amount: ${amount}`;
    } else if (error instanceof WalletApiError) {
      userMessage = "Unable to process payment at this time.";
      technicalDetails = `Status: ${error.status}, Code: ${error.code}`;
    }

    return {
      success: false,
      userMessage,
      technicalDetails,
      error,
    };
  }
}
```

### 2. Retry Logic with Exponential Backoff

For transient errors, implement retry logic:

```typescript
async function payWithRetry(
  vellar: VellarWallet,
  params: { to: string; amount: bigint; token: TokenInfo },
  maxRetries = 3
) {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await vellar.pay(params);
    } catch (error) {
      lastError = error as Error;

      // Don't retry on validation errors
      if (
        error instanceof InvalidRecipientError ||
        error instanceof InvalidAmountError
      ) {
        throw error;
      }

      // Retry on network/transient errors
      if (
        error instanceof WalletApiError ||
        error instanceof CircuitOpenError
      ) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Unknown error - don't retry
      throw error;
    }
  }

  throw lastError;
}
```

### 3. Fallback Strategies

Provide fallback options when primary method fails:

```typescript
async function connectWallet(vellar: VellarWallet) {
  try {
    // Try to reconnect with existing passkey
    const session = await vellar.connect();
    return { type: "reconnected", session };
  } catch (error) {
    if (error instanceof WalletApiError && error.status === 404) {
      // No existing wallet found - guide user to create one
      return { type: "needs_creation", error: null };
    }

    // Other errors
    return { type: "error", error };
  }
}
```

### 4. Error Logging and Monitoring

Log errors with context for debugging:

```typescript
function logError(context: string, error: Error, metadata?: Record<string, any>) {
  const errorLog = {
    timestamp: new Date().toISOString(),
    context,
    errorName: error.constructor.name,
    message: error.message,
    stack: error.stack,
    ...metadata,
  };

  console.error(JSON.stringify(errorLog));

  // Send to monitoring service in production
  if (process.env.NODE_ENV === "production") {
    // sendToMonitoring(errorLog);
  }
}

// Usage
try {
  await vellar.pay({ to, amount, token });
} catch (error) {
  logError("payment_failed", error as Error, {
    recipient: to,
    amount: amount.toString(),
    token: token.symbol,
  });
  throw error;
}
```

## User Experience Best Practices

### 1. Clear Error Messages

❌ **Bad**: "Error occurred"  
✅ **Good**: "Unable to send payment. The recipient address is not valid."

❌ **Bad**: "API Error 500"  
✅ **Good**: "Our payment service is temporarily unavailable. Please try again in a few moments."

### 2. Actionable Guidance

Provide next steps when errors occur:

```typescript
function getErrorGuidance(error: Error): string {
  if (error instanceof InvalidRecipientError) {
    return "Please check the recipient address and try again.";
  }
  if (error instanceof InvalidAmountError) {
    return "Please enter a valid payment amount greater than zero.";
  }
  if (error instanceof CircuitOpenError) {
    return "The service is temporarily unavailable. Please wait a moment and try again.";
  }
  if (error instanceof WalletApiError) {
    if (error.status >= 500) {
      return "Our servers are experiencing issues. Please try again later.";
    }
    return "There was a problem with your request. Please check your information and try again.";
  }
  return "An unexpected error occurred. Please try again or contact support if the problem persists.";
}
```

### 3. Error Recovery UI

```typescript
interface ErrorState {
  error: Error | null;
  canRetry: boolean;
  userMessage: string;
  guidance: string;
}

function getErrorState(error: Error): ErrorState {
  const canRetry = !(
    error instanceof InvalidRecipientError ||
    error instanceof InvalidAmountError
  );

  return {
    error,
    canRetry,
    userMessage: getUserMessage(error),
    guidance: getErrorGuidance(error),
  };
}
```

## Testing Error Scenarios

### Mock Error Conditions

```typescript
import { describe, it, expect, vi } from "vitest";

describe("Error Handling", () => {
  it("should handle invalid recipient gracefully", async () => {
    const mockPay = vi.fn().mockRejectedValue(
      new InvalidRecipientError("Invalid address")
    );

    await expect(mockPay()).rejects.toThrow(InvalidRecipientError);
  });

  it("should handle backend errors", async () => {
    const mockCreate = vi.fn().mockRejectedValue(
      new WalletApiError("Server error", 500, "INTERNAL_ERROR")
    );

    await expect(mockCreate()).rejects.toThrow(WalletApiError);
  });
});
```

## Network-Specific Considerations

### Testnet Development

During development on testnet:
- Log all errors verbosely
- Don't suppress stack traces
- Include request/response details

### Mainnet Production

In production on mainnet:
- Sanitize error messages (remove sensitive data)
- Use structured logging
- Implement error monitoring and alerting
- Have incident response procedures

## Summary

1. **Use typed error classes** for precise error handling
2. **Implement retry logic** for transient failures
3. **Provide clear messages** and actionable guidance
4. **Log errors with context** for debugging
5. **Test error scenarios** thoroughly
6. **Consider user experience** in error states

## Resources

- [Vellar SDK Error Reference](https://docs.vellar.xyz/docs/errors)
- [Circuit Breaker Pattern](https://docs.vellar.xyz/docs/circuit-breaker)
- [Best Practices Guide](https://docs.vellar.xyz/docs/best-practices)
