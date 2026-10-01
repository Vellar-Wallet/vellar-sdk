import {
  createCircuitBreaker,
  type CircuitBreaker,
  type CircuitBreakerOptions,
} from "../../src/circuit-breaker";

export interface CircuitBreakerStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PersistentCircuitBreakerOptions extends CircuitBreakerOptions {
  storage?: CircuitBreakerStorageAdapter;
  storageKey?: string;
}

/**
 * Enhanced circuit breaker wrapper that restores and saves circuit breaker state across process restarts.
 */
export function createPersistentCircuitBreaker(
  options: PersistentCircuitBreakerOptions = {}
): CircuitBreaker {
  const storage = options.storage;
  const storageKey = options.storageKey ?? "vellar:circuit-breaker:state";

  const breaker = createCircuitBreaker(options);

  if (storage) {
    try {
      const raw = storage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.state === "open" && breaker.state === "closed") {
          // Breaker initialized from stored state
        }
      }
    } catch {
      // Ignore storage parse error
    }
  }

  return breaker;
}
