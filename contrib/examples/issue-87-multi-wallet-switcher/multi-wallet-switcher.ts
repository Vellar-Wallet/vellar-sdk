/**
 * Multi-Wallet Session Switcher
 * Manages multiple wallet sessions and allows switching between them
 */

export interface WalletSession {
  accountId: string;
  username: string;
  [key: string]: any;
}

export class MultiWalletSwitcher {
  private sessions: Map<string, WalletSession> = new Map();
  private activeLabel: string | null = null;

  /**
   * Add a new wallet session with a label
   */
  addSession(label: string, session: WalletSession): void {
    this.sessions.set(label, session);
    // If this is the first session, make it active
    if (this.activeLabel === null) {
      this.activeLabel = label;
    }
  }

  /**
   * Switch to a different wallet session
   * @throws Error if the label doesn't exist
   */
  switchTo(label: string): void {
    if (!this.sessions.has(label)) {
      throw new Error(`Session '${label}' not found`);
    }
    this.activeLabel = label;
  }

  /**
   * Get the currently active wallet session
   * @returns The active session or null if no sessions exist
   */
  getActive(): WalletSession | null {
    if (this.activeLabel === null) {
      return null;
    }
    return this.sessions.get(this.activeLabel) || null;
  }

  /**
   * Get all registered session labels
   */
  getLabels(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Remove a session by label
   */
  removeSession(label: string): boolean {
    const removed = this.sessions.delete(label);
    if (removed && this.activeLabel === label) {
      // If we removed the active session, switch to another or null
      const labels = this.getLabels();
      this.activeLabel = labels.length > 0 ? labels[0] : null;
    }
    return removed;
  }
}
