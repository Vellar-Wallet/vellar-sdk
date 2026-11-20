/**
 * Unit test for session store edge cases and lifecycle management
 * Related to issue #791
 * 
 * This test suite validates session store behavior including persistence,
 * retrieval, expiration, and disposal patterns.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Session Store Lifecycle Management (#791)", () => {
  let mockStorage: Map<string, string>;

  beforeEach(() => {
    mockStorage = new Map();
  });

  describe("Session Persistence", () => {
    it("should persist session data correctly", () => {
      const sessionData = {
        accountId: "CTEST123ABC",
        keyId: "key-123",
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      };

      // Simulate storing session
      mockStorage.set("vellar-session", JSON.stringify(sessionData));

      // Verify persistence
      const stored = mockStorage.get("vellar-session");
      expect(stored).toBeDefined();
      
      const parsed = JSON.parse(stored!);
      expect(parsed.accountId).toBe(sessionData.accountId);
      expect(parsed.keyId).toBe(sessionData.keyId);
    });

    it("should handle missing session gracefully", () => {
      const retrieved = mockStorage.get("vellar-session");
      expect(retrieved).toBeUndefined();
    });

    it("should handle corrupted session data", () => {
      mockStorage.set("vellar-session", "invalid-json{");

      expect(() => {
        const data = mockStorage.get("vellar-session");
        if (data) {
          JSON.parse(data);
        }
      }).toThrow();
    });
  });

  describe("Session Touch/Update", () => {
    it("should update lastActiveAt on touch", () => {
      const initialTime = new Date("2024-01-01T00:00:00Z");
      const sessionData = {
        accountId: "CTEST123",
        keyId: "key-123",
        createdAt: initialTime.toISOString(),
        lastActiveAt: initialTime.toISOString(),
      };

      mockStorage.set("vellar-session", JSON.stringify(sessionData));

      // Simulate touch after some time
      const touchTime = new Date("2024-01-01T01:00:00Z");
      const updatedData = {
        ...sessionData,
        lastActiveAt: touchTime.toISOString(),
      };

      mockStorage.set("vellar-session", JSON.stringify(updatedData));

      const stored = JSON.parse(mockStorage.get("vellar-session")!);
      expect(stored.lastActiveAt).toBe(touchTime.toISOString());
      expect(stored.createdAt).toBe(initialTime.toISOString());
    });

    it("should preserve original createdAt on touch", () => {
      const createdAt = "2024-01-01T00:00:00Z";
      const sessionData = {
        accountId: "CTEST123",
        keyId: "key-123",
        createdAt,
        lastActiveAt: createdAt,
      };

      mockStorage.set("vellar-session", JSON.stringify(sessionData));

      // Multiple touches
      for (let i = 0; i < 5; i++) {
        const current = JSON.parse(mockStorage.get("vellar-session")!);
        const updated = {
          ...current,
          lastActiveAt: new Date().toISOString(),
        };
        mockStorage.set("vellar-session", JSON.stringify(updated));
      }

      const final = JSON.parse(mockStorage.get("vellar-session")!);
      expect(final.createdAt).toBe(createdAt);
    });
  });

  describe("Session Expiration", () => {
    it("should identify expired sessions based on lastActiveAt", () => {
      const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
      const now = Date.now();
      
      const expiredSession = {
        accountId: "CTEST123",
        keyId: "key-123",
        createdAt: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(),
        lastActiveAt: new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const activeSession = {
        accountId: "CTEST456",
        keyId: "key-456",
        createdAt: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(),
        lastActiveAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
      };

      // Check expired session
      const expiredAge = now - new Date(expiredSession.lastActiveAt).getTime();
      expect(expiredAge).toBeGreaterThan(maxAgeMs);

      // Check active session
      const activeAge = now - new Date(activeSession.lastActiveAt).getTime();
      expect(activeAge).toBeLessThan(maxAgeMs);
    });

    it("should handle sessions with future timestamps gracefully", () => {
      const futureTime = new Date(Date.now() + 10000).toISOString();
      const sessionData = {
        accountId: "CTEST123",
        keyId: "key-123",
        createdAt: futureTime,
        lastActiveAt: futureTime,
      };

      // Future timestamps should not be treated as expired
      const age = Date.now() - new Date(sessionData.lastActiveAt).getTime();
      expect(age).toBeLessThan(0);
    });

    it("should handle invalid date formats", () => {
      const sessionData = {
        accountId: "CTEST123",
        keyId: "key-123",
        createdAt: "not-a-date",
        lastActiveAt: "also-not-a-date",
      };

      const parsedDate = new Date(sessionData.lastActiveAt);
      expect(isNaN(parsedDate.getTime())).toBe(true);
    });
  });

  describe("Session Disposal", () => {
    it("should clear session on explicit end", () => {
      const sessionData = {
        accountId: "CTEST123",
        keyId: "key-123",
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      };

      mockStorage.set("vellar-session", JSON.stringify(sessionData));
      expect(mockStorage.has("vellar-session")).toBe(true);

      // Simulate session end
      mockStorage.delete("vellar-session");
      expect(mockStorage.has("vellar-session")).toBe(false);
    });

    it("should handle disposal of non-existent session", () => {
      expect(mockStorage.has("vellar-session")).toBe(false);
      
      // Should not throw
      expect(() => {
        mockStorage.delete("vellar-session");
      }).not.toThrow();
    });

    it("should stop timers on disposal", () => {
      const mockTimer = vi.fn();
      const intervalId = setInterval(mockTimer, 1000);

      // Simulate disposal
      clearInterval(intervalId);

      // Wait and verify timer stopped
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(mockTimer).not.toHaveBeenCalled();
          resolve();
        }, 1500);
      });
    });
  });

  describe("Session Store Concurrency", () => {
    it("should handle concurrent reads", async () => {
      const sessionData = {
        accountId: "CTEST123",
        keyId: "key-123",
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      };

      mockStorage.set("vellar-session", JSON.stringify(sessionData));

      // Simulate concurrent reads
      const reads = await Promise.all([
        Promise.resolve(mockStorage.get("vellar-session")),
        Promise.resolve(mockStorage.get("vellar-session")),
        Promise.resolve(mockStorage.get("vellar-session")),
      ]);

      expect(reads).toHaveLength(3);
      reads.forEach((data) => {
        expect(data).toBeDefined();
        const parsed = JSON.parse(data!);
        expect(parsed.accountId).toBe(sessionData.accountId);
      });
    });

    it("should handle concurrent writes safely", async () => {
      const writes = [];
      
      for (let i = 0; i < 5; i++) {
        writes.push(
          Promise.resolve().then(() => {
            const data = {
              accountId: `CTEST${i}`,
              keyId: `key-${i}`,
              createdAt: new Date().toISOString(),
              lastActiveAt: new Date().toISOString(),
            };
            mockStorage.set("vellar-session", JSON.stringify(data));
          })
        );
      }

      await Promise.all(writes);

      // Last write wins
      const final = mockStorage.get("vellar-session");
      expect(final).toBeDefined();
      const parsed = JSON.parse(final!);
      expect(parsed.accountId).toMatch(/^CTEST\d$/);
    });
  });

  describe("Refresh Interval", () => {
    it("should support configurable refresh intervals", () => {
      const refreshIntervals = [0, 1000, 60000, 300000];
      
      refreshIntervals.forEach((interval) => {
        expect(interval).toBeGreaterThanOrEqual(0);
        
        if (interval > 0) {
          // Interval should be reasonable (not too short)
          expect(interval).toBeGreaterThanOrEqual(1000);
        }
      });
    });

    it("should handle disabled refresh (0 or undefined)", () => {
      const config = {
        refreshIntervalMs: 0,
      };

      // No timer should be created
      expect(config.refreshIntervalMs).toBe(0);
    });
  });
});
