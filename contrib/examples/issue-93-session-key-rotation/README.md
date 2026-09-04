# Session Key Rotation Helper

A self-contained reference example that manages an in-memory registry of
session keys where only one key is active at a time.

## Flow

1. `createSessionKeyRegistry()` returns a registry with no keys.
2. `registry.rotate()` generates a new 32-byte hex key, marks the current
   active key (if any) as `'retired'`, and returns the new key.
3. `registry.activeKey()` returns the currently active key, or `null`.
4. `registry.history()` returns all entries in chronological order, each with
   `key`, `status`, `createdAt`, and (if retired) `retiredAt`.

## Constraints

- Only one key may be `'active'` at any time.
- Retired keys remain in history and are never removed.

## Files

| File | Purpose |
|------|---------|
| `session-key-rotation.ts` | Core `createSessionKeyRegistry` implementation |
| `demo.ts` | Script that generates, rotates, and inspects keys |

## Running the demo

```bash
npx ts-node demo.ts
```

Expected output:

```
--- Initial rotation ---
Active key: <hex>

--- Rotating to a new key ---
Active key: <different hex>

--- Key history ---
  [retired] <key1 prefix>...  created=...  retired=...
  [active ] <key2 prefix>...  created=...

--- Confirming old key is retired ---
key1 status: retired
key2 is active: true
```
