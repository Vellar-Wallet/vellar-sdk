import { createMockSacClient, createMockBackend, runPaymentFlow } from "./index";

console.log("full-payment-flow tests:");

// 1) Successful submit on first attempt
{
  const sac = createMockSacClient();
  const backend = createMockBackend(false);

  const result = await runPaymentFlow({
    from: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    to: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    token: { contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHHHH", symbol: "USDC", decimals: 7 },
    amount: 1000000n,
    network: "testnet",
    sac,
    backend,
  });

  console.assert(result.attempts === 1, "expected 1 attempt on success");
  console.assert(result.hash.length > 0, "expected hash");
  console.log("ok: successful submit → 1 attempt, hash:", result.hash);
}

// 2) First attempt fails, retry succeeds
{
  const sac = createMockSacClient();
  const backend = createMockBackend(true);

  const result = await runPaymentFlow({
    from: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    to: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    token: { contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHHHH", symbol: "USDC", decimals: 7 },
    amount: 1000000n,
    network: "testnet",
    sac,
    backend,
  });

  console.assert(result.attempts === 2, "expected 2 attempts on retry");
  console.log("ok: first attempt failed, retry succeeded → 2 attempts, hash:", result.hash);
}

console.log("full-payment-flow tests passed");