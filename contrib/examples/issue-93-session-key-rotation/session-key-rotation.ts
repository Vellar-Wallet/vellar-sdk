/**
 * Session key rotation helper (issue #93)
 *
 * Maintains an in-memory registry of session keys. At most one key is active
 * at a time; rotating to a new key marks the previous key as retired.
 */

import { randomBytes } from 'crypto';

export type KeyStatus = 'active' | 'retired';

export interface KeyEntry {
  key: string;
  status: KeyStatus;
  createdAt: Date;
  retiredAt?: Date;
}

export interface SessionKeyRegistry {
  /** Generate and activate a new session key, retiring the current one. */
  rotate: () => string;
  /** Return the currently active key, or null if none exists yet. */
  activeKey: () => string | null;
  /** Return the full history of all keys in chronological order. */
  history: () => KeyEntry[];
}

function generateKey(): string {
  return randomBytes(32).toString('hex');
}

export function createSessionKeyRegistry(): SessionKeyRegistry {
  const entries: KeyEntry[] = [];

  return {
    rotate() {
      // Retire the current active key if one exists.
      const current = entries.find(e => e.status === 'active');
      if (current) {
        current.status = 'retired';
        current.retiredAt = new Date();
      }

      const newKey = generateKey();
      entries.push({ key: newKey, status: 'active', createdAt: new Date() });
      return newKey;
    },

    activeKey() {
      return entries.find(e => e.status === 'active')?.key ?? null;
    },

    history() {
      return [...entries];
    },
  };
}
