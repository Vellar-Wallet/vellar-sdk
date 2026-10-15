import {
  createContext,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createVellarWallet, type PayInput, type VellarWallet, type VellarWalletConfig } from "./client";
import type { PolicyFacade } from "./policy-facade";
import type { WalletSession } from "./types";

const WalletContext = createContext<VellarWallet | null>(null);

export interface VellarProviderProps {
  config: VellarWalletConfig;
  children: ReactNode;
}

export function VellarProvider({ config, children }: VellarProviderProps) {
  const [wallet] = useState(() => createVellarWallet(config));
  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

export interface WalletHookValue {
  wallet: VellarWallet;
  session: WalletSession | null;
  loading: boolean;
  error: unknown | null;
  create(input?: { username?: string }): Promise<WalletSession>;
  connect(): Promise<WalletSession>;
  pay(input: PayInput): Promise<{ hash: string }>;
  policies: PolicyFacade;
}

export function useWallet(): WalletHookValue {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("useWallet must be used within a VellarProvider");

  const session = useSyncExternalStore(
    (onStoreChange) => wallet.subscribe(() => onStoreChange()),
    () => wallet.session,
    () => null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const pendingActions = useRef(0);

  async function runAction<T>(action: () => Promise<T>): Promise<T> {
    pendingActions.current += 1;
    setLoading(true);
    setError(null);
    try {
      return await action();
    } catch (actionError) {
      setError(actionError);
      throw actionError;
    } finally {
      pendingActions.current -= 1;
      setLoading(pendingActions.current > 0);
    }
  }

  return {
    wallet,
    session,
    loading,
    error,
    create: (input) => runAction(() => wallet.create(input)),
    connect: () => runAction(() => wallet.connect()),
    pay: (input) => runAction(() => wallet.pay(input)),
    policies: wallet.policies,
  };
}