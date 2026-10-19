# Graceful Shutdown Implementation Guide

## Quick Start

This guide helps you implement graceful shutdown in any MCP server that holds state and processes long-running operations.

## When You Need This

✅ Your server:
- Holds a single resource that must remain consistent (key, ledger, balance)
- Processes operations that take time (network requests, chain submissions)
- Risks indeterminate state if interrupted mid-operation
- Needs to flush pending writes before exit

❌ You don't need this if:
- Your server is stateless
- All operations are instant
- You have external coordination (like Kubernetes liveness probes)

## Five-Step Implementation

### Step 1: Add Shutdown Tracking to Your State Manager

**File: `src/state-manager.ts`**

```typescript
export interface StateManager {
  // Existing methods...
  getValue(): YourType;
  setValue(value: YourType): void;
  
  // ADD THESE:
  isShuttingDown(): boolean;
  shutdown(): Promise<void>;
  _trackCriticalSectionStart(): void;
  _trackCriticalSectionEnd(): void;
}

export function createStateManager(initial: YourType): StateManager {
  let state = initial;
  let shutdownInitiated = false;
  let inFlightCount = 0;
  let shutdownResolve: (() => void) | undefined;

  return {
    getValue() { return state; },
    setValue(value) { state = value; },
    
    isShuttingDown() { return shutdownInitiated; },
    
    async shutdown() {
      shutdownInitiated = true;
      if (inFlightCount === 0) return;
      return new Promise<void>((resolve) => {
        shutdownResolve = resolve;
      });
    },
    
    _trackCriticalSectionStart() {
      inFlightCount++;
    },
    
    _trackCriticalSectionEnd() {
      inFlightCount--;
      if (shutdownInitiated && inFlightCount === 0 && shutdownResolve) {
        shutdownResolve();
      }
    },
  };
}
```

### Step 2: Update Your Mutex/Serialization

**File: `src/serialization.ts`**

```typescript
export function createExclusive(
  stateManager?: StateManager  // ADD PARAMETER
): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const wrappedFn = async () => {
      if (stateManager) {
        stateManager._trackCriticalSectionStart();  // ADD
      }
      try {
        return await fn();
      } finally {
        if (stateManager) {
          stateManager._trackCriticalSectionEnd();  // ADD
        }
      }
    };

    const result = tail.then(wrappedFn, wrappedFn);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
```

### Step 3: Check Shutdown State in Blocking Operations

**File: `src/payment-processor.ts` (or equivalent)**

```typescript
export function createProcessor(
  config: Config,
  stateManager: StateManager  // Already have this
) {
  const exclusive = createExclusive(stateManager);  // Pass it here

  async function process(item: Item): Promise<Result> {
    return exclusive(async () => {
      // CHECK SHUTDOWN AT ENTRY
      if (stateManager.isShuttingDown()) {
        throw new Error("Server is shutting down and cannot accept new operations");
      }

      // Your existing logic...
      const result = await doWork(item);
      
      // Update state
      stateManager.setValue(result);
      
      return result;
    });
  }

  return { process };
}
```

### Step 4: Register Signal Handlers in Entry Point

**File: `src/bin.ts`**

```typescript
async function main(): Promise<void> {
  // Initialize everything
  const stateManager = createStateManager(initialState);
  const processor = createProcessor(config, stateManager);
  
  // Start server
  const server = createMcpServer(processor);
  await startStdio(server);

  // REGISTER SIGNAL HANDLERS
  const shutdownHandler = async (signal: string) => {
    log("info", `${signal} received, initiating graceful shutdown`);
    
    try {
      // This will block until all in-flight operations complete
      await stateManager.shutdown();
      log("info", "Graceful shutdown complete");
    } catch (err) {
      log("error", "Error during shutdown", { error: err });
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => shutdownHandler("SIGTERM"));
  process.on("SIGINT", () => shutdownHandler("SIGINT"));
}

main().catch((err) => {
  process.stderr.write(`Failed to start: ${err.message}\n`);
  process.exit(1);
});
```

### Step 5: Add Tests

**File: `test/graceful-shutdown.test.ts`**

```typescript
describe("graceful shutdown", () => {
  it("blocks new operations after shutdown", async () => {
    const manager = createStateManager(initialState);
    await manager.shutdown();
    
    expect(() => {
      // Try to do something
      if (manager.isShuttingDown()) {
        throw new Error("Server shutting down");
      }
    }).toThrow();
  });

  it("waits for in-flight operations", async () => {
    const manager = createStateManager(initialState);
    const exclusive = createExclusive(manager);
    
    let completed = false;
    const operation = exclusive(async () => {
      await new Promise(r => setTimeout(r, 50));
      completed = true;
    });

    const shutdown = manager.shutdown();
    
    // Give shutdown a moment to try
    await new Promise(r => setTimeout(r, 10));
    expect(completed).toBe(false);
    
    // Wait for both
    await Promise.all([operation, shutdown]);
    expect(completed).toBe(true);
  });

  it("maintains consistency after shutdown", async () => {
    const manager = createStateManager(initialState);
    const exclusive = createExclusive(manager);
    
    await exclusive(async () => {
      manager.setValue({ updated: true });
    });

    await manager.shutdown();

    const snapshot = manager.getValue();
    expect(snapshot.updated).toBe(true);
  });
});
```

## Common Patterns

### Pattern 1: Blocking Tool Registration

```typescript
server.registerTool("my_operation", schema, async (params) => {
  try {
    // ALWAYS check this first
    if (stateManager.isShuttingDown()) {
      return textResult("Server is shutting down", true);
    }

    // The mutex handles the rest
    const result = await processor.process(params);
    return textResult(result);
  } catch (err) {
    return textResult(`Error: ${err.message}`, true);
  }
});
```

### Pattern 2: Multiple Resource Types

```typescript
const ledger = createLedger(ceilings);
const keyManager = createKeyManager(secret);
const exclusive = createExclusive(ledger);  // Use primary resource

// All operations go through exclusive lock
async function pay(url: string, amount: string) {
  return exclusive(async () => {
    if (ledger.isShuttingDown()) throw new Error("Shutting down");
    // Use both resources
    const sig = await keyManager.sign(data);
    ledger.record(asset, amount);
    return result;
  });
}

// Shutdown waits on primary resource only
await ledger.shutdown();
```

### Pattern 3: Timeout Protection

```typescript
async function shutdownWithTimeout(timeout: number = 30000) {
  const race = Promise.race([
    stateManager.shutdown(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Shutdown timeout")), timeout)
    )
  ]);

  try {
    await race;
  } catch (err) {
    log("error", "Graceful shutdown timed out, force exiting", { error });
  }

  process.exit(0);
}
```

### Pattern 4: Orchestrated Multi-Server Shutdown

```typescript
class ServerCluster {
  servers: ManagedServer[] = [];

  async shutdown() {
    // Initiate all shutdowns in parallel
    const shutdowns = this.servers.map(s => s.shutdown());
    
    // Wait for all to complete
    await Promise.all(shutdowns);
  }
}

process.on("SIGTERM", async () => {
  await cluster.shutdown();
  process.exit(0);
});
```

## Debugging Checklist

If shutdown hangs, check:

- [ ] Are signal handlers registered? (`process.on("SIGTERM", ...)`)
- [ ] Does `isShuttingDown()` block new operations?
- [ ] Are critical sections properly tracked?
  - [ ] `_trackCriticalSectionStart()` called at entry?
  - [ ] `_trackCriticalSectionEnd()` called in finally?
- [ ] Is there a deadlock? (Operation waiting for something else?)
- [ ] Is there an infinite loop? (Check async operation logic)
- [ ] Is the signal handler being called? (Add logging)

**Debugging commands:**
```bash
# Send signal manually during test
kill -SIGTERM <pid>
kill -SIGINT <pid>

# Check if process exited
echo $?  # Should be 0

# Monitor in-flight count (if you add logging)
tail -f logs | grep "in-flight"
```

## Testing Different Scenarios

### Test 1: Instant Shutdown
```typescript
it("exits immediately with no in-flight operations", async () => {
  const start = Date.now();
  await stateManager.shutdown();
  expect(Date.now() - start).toBeLessThan(10);
});
```

### Test 2: Long-Running Operation
```typescript
it("waits for long operations", async () => {
  const exclusive = createExclusive(stateManager);
  
  const operation = exclusive(async () => {
    await new Promise(r => setTimeout(r, 1000));
  });

  const shutdown = stateManager.shutdown();
  
  // Both should complete after ~1000ms
  const start = Date.now();
  await Promise.all([operation, shutdown]);
  expect(Date.now() - start).toBeGreaterThan(1000);
});
```

### Test 3: Concurrent Operations
```typescript
it("waits for all concurrent operations", async () => {
  const exclusive = createExclusive(stateManager);
  
  const ops = [
    exclusive(async () => { await sleep(100); }),
    exclusive(async () => { await sleep(200); }),
    exclusive(async () => { await sleep(150); }),
  ];

  const shutdown = stateManager.shutdown();
  
  // Should wait for longest (200ms)
  const start = Date.now();
  await Promise.all([...ops, shutdown]);
  expect(Date.now() - start).toBeGreaterThanOrEqual(200);
});
```

### Test 4: Failed Operation During Shutdown
```typescript
it("handles failed operations gracefully", async () => {
  const exclusive = createExclusive(stateManager);
  
  const failing = exclusive(async () => {
    throw new Error("Operation failed");
  });

  const shutdown = stateManager.shutdown();
  
  await expect(failing).rejects.toThrow("Operation failed");
  await shutdown;  // Should still complete
});
```

## Deployment Considerations

### Docker
```dockerfile
# Send SIGTERM to app, not to PID 1
ENTRYPOINT ["node", "dist/bin.js"]

# Graceful period before SIGKILL
# Kubernetes: terminationGracePeriodSeconds: 30
```

### Kubernetes
```yaml
spec:
  terminationGracePeriodSeconds: 30  # Give app 30s to shutdown
  containers:
  - name: mcp-payer
    image: my-mcp-payer:latest
    lifecycle:
      preStop:
        exec:
          command: ["/bin/sh", "-c", "sleep 5"]  # Buffer for connection drain
```

### Systemd
```ini
[Service]
Type=simple
ExecStart=/usr/bin/node /app/dist/bin.js
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=30
```

## FAQ

**Q: What if an operation never completes?**
A: Your operation timeout should fire (network timeouts, etc.). Use TimeoutWithShutdown pattern above.

**Q: Can I force shutdown without waiting?**
A: Yes, just `process.exit(0)` immediately, but you risk inconsistency. Not recommended.

**Q: Do I need this for read-only operations?**
A: No, only for operations that change state.

**Q: Can shutdown be called multiple times?**
A: Yes, multiple calls should be idempotent. Return same promise.

**Q: What about child processes?**
A: Signals propagate to child processes. Handle in each independently.

## Summary

| Step | File | Change | Lines |
|------|------|--------|-------|
| 1 | `src/state.ts` | Add shutdown tracking | ~20 |
| 2 | `src/mutex.ts` | Wrap with tracking calls | ~10 |
| 3 | `src/processor.ts` | Check `isShuttingDown()` | ~2 |
| 4 | `src/bin.ts` | Register signal handlers | ~15 |
| 5 | `test/shutdown.test.ts` | Add test cases | ~50 |
| **Total** | | | **~97** |

**Result:** Robust graceful shutdown in under 100 lines of actual implementation.
