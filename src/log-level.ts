// Shared log-level convention for every package in this workspace (#678).
//
// Each workspace package (vellar-sdk root, packages/cli, packages/mcp-x402-payer)
// previously handled its own console/stderr output independently, with no
// mechanism to set one log verbosity across all three. This module is the
// single source of truth for:
//
//   1. The env var name (VELLAR_LOG_LEVEL) and its accepted values.
//   2. The severity ordering those values compare against.
//   3. shouldLog(level), which every package's own logger calls to decide
//      whether a given message clears the configured threshold.
//
// This module does NOT write anything itself, no console.*, no
// process.stdout/stderr. Each package keeps its own output mechanism (the
// payer's `log()` in output.ts writes structured JSON to stderr only, never
// stdout, per issue #416's stdout-safety constraint); this module only
// answers "should this message be emitted at all."

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const DEFAULT_LOG_LEVEL: LogLevel = "info";

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * This module is part of the SDK root, which must stay Node-free (see
 * tsconfig.json's `types: []`, no `@types/node`, so `process` cannot be
 * referenced directly without silently pulling Node ambient types into
 * every other SDK file). `process.env` is read through `globalThis`
 * instead, same pattern already used for `globalThis.crypto`/
 * `globalThis.performance` elsewhere in this package.
 */
function readProcessEnv(): Record<string, string | undefined> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  return proc?.env ?? {};
}

/**
 * Reads VELLAR_LOG_LEVEL from the environment, falling back to "info" when
 * unset or set to an unrecognised value. Case-insensitive, so VELLAR_LOG_LEVEL=DEBUG
 * and =debug are equivalent.
 */
export function getConfiguredLogLevel(
  env: Record<string, string | undefined> = readProcessEnv(),
): LogLevel {
  const raw = env.VELLAR_LOG_LEVEL?.trim().toLowerCase();
  if (raw && isLogLevel(raw)) return raw;
  return DEFAULT_LOG_LEVEL;
}

/**
 * Whether a message at `level` should be emitted, given the currently
 * configured threshold (VELLAR_LOG_LEVEL, or the `threshold` override).
 *
 * "silent" as the threshold suppresses every level, including "error":
 * callers that must always surface fatal failures regardless of log level
 * (e.g. a startup failure written straight to stderr) should not route
 * through shouldLog() at all.
 */
export function shouldLog(
  level: Exclude<LogLevel, "silent">,
  threshold: LogLevel = getConfiguredLogLevel(),
): boolean {
  return SEVERITY[level] >= SEVERITY[threshold];
}
