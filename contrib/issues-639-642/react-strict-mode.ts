// Issue #642 — a minimal local wrapper around the VellarWallet handle that is
// safe under React 19 strict mode. It stands in for a future official React
// binding (#457) so the effect contract can be tested before that lands.
//
// Strict mode mounts, runs effects, runs cleanup, then runs effects again, in
// development. An effect that calls `wallet.connect()` therefore connects
// twice and shows the user two passkey prompts. The pattern below follows from
// two facts:
//   1. A WebAuthn prompt cannot be cancelled by effect cleanup, so cleanup must
//      not try to "undo" a connect; it only stops the component from using the
//      result.
//   2. The connect itself has to be deduplicated outside React state, because
//      the strict-mode remount discards refs and state of the first pass.
// So: share one in-flight promise per wallet handle, clear it when it settles,
// and have cleanup flip a `cancelled` flag that gates every setState.

import type { VellarWallet } from "../../src/client";
import type { WalletSession } from "../../src/types";

export interface ConnectState {
  status: "connecting" | "connected" | "error";
  session: WalletSession | null;
  error: unknown;
}

const inflight = new WeakMap<VellarWallet, Promise<WalletSession>>();

/**
 * Connect the wallet, sharing a single in-flight call between callers. The
 * entry is removed once the call settles, so a later retry connects again.
 */
export function connectOnce(wallet: VellarWallet): Promise<WalletSession> {
  const existing = inflight.get(wallet);
  if (existing) return existing;
  const promise = wallet.connect().finally(() => {
    inflight.delete(wallet);
  });
  inflight.set(wallet, promise);
  return promise;
}

type ReactLike = Pick<typeof import("react"), "useEffect" | "useState">;

/** Build the hooks against the host's React, so this file never imports react itself. */
export function createConnectHooks(react: ReactLike) {
  const { useEffect, useState } = react;
  const initial: ConnectState = { status: "connecting", session: null, error: null };

  /** The recommended pattern. */
  function useWalletConnect(wallet: VellarWallet): ConnectState {
    const [state, setState] = useState<ConnectState>(initial);
    useEffect(() => {
      let cancelled = false;
      connectOnce(wallet).then(
        (session) => {
          if (!cancelled) setState({ status: "connected", session, error: null });
        },
        (error: unknown) => {
          if (!cancelled) setState({ status: "error", session: null, error });
        },
      );
      return () => {
        cancelled = true;
      };
    }, [wallet]);
    return state;
  }

  /** The common mistake, kept only to prove the test harness detects it. */
  function useWalletConnectNaive(wallet: VellarWallet): ConnectState {
    const [state, setState] = useState<ConnectState>(initial);
    useEffect(() => {
      wallet.connect().then(
        (session) => setState({ status: "connected", session, error: null }),
        (error: unknown) => setState({ status: "error", session: null, error }),
      );
    }, [wallet]);
    return state;
  }

  return { useWalletConnect, useWalletConnectNaive };
}
