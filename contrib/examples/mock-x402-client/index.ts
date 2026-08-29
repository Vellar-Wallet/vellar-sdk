import type { X402Client, X402FetchInit, X402Response } from "../../../src/x402-types";
import type { SignedPayment, PaymentRequirements } from "../../../src/x402-types";

/**
 * Mock X402Client for unit tests.
 *
 * Configurable behavior:
 * - `fetch(...)` resolves with a canned X402Response. Set `paid` to true or false.
 * - `createPayment(...)` always resolves with a fixed sample SignedPayment shape.
 */
export interface MockX402ClientOptions {
  /** Whether the mock fetch should report a successful paid response. Default: false. */
  paid?: boolean;
  /** Optional canned response to return from fetch. */
  response?: Response;
  /** Fixed sample payment to return from createPayment. Default: a minimal SignedPayment. */
  samplePayment?: SignedPayment;
  /** Optional canned 402 payment requirements for use in the sample payment. */
  sampleRequirements?: PaymentRequirements;
}

const SAMPLE_REQUIREMENTS: PaymentRequirements = {
  scheme: "exact",
  network: "stellar:testnet",
  asset: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHHHH",
  amount: "1000000",
  payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  maxTimeoutSeconds: 120,
};

const SAMPLE_PAYMENT: SignedPayment = {
  header: "eyJ4MDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhjZXB0IiwibmV0d29yayI6InN0ZWxsYXI6dGVzdG5ldCIsImFzc2V0IjoiQ0FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFHSEhISCIEYW1vdW50IjoiMTAwMDAwMCIsInBheVRvIjoiR0FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBIn19fQ==",
  requirements: SAMPLE_REQUIREMENTS,
  amount: 1000000n,
};

export function createMockX402Client(opts: MockX402ClientOptions = {}): X402Client {
  const paid = opts.paid ?? false;
  const response = opts.response ?? new Response("OK", { status: 200 });
  const samplePayment: SignedPayment = opts.samplePayment ?? {
    ...SAMPLE_PAYMENT,
    ...(opts.sampleRequirements ? { requirements: opts.sampleRequirements } : {}),
  };

  return {
    async fetch(_url: string, _init?: X402FetchInit): Promise<X402Response> {
      if (paid) {
        return {
          response,
          paid: true,
          settlement: {
            transaction: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            payer: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHHHH",
            asset: SAMPLE_REQUIREMENTS.asset,
            amount: BigInt(SAMPLE_REQUIREMENTS.amount),
            network: "testnet",
          },
        };
      }
      return { response, paid: false };
    },
    async createPayment(): Promise<SignedPayment> {
      // Return a copy to prevent accidental mutation of the singleton sample.
      return {
        ...samplePayment,
        requirements: { ...samplePayment.requirements },
        amount: samplePayment.amount,
      };
    },
  } satisfies X402Client;
}

export { SAMPLE_REQUIREMENTS, SAMPLE_PAYMENT };