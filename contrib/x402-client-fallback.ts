import {
  decodePaymentRequired,
  selectRequirements,
  extractRejectionReason,
  decodeSettlementHeader,
  CAIP2_BY_NETWORK,
} from "../src/x402-guards.js";
import {
  PaymentRejectedError,
  createX402Client,
  type X402Client,
  type X402ClientDeps,
  type X402FetchInit,
  type X402Response,
  type PaymentRequirements,
} from "../src/index.js";

export interface X402FetchInitWithFallback extends X402FetchInit {
  timeoutMs?: number;
  fallbackResponse?: Response;
}

export interface X402ResponseWithFallback extends X402Response {
  isFallback?: boolean;
}

export function createX402ClientWithFallback(deps: X402ClientDeps): X402Client & {
  fetch(url: string, init: X402FetchInitWithFallback): Promise<X402ResponseWithFallback>;
} {
  const originalClient = createX402Client(deps);
  const doFetch = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const ourCaip2 = CAIP2_BY_NETWORK[deps.network];

  function readSettlement(
    res: Response,
    requirements: PaymentRequirements,
    amount: bigint,
  ): X402Response["settlement"] {
    const decoded = decodeSettlementHeader(res);
    if (!decoded) return undefined;
    return {
      transaction: decoded.transaction,
      payer: decoded.payer ?? requirements.payTo,
      asset: requirements.asset,
      amount,
      network: deps.network,
    };
  }

  return {
    ...originalClient,
    async fetch(url: string, init: X402FetchInitWithFallback): Promise<X402ResponseWithFallback> {
      if (init.body instanceof ReadableStream) {
        throw new Error(
          "x402: a ReadableStream body cannot be replayed on the payment retry. " +
            "Pass a buffered body (string, Uint8Array, Blob, FormData) instead.",
        );
      }
      const baseInit: RequestInit = {
        ...init.requestInit,
        method: init.method ?? "GET",
        headers: init.headers,
        body: init.body ?? undefined,
      };

      let first: Response;
      let timedOut = false;

      if (init.timeoutMs !== undefined && init.timeoutMs > 0) {
        const controller = new AbortController();
        const signal = controller.signal;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, init.timeoutMs);

        const callerSignal = init.requestInit?.signal;
        if (callerSignal) {
          if (callerSignal.aborted) {
            controller.abort();
          } else {
            callerSignal.addEventListener("abort", () => controller.abort());
          }
        }

        try {
          first = await doFetch(url, { ...baseInit, signal });
        } catch (err: any) {
          if (timedOut || err.name === "AbortError") {
            const fallbackRes = init.fallbackResponse ?? new Response(
              JSON.stringify({ error: "Discovery timed out", partial: true }),
              {
                status: 504,
                statusText: "Gateway Timeout",
                headers: { "Content-Type": "application/json" },
              }
            );
            return {
              response: fallbackRes,
              paid: false,
              isFallback: true,
            };
          }
          throw err;
        } finally {
          clearTimeout(timeoutId);
        }
      } else {
        first = await doFetch(url, baseInit);
      }

      if (first.status !== 402) {
        return { response: first, paid: false };
      }

      const decoded = decodePaymentRequired(first);
      const requirements = selectRequirements(decoded, init, ourCaip2);

      const signedPayment = await originalClient.createPayment(requirements, init);

      const paid = await doFetch(url, {
        ...baseInit,
        headers: { ...(init.headers ?? {}), "PAYMENT-SIGNATURE": signedPayment.header },
      });

      if (paid.status === 402 || paid.status >= 400) {
        const reason = extractRejectionReason(paid);
        throw new PaymentRejectedError(
          `x402 payment was not accepted (HTTP ${paid.status}${reason ? `: ${reason}` : ""}). ` +
            `If this was over-budget, the on-chain policy rejected it at facilitator verify.`,
          reason,
        );
      }

      const settlement = readSettlement(paid, requirements, signedPayment.amount);
      return { response: paid, paid: true, settlement };
    }
  };
}
