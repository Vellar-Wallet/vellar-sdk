import { describe, expect, it, vi } from "vitest";
import { executeCliDryRun } from "./cli-dry-run";

describe("cli-dry-run (#413)", () => {
  it("returns null when dryRun is false", () => {
    const res = executeCliDryRun({
      dryRun: false,
      payerPublicKey: "G...",
      asset: "C...",
      amount: 100n,
      payTo: "G...",
      payload: {},
      paymentHeader: {},
    });
    expect(res).toBeNull();
  });

  it("constructs dry run result and outputs details without sending network request", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = executeCliDryRun({
      dryRun: true,
      payerPublicKey: "GAVU25UK4ISUJIH6KWLXX6XDKKCR3GNZ27RZ5WABRSE42ZADV2LB3ZLU",
      asset: "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND",
      amount: 5000000n,
      payTo: "GAATVGLRHZXFC66GEN5QNKD56HC5JJZVHQ3P7ZJNVCCI4WKLN44FICSC",
      payload: { expirationLedger: 123456 },
      paymentHeader: { "X-Payment": "signed-payload" },
    });

    expect(res).not.toBeNull();
    expect(res?.isDryRun).toBe(true);
    expect(res?.sentNetworkRequest).toBe(false);
    expect(res?.amount).toBe("5000000");
    expect(res?.disclaimer).toMatch(/server-side/);

    expect(logSpy.mock.calls.flat().join(" ")).toMatch(/DRY RUN: Payment constructed/);
    expect(errSpy.mock.calls.flat().join(" ")).toMatch(/Expiration Ledger: 123456/);

    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});
