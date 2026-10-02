import { describe, expect, it } from "vitest";
import {
  CLI_PAY_SETTLEMENT_EXIT_CODES,
  handleSettlementOutcome,
  processPayResponse,
} from "./cli-settlement";

describe("CLI pay settlement retry semantics and exit codes (#412)", () => {
  const validHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("handles settled outcome with exit code 0", async () => {
    const settleJson = JSON.stringify({ success: true, transaction: validHash });
    const res = new Response("paid content payload", {
      headers: { "x-payment-response": btoa(settleJson) },
    });

    const result = await processPayResponse(res);

    expect(result.exitCode).toBe(CLI_PAY_SETTLEMENT_EXIT_CODES.SETTLED);
    expect(result.outcome.kind).toBe("settled");
    expect(result.output).toBe("paid content payload");
  });

  it("handles not-spent outcome with exit code 3", async () => {
    const settleJson = JSON.stringify({
      success: false,
      transaction: "",
      errorReason: "insufficient account balance",
    });
    const res = new Response("payment required", {
      headers: { "x-payment-response": btoa(settleJson) },
    });

    const result = await processPayResponse(res);

    expect(result.exitCode).toBe(CLI_PAY_SETTLEMENT_EXIT_CODES.NOT_SPENT);
    expect(result.outcome.kind).toBe("not-spent");
    expect(result.guidance).toContain("safe to retry");
  });

  it("handles indeterminate outcome without settlement header with exit code 5", async () => {
    const res = new Response("response with missing settlement header");

    const result = await processPayResponse(res);

    expect(result.exitCode).toBe(CLI_PAY_SETTLEMENT_EXIT_CODES.INDETERMINATE);
    expect(result.outcome.kind).toBe("indeterminate");
    expect(result.guidance).toContain("Inspect the transaction on Horizon or Stellar Expert before retrying");
    expect(result.guidance).toContain("prevent double-spending");
  });

  it("handles indeterminate outcome with failure after tx submission", async () => {
    const settleJson = JSON.stringify({
      success: false,
      transaction: validHash,
    });
    const res = new Response("tx failed on-chain", {
      headers: { "x-payment-response": btoa(settleJson) },
    });

    const result = await processPayResponse(res);

    expect(result.exitCode).toBe(CLI_PAY_SETTLEMENT_EXIT_CODES.INDETERMINATE);
    expect(result.outcome.kind).toBe("indeterminate");
    expect(result.guidance).toContain(validHash);
    expect(result.guidance).toContain("prevent double-spending");
  });
});
