/**
 * Demo script for the verification status poller (issue #96).
 *
 * Demonstrates both the success path (job resolves in time) and the timeout
 * path (job never reaches a terminal state within maxWaitMs).
 *
 * Run: npx ts-node demo.ts
 */

import { pollVerificationStatus, VerificationJob, JobStatus } from './verification-status-poller';

// --- Success path: job transitions to 'verified' after a few polls ---

function makeMockFetcher(transitions: JobStatus[], delayMs: number) {
  let call = 0;
  return async (_jobId: string): Promise<VerificationJob> => {
    await new Promise(r => setTimeout(r, delayMs));
    const status = transitions[Math.min(call, transitions.length - 1)];
    call += 1;
    return { id: _jobId, status };
  };
}

async function main() {
  console.log('--- Success path ---');
  const successFetcher = makeMockFetcher(['pending', 'processing', 'verified'], 300);
  try {
    const result = await pollVerificationStatus('job-001', successFetcher, {
      intervalMs: 400,
      maxWaitMs: 5000,
    });
    console.log(`Job resolved: status=${result.status}`);
  } catch (err) {
    console.error('Unexpected error:', err);
  }

  console.log('\n--- Timeout path ---');
  const stalledFetcher = makeMockFetcher(['pending', 'pending', 'pending'], 200);
  try {
    await pollVerificationStatus('job-002', stalledFetcher, {
      intervalMs: 300,
      maxWaitMs: 1000,
    });
  } catch (err) {
    console.log(`Correctly rejected: ${(err as Error).message}`);
  }
}

main();
