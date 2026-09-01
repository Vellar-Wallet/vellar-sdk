import { describe, expect, it } from "vitest";
import type { WalletConnector } from "../../../src/connector";
import type { WalletSession } from "../../../src/types";
import { withConnectTelemetry, type ConnectFunnelEvent } from "./connect-telemetry";

function makeConnector(overrides: Partial<WalletConnector> = {}): WalletConnector {
  return {
    async createWallet() {
      throw new Error("not used in these tests");
    },
    async connectWallet(network) {
      const session: WalletSession = {
        accountId: "CTESTACCOUNT",
        network,
        connected: true,
        authMethod: "passkey",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActiveAt: "2026-01-01T00:00:00.000Z",
        keyId: "test-key-id",
      };
      return session;
    },
    async signTransaction() {
      throw new Error("not used in these tests");
    },
    ...overrides,
  };
}

describe("withConnectTelemetry", () => {
  it("emits the full funnel in order on a successful connect", async () => {
    const events: ConnectFunnelEvent[] = [];
    const connector = withConnectTelemetry(makeConnector(), (e) => events.push(e));

    const session = await connector.connectWallet("testnet");

    expect(session.accountId).toBe("CTESTACCOUNT");
    expect(events.map((e) => e.name)).toEqual([
      "connect_started",
      "connect_webauthn_ceremony_started",
      "connect_webauthn_ceremony_completed",
      "connect_backend_lookup_started",
      "connect_backend_lookup_completed",
      "connect_succeeded",
    ]);
  });

  it("stamps every event with the same connectionAttemptId and the requested network", async () => {
    const events: ConnectFunnelEvent[] = [];
    const connector = withConnectTelemetry(makeConnector(), (e) => events.push(e));

    await connector.connectWallet("mainnet");

    const ids = new Set(events.map((e) => e.connectionAttemptId));
    expect(ids.size).toBe(1);
    expect(events.every((e) => e.network === "mainnet")).toBe(true);
  });

  it("includes the account id and a duration on connect_succeeded", async () => {
    const events: ConnectFunnelEvent[] = [];
    const connector = withConnectTelemetry(makeConnector(), (e) => events.push(e));

    await connector.connectWallet("testnet");

    const succeeded = events.find((e) => e.name === "connect_succeeded");
    expect(succeeded).toBeDefined();
    if (succeeded?.name === "connect_succeeded") {
      expect(succeeded.accountId).toBe("CTESTACCOUNT");
      expect(typeof succeeded.durationMs).toBe("number");
      expect(succeeded.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("includes the resolved keyId on connect_webauthn_ceremony_completed", async () => {
    const events: ConnectFunnelEvent[] = [];
    const connector = withConnectTelemetry(makeConnector(), (e) => events.push(e));

    await connector.connectWallet("testnet");

    const ceremonyCompleted = events.find((e) => e.name === "connect_webauthn_ceremony_completed");
    expect(ceremonyCompleted).toBeDefined();
    if (ceremonyCompleted?.name === "connect_webauthn_ceremony_completed") {
      expect(ceremonyCompleted.keyId).toBe("test-key-id");
    }
  });

  it("emits connect_failed with the error name, message, and failing step when the connector throws", async () => {
    const events: ConnectFunnelEvent[] = [];
    const failingConnector = makeConnector({
      async connectWallet() {
        const err = new Error("network mismatch");
        err.name = "WalletNetworkMismatchError";
        throw err;
      },
    });
    const connector = withConnectTelemetry(failingConnector, (e) => events.push(e));

    await expect(connector.connectWallet("testnet")).rejects.toThrow("network mismatch");

    expect(events.map((e) => e.name)).toEqual(["connect_started", "connect_webauthn_ceremony_started", "connect_failed"]);
    const failed = events.find((e) => e.name === "connect_failed");
    if (failed?.name === "connect_failed") {
      expect(failed.errorName).toBe("WalletNetworkMismatchError");
      expect(failed.errorMessage).toBe("network mismatch");
      expect(failed.failedAtStep).toBe("connect_webauthn_ceremony_started");
    }
  });

  it("still resolves the underlying connect call when the telemetry hook throws", async () => {
    const connector = withConnectTelemetry(makeConnector(), () => {
      throw new Error("telemetry backend is down");
    });

    const session = await connector.connectWallet("testnet");
    expect(session.accountId).toBe("CTESTACCOUNT");
  });

  it("does not instrument createWallet or signTransaction", async () => {
    let createWalletCalls = 0;
    const connector = withConnectTelemetry(
      makeConnector({
        async createWallet(input) {
          createWalletCalls++;
          return {
            accountId: "CCREATED",
            network: input.network,
            connected: true,
            authMethod: "passkey",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastActiveAt: "2026-01-01T00:00:00.000Z",
          };
        },
      }),
      () => {
        throw new Error("createWallet must never trigger connect telemetry");
      },
    );

    const session = await connector.createWallet({ network: "testnet" });
    expect(session.accountId).toBe("CCREATED");
    expect(createWalletCalls).toBe(1);
  });

  it("assigns a distinct connectionAttemptId to each connectWallet call", async () => {
    const events: ConnectFunnelEvent[] = [];
    const connector = withConnectTelemetry(makeConnector(), (e) => events.push(e));

    await connector.connectWallet("testnet");
    await connector.connectWallet("testnet");

    const ids = new Set(events.map((e) => e.connectionAttemptId));
    expect(ids.size).toBe(2);
  });
});
