import { createMockX402Client } from "./index";

// 1) unpaid fetch – should return paid=false and no settlement
{
  const client = createMockX402Client({ paid: false });
  const result = await client.fetch("https://example.com/resource", { maxAmount: 0n });
  console.assert(result.paid === false, "expected unpaid");
  console.assert(result.settlement === undefined, "expected no settlement");
  console.log("ok: unpaid fetch → paid=false");
}

// 2) paid fetch – should return paid=true and a populated settlement
{
  const client = createMockX402Client({ paid: true });
  const result = await client.fetch("https://example.com/resource", { maxAmount: 0n });
  console.assert(result.paid === true, "expected paid");
  console.assert(result.settlement !== undefined, "expected settlement");
  console.assert(result.settlement!.transaction.length > 0, "expected tx hash");
  console.log("ok: paid fetch → paid=true, settlement present");
}

// 3) createPayment returns a stable signed-payment shape
{
  const client = createMockX402Client();
  const payment = await client.createPayment(
    {
      scheme: "exact",
      network: "stellar:testnet",
      asset: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHHHH",
      amount: "2500000",
      payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      maxTimeoutSeconds: 120,
    },
    { maxAmount: 5000000n },
  );
  console.assert(typeof payment.header === "string" && payment.header.length > 0, "expected header string");
  // The mock returns the fixed sample payment shape, ignoring the inputs.
  console.assert(payment.amount === 1000000n, "expected sample amount");
  console.assert(payment.requirements.amount === "1000000", "expected sample requirements.amount");
  console.log("ok: createPayment → SignedPayment shape");
}

console.log("mock-x402-client tests passed");