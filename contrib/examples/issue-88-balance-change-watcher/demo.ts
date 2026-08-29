/**
 * Demo script for the balance change watcher (issue #88).
 *
 * A mock balance source returns a fixed value for the first few polls, then
 * changes — showing that the watcher only fires when the value actually differs.
 *
 * Run: npx ts-node demo.ts
 */

import { createBalanceWatcher } from './balance-change-watcher';

const VALUES = ['100.00', '100.00', '100.00', '175.50', '175.50', '200.00'];
let callCount = 0;

const mockSource = async (): Promise<string> => {
  const value = VALUES[Math.min(callCount, VALUES.length - 1)];
  callCount += 1;
  return value;
};

const watcher = createBalanceWatcher(mockSource, 500);

watcher.subscribe((newBalance, previousBalance) => {
  console.log(`[change] ${previousBalance} → ${newBalance}`);
});

// Let the watcher run through all mock values then stop.
setTimeout(() => {
  watcher.stop();
  console.log('Watcher stopped.');
}, 3500);
