import { rpc } from "@stellar/stellar-sdk";

export class RpcCircuitBreakerError extends Error {
  constructor(readonly url: string) {
    super(`Stellar RPC Circuit Breaker is OPEN for ${url}. Request blocked.`);
    this.name = "RpcCircuitBreakerError";
  }
}

type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

class CircuitBreaker {
  state: BreakerState = "CLOSED";
  failureCount = 0;
  nextAllowedTime = 0;

  constructor(
    readonly url: string,
    readonly failureThreshold = 5,
    readonly cooldownMs = 10000,
  ) {}

  checkCall() {
    if (this.state === "OPEN") {
      if (Date.now() >= this.nextAllowedTime) {
        this.state = "HALF_OPEN";
      } else {
        throw new RpcCircuitBreakerError(this.url);
      }
    }
  }

  recordSuccess() {
    this.state = "CLOSED";
    this.failureCount = 0;
  }

  recordFailure() {
    this.failureCount++;
    if (this.state === "HALF_OPEN" || this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      this.nextAllowedTime = Date.now() + this.cooldownMs;
    }
  }
}

// Global registry to share breaker state for the same RPC URLs
const breakerRegistry = new Map<string, CircuitBreaker>();

export function getBreaker(url: string): CircuitBreaker {
  let breaker = breakerRegistry.get(url);
  if (!breaker) {
    breaker = new CircuitBreaker(url);
    breakerRegistry.set(url, breaker);
  }
  return breaker;
}

export function resetBreakerRegistry() {
  breakerRegistry.clear();
}

export class Server extends rpc.Server {
  private readonly _url: string;

  constructor(serverURL: string, opts?: rpc.Server.Options) {
    super(serverURL, opts);
    this._url = serverURL;
  }

  private async _executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    const breaker = getBreaker(this._url);
    breaker.checkCall();

    const maxRetries = 3;
    const baseDelay = 100; // ms
    const maxDelay = 1000; // ms

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn();
        breaker.recordSuccess();
        return result;
      } catch (err: any) {
        breaker.recordFailure();

        if (attempt === maxRetries) {
          throw err;
        }

        const delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt));
        const jitteredDelay = delay * (0.5 + 0.5 * Math.random());
        await new Promise((resolve) => setTimeout(resolve, jitteredDelay));

        breaker.checkCall();
      }
    }
    throw new Error("Stellar RPC call failed after retries");
  }

  override getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse> {
    return this._executeWithRetry(() => super.getTransaction(hash));
  }

  override simulateTransaction(transaction: any): Promise<rpc.Api.SimulateTransactionResponse> {
    return this._executeWithRetry(() => super.simulateTransaction(transaction));
  }

  override getLatestLedger(): Promise<rpc.Api.GetLatestLedgerResponse> {
    return this._executeWithRetry(() => super.getLatestLedger());
  }

  override getAccount(address: string): Promise<any> {
    return this._executeWithRetry(() => super.getAccount(address));
  }

  override sendTransaction(transaction: any): Promise<rpc.Api.SendTransactionResponse> {
    return this._executeWithRetry(() => super.sendTransaction(transaction));
  }

  override getEvents(opts: any): Promise<any> {
    return this._executeWithRetry(() => super.getEvents(opts));
  }

  override getLedgerEntries(...args: any[]): Promise<any> {
    return this._executeWithRetry(() => super.getLedgerEntries(...args as any));
  }

  override getNetwork(): Promise<rpc.Api.GetNetworkResponse> {
    return this._executeWithRetry(() => super.getNetwork());
  }
}
