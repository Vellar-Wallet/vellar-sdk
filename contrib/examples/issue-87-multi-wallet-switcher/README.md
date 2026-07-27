# Multi-Wallet Session Switcher

A reference implementation demonstrating how to manage multiple wallet sessions and switch between them.

## Overview

This example shows how to:
- Store multiple wallet sessions keyed by account labels
- Switch the active session
- Handle errors when switching to unknown labels
- Retrieve the currently active session

## Flow

1. **Add sessions** - Register wallet sessions with unique labels
2. **Switch sessions** - Change which session is currently active
3. **Get active session** - Retrieve the current active session
4. **Error handling** - Gracefully handle attempts to switch to non-existent sessions

## Usage

```typescript
import { MultiWalletSwitcher } from './multi-wallet-switcher';

const switcher = new MultiWalletSwitcher();

// Add sessions
switcher.addSession('alice', aliceSession);
switcher.addSession('bob', bobSession);

// Switch between sessions
switcher.switchTo('alice');
console.log(switcher.getActive()); // Returns alice's session

switcher.switchTo('bob');
console.log(switcher.getActive()); // Returns bob's session

// Handle errors
try {
  switcher.switchTo('unknown');
} catch (error) {
  console.error(error.message); // "Session 'unknown' not found"
}
```

## Running the Example

```bash
npx ts-node example.ts
```

## Implementation Details

The switcher maintains:
- A `Map` of label → session objects
- A reference to the currently active session label
- Clear error messages for missing sessions
