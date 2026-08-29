/**
 * Versioned session cache envelope for local storage.
 *
 * Contributed for issue #220: add a schemaVersion field to persisted session
 * cache writes and reject unversioned or mismatched reads.
 */

export interface WalletSession {
  accountId: string;
  network: "testnet" | "mainnet";
  connected: boolean;
  authMethod: "passkey";
  createdAt: string;
  lastActiveAt: string;
  serverSessionId?: string;
  keyId?: string;
}

/**
 * Persisted session envelope version. Bump when WalletSession fields or semantics
 * change; reads with a different version are rejected (safe fallback to null).
 */
export const SESSION_SCHEMA_VERSION = 1;

interface PersistedSessionEnvelope {
  schemaVersion: number;
  session: WalletSession;
}

export function isWalletSession(value: unknown): value is WalletSession {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accountId === "string" &&
    v.accountId.length > 0 &&
    (v.network === "testnet" || v.network === "mainnet") &&
    typeof v.connected === "boolean" &&
    v.authMethod === "passkey" &&
    typeof v.createdAt === "string" &&
    typeof v.lastActiveAt === "string"
  );
}

function isPersistedSessionEnvelope(value: unknown): value is PersistedSessionEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.schemaVersion === SESSION_SCHEMA_VERSION && isWalletSession(v.session);
}

export function wrapSession(session: WalletSession): PersistedSessionEnvelope {
  return { schemaVersion: SESSION_SCHEMA_VERSION, session };
}

/** Returns null for unversioned legacy writes or mismatched schemaVersion. */
export function unwrapSession(value: unknown): WalletSession | null {
  if (isPersistedSessionEnvelope(value)) {
    return value.session;
  }
  if (isWalletSession(value)) {
    return null;
  }
  return null;
}

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function saveSession(storage: SessionStorageLike, key: string, session: WalletSession): void {
  storage.setItem(key, JSON.stringify(wrapSession(session)));
}

export function loadSession(storage: SessionStorageLike, key: string): WalletSession | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  return unwrapSession(JSON.parse(raw) as unknown);
}

export function clearSession(storage: SessionStorageLike, key: string): void {
  storage.removeItem(key);
}
