// Tests for signed-request auth between the SDK and a vellar-facilitator
// deployment (#226): valid, missing, and invalid signature scenarios, plus the
// canonical-string and fetch-wrapper wiring.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalRequestString,
  createSignedFetch,
  InvalidSigningConfigError,
  RequestSigningUnavailableError,
  SIGNED_REQUEST_HEADER_NAMES,
  signFacilitatorRequest,
  verifyFacilitatorRequest,
} from "./x402-request-auth";

const SECRET = "test-shared-secret";
const KEY_ID = "key-abc";
const FIXED_NOW = () => Date.parse("2026-08-01T00:00:00.000Z");
const FIXED_NONCE = () => "0102030405060708090a0b0c0d0e0f10";

function config(overrides: Partial<Parameters<typeof signFacilitatorRequest>[0]> = {}) {
  return { keyId: KEY_ID, secret: SECRET, now: FIXED_NOW, nonce: FIXED_NONCE, ...overrides };
}

describe("canonicalRequestString", () => {
  it("joins method, path, timestamp, nonce, body with newlines, method uppercased", () => {
    const s = canonicalRequestString({
      method: "post",
      path: "/verify",
      body: '{"a":1}',
      timestamp: "1700000000",
      nonce: "abc",
    });
    expect(s).toBe("POST\n/verify\n1700000000\nabc\n{\"a\":1}");
  });

  it("treats an empty body as an empty final segment", () => {
    const s = canonicalRequestString({
      method: "GET",
      path: "/settle",
      body: "",
      timestamp: "1",
      nonce: "n",
    });
    expect(s.endsWith("\n")).toBe(true);
  });
});

describe("signFacilitatorRequest", () => {
  it("produces the four signed-request headers", async () => {
    const headers = await signFacilitatorRequest(config(), {
      method: "POST",
      path: "/verify",
      body: "{}",
    });
    expect(headers[SIGNED_REQUEST_HEADER_NAMES.keyId]).toBe(KEY_ID);
    expect(headers[SIGNED_REQUEST_HEADER_NAMES.timestamp]).toBe(
      String(Math.floor(FIXED_NOW() / 1000)),
    );
    expect(headers[SIGNED_REQUEST_HEADER_NAMES.nonce]).toBe(FIXED_NONCE());
    expect(headers[SIGNED_REQUEST_HEADER_NAMES.signature]).toMatch(/^HMAC-SHA256 /);
  });

  it("is deterministic for a fixed clock, nonce, and secret", async () => {
    const a = await signFacilitatorRequest(config(), {
      method: "POST",
      path: "/verify",
      body: "{}",
    });
    const b = await signFacilitatorRequest(config(), {
      method: "POST",
      path: "/verify",
      body: "{}",
    });
    expect(a[SIGNED_REQUEST_HEADER_NAMES.signature]).toBe(b[SIGNED_REQUEST_HEADER_NAMES.signature]);
  });

  it("changes the signature when the body changes", async () => {
    const a = await signFacilitatorRequest(config(), { method: "POST", path: "/verify", body: "{}" });
    const b = await signFacilitatorRequest(config(), {
      method: "POST",
      path: "/verify",
      body: '{"changed":true}',
    });
    expect(a[SIGNED_REQUEST_HEADER_NAMES.signature]).not.toBe(
      b[SIGNED_REQUEST_HEADER_NAMES.signature],
    );
  });

  it("changes the signature when the path changes", async () => {
    const a = await signFacilitatorRequest(config(), { method: "POST", path: "/verify", body: "" });
    const b = await signFacilitatorRequest(config(), { method: "POST", path: "/settle", body: "" });
    expect(a[SIGNED_REQUEST_HEADER_NAMES.signature]).not.toBe(
      b[SIGNED_REQUEST_HEADER_NAMES.signature],
    );
  });

  it("changes the signature when the secret changes", async () => {
    const a = await signFacilitatorRequest(config(), { method: "GET", path: "/x", body: "" });
    const b = await signFacilitatorRequest(config({ secret: "different-secret" }), {
      method: "GET",
      path: "/x",
      body: "",
    });
    expect(a[SIGNED_REQUEST_HEADER_NAMES.signature]).not.toBe(
      b[SIGNED_REQUEST_HEADER_NAMES.signature],
    );
  });

  it("rejects an empty keyId", async () => {
    await expect(
      signFacilitatorRequest(config({ keyId: "" }), { method: "GET", path: "/x" }),
    ).rejects.toBeInstanceOf(InvalidSigningConfigError);
  });

  it("rejects an empty secret", async () => {
    await expect(
      signFacilitatorRequest(config({ secret: "" }), { method: "GET", path: "/x" }),
    ).rejects.toBeInstanceOf(InvalidSigningConfigError);
  });
});

describe("verifyFacilitatorRequest — valid, missing, and invalid signatures", () => {
  async function signedHeadersFor(request: { method: string; path: string; body?: string }) {
    const headers = await signFacilitatorRequest(config(), request);
    return {
      keyId: headers[SIGNED_REQUEST_HEADER_NAMES.keyId],
      timestamp: headers[SIGNED_REQUEST_HEADER_NAMES.timestamp],
      nonce: headers[SIGNED_REQUEST_HEADER_NAMES.nonce],
      signature: headers[SIGNED_REQUEST_HEADER_NAMES.signature],
    };
  }

  it("accepts a validly signed request", async () => {
    const request = { method: "POST", path: "/verify", body: "{}" };
    const headers = await signedHeadersFor(request);
    const ok = await verifyFacilitatorRequest(SECRET, headers, request, { now: FIXED_NOW });
    expect(ok).toBe(true);
  });

  it("rejects when the signature header is missing entirely", async () => {
    const request = { method: "POST", path: "/verify", body: "{}" };
    const headers = await signedHeadersFor(request);
    const ok = await verifyFacilitatorRequest(
      SECRET,
      { ...headers, signature: "" },
      request,
      { now: FIXED_NOW },
    );
    expect(ok).toBe(false);
  });

  it("rejects an invalid (tampered) signature", async () => {
    const request = { method: "POST", path: "/verify", body: "{}" };
    const headers = await signedHeadersFor(request);
    const ok = await verifyFacilitatorRequest(
      SECRET,
      { ...headers, signature: "HMAC-SHA256 dGFtcGVyZWQ=" },
      request,
      { now: FIXED_NOW },
    );
    expect(ok).toBe(false);
  });

  it("rejects when the body was altered after signing", async () => {
    const request = { method: "POST", path: "/verify", body: "{}" };
    const headers = await signedHeadersFor(request);
    const ok = await verifyFacilitatorRequest(
      SECRET,
      headers,
      { ...request, body: '{"tampered":true}' },
      { now: FIXED_NOW },
    );
    expect(ok).toBe(false);
  });

  it("rejects the wrong secret", async () => {
    const request = { method: "GET", path: "/x" };
    const headers = await signedHeadersFor(request);
    const ok = await verifyFacilitatorRequest("wrong-secret", headers, request, {
      now: FIXED_NOW,
    });
    expect(ok).toBe(false);
  });

  it("rejects a stale timestamp outside the tolerance window", async () => {
    const request = { method: "GET", path: "/x" };
    const headers = await signedHeadersFor(request);
    const farFuture = () => FIXED_NOW() + 10 * 60 * 1000; // 10 minutes later
    const ok = await verifyFacilitatorRequest(SECRET, headers, request, {
      now: farFuture,
      toleranceSeconds: 300,
    });
    expect(ok).toBe(false);
  });

  it("rejects a non-numeric timestamp", async () => {
    const request = { method: "GET", path: "/x" };
    const headers = await signedHeadersFor(request);
    const ok = await verifyFacilitatorRequest(
      SECRET,
      { ...headers, timestamp: "not-a-number" },
      request,
      { now: FIXED_NOW },
    );
    expect(ok).toBe(false);
  });

  it("rejects an unrecognized algorithm prefix", async () => {
    const request = { method: "GET", path: "/x" };
    const headers = await signedHeadersFor(request);
    const ok = await verifyFacilitatorRequest(
      SECRET,
      { ...headers, signature: `MD5 ${headers.signature.split(" ")[1]}` },
      request,
      { now: FIXED_NOW },
    );
    expect(ok).toBe(false);
  });
});

describe("createSignedFetch", () => {
  it("attaches signed headers to every request without changing the URL", async () => {
    const inner = vi.fn().mockResolvedValue(new Response("ok"));
    const signedFetch = createSignedFetch(config(), inner);

    await signedFetch("https://facilitator.test/verify", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });

    expect(inner).toHaveBeenCalledTimes(1);
    const [url, init] = inner.mock.calls[0]!;
    expect(url).toBe("https://facilitator.test/verify");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers[SIGNED_REQUEST_HEADER_NAMES.keyId]).toBe(KEY_ID);
    expect(init.headers[SIGNED_REQUEST_HEADER_NAMES.signature]).toMatch(/^HMAC-SHA256 /);
  });

  it("defaults to GET when no method is given, matching fetch's own default", async () => {
    const inner = vi.fn().mockResolvedValue(new Response("ok"));
    const signedFetch = createSignedFetch(config(), inner);
    await signedFetch("https://facilitator.test/status");
    const [, init] = inner.mock.calls[0]!;
    expect(init.headers[SIGNED_REQUEST_HEADER_NAMES.signature]).toMatch(/^HMAC-SHA256 /);
  });

  it("produces a signature that verifies against the exact body sent", async () => {
    let captured: { path: string; body?: string; headers: Record<string, string> } | undefined;
    const inner = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      captured = {
        path: new URL(url).pathname,
        body: typeof init.body === "string" ? init.body : undefined,
        headers: init.headers as Record<string, string>,
      };
      return Promise.resolve(new Response("ok"));
    });
    const signedFetch = createSignedFetch(config(), inner);
    await signedFetch("https://facilitator.test/settle", { method: "POST", body: '{"x":1}' });

    const ok = await verifyFacilitatorRequest(
      SECRET,
      {
        keyId: captured!.headers[SIGNED_REQUEST_HEADER_NAMES.keyId]!,
        timestamp: captured!.headers[SIGNED_REQUEST_HEADER_NAMES.timestamp]!,
        nonce: captured!.headers[SIGNED_REQUEST_HEADER_NAMES.nonce]!,
        signature: captured!.headers[SIGNED_REQUEST_HEADER_NAMES.signature]!,
      },
      { method: "POST", path: captured!.path, body: captured!.body },
      { now: FIXED_NOW },
    );
    expect(ok).toBe(true);
  });
});

describe("Web Crypto unavailability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signFacilitatorRequest fails loudly when subtle crypto is missing", async () => {
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: original.getRandomValues.bind(original) });
    await expect(
      signFacilitatorRequest(config(), { method: "GET", path: "/x" }),
    ).rejects.toBeInstanceOf(RequestSigningUnavailableError);
  });
});
