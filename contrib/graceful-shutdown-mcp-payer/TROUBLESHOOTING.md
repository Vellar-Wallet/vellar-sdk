# Graceful Shutdown Troubleshooting Guide

## Problem: Shutdown Hangs (Timeout)

### Symptoms
- Signal sent but process doesn't exit
- Waiting more than 30 seconds
- No errors in logs

### Common Causes & Solutions

#### Cause 1: Signal handler not registered
```typescript
// ❌ WRONG: Forgot to register
// (no process.on("SIGTERM", ...))

// ✅ CORRECT: Must register both signals
process.on("SIGTERM", shutdownHandler);
process.on("SIGINT", shutdownHandler);
```

**Check:**
```bash
# Add logging to verify handler fires
process.on("SIGTERM", () => {
  console.error("[SHUTDOWN] SIGTERM received!");  // Should see this
  shutdownHandler("SIGTERM");
});
```

#### Cause 2: `isShuttingDown()` check not in operation

```typescript
// ❌ WRONG: No shutdown check, so still accepts new operations
async function process(item) {
  return exclusive(async () => {
    const result = await doWork(item);
    return result;
  });
}

// ✅ CORRECT: Check shutdown flag first
async function process(item) {
  return exclusive(async () => {
    if (stateManager.isShuttingDown()) {
      throw new Error("Server shutting down");
    }
    const result = await doWork(item);
    return result;
  });
}
```

**Check:**
```typescript
// Add this test to verify check works
it("rejects new operations after shutdown", async () => {
  await manager.shutdown();
  
  expect(() => {
    if (!manager.isShuttingDown()) {
      throw new Error("Check not working!");
    }
  }).not.toThrow();
});
```

#### Cause 3: Critical section tracking not active

```typescript
// ❌ WRONG: Created mutex without ledger
const exclusive = createExclusive();  // Missing parameter!

// ✅ CORRECT: Pass state manager for tracking
const exclusive = createExclusive(stateManager);
```

**Check:**
```typescript
// Verify tracking is wired
const exclusive = createExclusive(stateManager);

// Add debug logging
const original_start = stateManager._trackCriticalSectionStart;
stateManager._trackCriticalSectionStart = () => {
  console.log("[TRACK] Section started, in-flight++");
  original_start.call(stateManager);
};
```

#### Cause 4: `_trackCriticalSectionEnd()` not called (exception)

```typescript
// ❌ WRONG: End not guaranteed if exception
return async () => {
  stateManager._trackCriticalSectionStart();
  return await fn();  // If fn() throws, end() never called!
  stateManager._trackCriticalSectionEnd();
};

// ✅ CORRECT: Use finally
return async () => {
  stateManager._trackCriticalSectionStart();
  try {
    return await fn();
  } finally {
    stateManager._trackCriticalSectionEnd();  // Always called
  }
};
```

**Check:**
```typescript
it("ends critical section even if operation throws", async () => {
  const exclusive = createExclusive(stateManager);
  
  await expect(
    exclusive(async () => {
      throw new Error("Boom!");
    })
  ).rejects.toThrow("Boom!");

  // If implemented correctly, shutdown resolves immediately
  await expect(stateManager.shutdown()).resolves.toBeUndefined();
});
```

#### Cause 5: Operation has infinite loop or never completes

```typescript
// ❌ WRONG: Never terminates
async function doWork(item) {
  while (true) {  // ← infinite loop
    await processOne(item);
  }
}

// ✅ CORRECT: Operations must have exit conditions
async function doWork(item) {
  for (const subitem of item.subitems) {
    await processOne(subitem);
  }
}
```

**Check:**
```bash
# Send signal and wait 10s, then inspect
timeout 10 node dist/bin.js

# Add operation timeout
export NODE_OPTIONS="--trace-uncaught"
kill -SIGTERM <pid>
```

#### Cause 6: Deadlock - waiting for another resource

```typescript
// ❌ WRONG: Operation waits on another system
async function settle(tx) {
  const result = await waitForChainConfirmation(tx);  // Waits forever?
  return result;
}

// ✅ CORRECT: Add timeout
async function settle(tx) {
  const result = await Promise.race([
    waitForChainConfirmation(tx),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Settlement timeout")), 30000)
    )
  ]);
  return result;
}
```

**Check:**
```typescript
it("operations timeout to prevent indefinite wait", async () => {
  const start = Date.now();
  
  await expect(
    performOperationWithHungService()
  ).rejects.toThrow("timeout");
  
  // Should fail quickly, not after 60 seconds
  expect(Date.now() - start).toBeLessThan(35000);
});
```

---

## Problem: Partial State After Shutdown

### Symptoms
- Ledger shows incomplete transaction
- Some payments recorded, others not
- Inconsistent state

### Root Causes

#### Cause 1: Recording outside critical section

```typescript
// ❌ WRONG: Record outside the exclusive section
const exclusive = createExclusive(stateManager);

async function doPayment(amount) {
  return exclusive(async () => {
    await signPayment();  // Inside exclusive
  });
  // ← Record happens outside exclusive!
  stateManager.record(amount);
}

// ✅ CORRECT: Record inside exclusive
async function doPayment(amount) {
  return exclusive(async () => {
    await signPayment();
    stateManager.record(amount);  // Inside exclusive
  });
}
```

#### Cause 2: Check-then-act race without mutex

```typescript
// ❌ WRONG: Check and record not atomic
if (stateManager.canRecord(amount)) {  // Check
  // Process may be interrupted here
  stateManager.record(amount);  // Act
}

// ✅ CORRECT: Both inside exclusive
exclusive(async () => {
  stateManager.assertCanRecord(amount);  // Throws if can't
  stateManager.record(amount);  // Act
});
```

#### Cause 3: Shutdown not waiting for in-flight

```typescript
// ❌ WRONG: Shutdown doesn't wait
async function shutdownHandler() {
  stateManager.shutdown();  // ← Not awaited!
  process.exit(0);
}

// ✅ CORRECT: Must await
async function shutdownHandler() {
  await stateManager.shutdown();  // ← Waited!
  process.exit(0);
}
```

---

## Problem: New Requests Accepted During Shutdown

### Symptoms
- Requests processed after `SIGTERM` received
- Ledger changes after shutdown should be complete
- Error message says "shutting down" but operation still runs

### Root Causes

#### Cause 1: Check in wrong place

```typescript
// ❌ WRONG: Check in HTTP handler, not critical section
app.post("/pay", async (req, res) => {
  if (stateManager.isShuttingDown()) {  // Too late!
    return res.status(503).json({ error: "Shutting down" });
  }
  
  // Still enters exclusive even if shutdown started
  await payer.pay(req.body);
});

// ✅ CORRECT: Check inside critical section
app.post("/pay", async (req, res) => {
  try {
    await payer.pay(req.body);  // Check happens inside
    return res.json({ ok: true });
  } catch (err) {
    if (err.message.includes("shutting down")) {
      return res.status(503).json({ error: "Shutting down" });
    }
    throw err;
  }
});
```

#### Cause 2: Multiple entry points not using same mutex

```typescript
// ❌ WRONG: Different code paths, different mutexes
const exclusive1 = createExclusive(stateManager);
const exclusive2 = createExclusive(stateManager);  // Different instance!

// payer uses exclusive1, webhook uses exclusive2
// Shutdown only waits on one!

// ✅ CORRECT: Single shared mutex
const exclusive = createExclusive(stateManager);

const payer = createPayer({ exclusive, stateManager });
const webhook = createWebhook({ exclusive, stateManager });
```

---

## Problem: Shutdown Completes but Process Doesn't Exit

### Symptoms
- Logs show "Graceful shutdown complete"
- Process still running
- Must manually kill

### Root Causes

#### Cause 1: Forgot to call `process.exit()`

```typescript
// ❌ WRONG: No exit after shutdown
async function shutdownHandler() {
  await stateManager.shutdown();
  console.log("Shutdown complete");
  // ← No exit, process hangs
}

// ✅ CORRECT: Exit after shutdown
async function shutdownHandler() {
  await stateManager.shutdown();
  console.log("Shutdown complete");
  process.exit(0);  // ← Exit!
}
```

#### Cause 2: Event listeners preventing exit

```typescript
// ❌ WRONG: Server still listening
async function shutdownHandler() {
  await stateManager.shutdown();
  // Server still listening on port 3000
  process.exit(0);
}

// ✅ CORRECT: Close resources first
async function shutdownHandler() {
  // Close server
  server.close();
  
  // Close database connections
  await db.close();
  
  // Shutdown business logic
  await stateManager.shutdown();
  
  // Now exit
  process.exit(0);
}
```

#### Cause 3: Unhandled promise rejection

```typescript
// ❌ WRONG: Rejection prevents exit
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  // No exit, process hangs
});

// ✅ CORRECT: Exit after handling
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  process.exit(1);  // Exit with error code
});
```

---

## Diagnostic Commands

### Check if process is running
```bash
ps aux | grep node
lsof -i :3000  # Check port
```

### Send signals manually
```bash
kill -SIGTERM <pid>
kill -SIGINT <pid>
```

### Monitor in real-time
```bash
# Watch logs while sending signal
tail -f logs.txt &
kill -SIGTERM <pid>
```

### Check exit code
```bash
node dist/bin.js
echo $?  # Should be 0
```

### Debug with strace
```bash
strace -e signal node dist/bin.js
# Should show: rt_sigaction(SIGTERM)
```

### Enable debug logging
```typescript
// Add to your shutdown handler
import * as util from "util";

async function shutdownHandler(signal: string) {
  console.error(`[${new Date().toISOString()}] ${signal} received`);
  console.error(`[${new Date().toISOString()}] In-flight count: ${inFlightCount}`);
  
  try {
    console.error(`[${new Date().toISOString()}] Calling shutdown()`);
    const start = Date.now();
    await stateManager.shutdown();
    console.error(`[${new Date().toISOString()}] Shutdown complete after ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Shutdown error:`, util.inspect(err));
  }

  console.error(`[${new Date().toISOString()}] Calling process.exit(0)`);
  process.exit(0);
}
```

---

## Testing the Fix

After making changes, verify with these tests:

```typescript
describe("graceful shutdown - verification", () => {
  it("accepts SIGTERM signal and exits", (done) => {
    const child = spawn("node", ["dist/bin.js"]);
    
    setTimeout(() => {
      child.kill("SIGTERM");
    }, 100);
    
    child.on("exit", (code) => {
      expect(code).toBe(0);
      done();
    });
  });

  it("waits for in-flight operations", (done) => {
    const child = spawn("node", ["dist/bin.js"]);
    const start = Date.now();
    
    setTimeout(() => {
      // Operation in progress
      child.kill("SIGTERM");
    }, 50);
    
    child.on("exit", (code) => {
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThan(100);  // Waited for operation
      done();
    });
  });

  it("maintains ledger consistency", async () => {
    // Start server, make payment, send SIGTERM mid-payment
    // Verify ledger is either fully updated or not at all
  });
});
```

---

## Quick Fix Checklist

- [ ] Verify signal handlers registered: `process.on("SIGTERM", ...)`
- [ ] Verify `isShuttingDown()` check in critical section
- [ ] Verify `_trackCriticalSectionStart()` called on entry
- [ ] Verify `_trackCriticalSectionEnd()` in finally block
- [ ] Verify `await stateManager.shutdown()` in handler
- [ ] Verify `process.exit(0)` after shutdown
- [ ] Add logging to shutdown handler
- [ ] Test with manual signal: `kill -SIGTERM <pid>`
- [ ] Verify exit code is 0: `echo $?`
- [ ] Run comprehensive tests

If still stuck, add this debug wrapper:

```typescript
export function createDebugStateManager(base: StateManager): StateManager {
  return {
    ...base,
    isShuttingDown: () => {
      const result = base.isShuttingDown();
      console.error(`[DEBUG] isShuttingDown() = ${result}`);
      return result;
    },
    shutdown: async () => {
      console.error(`[DEBUG] shutdown() called`);
      const start = Date.now();
      await base.shutdown();
      console.error(`[DEBUG] shutdown() completed after ${Date.now() - start}ms`);
    },
  };
}
```
