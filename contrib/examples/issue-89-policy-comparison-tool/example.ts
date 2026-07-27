/**
 * Example usage of the Policy Comparison Tool
 */

import { PolicyComparisonTool } from './policy-comparison-tool';
import { mockPolicySource } from './mock-policy-source';

async function main() {
  console.log('=== Policy Comparison Tool Example ===\n');

  const tool = new PolicyComparisonTool(mockPolicySource);

  console.log('Comparing policies for account1 and account2...\n');

  const result = await tool.compare('account1', 'account2');

  // Display the formatted comparison
  console.log(tool.formatComparison(result));

  // Also show the structured differences
  if (result.hasDifferences) {
    console.log('\nStructured Differences:');
    console.log(JSON.stringify(result.differences, null, 2));
  }

  console.log('\n=== Example Complete ===');
}

main().catch(console.error);
