import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  DisallowedAssetError,
  IndeterminateSettlementError,
  InvalidRequirementsError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
  PaymentRejectedError,
  SessionCeilingExceededError,
  SettlementFailedError,
} from "./errors.js";
import type { SpendLedger } from "./ledger.js";
import { redact } from "./output.js";

export type PaymentFailureReason =
  | "session_ceiling_exceeded"
  | "max_amount_exceeded"
  | "disallowed_asset"
  | "no_usable_option"
  | "invalid_requirements"
  | "payment_rejected"
  | "settlement_failed"
  | "indeterminate_settlement"
  | "other";

export interface PayerMetricsSnapshot {
  spendByAssetNetwork: ReadonlyArray<{
    asset: string;
    network: string;
    totalSpendBaseUnits: bigint;
    successCount: number;
  }>;
  totalSuccessCount: number;
  totalFailureCount: number;
  failuresByReason: Readonly<Record<string, number>>;
  totalSessionCeilingRejections: number;
  sessionCeilingRejectionsByAsset: Readonly<Record<string, number>>;
}

export interface PayerMetricsRegistry {
  recordPaymentSuccess(asset: string, amount: bigint, network: string): void;
  recordPaymentFailure(errOrReason: unknown): void;
  recordSessionCeilingRejection(asset: string): void;
  snapshot(): PayerMetricsSnapshot;
  renderPrometheus(ledger?: SpendLedger): string;
}

export function classifyPaymentFailureReason(
  err: unknown
): PaymentFailureReason {
  if (typeof err === "string") {
    return (err as PaymentFailureReason) || "other";
  }
  if (err instanceof SessionCeilingExceededError) {
    return "session_ceiling_exceeded";
  }
  if (err instanceof MaxAmountExceededError) {
    return "max_amount_exceeded";
  }
  if (err instanceof DisallowedAssetError) {
    return "disallowed_asset";
  }
  if (err instanceof NoUsablePaymentOptionError) {
    return "no_usable_option";
  }
  if (err instanceof InvalidRequirementsError) {
    return "invalid_requirements";
  }
  if (err instanceof PaymentRejectedError) {
    return "payment_rejected";
  }
  if (err instanceof SettlementFailedError) {
    return "settlement_failed";
  }
  if (err instanceof IndeterminateSettlementError) {
    return "indeterminate_settlement";
  }
  return "other";
}

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

/**
 * Create an in-memory Prometheus metrics collector for the MCP x402 payer (#676).
 */
export function createMetricsRegistry(): PayerMetricsRegistry {
  const spendMap = new Map<
    string,
    { asset: string; network: string; totalSpendBaseUnits: bigint; successCount: number }
  >();
  const failuresByReason = new Map<string, number>();
  const ceilingRejectionsByAsset = new Map<string, number>();
  let totalSuccessCount = 0;
  let totalFailureCount = 0;
  let totalSessionCeilingRejections = 0;

  return {
    recordPaymentSuccess(asset: string, amount: bigint, network: string): void {
      const key = `${asset}::${network}`;
      const existing = spendMap.get(key);
      if (existing) {
        existing.totalSpendBaseUnits += amount;
        existing.successCount += 1;
      } else {
        spendMap.set(key, {
          asset,
          network,
          totalSpendBaseUnits: amount,
          successCount: 1,
        });
      }
      totalSuccessCount += 1;
    },

    recordSessionCeilingRejection(asset: string): void {
      ceilingRejectionsByAsset.set(
        asset,
        (ceilingRejectionsByAsset.get(asset) ?? 0) + 1
      );
      totalSessionCeilingRejections += 1;
    },

    recordPaymentFailure(errOrReason: unknown): void {
      if (errOrReason instanceof SessionCeilingExceededError) {
        this.recordSessionCeilingRejection(errOrReason.asset);
      }
      const reason = classifyPaymentFailureReason(errOrReason);
      failuresByReason.set(reason, (failuresByReason.get(reason) ?? 0) + 1);
      totalFailureCount += 1;
    },

    snapshot(): PayerMetricsSnapshot {
      return {
        spendByAssetNetwork: [...spendMap.values()].map((entry) => ({
          ...entry,
        })),
        totalSuccessCount,
        totalFailureCount,
        failuresByReason: Object.fromEntries(failuresByReason.entries()),
        totalSessionCeilingRejections,
        sessionCeilingRejectionsByAsset: Object.fromEntries(
          ceilingRejectionsByAsset.entries()
        ),
      };
    },

    renderPrometheus(ledger?: SpendLedger): string {
      return renderPrometheusMetrics(this, ledger);
    },
  };
}

/**
 * Render the current payer metrics in Prometheus text exposition format (0.0.4).
 * Guaranteed to pass through `redact()` so no secret seed can ever be exposed.
 */
export function renderPrometheusMetrics(
  registry: PayerMetricsRegistry,
  ledger?: SpendLedger
): string {
  const snap = registry.snapshot();
  const lines: string[] = [];

  lines.push(
    "# HELP vellar_x402_spend_base_units_total Cumulative confirmed x402 spend in asset base units."
  );
  lines.push("# TYPE vellar_x402_spend_base_units_total counter");
  for (const entry of snap.spendByAssetNetwork) {
    lines.push(
      `vellar_x402_spend_base_units_total{asset="${escapeLabelValue(entry.asset)}",network="${escapeLabelValue(entry.network)}"} ${entry.totalSpendBaseUnits.toString()}`
    );
  }

  lines.push(
    "# HELP vellar_x402_payments_succeeded_total Total number of x402 payments that settled on-chain."
  );
  lines.push("# TYPE vellar_x402_payments_succeeded_total counter");
  lines.push(`vellar_x402_payments_succeeded_total ${snap.totalSuccessCount}`);
  for (const entry of snap.spendByAssetNetwork) {
    lines.push(
      `vellar_x402_payments_succeeded_by_asset_total{asset="${escapeLabelValue(entry.asset)}",network="${escapeLabelValue(entry.network)}"} ${entry.successCount}`
    );
  }

  lines.push(
    "# HELP vellar_x402_payments_failed_total Total number of x402 payment attempts that were refused or failed."
  );
  lines.push("# TYPE vellar_x402_payments_failed_total counter");
  lines.push(`vellar_x402_payments_failed_total ${snap.totalFailureCount}`);
  for (const [reason, count] of Object.entries(snap.failuresByReason)) {
    lines.push(
      `vellar_x402_payments_failed_by_reason_total{reason="${escapeLabelValue(reason)}"} ${count}`
    );
  }

  lines.push(
    "# HELP vellar_x402_session_ceiling_rejections_total Total number of payments refused due to session ceiling limits."
  );
  lines.push("# TYPE vellar_x402_session_ceiling_rejections_total counter");
  lines.push(
    `vellar_x402_session_ceiling_rejections_total ${snap.totalSessionCeilingRejections}`
  );
  for (const [asset, count] of Object.entries(
    snap.sessionCeilingRejectionsByAsset
  )) {
    lines.push(
      `vellar_x402_session_ceiling_rejections_by_asset_total{asset="${escapeLabelValue(asset)}"} ${count}`
    );
  }

  if (ledger) {
    const ledgerRows = ledger.snapshot();
    lines.push(
      "# HELP vellar_x402_session_ceiling_base_units Configured per-asset session ceiling in base units."
    );
    lines.push("# TYPE vellar_x402_session_ceiling_base_units gauge");
    for (const row of ledgerRows) {
      lines.push(
        `vellar_x402_session_ceiling_base_units{asset="${escapeLabelValue(row.asset)}"} ${row.ceiling}`
      );
    }

    lines.push(
      "# HELP vellar_x402_session_remaining_base_units Remaining per-asset session budget in base units."
    );
    lines.push("# TYPE vellar_x402_session_remaining_base_units gauge");
    for (const row of ledgerRows) {
      lines.push(
        `vellar_x402_session_remaining_base_units{asset="${escapeLabelValue(row.asset)}"} ${row.remaining}`
      );
    }
  }

  return redact(`${lines.join("\n")}\n`);
}

export interface MetricsEndpointOptions {
  /** Opt-in flag. When false or omitted without a port, no server is started. */
  enabled?: boolean;
  /** TCP port to bind (`0` selects an ephemeral port). Required when enabled. */
  port?: number;
  /** Bind address (defaults to `"127.0.0.1"` so metrics are loopback-only). */
  host?: string;
  /** HTTP path (defaults to `"/metrics"`). */
  path?: string;
  registry: PayerMetricsRegistry;
  ledger?: SpendLedger;
}

export interface MetricsEndpointHandle {
  readonly server: http.Server;
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Start the opt-in Prometheus HTTP endpoint for the MCP payer (#676).
 * Disabled by default: returns `undefined` unless `enabled` is true or `port` is provided.
 */
export async function startMetricsEndpoint(
  options: MetricsEndpointOptions
): Promise<MetricsEndpointHandle | undefined> {
  const isEnabled = options.enabled ?? options.port !== undefined;
  if (!isEnabled || options.port === undefined) {
    return undefined;
  }

  const host = options.host ?? "127.0.0.1";
  const metricsPath = options.path ?? "/metrics";

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url ?? "/", `http://${host}`);
    if (reqUrl.pathname !== metricsPath) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found\n");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, {
        "Content-Type": "text/plain; charset=utf-8",
        Allow: "GET, HEAD",
      });
      res.end("Method Not Allowed\n");
      return;
    }

    const body = renderPrometheusMetrics(options.registry, options.ledger);
    res.writeHead(200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const addr = server.address() as AddressInfo;
  const boundPort = addr.port;
  const formattedHost = host.includes(":") ? `[${host}]` : host;

  return {
    server,
    host,
    port: boundPort,
    path: metricsPath,
    url: `http://${formattedHost}:${boundPort}${metricsPath}`,
    close(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
