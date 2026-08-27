import { describe, expect, it } from "vitest";
import { MultiSignerApproval } from "./multi-signer-approval-demo";

describe("MultiSignerApproval", () => {
  it("is not ready before the threshold is reached", () => {
    const approval = new MultiSignerApproval(3);
    approval.approve("alice");
    approval.approve("bob");
    expect(approval.approvalCount).toBe(2);
    expect(approval.isReady).toBe(false);
  });

  it("becomes ready once distinct approvals reach the threshold", () => {
    const approval = new MultiSignerApproval(3);
    approval.approve("alice");
    approval.approve("bob");
    approval.approve("carol");
    expect(approval.approvalCount).toBe(3);
    expect(approval.isReady).toBe(true);
  });

  it("a signer approving twice only counts once", () => {
    const approval = new MultiSignerApproval(2);
    approval.approve("alice");
    approval.approve("alice");
    approval.approve("alice");
    expect(approval.approvalCount).toBe(1);
    expect(approval.isReady).toBe(false);

    approval.approve("bob");
    expect(approval.approvalCount).toBe(2);
    expect(approval.isReady).toBe(true);
  });

  it("rejects a non-positive threshold", () => {
    expect(() => new MultiSignerApproval(0)).toThrow(RangeError);
    expect(() => new MultiSignerApproval(-1)).toThrow(RangeError);
  });
});
