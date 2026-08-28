import { formatSettlementReceipt } from "./index";
import type { X402Settlement } from "../../../src/x402-types";

console.log("format-settlement-receipt tests:");

{
  const settlement: X402Settlement = {
    transaction: "aaa111bbb222ccc333ddd444eee555fff666777888",
    payer: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHHHH",
    asset: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHHHH",
    amount: 1000000n,
    network: "testnet",
  };

  const receipt = formatSettlementReceipt(settlement);
  console.log(receipt.lines.join("\n"));
  console.assert(receipt.lines.length >= 4, "expected at least 4 lines");
}

{
  // Optional fields present/absent are handled cleanly.
  const settlement: X402Settlement = {
    transaction: "aaa111bbb222ccc333ddd444eee555fff666777888",
    payer: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHHHH",
    asset: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHHHH",
    amount: 2500000n,
    network: "testnet",
  };

  const receipt = formatSettlementReceipt(settlement, { assetDecimals: 7 });
  console.log(receipt.lines.join("\n"));
  console.assert(receipt.lines.some((l) => l.startsWith("Network:")), "network rendered when present");
}

console.log("format-settlement-receipt tests passed");