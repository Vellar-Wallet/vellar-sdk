# Relayer Fallback Example

A reference implementation demonstrating a submission path that tries a primary relayer and falls back to direct submission on failure.

## Overview

This example shows how to:
- Attempt submission through a primary relayer function
- Automatically fall back to a secondary direct submission on failure
- Demonstrate both success and fallback scenarios
- Provide clear logging of which path was used

## Flow

1. **Primary attempt** - Try to submit via the primary relayer
2. **Fallback on failure** - If primary fails, automatically use the fallback path
3. **Success path** - When primary succeeds, never invoke the fallback

## Usage

```typescript
import { RelayerFallbackSubmitter } from './relayer-fallback-submitter';

const submitter = new RelayerFallbackSubmitter({
  primarySubmit: async (tx) => {
    // Primary relayer logic
    return await relayer.submit(tx);
  },
  fallbackSubmit: async (tx) => {
    // Direct submission logic
    return await directSubmit(tx);
  },
});

const result = await submitter.submit(transaction);
console.log('Submitted via:', result.path); // 'primary' or 'fallback'
```

## Running the Examples

```bash
# Example with primary succeeding (fallback never called)
npx ts-node example-primary-success.ts

# Example with primary failing, fallback succeeds
npx ts-node example-fallback.ts
```

## Implementation Details

- Both primary and fallback functions are simple mocks
- Clear logging shows which path was taken
- Fallback is only invoked if primary fails
- Returns metadata about which submission path succeeded
