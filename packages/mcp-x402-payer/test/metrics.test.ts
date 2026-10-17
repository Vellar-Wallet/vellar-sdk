import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";
import { createSpendLedger } from "../src/ledger.js";
import { createPayer } from "../src/payer.js";
import {
  createMcpServer,
  createMetricsRegistry,
  renderPrometheusMetrics,
  startMetricsEndpoint,
  type MetricsEndpointHandle,
} from "../src/server.js";
import {
  ASSET_A,
  challenge,
  requirement,
  response402,
  responsePaid,
  scriptedFetch,
  stubSigner,
  testEnv,
} from "./helpers.js";

async function callTool(
  server: ReturnType<typeof createMcpServer>,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError?: boolean }> {
  const registered = (
    server as unknown as {
      _registeredTools: Record<
        string,
        { handler: (a: unknown, e: unknown) => unknown }
      >;
    }
  )._registeredTools[name];
  if (!registered) throw new Error(`tool ${name} is not registered`);
  const out = (await registered.handler(args, {})) as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  return {
    text: out.content.map((c) => c.text).join("\n"),
    isError: out.isError,
  };
}

describe("MCP payer Prometheus metrics endpoint (#676)", () => {
  let activeEndpoint: MetricsEndpointHandle | undefined;

  afterEach(async () => {
    if (activeEndpoint) {
      await activeEndpoint.close();
      activeEndpoint = undefined;
    }
    vi.restoreAllMocks();
  });

  it("is disabled by default in loadConfig and startMetricsEndpoint", async () => {
    const cfg = loadConfig(testEnv());
    expect(cfg.metricsPort).toBeUndefined();

    const registry = createMetricsRegistry();
    const handle = await startMetricsEndpoint({ registry });
    expect(handle).toBeUndefined();

    expect(() =>
      loadConfig({ ...testEnv(), VELLAR_X402_METRICS_PORT: "0" }),
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig({ ...testEnv(), VELLAR_X402_METRICS_PORT: "99999" }),
    ).toThrow(ConfigError);

    const enabledCfg = loadConfig({
      ...testEnv(),
      VELLAR_X402_METRICS_PORT: "9464",
    });
    expect(enabledCfg.metricsPort).toBe(9464);
  });

  it("records total spend, payment successes, payment failures, and session ceiling rejections in valid Prometheus text format", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // Session ceiling for ASSET_A is 1000 base units
    const config = loadConfig(testEnv({ assets: `${ASSET_A}:1000` }));
    const ledger = createSpendLedger(config.ceilings);
    const metrics = createMetricsRegistry();

    const fetchImpl = scriptedFetch([
      // 1st x402_pay: price 600 <= ceiling 1000 -> succeeds
      response402(challenge([requirement({ amount: "600" })])),
      responsePaid("paid-body-1"),
      // 2nd x402_pay: price 600 > remaining 400 -> SessionCeilingExceededError
      response402(challenge([requirement({ amount: "600" })])),
      // 3rd x402_pay: price 500 > max_amount 100 -> MaxAmountExceededError
      response402(challenge([requirement({ amount: "500" })])),
    ]);

    const payer = createPayer({
      config,
      ledger,
      signer: stubSigner(),
      fetchImpl,
    });
    const server = createMcpServer({ payer, config, ledger, metrics });

    const first = await callTool(server, "x402_pay", {
      resource_url: "https://res.test/item-1",
      max_amount: "1000",
    });
    expect(first.isError).toBe(false);

    const second = await callTool(server, "x402_pay", {
      resource_url: "https://res.test/item-2",
      max_amount: "1000",
    });
    expect(second.isError).toBe(true);
    expect(second.text).toContain("exceed this session's ceiling");

    const third = await callTool(server, "x402_pay", {
      resource_url: "https://res.test/item-3",
      max_amount: "100",
    });
    expect(third.isError).toBe(true);

    const text = renderPrometheusMetrics(metrics, ledger);

    // Validate Prometheus exposition format structure
    for (const rawLine of text.trim().split("\n")) {
      expect(rawLine).toMatch(
        /^(?:# (?:HELP|TYPE) [a-zA-Z_:][a-zA-Z0-9_:]* .+$|[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})? -?\d+(?:\.\d+)?)$/,
      );
    }

    expect(text).toContain(
      `vellar_x402_spend_base_units_total{asset="${ASSET_A}",network="testnet"} 600`,
    );
    expect(text).toContain("vellar_x402_payments_succeeded_total 1");
    expect(text).toContain(
      `vellar_x402_payments_succeeded_by_asset_total{asset="${ASSET_A}",network="testnet"} 1`,
    );
    expect(text).toContain("vellar_x402_payments_failed_total 2");
    expect(text).toContain(
      'vellar_x402_payments_failed_by_reason_total{reason="session_ceiling_exceeded"} 1',
    );
    expect(text).toContain(
      'vellar_x402_payments_failed_by_reason_total{reason="max_amount_exceeded"} 1',
    );
    expect(text).toContain("vellar_x402_session_ceiling_rejections_total 1");
    expect(text).toContain(
      `vellar_x402_session_ceiling_rejections_by_asset_total{asset="${ASSET_A}"} 1`,
    );
    expect(text).toContain(
      `vellar_x402_session_ceiling_base_units{asset="${ASSET_A}"} 1000`,
    );
    expect(text).toContain(
      `vellar_x402_session_remaining_base_units{asset="${ASSET_A}"} 400`,
    );
  });

  it("serves Prometheus text format over HTTP GET /metrics when opted in", async () => {
    const config = loadConfig(testEnv({ assets: `${ASSET_A}:5000` }));
    const ledger = createSpendLedger(config.ceilings);
    const metrics = createMetricsRegistry();
    metrics.recordPaymentSuccess(ASSET_A, 1250n, "testnet");
    ledger.record(ASSET_A, 1250n);

    activeEndpoint = await startMetricsEndpoint({
      enabled: true,
      port: 0,
      registry: metrics,
      ledger,
    });
    expect(activeEndpoint).toBeDefined();

    const res = await fetch(activeEndpoint!.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "text/plain; version=0.0.4; charset=utf-8",
    );
    const body = await res.text();
    expect(body).toContain(
      `vellar_x402_spend_base_units_total{asset="${ASSET_A}",network="testnet"} 1250`,
    );
    expect(body).toContain(
      `vellar_x402_session_remaining_base_units{asset="${ASSET_A}"} 3750`,
    );

    const notFound = await fetch(`http://127.0.0.1:${activeEndpoint!.port}/other`);
    expect(notFound.status).toBe(404);
  });
});
