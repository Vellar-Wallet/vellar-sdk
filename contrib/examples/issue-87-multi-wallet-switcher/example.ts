/**
 * Example usage of the Multi-Wallet Session Switcher
 */

import { MultiWalletSwitcher, WalletSession } from './multi-wallet-switcher';

// Mock wallet sessions
const aliceSession: WalletSession = {
  accountId: 'CALICE123...',
  username: 'alice',
  createdAt: new Date('2024-01-01'),
};

const bobSession: WalletSession = {
  accountId: 'CBOB456...',
  username: 'bob',
  createdAt: new Date('2024-01-02'),
};

function main() {
  console.log('=== Multi-Wallet Session Switcher Example ===\n');

  const switcher = new MultiWalletSwitcher();

  // Add two sessions
  console.log('Adding sessions for alice and bob...');
  switcher.addSession('alice', aliceSession);
  switcher.addSession('bob', bobSession);
  console.log(`Available sessions: ${switcher.getLabels().join(', ')}\n`);

  // Show initial active session
  console.log('Initial active session:');
  console.log(JSON.stringify(switcher.getActive(), null, 2));
  console.log();

  // Switch to bob
  console.log('Switching to bob...');
  switcher.switchTo('bob');
  console.log('Active session after switch:');
  console.log(JSON.stringify(switcher.getActive(), null, 2));
  console.log();

  // Switch back to alice
  console.log('Switching back to alice...');
  switcher.switchTo('alice');
  console.log('Active session after switch:');
  console.log(JSON.stringify(switcher.getActive(), null, 2));
  console.log();

  // Try switching to unknown session
  console.log('Attempting to switch to unknown session...');
  try {
    switcher.switchTo('charlie');
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
  }
  console.log();

  console.log('=== Example Complete ===');
}

main();
