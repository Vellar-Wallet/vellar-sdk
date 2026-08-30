import { describe, expect, it } from "vitest";
import { formatPolicySummaryCard } from "./policy-summary-card";

describe("formatPolicySummaryCard", () => {
  it("includes id, type, limit, and window when all are present", () => {
    const card = formatPolicySummaryCard({
      id: "policy_1",
      type: "spending-limit",
      limit: "100 XLM/day",
      window: "24h",
    });
    expect(card).toBe(
      ["Policy ID: policy_1", "Type:      spending-limit", "Limit:     100 XLM/day", "Window:    24h"].join("\n"),
    );
  });

  it("omits the limit and window lines cleanly when absent", () => {
    const card = formatPolicySummaryCard({ id: "policy_2", type: "signer-limits" });
    expect(card).toBe("Policy ID: policy_2\nType:      signer-limits");
    expect(card).not.toContain("Limit:");
    expect(card).not.toContain("Window:");
  });

  it("omits only the window line when limit is present but window is not", () => {
    const card = formatPolicySummaryCard({ id: "policy_3", type: "spending-limit", limit: "50 XLM/tx" });
    expect(card).toContain("Limit:     50 XLM/tx");
    expect(card).not.toContain("Window:");
  });
});
