import {
  createContext,
  createElement,
  useContext,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactElement, ReactNode } from "react";
import {
  createVellarWallet,
  type PayInput,
  type VellarWallet,
  type VellarWalletConfig,
} from "./client";
import type { PolicyDefinition, WalletSession } from "./types";
import type { PolicyFacade } from "./policy-facade";

interface WalletContextValue {
  wallet: VellarWallet;
  policiesEnabled: boolean;
}

export interface VellarProviderProps {
  config: VellarWalletConfig;
  children?: ReactNode;
}

export interface UseWalletResult {
  wallet: VellarWallet;
  session: WalletSession | null;
  create: VellarWallet["create"];
  connect: VellarWallet["connect"];
  pay: VellarWallet["pay"];
  policies: PolicyFacade | undefined;
  loading: boolean;
  error: unknown;
  clearError(): void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function VellarProvider({ config, children }: VellarProviderProps): ReactElement {
  const [value] = useState<WalletContextValue>(() => ({
    wallet: createVellarWallet(config),
    policiesEnabled: Boolean(config.apiUrl),
  }));

  return createElement(WalletContext.Provider, { value }, children);
}

export function useWallet(): UseWalletResult {
  const context = useContext<WalletContextValue | null>(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used inside a VellarProvider");
  }

  const { wallet } = context;
  const session = useSyncExternalStore(
    wallet.subscribe,
    () => wallet.session,
    () => wallet.session,
  );
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<unknown>(null);

  async function run<T>(action: () => Promise<T>): Promise<T> {
    setPending((count) => count + 1);
    setError(null);
    try {
      return await action();
    } catch (actionError) {
      setError(actionError);
      throw actionError;
    } finally {
      setPending((count) => Math.max(0, count - 1));
    }
  }

  const policies: PolicyFacade | undefined = context.policiesEnabled
    ? {
        get client() {
          return wallet.policies.client;
        },
        listTemplates: () => run(() => wallet.policies.listTemplates()),
        generate: (definition: PolicyDefinition) =>
          run(() => wallet.policies.generate(definition)),
        simulate: (policyId: string) => run(() => wallet.policies.simulate(policyId)),
        deploy: (policyId: string) => run(() => wallet.policies.deploy(policyId)),
      }
    : undefined;

  return {
    wallet,
    session,
    create: (input) => run(() => wallet.create(input)),
    connect: () => run(() => wallet.connect()),
    pay: (input: PayInput) => run(() => wallet.pay(input)),
    policies,
    loading: pending > 0,
    error,
    clearError: () => setError(null),
  };
}