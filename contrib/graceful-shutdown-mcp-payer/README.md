# Graceful Shutdown for MCP Payer Server

## Overview

This document describes the graceful shutdown pattern implemented in the MCP x402 payer server. It ensures that when the process receives a termination signal (SIGTERM or SIGINT), it:

1. **Stops accepting new payments** - Blocks new tool calls from being processed
2. **Allows in-flight payments to complete** - Waits for any payment currently being processed to finish
3. **Maintains ledger consistency** - Ensures all payments are either fully recorded or not at all
4. **Exits cleanly** - Terminates only after all in-flight operations complete

## Problem Statement

Without graceful shutdown handling, a host application terminating the MCP payer process risks:

- **Indeterminate payments** - A payment signed but not submitted, leaving the ledger in an inconsistent state
- **Lost ledger writes** - Pending ledger updates not flushed before exit
- **Partial transactions** - Payments stuck mid-settlement with unclear blockchain state

## Architecture

### Three-Layer Implementation

The solution is implemented across three layers:

#### Layer 1: Ledger Shutdown Coordination (`ledger.ts`)

The spend ledger now tracks in-flight payment critical sections:

```typescript
export interface SpendLedger {
  // Existing methods...
  assertWithinCeiling(asset: string, amount: bigint): void;
  record(asset: string, amount: bigint): void;
  
  // New shutdown methods:
  isShuttingDown(): boolean;                    // Check if shutdown started
  shutdown(): Promise<void>;                    // Initiate shutdown, wait for in-flight
  _trackCriticalSectionStart(): void;           // Internal: track critical section start
  _trackCriticalSectionEnd(): void;             // Internal: track critical section end
}
```

**How it works:**
- Maintains counter of in-flight critical sections
- When `shutdown()` is called, sets flag to block new calls
- Returns promise that resolves only when all in-flight sections complete
- `assertWithinCeiling()` throws immediately if shutdown initiated

#### Layer 2: Mutex Lifecycle Tracking (`ledger.ts`)

The mutex serializes payments and now tracks their lifecycle with the ledger:

```typescript
export function createMutex(ledger?: SpendLedger): <T>(fn: () => Promise<T>) => Promise<T> {
  // For each critical section:
  // 1. Call ledger._trackCriticalSectionStart()
  // 2. Execute the payment function
  // 3. Call ledger._trackCriticalSectionEnd() in finally block
  // This ensures ledger always knows how many payments are in-flight
}
```

**Benefits:**
- Accurate in-flight tracking
- Exception-safe (finally block ensures end is always called)
- Transparent to payment logic

#### Layer 3: Signal Handlers & Coordination (`bin.ts` and `server.ts`)

The entry point registers signal handlers and coordinates shutdown:

```typescript
// In bin.ts:
process.on("SIGTERM", () => shutdownHandler("SIGTERM"));
process.on("SIGINT", () => shutdownHandler("SIGINT"));

async function shutdownHandler(signal: string) {
  log("info", `shutdown signal received: ${signal}`, { signal });
  try {
    await serverHandle.shutdown();  // Waits for all in-flight payments
    log("info", "graceful shutdown complete", { signal });
  } catch (err) {
    log("error", "error during graceful shutdown", { signal, error });
  }
  process.exit(0);
}
```

**Shutdown Sequence:**
1. Signal received (SIGTERM or SIGINT)
2. `shutdownHandler` calls `serverHandle.shutdown()`
3. Ledger blocks new payments via `isShuttingDown()` check
4. Waits for in-flight payments via `shutdown()` promise
5. All payments complete or fail
6. Process exits with code 0

## State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                         NORMAL OPERATION                         │
│  • Accepting new payments                                        │
│  • Ledger: isShuttingDown() = false                              │
│  • In-flight counter increments/decrements as payments start/end │
└────────────────────────┬────────────────────────────────────────┘
                         │
                    [Signal Received]
                    [SIGTERM/SIGINT]
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SHUTDOWN INITIATED                          │
│  • Ledger: isShuttingDown() = true                               │
│  • New payments rejected: "Server is shutting down..."           │
│  • In-flight payments allowed to complete                        │
│  • Ledger.shutdown() waits on promise                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                  [In-flight counter = 0]
                    [All payments done]
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SHUTDOWN COMPLETE                            │
│  • All payments processed                                        │
│  • Ledger snapshot frozen and consistent                         │
│  • Process exit(0)                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Checklist

When implementing graceful shutdown for a similar MCP server:

### 1. Add Shutdown State to Ledger/Resource Manager
- [ ] Add `isShuttingDown()` method
- [ ] Add `shutdown()` promise method
- [ ] Add internal tracking methods for critical sections
- [ ] Block operations when `isShuttingDown()` is true

### 2. Update Mutex/Serialization Layer
- [ ] Accept optional resource manager parameter
- [ ] Call `_trackCriticalSectionStart()` at section entry
- [ ] Call `_trackCriticalSectionEnd()` in finally block
- [ ] Maintain exact section boundaries

### 3. Integrate with Entry Point
- [ ] Register SIGTERM handler
- [ ] Register SIGINT handler
- [ ] Call `ledger.shutdown()` and wait
- [ ] Log shutdown events
- [ ] Exit with code 0 after shutdown completes

### 4. Update Core Logic Layer
- [ ] Pass ledger/manager to mutex creator
- [ ] Ensure all critical sections use tracked mutex
- [ ] No changes needed to individual payment logic

### 5. Test Coverage
- [ ] Test shutdown blocks new operations
- [ ] Test in-flight operations complete
- [ ] Test concurrent in-flight operations
- [ ] Test ledger state consistency after shutdown
- [ ] Test mid-operation shutdown
- [ ] Test multiple shutdown calls (should be idempotent)

## Key Properties

### 1. Atomicity
Payments are recorded all-or-nothing:
- A payment that completes settles fully and records
- A payment that fails or is interrupted never records partial state
- Ledger reflects exactly what was confirmed on-chain

### 2. No Indefinite Waiting
- Shutdown waits only for in-flight operations
- No arbitrary timeouts needed
- Operations proceed at their natural pace
- Maximum wait is network timeout of current operation

### 3. Signal Safety
- Signal handlers immediately call async shutdown
- Long-running operations don't prevent shutdown
- New requests rejected instantly when shutdown initiated
- In-flight requests given time to complete

### 4. Backward Compatible
- Optional ledger parameter to mutex
- Existing code continues to work unchanged
- New shutdown capability is opt-in

## Error Handling

### Shutdown During Payment Failure
If a payment fails while shutdown is in progress:
- Error is thrown and caught in mutex
- `_trackCriticalSectionEnd()` still called (in finally)
- Ledger correctly reflects that section completed
- Shutdown promise unblocked and continues

### Shutdown During Network Error
If network timeout occurs during payment:
- Payment handler receives error and returns result
- Section marked as complete
- Shutdown continues waiting for other sections

### Recording Indeterminate Settlements
If a payment settlement is unreadable:
- Payment logic throws `IndeterminateSettlementError`
- Ledger has already debited the amount (as precaution)
- Section completes, shutdown continues
- Ledger consistency maintained (over-counted rather than under-counted)

## Testing Strategy

### Unit Tests - Ledger Shutdown
```typescript
// Basic state tracking
it("reports not shutting down initially")
it("blocks new payments after shutdown is initiated")
it("allows in-flight payments to complete")
it("resolves immediately if no in-flight payments")

// Mutex integration
it("tracks critical section lifecycle")
it("keeps chain alive even if section throws")
it("prevents concurrent check-then-act from busting ceiling")
```

### Unit Tests - Mid-Payment Consistency
```typescript
// Consistency verification
it("ledger ends in consistent state when shutdown mid-payment")
it("no partial ledger updates - all or nothing")
it("multiple concurrent payments complete before shutdown resolves")
it("cross-asset payments correctly recorded")
it("snapshot remains consistent after shutdown")
```

### Integration Tests
```typescript
// Real-world scenarios
it("handles SIGTERM signal correctly")
it("handles SIGINT signal correctly")
it("logs shutdown events")
it("exits with code 0 after graceful shutdown")
```

## Performance Characteristics

| Scenario | Behavior | Time |
|----------|----------|------|
| Shutdown with no in-flight | Resolves immediately | <1ms |
| Shutdown with 1 in-flight (10s payment) | Waits for payment | ~10s |
| Shutdown with 3 in-flight (concurrent) | Waits for longest | ~longest duration |
| New request after shutdown | Rejected instantly | <1ms |

## Example: Complete Implementation

```typescript
// 1. Create ledger (tracks shutdown state)
const ledger = createSpendLedger(ceilings);

// 2. Create mutex with ledger tracking
const payer = createPayer({ config, ledger, signer });

// 3. Register signal handlers
process.on("SIGTERM", async () => {
  log("info", "SIGTERM received");
  try {
    await ledger.shutdown();  // Blocks new, waits for in-flight
    log("info", "Graceful shutdown complete");
  } catch (err) {
    log("error", "Shutdown error", { error: err });
  }
  process.exit(0);
});

process.on("SIGINT", async () => {
  log("info", "SIGINT received (Ctrl+C)");
  try {
    await ledger.shutdown();
    log("info", "Graceful shutdown complete");
  } catch (err) {
    log("error", "Shutdown error", { error: err });
  }
  process.exit(0);
});

// 4. Start server - requests automatically use tracked mutex
await startServer(payer);
```

## Related Issue

Fixes #609: Add graceful shutdown handling to the MCP payer server on SIGTERM

## References

- [Node.js Signal Handling](https://nodejs.org/en/docs/guides/simple-profiling/)
- [Graceful Shutdown Patterns](https://nodejs.org/api/process.html#process_signal_events)
- [Mutex Pattern for Serialization](https://en.wikipedia.org/wiki/Mutual_exclusion)
