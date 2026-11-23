// #853 — a wrong usdcContractId fails as a simulation error. A connectivity
// failure is a different error. Callers pass the simulate function (the RPC
// server in production, a fake in tests) so this file never opens a socket.

import {
  Account,
  Address,
  Operation,
  TransactionBuilder,
  scValToBigInt,
  type Transaction,
} from "@stellar/stellar-sdk";

const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export class UsdcSimulationError extends Error {
  readonly kind = "simulation" as const;
  constructor(message: string) {
    super(message);
    this.name = "UsdcSimulationError";
  }
}

export class UsdcNetworkError extends Error {
  readonly kind = "network" as const;
  constructor(message: string) {
    super(message);
    this.name = "UsdcNetworkError";
  }
}

const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

function isNetworkFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: string }).code;
  if (code && NETWORK_CODES.has(code)) return true;
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|fetch failed/i.test(err.message);
}

export interface SimulateBalance {
  (tx: Transaction): Promise<{ error?: string; result?: { retval?: unknown } }>;
}

/**
 * Read a USDC balance by simulating `balance` on `usdcContractId`.
 * A contract id that is not a deployed contract comes back as
 * {@link UsdcSimulationError}. A socket or DNS failure comes back as
 * {@link UsdcNetworkError}. Those two are not interchangeable: a wrong
 * contract id must fail loudly, and a caller must be able to tell that
 * apart from the RPC being down (#853).
 */
export async function readUsdcBalanceViaSimulation(options: {
  usdcContractId: string;
  holder: string;
  networkPassphrase: string;
  simulate: SimulateBalance;
}): Promise<bigint> {
  const tx = new TransactionBuilder(new Account(SIMULATION_SOURCE, "0"), {
    fee: "100",
    networkPassphrase: options.networkPassphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: options.usdcContractId,
        function: "balance",
        args: [new Address(options.holder).toScVal()],
      }),
    )
    .setTimeout(60)
    .build();

  let sim: { error?: string; result?: { retval?: unknown } };
  try {
    sim = await options.simulate(tx);
  } catch (err) {
    if (isNetworkFailure(err)) {
      throw new UsdcNetworkError(err instanceof Error ? err.message : String(err));
    }
    throw new UsdcSimulationError(err instanceof Error ? err.message : String(err));
  }

  if (sim.error) {
    throw new UsdcSimulationError(sim.error);
  }
  const retval = sim.result?.retval;
  if (!retval) {
    throw new UsdcSimulationError(
      `Balance simulation for ${options.usdcContractId} returned no result. A wrong usdcContractId fails here instead of returning a zero balance.`,
    );
  }
  return scValToBigInt(retval as Parameters<typeof scValToBigInt>[0]);
}
