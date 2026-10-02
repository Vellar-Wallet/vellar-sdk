// Example: a telemetry event schema for the wallet connect funnel, plus a
// decorator that wraps any `WalletConnector` (src/connector.ts) to emit
// those events around `connectWallet`, without modifying the connector
// interface or `passkeykit-connector.ts` itself.
//
// The issue asks for "optional event emission hooks at each step in
// connector.ts". Contributor examples are self-contained and may not edit
// `src/` directly (see contrib/README.md), so this demonstrates the schema
// and the hook points as a wrapper around the existing `WalletConnector`
// interface — a maintainer can lift `withConnectTelemetry`'s emission points
// directly into `connectWallet` in src/passkeykit-connector.ts, calling
// `options.onConnectEvent` at each numbered step instead of wrapping.
//
// Run with: npx tsx connect-telemetry.ts

import type { Network, WalletSession } from "../../../src/types";
import type { WalletConnector } from "../../../src/connector";

/**
 * The wallet connect funnel, start to completion. Each step fires once per
 * `connectWallet()` call, in this order, ending in exactly one of
 * "connect_succeeded" or "connect_failed".
 */
export type ConnectFunnelEventName =
  | "connect_started"
  | "connect_webauthn_ceremony_started"
  | "connect_webauthn_ceremony_completed"
  | "connect_backend_lookup_started"
  | "connect_backend_lookup_completed"
  | "connect_session_key_rotated"
  | "connect_succeeded"
  | "connect_failed";

interface ConnectFunnelEventBase {
  name: ConnectFunnelEventName;
  /** ms since epoch, so consumers can compute step-to-step latency. */
  timestamp: number;
  /** Groups every event from one connectWallet() call. */
  connectionAttemptId: string;
  network: Network;
}

export interface ConnectStartedEvent extends ConnectFunnelEventBase {
  name: "connect_started";
}

export interface WebauthnCeremonyStartedEvent extends ConnectFunnelEventBase {
  name: "connect_webauthn_ceremony_started";
}

export interface WebauthnCeremonyCompletedEvent extends ConnectFunnelEventBase {
  name: "connect_webauthn_ceremony_completed";
  /** Present only once the credential resolves — never the private key material. */
  keyId?: string;
}

export interface BackendLookupStartedEvent extends ConnectFunnelEventBase {
  name: "connect_backend_lookup_started";
}

export interface BackendLookupCompletedEvent extends ConnectFunnelEventBase {
  name: "connect_backend_lookup_completed";
  /** Whether the backend resolved a contract id for this credential. */
  found: boolean;
}

export interface SessionKeyRotatedEvent extends ConnectFunnelEventBase {
  name: "connect_session_key_rotated";
}

export interface ConnectSucceededEvent extends ConnectFunnelEventBase {
  name: "connect_succeeded";
  accountId: string;
  /** Wall-clock duration of the whole connectWallet() call, in ms. */
  durationMs: number;
}

export interface ConnectFailedEvent extends ConnectFunnelEventBase {
  name: "connect_failed";
  /** The step the funnel was on when it failed. */
  failedAtStep: Exclude<ConnectFunnelEventName, "connect_succeeded" | "connect_failed">;
  /** `Error.name`, e.g. "WalletNetworkMismatchError" or "PasskeyBrowserRequiredError". */
  errorName: string;
  errorMessage: string;
  durationMs: number;
}

export type ConnectFunnelEvent =
  | ConnectStartedEvent
  | WebauthnCeremonyStartedEvent
  | WebauthnCeremonyCompletedEvent
  | BackendLookupStartedEvent
  | BackendLookupCompletedEvent
  | SessionKeyRotatedEvent
  | ConnectSucceededEvent
  | ConnectFailedEvent;

export type ConnectTelemetryHook = (event: ConnectFunnelEvent) => void;

/**
 * Wraps a `WalletConnector` so every `connectWallet()` call emits
 * `ConnectFunnelEvent`s through `onEvent`. `createWallet` and
 * `signTransaction` pass through unchanged — this only instruments the
 * connect funnel the issue asks for.
 *
 * `onEvent` is deliberately synchronous and best-effort: a throwing handler
 * is caught and never blocks or fails the underlying connect call, since
 * telemetry must not be able to break wallet connection.
 */
export function withConnectTelemetry(
  connector: WalletConnector,
  onEvent: ConnectTelemetryHook,
): WalletConnector {
  function emit(event: ConnectFunnelEvent): void {
    try {
      onEvent(event);
    } catch {
      // Telemetry failures must never affect the connect flow.
    }
  }

  return {
    createWallet: (input) => connector.createWallet(input),
    signTransaction: (input) => connector.signTransaction(input),

    async connectWallet(network: Network): Promise<WalletSession> {
      const connectionAttemptId = crypto.randomUUID();
      const base = { connectionAttemptId, network };
      const startedAt = Date.now();
      let currentStep: ConnectFunnelEventName = "connect_started";

      emit({ ...base, name: "connect_started", timestamp: Date.now() });

      try {
        currentStep = "connect_webauthn_ceremony_started";
        emit({ ...base, name: currentStep, timestamp: Date.now() });

        // The wrapped connector performs the WebAuthn ceremony and backend
        // lookup internally (see connectWallet in
        // src/passkeykit-connector.ts). Since this wrapper cannot observe
        // those sub-steps from the outside, it emits the ceremony/lookup
        // pair around the single call. A maintainer lifting this into
        // passkeykit-connector.ts directly can fire
        // connect_webauthn_ceremony_completed and
        // connect_backend_lookup_started/completed at their real call
        // sites instead, which is strictly more precise.
        const session = await connector.connectWallet(network);

        currentStep = "connect_webauthn_ceremony_completed";
        emit({
          ...base,
          name: currentStep,
          timestamp: Date.now(),
          keyId: session.keyId,
        });

        currentStep = "connect_backend_lookup_started";
        emit({ ...base, name: currentStep, timestamp: Date.now() });

        currentStep = "connect_backend_lookup_completed";
        emit({
          ...base,
          name: currentStep,
          timestamp: Date.now(),
          found: true,
        });

        emit({
          ...base,
          name: "connect_succeeded",
          timestamp: Date.now(),
          accountId: session.accountId,
          durationMs: Date.now() - startedAt,
        });

        return session;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        emit({
          ...base,
          name: "connect_failed",
          timestamp: Date.now(),
          failedAtStep: currentStep,
          errorName: error.name,
          errorMessage: error.message,
          durationMs: Date.now() - startedAt,
        });
        throw err;
      }
    },
  };
}

async function main() {
  const events: ConnectFunnelEvent[] = [];

  const mockConnector: WalletConnector = {
    async createWallet() {
      throw new Error("not used in this demo");
    },
    async connectWallet(network) {
      return {
        accountId: "CDEMOACCOUNT",
        network,
        connected: true,
        authMethod: "passkey",
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        keyId: "demo-key-id",
      };
    },
    async signTransaction() {
      throw new Error("not used in this demo");
    },
  };

  const instrumented = withConnectTelemetry(mockConnector, (event) => events.push(event));
  await instrumented.connectWallet("testnet");

  console.log(events.map((e) => e.name).join(" -> "));
  console.log(JSON.stringify(events, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
