// Example: an in-memory tracker recording used nonce values per account,
// to detect and reject a repeated nonce (e.g. for replay protection on a
// signed request).
//
// Run with: npx tsx nonce-tracker.ts

export class NonceTracker {
  #used = new Map<string, Set<string>>();

  /**
   * Checks whether `nonce` is fresh for `account`. If fresh, marks it used
   * (so a second check for the same account+nonce returns false) and
   * returns true. If already used, returns false without side effects.
   */
  checkAndConsume(account: string, nonce: string): boolean {
    let seen = this.#used.get(account);
    if (!seen) {
      seen = new Set();
      this.#used.set(account, seen);
    }
    if (seen.has(nonce)) {
      return false;
    }
    seen.add(nonce);
    return true;
  }
}

function main() {
  const tracker = new NonceTracker();

  console.log("First check of nonce 'abc' for account GALICE:", tracker.checkAndConsume("GALICE", "abc"));
  console.log("Second check of the same nonce (should be rejected):", tracker.checkAndConsume("GALICE", "abc"));
  console.log("Same nonce, different account (should be fresh):", tracker.checkAndConsume("GBOB", "abc"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
