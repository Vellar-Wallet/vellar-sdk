import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REDACTED,
  redactSensitiveFields,
  SENSITIVE_LOG_FIELDS,
} from "./log-redaction";
import { createPasskeyKitConnector, type PasskeyKitLike, type WalletBackend } from "./passkeykit-connector";

describe("redactSensitiveFields", () => {
  it("redacts every known sensitive field at the top level", () => {
    const input: Record<string, unknown> = {};
    for (const field of SENSITIVE_LOG_FIELDS) input[field] = `value-of-${field}`;
    input.event = "user-connected";

    const out = redactSensitiveFields(input);
    for (const field of SENSITIVE_LOG_FIELDS) expect(out[field]).toBe(REDACTED);
    expect(out.event).toBe("user-connected");
  });

  it("matches field names case-insensitively", () => {
    const out = redactSensitiveFields({ SecretKey: "S123", ACCOUNTID: "CABC" });
    expect(out.SecretKey).toBe(REDACTED);
    expect(out.ACCOUNTID).toBe(REDACTED);
  });

  it("redacts sensitive fields nested inside objects and arrays", () => {
    const out = redactSensitiveFields({
      event: "session-key-rotated",
      details: {
        previousPublicKey: "GFIRST",
        newPublicKey: "GSECOND",
        history: [{ publicKey: "GOLD1" }, { publicKey: "GOLD2" }],
      },
    });
    const details = out.details as Record<string, unknown>;
    expect(details.previousPublicKey).toBe(REDACTED);
    expect(details.newPublicKey).toBe(REDACTED);
    const history = details.history as Array<Record<string, unknown>>;
    expect(history[0]!.publicKey).toBe(REDACTED);
    expect(history[1]!.publicKey).toBe(REDACTED);
  });

  it("leaves non-sensitive fields untouched", () => {
    const out = redactSensitiveFields({ event: "wallet-created", network: "testnet", count: 3 });
    expect(out).toEqual({ event: "wallet-created", network: "testnet", count: 3 });
  });

  it("does not mutate the input", () => {
    const input = { secretKey: "S123", event: "x" };
    const out = redactSensitiveFields(input);
    expect(input.secretKey).toBe("S123");
    expect(out).not.toBe(input);
  });

  it("passes through null and undefined", () => {
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields(undefined)).toBeUndefined();
  });

  it("passes through primitives unchanged", () => {
    expect(redactSensitiveFields("hello")).toBe("hello");
    expect(redactSensitiveFields(42)).toBe(42);
    expect(redactSensitiveFields(true)).toBe(true);
  });

  it("passes through non-plain objects (Error, Date) without flattening them", () => {
    const err = new Error("boom");
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(redactSensitiveFields({ err, date })).toEqual({ err, date });
  });

  it("supports extraFields for consumer-specific sensitive keys", () => {
    const out = redactSensitiveFields(
      { email: "user@example.com", event: "x" },
      { extraFields: ["email"] },
    );
    expect(out.email).toBe(REDACTED);
    expect(out.event).toBe("x");
  });

  it("does not redact fields not in the sensitive set even if similarly named", () => {
    const out = redactSensitiveFields({ eventKeyId: "not-a-real-keyId-field", keyId: "abc" });
    // Only an exact (case-insensitive) field-name match is redacted.
    expect(out.eventKeyId).toBe("not-a-real-keyId-field");
    expect(out.keyId).toBe(REDACTED);
  });

  it("redacts circular references safely instead of throwing or looping forever", () => {
    const obj: Record<string, unknown> = { secretKey: "S123" };
    obj.self = obj;
    const out = redactSensitiveFields(obj);
    expect(out.secretKey).toBe(REDACTED);
    expect(out.self).toBe("[circular]");
  });

  it("stops descending past maxDepth, leaving deeper values as-is", () => {
    const deep = { a: { b: { c: { secretKey: "S123" } } } };
    const out = redactSensitiveFields(deep, { maxDepth: 1 });
    // depth 1 only redacts/walks the top level's direct children; a's value
    // (an object) is returned unwalked once depth is exhausted.
    expect(out.a).toEqual({ b: { c: { secretKey: "S123" } } });
  });
});

describe("PII redaction guidance wired to onDebugLog (#291)", () => {
  // connectWallet guards on a browser WebAuthn context; simulate it for these
  // Node-run unit tests (same pattern as passkeykit-connector.test.ts).
  beforeEach(() => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { credentials: {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeKit(): PasskeyKitLike {
    return {
      createWallet: vi.fn(),
      connectWallet: vi.fn().mockResolvedValue({ keyIdBase64: "key1", contractId: "CABC" }),
      sign: vi.fn(),
      wallet: undefined,
    };
  }
  function fakeBackend(): WalletBackend {
    return {
      submitWalletCreation: vi.fn(),
      lookupContractId: vi.fn().mockResolvedValue({ contractId: "CABC", sessionId: "sess-1" }),
    };
  }

  it("a consumer wrapping onDebugLog with redactSensitiveFields never sees raw public keys", async () => {
    const sink: Array<{ event: string; details: unknown }> = [];
    const connector = createPasskeyKitConnector({
      kit: fakeKit(),
      backend: fakeBackend(),
      network: "testnet",
      appName: "Test App",
      sessionKeyRotation: {
        mint: vi.fn().mockResolvedValue({ publicKey: "GVERYSENSITIVEPUBLICKEY00000000000000000000000000000000" }),
        revoke: vi.fn().mockResolvedValue(undefined),
      },
      onDebugLog: (event, details) => {
        sink.push({ event, details: redactSensitiveFields(details) });
      },
    });

    await connector.connectWallet("testnet");

    const rotated = sink.find((s) => s.event === "session-key-rotated");
    expect(rotated).toBeDefined();
    const details = rotated!.details as Record<string, unknown>;
    expect(details.newPublicKey).toBe(REDACTED);
    // Confirm the raw value genuinely never reached the sink at all, not just
    // that the redacted copy looks right.
    expect(JSON.stringify(sink)).not.toContain("GVERYSENSITIVEPUBLICKEY");
  });
});
