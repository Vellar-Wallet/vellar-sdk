/**
 * Example: Primary submission succeeds, fallback is never invoked
 */

import { RelayerFallbackSubmitter } from './relayer-fallback-submitter';

interface MockTransaction {
  from: string;
  to: string;
  amount: number;
}

// Mock primary relayer that succeeds
async function mockPrimaryRelayerSuccess(tx: MockTransaction): Promise<string> {
  // Simulate some processing time
  await new Promise((resolve) => setTimeout(resolve, 50));
  return `relayer_tx_${Date.now()}`;
}

// Mock fallback that should never be called
async function mockFallbackSubmit(tx: MockTransaction): Promise<string> {
  console.log('⚠️  Fallback was called (should not happen in this example)');
  return `direct_tx_${Date.now()}`;
}

async function main() {
  console.log('=== Relayer Fallback - Primary Success Example ===\n');

  const submitter = new RelayerFallbackSubmitter({
    primarySubmit: mockPrimaryRelayerSuccess,
    fallbackSubmit: mockFallbackSubmit,
  });

  const transaction: MockTransaction = {
    from: 'GALICE...',
    to: 'GBOB...',
    amount: 100,
  };

  console.log('Transaction:', JSON.stringify(transaction, null, 2));
  console.log();

  const result = await submitter.submit(transaction);

  console.log('\n✓ Submission completed');
  console.log('Path used:', result.path);
  console.log('Transaction hash:', result.result);

  console.log('\n=== Example Complete ===');
}

main().catch(console.error);
