/**
 * Migration helper for consumers upgrading a stored session schema.
 *
 * Contributed for issue #215: consumers holding a locally stored session
 * written by an older SDK version have no supported upgrade path when the
 * schema changes. `migrateStoredSession` detects which prior shape a blob is
 * in and upgrades it to the current envelope; `dryRun` reports whether a
 * migration is needed without writing anything.
 *
 * Relationship to issue #220 (contrib/examples/issue-220-session-schema-version):
 * that example added the `{ schemaVersion, session }` envelope and made every
 * pre-envelope blob load as `null` — safe, but it silently disconnects users on
 * upgrade. This helper is the missing other half: instead of discarding a v0
 * blob, it upgrades it in place so the session survives the SDK bump.
 *
 * Run with: npx vitest run contrib/examples/issue-215-session-schema-migration
 */

import type { WalletSession } from "../../../src/types";

/**
 * Current persisted session envelope version.
 *
 * Version history (each entry is a shape this helper can migrate FROM):
 * - v0 — pre-envelope. The bare `WalletSession` object was stored directly,
 *        with no wrapper. Written by SDK <= 0.5.x.
 * - v1 — `{ schemaVersion: 1, session }`. Envelope introduced by issue #220.
 * - v2 — `{ schemaVersion: 2, session, migratedAt }`. Adds a migration stamp so
 *        a consumer can tell an upgraded record from a natively-written one.
 */
export const SESSION_SCHEMA_VERSION = 2;

/** Every schema version this helper knows how to read. */
export const KNOWN_SCHEMA_VERSIONS = [0, 1, 2] as const;

export type KnownSchemaVersion = (typeof KNOWN_SCHEMA_VERSIONS)[number];

/** v1 envelope: the shape introduced by issue #220. */
export interface SessionEnvelopeV1 {
  schemaVersion: 1;
  session: WalletSession;
}

/** v2 envelope: current. `migratedAt` is set only when the record was upgraded. */
export interface SessionEnvelopeV2 {
  schemaVersion: 2;
  session: WalletSession;
  /** ISO timestamp of the migration that produced this record. Absent on fresh writes. */
  migratedAt?: string;
}

export type CurrentSessionEnvelope = SessionEnvelopeV2;

/** Structural check for the bare (v0) session shape. Mirrors src/session.ts. */
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

/**
 * Detects which known schema version a stored blob is in.
 *
 * Returns `null` for anything unrecognisable — a corrupt blob, a future
 * version written by a newer SDK, or a valid envelope wrapping an invalid
 * session. Callers must treat `null` as "do not migrate, fall back to
 * disconnected" rather than attempting a repair.
 */
export function detectSchemaVersion(value: unknown): KnownSchemaVersion | null {
  if (isWalletSession(value)) return 0;
  if (typeof value !== "object" || value === null) return null;

  const v = value as Record<string, unknown>;
  if (typeof v.schemaVersion !== "number") return null;
  if (!isWalletSession(v.session)) return null;

  // A version we recognise, but only the ones we can actually read. A blob
  // stamped v99 by a newer SDK is deliberately NOT downgraded.
  return (KNOWN_SCHEMA_VERSIONS as readonly number[]).includes(v.schemaVersion)
    ? (v.schemaVersion as KnownSchemaVersion)
    : null;
}

export type MigrationOutcome =
  /** Already at SESSION_SCHEMA_VERSION — nothing to do. */
  | "up-to-date"
  /** A known prior version that was (or would be) upgraded. */
  | "migrated"
  /** Unrecognised, corrupt, or newer-than-known. Nothing is written. */
  | "unsupported";

export interface MigrationReport {
  outcome: MigrationOutcome;
  /** Detected version of the input, or `null` when unsupported. */
  from: KnownSchemaVersion | null;
  /** Target version. Always SESSION_SCHEMA_VERSION. */
  to: number;
  /** True when a write is required to bring storage up to date. */
  needsMigration: boolean;
  /** Human-readable explanation, suitable for logging in a consumer's upgrade path. */
  reason: string;
}

export interface MigrationResult extends MigrationReport {
  /** The upgraded envelope, or `null` when the outcome is "unsupported". */
  envelope: CurrentSessionEnvelope | null;
}

export interface MigrateOptions {
  /**
   * Report what would happen without producing an upgraded envelope. The
   * returned `envelope` is `null` in dry-run mode even for a migratable blob —
   * use `migrateStoredSession` (or `migrateStorage`) to actually perform it.
   */
  dryRun?: boolean;
  /** Injectable clock for the `migratedAt` stamp (tests pass a fixed date). */
  now?: () => Date;
}

/**
 * Upgrades a stored session blob to the current envelope.
 *
 * Never throws on bad input: an unreadable blob returns
 * `{ outcome: "unsupported", envelope: null }` so a consumer's startup path can
 * fall back to disconnected exactly as it does today.
 */
export function migrateStoredSession(value: unknown, options: MigrateOptions = {}): MigrationResult {
  const now = options.now ?? (() => new Date());
  const from = detectSchemaVersion(value);

  if (from === null) {
    return {
      outcome: "unsupported",
      from: null,
      to: SESSION_SCHEMA_VERSION,
      needsMigration: false,
      envelope: null,
      reason:
        "Stored value is not a recognised session schema (corrupt, empty, or written by a newer SDK). Clear it and reconnect.",
    };
  }

  if (from === SESSION_SCHEMA_VERSION) {
    return {
      outcome: "up-to-date",
      from,
      to: SESSION_SCHEMA_VERSION,
      needsMigration: false,
      envelope: options.dryRun ? null : (value as CurrentSessionEnvelope),
      reason: `Stored session is already at schema v${SESSION_SCHEMA_VERSION}.`,
    };
  }

  const session = from === 0 ? (value as WalletSession) : (value as SessionEnvelopeV1).session;
  const report: MigrationReport = {
    outcome: "migrated",
    from,
    to: SESSION_SCHEMA_VERSION,
    needsMigration: true,
    reason: `Stored session is at schema v${from}; upgrade to v${SESSION_SCHEMA_VERSION} is required.`,
  };

  if (options.dryRun) {
    return { ...report, envelope: null };
  }

  return {
    ...report,
    envelope: {
      schemaVersion: SESSION_SCHEMA_VERSION,
      // Field-by-field copy: an old blob may carry extra keys from a shape we
      // no longer support, and those must not ride along into the new record.
      session: {
        accountId: session.accountId,
        network: session.network,
        connected: session.connected,
        authMethod: session.authMethod,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        ...(session.serverSessionId === undefined
          ? {}
          : { serverSessionId: session.serverSessionId }),
        ...(session.keyId === undefined ? {} : { keyId: session.keyId }),
      },
      migratedAt: now().toISOString(),
    },
  };
}

/** Convenience wrapper: report only, never produces an envelope. */
export function dryRunMigration(
  value: unknown,
  options: Omit<MigrateOptions, "dryRun"> = {},
): MigrationReport {
  const { envelope: _envelope, ...report } = migrateStoredSession(value, {
    ...options,
    dryRun: true,
  });
  return report;
}

/** Wraps a fresh session for storage at the current version (no migration stamp). */
export function wrapSession(session: WalletSession): CurrentSessionEnvelope {
  return { schemaVersion: SESSION_SCHEMA_VERSION, session };
}

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MigrateStorageOptions extends MigrateOptions {
  /**
   * Remove the stored value when it cannot be migrated. Off by default — a
   * consumer may prefer to keep the blob around for diagnostics.
   */
  clearUnsupported?: boolean;
}

/**
 * Reads `key`, migrates it if needed, and writes the upgraded envelope back.
 *
 * In dry-run mode storage is only read, never written — the returned report
 * tells a consumer whether an upgrade is pending. Malformed JSON is reported as
 * "unsupported" rather than thrown, so this is safe to call on startup.
 */
export function migrateStorage(
  storage: SessionStorageLike,
  key: string,
  options: MigrateStorageOptions = {},
): MigrationResult {
  const raw = storage.getItem(key);
  if (raw === null) {
    return {
      outcome: "unsupported",
      from: null,
      to: SESSION_SCHEMA_VERSION,
      needsMigration: false,
      envelope: null,
      reason: `No stored session at "${key}"; nothing to migrate.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const result: MigrationResult = {
      outcome: "unsupported",
      from: null,
      to: SESSION_SCHEMA_VERSION,
      needsMigration: false,
      envelope: null,
      reason: `Stored session at "${key}" is not valid JSON. Clear it and reconnect.`,
    };
    if (options.clearUnsupported && !options.dryRun) storage.removeItem(key);
    return result;
  }

  const result = migrateStoredSession(parsed, options);

  if (options.dryRun) return result;

  if (result.outcome === "migrated" && result.envelope) {
    storage.setItem(key, JSON.stringify(result.envelope));
  } else if (result.outcome === "unsupported" && options.clearUnsupported) {
    storage.removeItem(key);
  }

  return result;
}

/**
 * Loads a session, migrating an older blob in place if necessary.
 *
 * This is the drop-in replacement for a consumer's existing load path: where
 * the v1 loader returned `null` for a pre-envelope blob (silently logging the
 * user out on upgrade), this upgrades and returns the session.
 */
export function loadAndMigrateSession(
  storage: SessionStorageLike,
  key: string,
  options: MigrateStorageOptions = {},
): WalletSession | null {
  const result = migrateStorage(storage, key, options);
  if (result.envelope) return result.envelope.session;
  // Dry-run on a migratable blob produces no envelope; surface the session
  // from the raw read rather than reporting a false disconnect.
  if (options.dryRun && result.needsMigration) {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      const from = detectSchemaVersion(parsed);
      if (from === 0) return parsed as WalletSession;
      if (from !== null) return (parsed as SessionEnvelopeV1).session;
    } catch {
      return null;
    }
  }
  return null;
}
