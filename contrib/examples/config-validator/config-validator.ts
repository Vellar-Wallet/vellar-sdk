// Example: validate a plain configuration object against a small schema of
// required field names and expected types, collecting every problem instead
// of throwing on the first one.
//
// Run with: npx tsx config-validator.ts

export type FieldType = "string" | "number" | "boolean" | "object" | "array";

export interface FieldSchema {
  name: string;
  type: FieldType;
}

function actualType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

/**
 * Validates `config` against `schema`: every listed field must be present
 * and match the declared type. Returns a list of human-readable error
 * messages — empty when the config is valid. Every issue is reported, not
 * just the first, so a caller can show a user all their mistakes at once.
 */
export function validateConfig(config: Record<string, unknown>, schema: FieldSchema[]): string[] {
  const errors: string[] = [];

  for (const field of schema) {
    if (!(field.name in config)) {
      errors.push(`Missing required field "${field.name}"`);
      continue;
    }
    const found = actualType(config[field.name]);
    if (found !== field.type) {
      errors.push(`Field "${field.name}" expected type "${field.type}", got "${found}"`);
    }
  }

  return errors;
}

function main() {
  const schema: FieldSchema[] = [
    { name: "network", type: "string" },
    { name: "appName", type: "string" },
    { name: "rpcUrl", type: "string" },
    { name: "enableX402", type: "boolean" },
  ];

  const validConfig = { network: "testnet", appName: "My App", rpcUrl: "https://rpc.example", enableX402: true };
  const brokenConfig = { network: "testnet", rpcUrl: 12345, enableX402: "yes" };

  console.log("Valid config errors:", validateConfig(validConfig, schema));
  console.log("Broken config errors:", validateConfig(brokenConfig, schema));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// ---------------------------------------------------------------------------
// Operator configuration aid for local facilitator integration testing.
//
// The helpers below mirror the documented self-hosted facilitator settings in
// website/content/docs/operators/limits.md and
// website/content/docs/reference/fees.md so a local setup script can catch
// misconfiguration before an integration test runs. They are setup aids only:
// the facilitator remains the source of truth for enforcement.
// ---------------------------------------------------------------------------

/** Documented default soft-floor alert threshold, in stroops. */
export const DEFAULT_SPONSOR_SOFT_FLOOR_STROOPS = 250_000_000;
/** Documented default hard-floor refusal threshold, in stroops. */
export const DEFAULT_SPONSOR_HARD_FLOOR_STROOPS = 100_000_000;
/** Documented default rolling spend ceiling, in stroops. */
export const DEFAULT_SPEND_CEILING_STROOPS = 50_000_000;
/** Documented default rolling spend window length, in milliseconds. */
export const DEFAULT_SPEND_WINDOW_MS = 60_000;
/** CHANNEL_ACCOUNT_SECRET_KEYS must contain exactly this many keys. */
export const REQUIRED_CHANNEL_ACCOUNT_KEY_COUNT = 50;

const STELLAR_CLASSIC_SECRET_PATTERN = /^S[A-Z2-7]{55}$/;

/**
 * Returns true when `value` looks like a well-formed Stellar classic secret
 * key (a 56-character base32 string starting with "S").
 */
export function isStellarClassicSecret(value: string): boolean {
  return STELLAR_CLASSIC_SECRET_PATTERN.test(value);
}

/**
 * Validates a candidate CHANNEL_ACCOUNT_SECRET_KEYS value: exactly 50
 * comma-separated Stellar classic secrets, none of which may equal the
 * sponsor secret key. Returns a list of human-readable errors — empty when
 * the configuration is valid.
 */
export function validateChannelAccountSecretKeys(raw: string, sponsorSecretKey?: string): string[] {
  const errors: string[] = [];
  const entries = raw.split(",").map((entry) => entry.trim());

  if (entries.length !== REQUIRED_CHANNEL_ACCOUNT_KEY_COUNT) {
    errors.push(
      `CHANNEL_ACCOUNT_SECRET_KEYS must contain exactly ${REQUIRED_CHANNEL_ACCOUNT_KEY_COUNT} keys, got ${entries.length}`,
    );
  }

  entries.forEach((entry, index) => {
    if (!isStellarClassicSecret(entry)) {
      errors.push(`CHANNEL_ACCOUNT_SECRET_KEYS[${index}] is not a well-formed Stellar classic secret key`);
    }
  });

  if (sponsorSecretKey !== undefined) {
    const sponsorIndex = entries.indexOf(sponsorSecretKey.trim());
    if (sponsorIndex !== -1) {
      errors.push(
        `SPONSOR_SECRET_KEY must not appear in CHANNEL_ACCOUNT_SECRET_KEYS (found at index ${sponsorIndex})`,
      );
    }
  }

  return errors;
}

export type SponsorBalanceStatus = "healthy" | "soft-floor-warning" | "hard-floor-refused";

/**
 * Classifies a current sponsor balance against the documented soft and hard
 * floors. Defaults match website/content/docs/reference/fees.md; callers may
 * override them to match a self-hosted facilitator's configuration.
 */
export function classifySponsorBalance(
  balanceStroops: number,
  softFloorStroops: number = DEFAULT_SPONSOR_SOFT_FLOOR_STROOPS,
  hardFloorStroops: number = DEFAULT_SPONSOR_HARD_FLOOR_STROOPS,
): SponsorBalanceStatus {
  if (balanceStroops < hardFloorStroops) return "hard-floor-refused";
  if (balanceStroops < softFloorStroops) return "soft-floor-warning";
  return "healthy";
}

export interface SpendWindowOptions {
  ceilingStroops?: number;
  windowMs?: number;
  now?: () => number;
}

/**
 * Local rolling-window spend accounting mirroring SPEND_CEILING_STROOPS and
 * SPEND_WINDOW_MS. This is a local estimation aid only — it is not a
 * substitute for the facilitator's own server-side enforcement.
 */
export class RollingSpendWindow {
  private readonly ceilingStroops: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private windowStart: number;
  private spentStroops = 0;

  constructor(options: SpendWindowOptions = {}) {
    this.ceilingStroops = options.ceilingStroops ?? DEFAULT_SPEND_CEILING_STROOPS;
    this.windowMs = options.windowMs ?? DEFAULT_SPEND_WINDOW_MS;
    this.now = options.now ?? (() => Date.now());
    this.windowStart = this.now();
  }

  private roll(): void {
    const current = this.now();
    if (current - this.windowStart >= this.windowMs) {
      this.windowStart = current;
      this.spentStroops = 0;
    }
  }

  /** Records `amountStroops` if it fits within the ceiling; returns whether it was accepted. */
  record(amountStroops: number): boolean {
    this.roll();
    if (this.spentStroops + amountStroops > this.ceilingStroops) return false;
    this.spentStroops += amountStroops;
    return true;
  }

  /** Stroops accumulated in the current window. */
  get spent(): number {
    this.roll();
    return this.spentStroops;
  }

  /** Stroops still available in the current window. */
  get remaining(): number {
    this.roll();
    return Math.max(0, this.ceilingStroops - this.spentStroops);
  }
}
