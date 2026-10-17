export const VELLAR_LOG_LEVEL_ENV = "VELLAR_LOG_LEVEL";

export const VELLAR_LOG_LEVELS = [
  "silent",
  "error",
  "warn",
  "info",
  "debug",
] as const;

export type VellarLogLevel = (typeof VELLAR_LOG_LEVELS)[number];
export type VellarActiveLogLevel = Exclude<VellarLogLevel, "silent">;

const LOG_LEVEL_WEIGHT: Record<VellarLogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const STELLAR_SECRET_SEED_PATTERN = /\bS[A-Z0-9]{55}\b/g;

/**
 * Parse and validate a `VELLAR_LOG_LEVEL` string (`silent | error | warn | info | debug`).
 * Throws an actionable `Error` if a non-empty value is not one of the allowed levels.
 */
export function parseVellarLogLevel(
  raw: string | undefined | null,
  fallback: VellarLogLevel = "info"
): VellarLogLevel {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "silent" ||
    normalized === "error" ||
    normalized === "warn" ||
    normalized === "info" ||
    normalized === "debug"
  ) {
    return normalized;
  }
  throw new Error(
    `Invalid ${VELLAR_LOG_LEVEL_ENV} ${JSON.stringify(raw)}. Expected one of: ${VELLAR_LOG_LEVELS.join(", ")}.`
  );
}

/**
 * Read `VELLAR_LOG_LEVEL` from the provided environment map (defaulting to `process.env`).
 */
export function resolveVellarLogLevel(
  env?: Record<string, string | undefined>,
  fallback: VellarLogLevel = "info"
): VellarLogLevel {
  const source =
    env ??
    (typeof process !== "undefined" && process.env ? process.env : undefined);
  return parseVellarLogLevel(source?.[VELLAR_LOG_LEVEL_ENV], fallback);
}

/**
 * Return `true` when `messageLevel` should be emitted under `configuredLevel`.
 */
export function shouldEmitLog(
  configuredLevel: VellarLogLevel,
  messageLevel: VellarActiveLogLevel
): boolean {
  return LOG_LEVEL_WEIGHT[messageLevel] <= LOG_LEVEL_WEIGHT[configuredLevel];
}

export interface VellarLogRecord {
  level: VellarActiveLogLevel;
  msg: string;
  component?: string;
  [key: string]: unknown;
}

export interface VellarLoggerOptions {
  /** Explicit log level override. When omitted, `VELLAR_LOG_LEVEL` is read from `env` / `process.env`. */
  level?: VellarLogLevel;
  /** Optional environment map (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
  /** Fallback level when `VELLAR_LOG_LEVEL` is unset (defaults to `"info"`). */
  defaultLevel?: VellarLogLevel;
  /** Optional component tag included in structured records. */
  component?: string;
  /** Output format (`"json"` default, or `"text"` for human-readable CLI stderr lines). */
  format?: "json" | "text";
  /** Optional redaction function applied before writing to the sink. */
  redactFn?: (text: string) => string;
  /**
   * Custom output sink. Defaults to writing to `process.stderr.write` (never `stdout`,
   * preserving MCP stdio transport safety).
   */
  sink?: (
    level: VellarActiveLogLevel,
    formattedLine: string,
    record: VellarLogRecord
  ) => void;
}

export interface VellarLogger {
  readonly level: VellarLogLevel;
  isLevelEnabled(level: VellarActiveLogLevel): boolean;
  log(
    level: VellarActiveLogLevel,
    message: string,
    fields?: Record<string, unknown>
  ): void;
  error(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
}

function defaultRedact(text: string): string {
  return text.replace(STELLAR_SECRET_SEED_PATTERN, "[REDACTED]");
}

function defaultStderrSink(_level: VellarActiveLogLevel, line: string): void {
  if (typeof process !== "undefined" && process.stderr?.write) {
    process.stderr.write(`${line}\n`);
  }
}

/**
 * Create a shared Vellar logger that honors `VELLAR_LOG_LEVEL` (`silent | error | warn | info | debug`)
 * and writes exclusively to `stderr` by default so stdio protocols (like MCP) are never corrupted.
 */
export function createVellarLogger(
  options: VellarLoggerOptions = {}
): VellarLogger {
  const fallback = options.defaultLevel ?? "info";
  const format = options.format ?? "json";
  const redact = options.redactFn ?? defaultRedact;
  const sink = options.sink ?? defaultStderrSink;

  function currentLevel(): VellarLogLevel {
    if (options.level !== undefined) {
      return options.level;
    }
    try {
      return resolveVellarLogLevel(options.env, fallback);
    } catch {
      return fallback;
    }
  }

  function emit(
    level: VellarActiveLogLevel,
    message: string,
    fields: Record<string, unknown> = {}
  ): void {
    const activeLevel = currentLevel();
    if (!shouldEmitLog(activeLevel, level)) {
      return;
    }

    const record: VellarLogRecord = {
      level,
      ...(options.component ? { component: options.component } : {}),
      msg: message,
      ...fields,
    };

    let formatted: string;
    if (format === "text") {
      const prefix = options.component
        ? `[${options.component}:${level}]`
        : `[${level}]`;
      const extraKeys = Object.keys(fields);
      let extra = "";
      if (extraKeys.length > 0) {
        try {
          extra = ` ${JSON.stringify(fields)}`;
        } catch {
          extra = " [unserializable]";
        }
      }
      formatted = redact(`${prefix} ${message}${extra}`);
    } else {
      let serialized: string;
      try {
        serialized = JSON.stringify(record);
      } catch {
        serialized = JSON.stringify({
          level,
          ...(options.component ? { component: options.component } : {}),
          msg: message,
          fields: "[unserializable]",
        });
      }
      formatted = redact(serialized);
    }

    sink(level, formatted, record);
  }

  return {
    get level(): VellarLogLevel {
      return currentLevel();
    },
    isLevelEnabled(level: VellarActiveLogLevel): boolean {
      return shouldEmitLog(currentLevel(), level);
    },
    log: emit,
    error(message: string, fields?: Record<string, unknown>): void {
      emit("error", message, fields);
    },
    warn(message: string, fields?: Record<string, unknown>): void {
      emit("warn", message, fields);
    },
    info(message: string, fields?: Record<string, unknown>): void {
      emit("info", message, fields);
    },
    debug(message: string, fields?: Record<string, unknown>): void {
      emit("debug", message, fields);
    },
  };
}
