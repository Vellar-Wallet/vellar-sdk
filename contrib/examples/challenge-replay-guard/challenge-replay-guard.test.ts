import { describe, it, expect } from "vitest";
import { ChallengeReplayGuard } from "./challenge-replay-guard";

describe("Issue #260 — Challenge Replay Guard", () => {
  it("allows fresh challenge and blocks replays and expired nonces", () => {
    const guard = new ChallengeReplayGuard(10_000);

    expect(() => guard.checkAndRecord("nonce-123", Date.now())).not.toThrow();
    expect(() => guard.checkAndRecord("nonce-123", Date.now())).toThrow(/already used/);
    expect(() => guard.checkAndRecord("nonce-456", Date.now() - 20_000)).toThrow(/expired/);
  });
});
