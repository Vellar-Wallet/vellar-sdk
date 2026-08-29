import { validateMaxAmount } from "./index";

console.log("validate-max-amount tests:");

{
  const result = validateMaxAmount({
    asset: "ETH",
    amount: 1_000_000_000n, // 0.1 ETH → ~$300
  });
  console.assert(result.warned === false, "expected no warning for reasonable amount");
  console.log("ok: ETH 0.1 → no warning");
}

{
  const result = validateMaxAmount({
    asset: "ETH",
    amount: 500_000_000_000n, // 50,000 ETH → ~$150,000,000
  });
  console.assert(result.warned === true, "expected warning for huge amount");
  console.assert(result.message !== undefined, "expected message");
  console.log("ok: ETH 50k → warned:", result.message);
}

{
  const result = validateMaxAmount({
    asset: "UNKNOWN",
    amount: 1_000n,
  });
  console.assert(result.warned === false, "expected no warning when no price feed");
  console.assert(result.message !== undefined, "expected message about missing feed");
  console.log("ok: UNKNOWN asset → skipped with message");
}

console.log("validate-max-amount tests passed");