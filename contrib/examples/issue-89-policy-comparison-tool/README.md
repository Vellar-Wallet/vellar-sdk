# Policy Comparison Tool

A reference implementation demonstrating how to compare policy configurations between two accounts.

## Overview

This example shows how to:
- Fetch policy configurations from mock sources
- Compare policies between two accounts
- Report differences in a readable format
- Display side-by-side values for differing fields

## Flow

1. **Fetch policies** - Retrieve policy configurations for two accounts
2. **Compare** - Identify which fields differ between the accounts
3. **Report** - Display differences with values from both accounts side by side

## Usage

```typescript
import { PolicyComparisonTool } from './policy-comparison-tool';
import { mockPolicySource } from './mock-policy-source';

const tool = new PolicyComparisonTool(mockPolicySource);

// Compare two accounts
const diff = await tool.compare('account1', 'account2');

if (diff.hasDifferences) {
  console.log('Differences found:');
  diff.differences.forEach(d => {
    console.log(`${d.field}: ${d.account1Value} vs ${d.account2Value}`);
  });
}
```

## Running the Example

```bash
npx ts-node example.ts
```

## Implementation Details

The tool:
- Uses a pluggable policy source (mock implementation provided)
- Deep compares policy objects field by field
- Returns structured difference objects with field paths and values
- Handles nested policy configurations
