/**
 * Demo script for session key rotation (issue #93).
 *
 * Run: npx ts-node demo.ts
 */

import { createSessionKeyRegistry } from './session-key-rotation';

const registry = createSessionKeyRegistry();

console.log('--- Initial rotation ---');
const key1 = registry.rotate();
console.log('Active key:', key1);

console.log('\n--- Rotating to a new key ---');
const key2 = registry.rotate();
console.log('Active key:', key2);

console.log('\n--- Key history ---');
for (const entry of registry.history()) {
  const line = `  [${entry.status.padEnd(7)}] ${entry.key.slice(0, 16)}...  created=${entry.createdAt.toISOString()}`;
  console.log(entry.retiredAt ? `${line}  retired=${entry.retiredAt.toISOString()}` : line);
}

console.log('\n--- Confirming old key is retired ---');
const h = registry.history();
const old = h.find(e => e.key === key1)!;
console.log(`key1 status: ${old.status}`); // retired
console.log(`key2 is active: ${registry.activeKey() === key2}`); // true
