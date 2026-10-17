import {
  createVellarLogger,
  parseVellarLogLevel,
  resolveVellarLogLevel,
  shouldEmitLog,
  VELLAR_LOG_LEVEL_ENV,
  VELLAR_LOG_LEVELS,
  type VellarActiveLogLevel,
  type VellarLogger,
  type VellarLoggerOptions,
  type VellarLogLevel,
  type VellarLogRecord,
} from "vellar-sdk/logger";

export {
  createVellarLogger,
  parseVellarLogLevel,
  resolveVellarLogLevel,
  shouldEmitLog,
  VELLAR_LOG_LEVEL_ENV,
  VELLAR_LOG_LEVELS,
  type VellarActiveLogLevel,
  type VellarLogger,
  type VellarLoggerOptions,
  type VellarLogLevel,
  type VellarLogRecord,
};

/**
 * Create a logger for `vellar-cli` backed by the shared `VELLAR_LOG_LEVEL` contract (#678).
 * Writes diagnostic logs to `stderr` so `stdout` (used for `--json` and resource output)
 * remains clean.
 */
export function createCliLogger(
  options: VellarLoggerOptions = {}
): VellarLogger {
  return createVellarLogger({
    component: "vellar-cli",
    defaultLevel: "warn",
    ...options,
  });
}
