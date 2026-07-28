import { requestTestnetFunds, FaucetError } from "./index";

console.log("faucet-helper tests:");

{
  const result = await requestTestnetFunds("GACC");
  console.assert(result.funded === true, "expected funded true on 200");
  console.log("ok: success funded=true");
}

{
  try {
    await requestTestnetFunds("invalid", { baseUrl: "https://httpbin.org/status/500" });
  } catch (err) {
    console.assert(err instanceof FaucetError, "expected FaucetError on 500");
    console.log("ok: non-200 throws FaucetError:", (err as FaucetError).message);
  }
}

console.log("faucet-helper tests passed");