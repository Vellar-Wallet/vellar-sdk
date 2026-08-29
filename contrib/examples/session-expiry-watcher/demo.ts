/**
 * Demonstrates SessionExpiryWatcher with a short-lived session so the
 * callback fires within a couple of seconds. Run with:
 *
 *   npx tsx demo.ts
 */

import { SessionExpiryWatcher, type SessionLike } from "./session-expiry-watcher";

const SESSION_LIFETIME_MS = 2000;
const WARN_BEFORE_MS = 1000;

const session: SessionLike = {
  expiresAt: Date.now() + SESSION_LIFETIME_MS,
};

const watcher = new SessionExpiryWatcher(session, {
  warnBeforeMs: WARN_BEFORE_MS,
  onExpiringSoon: (s) => {
    console.log(`Session expiring soon at ${new Date(s.expiresAt).toISOString()}`);
  },
});

console.log("Starting watcher, expect a warning in ~1s...");
watcher.start();

// Stopping the watcher after it has already fired is a no-op.
setTimeout(() => watcher.stop(), SESSION_LIFETIME_MS + 500);
