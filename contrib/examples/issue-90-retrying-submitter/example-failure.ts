/**
 * Example: Submission that exhausts all attempts and fails
 */

import { RetryingSubmitter } from './retrying-submitter';

// Mock submission that always fails
async function mockSubmitThatAlwaysFails(): Promise<string> {
  throw new Error('Service unavailable');
}

async function main() {
  console.log('=== Retrying Submitter - Failure Example ===\n');

  const submitter = new RetryingSubmitter({
    maxAttempts: 4,
    baseDelayMs: 50,
  });

  try {
    await submitter.submit(mockSubmitThatAlwaysFails);
  } catch (error) {
    console.error('\nAll attempts exhausted!');
    console.error('Error:', (error as Error).message);
  }

  console.log('\n=== Example Complete ===');
}

main().catch(console.error);
