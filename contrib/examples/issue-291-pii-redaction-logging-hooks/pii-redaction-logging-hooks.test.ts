import { describe, expect, it } from "vitest";
import {
  REDACTED,
  redactSensitiveFields,
  SENSITIVE_LOG_FIELDS,
  withRedaction,
  type DebugLogHook,
} from "./pii-redaction-logging-hooks";

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

  it("passes through null, undefined, and primitives", () => {
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields(undefined)).toBeUndefined();
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

  it("only redacts exact field-name matches, not substrings", () => {
    const out = redactSensitiveFields({ eventKeyId: "not-sensitive", keyId: "abc" });
    expect(out.eventKeyId).toBe("not-sensitive");
    expect(out.keyId).toBe(REDACTED);
  });

  it("handles circular references instead of throwing or looping forever", () => {
    const obj: Record<string, unknown> = { secretKey: "S123" };
    obj.self = obj;
    const out = redactSensitiveFields(obj);
    expect(out.secretKey).toBe(REDACTED);
    expect(out.self).toBe("[circular]");
  });

  it("stops descending past maxDepth, leaving deeper values as-is", () => {
    const deep = { a: { b: { c: { secretKey: "S123" } } } };
    const out = redactSensitiveFields(deep, { maxDepth: 1 });
    expect(out.a).toEqual({ b: { c: { secretKey: "S123" } } });
  });
});

describe("withRedaction: redacted fields never reach the logging hook", () => {
  it("the wrapped hook receives redacted values, never the raw ones", () => {
    const received: Array<{ event: string; details: Record<string, unknown> }> = [];
    const hook: DebugLogHook = (event, details) => received.push({ event, details });

    withRedaction(hook)("session-key-rotated", {
      previousPublicKey: "GOLDSENSITIVEKEY",
      newPublicKey: "GNEWSENSITIVEKEY",
      attempt: 1,
    });

    expect(received).toHaveLength(1);
    expect(received[0]!.details.previousPublicKey).toBe(REDACTED);
    expect(received[0]!.details.newPublicKey).toBe(REDACTED);
    // Non-sensitive context survives, so the log line stays useful.
    expect(received[0]!.details.attempt).toBe(1);
    expect(received[0]!.event).toBe("session-key-rotated");
  });

  it("the raw sensitive value never appears anywhere in what the hook saw", () => {
    const captured: string[] = [];
    const hook: DebugLogHook = (event, details) =>
      captured.push(`${event} ${JSON.stringify(details)}`);

    withRedaction(hook)("wallet-connected", {
      wallet: {
        accountId: "CVERYSENSITIVEACCOUNTID",
        keyId: "VERYSENSITIVEKEYID",
        network: "testnet",
      },
    });

    const all = captured.join("\n");
    expect(all).not.toContain("CVERYSENSITIVEACCOUNTID");
    expect(all).not.toContain("VERYSENSITIVEKEYID");
    expect(all).toContain("testnet");
  });

  it("passes extraFields through to the redaction", () => {
    const received: Record<string, unknown>[] = [];
    const hook: DebugLogHook = (_event, details) => received.push(details);

    withRedaction(hook, { extraFields: ["email"] })("signup", {
      email: "user@example.com",
      plan: "free",
    });

    expect(received[0]!.email).toBe(REDACTED);
    expect(received[0]!.plan).toBe("free");
  });

  it("forwards the event name unchanged", () => {
    const events: string[] = [];
    withRedaction((event) => events.push(event))("session-key-revoke-failed", {});
    expect(events).toEqual(["session-key-revoke-failed"]);
  });
});
