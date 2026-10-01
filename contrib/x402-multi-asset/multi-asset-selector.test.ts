// Conformance vectors for multi-asset x402 payment decisions.
//
// Tests the selectWithAssetPreference function against the cases the current
// selectRequirements does not cover: candidates spanning multiple assets.

import { describe, expect, it } from "vitest";
import { NoUsablePaymentOptionError } from "../../src/x402-types.js";
import { selectWithAssetPreference } from "./multi-asset-selector.js";

// Aliases for readability.
const select = selectWithAssetPreference;

const TOKEN_A = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const TOKEN_B = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";

function requirement(overrides: Record<string, unknown> = {}) {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    asset: TOKEN_A,
    amount: "1000000",
    payTo: "GAVU25UK4ISUJIH6KWLXX6XDKKCR3GNZ27RZ5WABRSE42ZADV2LB3ZLU",
    maxTimeoutSeconds: 120,
    extra: { areFeesSponsored: true },
    ...overrides,
  };
}

function decoded(accepts: ReturnType<typeof requirement>[]) {
  return { x402Version: 2, accepts };
}

describe("selectWithAssetPreference", () => {
  // ── single-asset cases (should behave like the original) ──────────────────

  it("picks the cheapest option when all candidates share one asset", () => {
    const result = select(
      decoded([
        requirement({ amount: "5000000" }),
        requirement({ amount: "1000000" }),
        requirement({ amount: "3000000" }),
      ]),
      {},
    );
    expect(result.amount).toBe("1000000");
    expect(result.asset).toBe(TOKEN_A);
  });

  it("works with a single candidate", () => {
    const result = select(decoded([requirement()]), {});
    expect(result.amount).toBe("1000000");
  });

  // ── multi-asset cases ────────────────────────────────────────────────────

  it("refuses multi-asset candidates when no preference is stated", () => {
    expect(() =>
      select(
        decoded([
          requirement({ asset: TOKEN_A, amount: "1000000" }),
          requirement({ asset: TOKEN_B, amount: "500000" }),
        ]),
        {},
      ),
    ).toThrow(NoUsablePaymentOptionError);
  });

  it("refuses multi-asset with a clear message about incomparable amounts", () => {
    expect(() =>
      select(
        decoded([
          requirement({ asset: TOKEN_A }),
          requirement({ asset: TOKEN_B }),
        ]),
        {},
      ),
    ).toThrow(/not comparable across assets/);
  });

  it("selects the preferred asset when stated", () => {
    const result = select(
      decoded([
        requirement({ asset: TOKEN_A, amount: "1000000" }),
        requirement({ asset: TOKEN_B, amount: "500000" }),
      ]),
      { preferredAssets: [TOKEN_B] },
    );
    expect(result.asset).toBe(TOKEN_B);
    expect(result.amount).toBe("500000");
  });

  it("picks the cheapest within the preferred asset", () => {
    const result = select(
      decoded([
        requirement({ asset: TOKEN_A, amount: "2000000" }),
        requirement({ asset: TOKEN_A, amount: "1000000" }),
        requirement({ asset: TOKEN_B, amount: "500000" }),
        requirement({ asset: TOKEN_B, amount: "300000" }),
      ]),
      { preferredAssets: [TOKEN_A] },
    );
    expect(result.asset).toBe(TOKEN_A);
    expect(result.amount).toBe("1000000");
  });

  it("falls through preference list to the second choice", () => {
    // TOKEN_C is not offered, so it falls through to TOKEN_B.
    const TOKEN_C = "CNOTOFFEREDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const result = select(
      decoded([
        requirement({ asset: TOKEN_A, amount: "1000000" }),
        requirement({ asset: TOKEN_B, amount: "500000" }),
      ]),
      { preferredAssets: [TOKEN_C, TOKEN_B] },
    );
    expect(result.asset).toBe(TOKEN_B);
  });

  it("throws when none of the preferred assets are offered", () => {
    const TOKEN_C = "CNOTOFFEREDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const TOKEN_D = "CNOTOFFEREDBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    expect(() =>
      select(
        decoded([requirement({ asset: TOKEN_A }), requirement({ asset: TOKEN_B })]),
        { preferredAssets: [TOKEN_C, TOKEN_D] },
      ),
    ).toThrow(/None of the preferred assets/);
  });

  it("throws when preferredAssets is an empty array (same as omitted)", () => {
    expect(() =>
      select(
        decoded([requirement({ asset: TOKEN_A }), requirement({ asset: TOKEN_B })]),
        { preferredAssets: [] },
      ),
    ).toThrow(/not comparable/);
  });

  // ── the correctness bug this issue documents ─────────────────────────────

  it("DOCUMENTS THE BUG: current selectRequirements would pick TOKEN_B by accident", () => {
    // 500 TOKEN_B < 1000 TOKEN_A in raw base-unit comparison, but these are
    // different assets with different base units. The current code picks
    // TOKEN_B because it has a smaller number — a meaningless comparison.
    // Our function correctly refuses without a preference.
    expect(() =>
      select(
        decoded([
          requirement({ asset: TOKEN_A, amount: "1000" }),
          requirement({ asset: TOKEN_B, amount: "500" }),
        ]),
        {},
      ),
    ).toThrow(/not comparable across assets/);
  });
});