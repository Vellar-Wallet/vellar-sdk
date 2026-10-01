import { describe, expect, it, vi } from "vitest";
import { X402AbortedError, withAbortSignal, withClientAbortSignal } from "./x402-abort";
import type { X402FetchInit, X402Response } from "../../src/x402-types";

const ok: X402Response = { response: new Response("ok", { status: 200 }), paid: false };

describe("x402 abort signal (#410)", () => {
  it("aborting before the first request performs no network call", async () => {
    const inner = vi.fn(async () => ok);
    const fetchFn = withAbortSignal(inner);
    const ac = new AbortController();
    ac.abort();
    await expect(
      fetchFn("https://res.test/paid", { maxAmount: 10n, requestInit: { signal: ac.signal } }),
    ).rejects.toBeInstanceOf(X402AbortedError);
    expect(inner).not.toHaveBeenCalled();
  });

  it("aborting mid-flow surfaces a typed abort error that spent nothing", async () => {
    const ac = new AbortController();
    const inner = vi.fn(async () => {
      ac.abort();
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const fetchFn = withAbortSignal(inner);
    const err = await fetchFn("https://res.test/paid", {
      maxAmount: 10_000_000n,
      requestInit: { signal: ac.signal },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(X402AbortedError);
    expect((err as X402AbortedError).paymentMayHaveBeenSigned).toBe(false);
  });

  it("post-signature abort reports that a payment may have been signed", async () => {
    const inner = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const fetchFn = withAbortSignal(inner, () => true);
    const err = await fetchFn("https://res.test/paid", { maxAmount: 1n } as X402FetchInit).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(X402AbortedError);
    expect((err as X402AbortedError).paymentMayHaveBeenSigned).toBe(true);
    expect((err as X402AbortedError).message).toMatch(/may have been signed/);
  });

  it("withClientAbortSignal leaves a clean fetch untouched when no signal is passed", async () => {
    const fetch = vi.fn(async () => ok);
    const client = withClientAbortSignal({ fetch });
    const out = await client.fetch("https://res.test/paid", { maxAmount: 1n });
    expect(out).toBe(ok);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
