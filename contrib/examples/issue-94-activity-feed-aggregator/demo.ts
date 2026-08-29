/**
 * Demo script for the activity feed aggregator (issue #94).
 *
 * Run: npx ts-node demo.ts
 */

import { aggregateFeed, PaymentRecord, PolicyChangeRecord } from './activity-feed-aggregator';

const payments: PaymentRecord[] = [
  { id: 'pay-1', amount: '50.00', currency: 'USDC', to: 'GBXYZ...', at: new Date('2026-07-01T10:00:00Z') },
  { id: 'pay-2', amount: '120.00', currency: 'USDC', to: 'GABC...', at: new Date('2026-07-03T14:30:00Z') },
  { id: 'pay-3', amount: '9.99', currency: 'USDC', to: 'GDEF...', at: new Date('2026-07-05T08:15:00Z') },
];

const policyChanges: PolicyChangeRecord[] = [
  { id: 'pc-1', policyId: 'pol-42', changeType: 'activated', at: new Date('2026-07-02T09:00:00Z') },
  { id: 'pc-2', policyId: 'pol-42', changeType: 'limit_updated', at: new Date('2026-07-04T11:45:00Z') },
];

const feed = aggregateFeed(payments, policyChanges);

console.log('Activity feed (newest first):\n');
for (const item of feed) {
  console.log(`[${item.timestamp.toISOString()}] (${item.kind}) ${item.summary}`);
}
