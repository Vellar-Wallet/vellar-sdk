// Structured startup diagnostics for MCP payer (#418).
//
// Defines a versioned, machine-readable startup event shape exported as a
// TypeScript type, distinguishing chain-enforced smart-account limits from
// process-only limits. Enforces that no secrets are ever carried in output.

/**
 * Declared, versioned startup event emitted by the MCP payer upon readiness.
 * An operator building monitoring around this event can alert on changes
 * to spendLimit and detect schema changes via schemaVersion.
 */
export interface StartupDiagnosticEvent {
  schemaVersion: 1;
  network: string;
  payer: string;
  assets: number;
  /**
   * Distinguishes a chain-enforced limit (smart account policy co-signer on Soroban)
   * from a process-only limit (hot wallet bounded only by local process memory).
   * This is the primary field an operator alerts on.
   */
  spendLimit: "chain-enforced (smart account policy)" | "process-only (hot wallet)";
  policies?: number;
}

export interface CreateStartupDiagnosticParams {
  network: string;
  payer: string;
  assets: number;
  spendLimit?: "chain-enforced (smart account policy)" | "process-only (hot wallet)";
  smartAccount?: boolean;
  policies?: number;
}

const STELLAR_SECRET_PATTERN = /\bS[A-Z2-7]{55}\b/g;

/**
 * Strip Stellar secret seeds from string.
 */
export function redactSecrets(text: string, knownSecrets: Set<string> = new Set()): string {
  let out = text.replace(STELLAR_SECRET_PATTERN, "[REDACTED]");
  for (const s of knownSecrets) {
    if (s && s.length >= 10) {
      out = out.split(s).join("[REDACTED]");
    }
  }
  return out;
}

/**
 * Construct a typed startup diagnostic event.
 */
export function createStartupDiagnosticEvent(
  params: CreateStartupDiagnosticParams,
): StartupDiagnosticEvent {
  const spendLimit =
    params.spendLimit ??
    (params.smartAccount
      ? "chain-enforced (smart account policy)"
      : "process-only (hot wallet)");

  return {
    schemaVersion: 1,
    network: params.network,
    payer: params.payer,
    assets: params.assets,
    spendLimit,
    ...(params.policies !== undefined ? { policies: params.policies } : {}),
  };
}

/**
 * Format the structured startup line for logging.
 */
export function formatStartupLine(
  event: StartupDiagnosticEvent,
  knownSecrets: Set<string> = new Set(),
): string {
  const logLine = {
    level: "info",
    msg: "vellar x402 payer ready",
    ...event,
  };
  return redactSecrets(JSON.stringify(logLine), knownSecrets);
}
