import { describe, it, expect, vi } from "vitest";
import { createPersistentCircuitBreaker } from "./circuit-breaker-persistence";

describe("circuit-breaker persistence tests (#402)", () => {
  it("creates persistent circuit breaker instance", () => {
    const mockStorage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    };

    const breaker = createPersistentCircuitBreaker({
      storage: mockStorage,
      storageKey: "test-cb",
    });

    expect(breaker.state).toBe("closed");
    expect(mockStorage.getItem).toHaveBeenCalledWith("test-cb");
  });
});
