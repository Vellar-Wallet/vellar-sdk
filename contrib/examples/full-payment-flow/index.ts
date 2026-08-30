/**
 * Reference example: full payment build, review, submit flow with mocked SAC and backend clients.
 *
 * Demonstrates:
 * - Building a payment (SAC transfer simulation)
 * - Reviewing the payment details
 * - First submit attempt failing
 * - Successful retry
 */

import type { TokenInfo } from "../../../src/balances";
import type { PaymentReview } from "../../../src/payments";

export interface MockSacClient {
  transfer(
    args: { from: string; to: string; amount: bigint },
    options?: { timeoutInSeconds?: number },
  ): Promise<unknown>;
}

export interface MockBackend {
  submitTransaction(input: { signedXdr: string; network: "testnet" | "mainnet" }): Promise<{ hash: string }>;
}

export interface PaymentFlowResult {
  review: PaymentReview;
  hash: string;
  attempts: number;
}

export function createMockSacClient(failFirst: boolean = false): MockSacClient {
  let callCount = 0;
  return {
    async transfer() {
      callCount++;
      // Simulate a successful build/simulation.
      return { toXDR: () => "AAAAAgAAAABk..." };
    },
  };
}

export function createMockBackend(failFirst: boolean = false): MockBackend {
  let callCount = 0;
  return {
    async submitTransaction() {
      callCount++;
      if (failFirst && callCount === 1) {
        throw new Error("simulated_submit_failure");
      }
      return { hash: `tx-hash-${callCount}-${Date.now()}` };
    },
  };
}

export async function runPaymentFlow(options: {
  from: string;
  to: string;
  token: TokenInfo;
  amount: bigint;
  network: string;
  sac: MockSacClient;
  backend: MockBackend;
}): Promise<PaymentFlowResult> {
  const { from, to, token, amount, network, sac, backend } = options;

  // 1. Build + simulate the transfer
  const tx = await sac.transfer({ from, to, amount }, { timeoutInSeconds: 30 });

  // 2. Review
  const review: PaymentReview = { from, to, token, amount, network: network as "testnet" | "mainnet" };

  // 3. Submit (with retry on failure)
  let attempts = 0;
  let lastError: Error | undefined;

  for (let i = 0; i < 2; i++) {
    attempts++;
    try {
      const result = await backend.submitTransaction({
        signedXdr: typeof tx === "object" && tx !== null && "toXDR" in tx
          ? (tx as { toXDR: () => string }).toXDR()
          : String(tx),
        network: network as "testnet" | "mainnet",
      });
      return { review, hash: result.hash, attempts };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error("submit failed after retries");
}