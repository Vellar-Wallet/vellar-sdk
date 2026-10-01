/**
 * React binding for the wallet handle — reference implementation for #457.
 *
 * A thin React provider + useWallet hook over the vanilla zustand session store.
 * Subscribes correctly for React 18+ and calls the existing teardown on unmount.
 *
 * Ships as a separate entry point with react as an optional peer dependency.
 * This file is a self-contained example; the real module would live in src/.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { StoreApi } from "zustand";
import type { SessionState, SessionStatus } from "../../src/session";
import type { WalletSession } from "../../src/types";

export interface WalletContextValue {
  session: WalletSession | null;
  status: SessionStatus;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export interface VellarProviderProps {
  store: StoreApi<SessionState>;
  children: ReactNode;
}

/**
 * Provider that subscribes to the session store and exposes wallet state.
 * Calls store.end() on unmount to run the existing teardown path.
 */
export function VellarProvider({ store, children }: VellarProviderProps) {
  const [state, setState] = useState<WalletContextValue>(() => ({
    session: store.getState().session,
    status: store.getState().status,
  }));

  useEffect(() => {
    const unsub = store.subscribe((s) => {
      setState({ session: s.session, status: s.status });
    });
    return () => {
      unsub();
      // Teardown on unmount — the specific bug this binding exists to prevent.
      store.getState().end().catch(() => {});
    };
  }, [store]);

  return <WalletContext.Provider value={state}>{children}</WalletContext.Provider>;
}

/**
 * Hook exposing the current wallet session and status.
 * Must be used inside a VellarProvider.
 */
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within a VellarProvider");
  }
  return ctx;
}