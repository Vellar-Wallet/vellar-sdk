/**
 * Example: Primary fails, fallback succeeds
 */

import { RelayerFallbackSubmitter } from './relayer-fallback-submitter';

interface MockTransaction {
  from: string;
  to: string;
  amount: number;
}

// Mock primary relayer that fails
async function mockPrimaryRelayerFailure(tx: MockTransaction): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  throw new Error('Relayer service unavailable');
}

// Mock fallback that succeeds
async function mockFallbackSuccess(tx: MockTransaction): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return `direct_tx_${Date.now()}`;
}

async function main() {
  console.log('=== Relayer Fallback - Fallback Path Example ===\n');

  const submitter = new RelayerFallbackSubmitter({
    primarySubmit: mockPrimaryRelayerFailure,
    fallbackSubmit: mockFallbackSuccess,
  });

  const transaction: MockTransaction = {
    from: 'GALICE...',
    to: 'GBOB...',
    amount: 100,
  };

  console.log('Transaction:', JSON.stringify(transaction, null, 2));
  console.log();

  const result = await submitter.submit(transaction);

  console.log('\n✓ Submission completed via fallback path');
  console.log('Path used:', result.path);
  console.log('Transaction hash:', result.result);

  console.log('\n=== Example Complete ===');
}

main().catch(console.error);
