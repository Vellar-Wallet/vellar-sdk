interface TestContext<T> {
  currentValue: T;
  Provider: object;
}

const providers = new WeakMap<object, TestContext<unknown>>();
const hookState: unknown[] = [];
const storeSubscriptions = new Map<Function, () => void>();
let hookIndex = 0;
let storeChangeCount = 0;

export function createContext<T>(defaultValue: T): TestContext<T> {
  const context: TestContext<T> = { currentValue: defaultValue, Provider: {} };
  providers.set(context.Provider, context as TestContext<unknown>);
  return context;
}

export function createElement(
  type: unknown,
  props: unknown,
  ...children: unknown[]
): unknown {
  if (typeof type === "object" && type !== null) {
    const context = providers.get(type);
    const value = props as { value?: unknown } | null;
    if (context && value) context.currentValue = value.value;
  }
  return { type, props, children };
}

export function useContext<T>(context: TestContext<T>): T {
  return context.currentValue;
}

export function useState<T>(
  initialState: T | (() => T),
): [T, (action: T | ((previous: T) => T)) => void] {
  const currentIndex = hookIndex++;
  if (!(currentIndex in hookState)) {
    hookState[currentIndex] =
      typeof initialState === "function" ? (initialState as () => T)() : initialState;
  }
  const setState = (action: T | ((previous: T) => T)) => {
    const previous = hookState[currentIndex] as T;
    hookState[currentIndex] =
      typeof action === "function" ? (action as (value: T) => T)(previous) : action;
  };
  return [hookState[currentIndex] as T, setState];
}

export function useSyncExternalStore<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T,
  _getServerSnapshot?: () => T,
): T {
  hookIndex += 1;
  if (!storeSubscriptions.has(subscribe)) {
    storeSubscriptions.set(subscribe, subscribe(() => storeChangeCount++));
  }
  return getSnapshot();
}

export function beginHookRender(): void {
  hookIndex = 0;
}

export function resetHookRuntime(): void {
  for (const unsubscribe of storeSubscriptions.values()) unsubscribe();
  storeSubscriptions.clear();
  hookState.length = 0;
  hookIndex = 0;
  storeChangeCount = 0;
}

export function getStoreChangeCount(): number {
  return storeChangeCount;
}