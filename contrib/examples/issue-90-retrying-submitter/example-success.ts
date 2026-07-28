/**
 * Example: Submission that fails a few times before succeeding
 */

import { RetryingSubmitter } from './retrying-submitter';

// Mock submission that fails first 2 attempts, then succeeds
let attemptCount = 0;
async function mockSubmitWithEventualSuccess(): Promise<string> {
  attemptCount++;
  if (attemptCount < 3) {
    throw new Error('Network timeout');
  }
  return 'tx_hash_12345';
}

async function main() {
  console.log('=== Retrying Submitter - Success Example ===\n');

  const submitter = new RetryingSubmitter({
    maxAttempts: 5,
    baseDelayMs: 100,
  });

  try {
    const result = await submitter.submit(mockSubmitWithEventualSuccess);
    console.log('\nTransaction submitted successfully!');
    console.log('Result:', result);
  } catch (error) {
    console.error('\nFailed:', (error as Error).message);
  }

  console.log('\n=== Example Complete ===');
}

main().catch(console.error);
