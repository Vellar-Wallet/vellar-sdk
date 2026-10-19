// Issue #665 — a seller redirecting the payment request to a different host.
//
// Two layers of proof:
//  1. Every REDIRECT_VECTOR is driven through the REAL createX402Client (RPC
//     answered from the captured testnet recording, nothing in src/ patched),
//     with the guard as fetchImpl: refused vectors never reach another origin,
//     the control vector is followed and paid.
//  2. A loopback test with Node's real fetch shows WHY the guard is needed:
//     unguarded, the PAYMENT-SIGNATURE header genuinely arrives at a second
//     origin; guarded, that origin receives nothing.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createX402Client, type FetchLike } from "../../src/x402-client.js";
import {
  X402CrossOriginRedirectError,
  X402TooManyRedirectsError,
  createRedirectGuardedFetch,
} from "./x402-redirect-guard.js";
import { REDIRECT_VECTORS, type RedirectVector } from "./x402-redirect-vectors.js";
import {
  RPC_URL,
  SIM_SOURCE,
  challenge,
  mockSorobanRpcFromRecording,
  recordedRequirements,
  recordingSigner,
} from "./test-helpers.js";

beforeEach(() => {
  mockSorobanRpcFromRecording();
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface SeenRequest {
  url: string;
  paymentSignature: string | null;
}

/**
 * A seller that answers the probe with a 402 and the paid retry with 200 — and
 * redirects whichever stage the vector targets. Records every request it gets.
 */
function sellerFor(vector: RedirectVector): { seen: SeenRequest[]; fetchImpl: FetchLike } {
  const seen: SeenRequest[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const paymentSignature = new Headers(init?.headers).get("PAYMENT-SIGNATURE");
    seen.push({ url, paymentSignature });
    const stage = paymentSignature ? "payment-submission" : "probe";
    if (url === vector.requestUrl && stage === vector.stage) {
      return new Response(null, { status: vector.status, headers: { Location: vector.location } });
    }
    if (!paymentSignature) return challenge({ x402Version: 2, accepts: [recordedRequirements()] });
    return new Response("unlocked", { status: 200 });
  };
  return { seen, fetchImpl };
}

function client(fetchImpl: FetchLike) {
  return createX402Client({
    signer: recordingSigner().signer,
    rpcUrl: RPC_URL,
    network: "testnet",
    simulationSourceAccount: SIM_SOURCE,
    fetchImpl,
  });
}

describe("REDIRECT_VECTORS through the real createX402Client, with the guard", () => {
  for (const vector of REDIRECT_VECTORS.filter((v) => v.expect === "refuse")) {
    it(`refuses ${vector.name}`, async () => {
      const { seen, fetchImpl } = sellerFor(vector);

      const err = await client(createRedirectGuardedFetch(fetchImpl))
        .fetch(vector.requestUrl, { maxAmount: 10_000_000n })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(X402CrossOriginRedirectError);
      expect((err as X402CrossOriginRedirectError).from).toBe("https://res.test");
      expect((err as X402CrossOriginRedirectError).to).toBe(
        new URL(vector.location, vector.requestUrl).href,
      );
      // Nothing — signed or not — ever reached another origin.
      const origins = new Set(seen.map((r) => new URL(r.url).origin));
      expect([...origins]).toEqual(["https://res.test"]);
    });
  }

  for (const vector of REDIRECT_VECTORS.filter((v) => v.expect === "follow")) {
    it(`follows ${vector.name} and completes the payment`, async () => {
      const { seen, fetchImpl } = sellerFor(vector);

      const out = await client(createRedirectGuardedFetch(fetchImpl)).fetch(vector.requestUrl, {
        maxAmount: 10_000_000n,
      });

      expect(out.paid).toBe(true);
      expect(out.response.status).toBe(200);
      const final = seen.at(-1)!;
      expect(final.url).toBe(new URL(vector.location, vector.requestUrl).href);
      expect(final.paymentSignature).not.toBeNull();
    });
  }

  it("is transparent when the seller does not redirect (happy path)", async () => {
    const seen: SeenRequest[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      const paymentSignature = new Headers(init?.headers).get("PAYMENT-SIGNATURE");
      seen.push({ url, paymentSignature });
      return paymentSignature
        ? new Response("unlocked", { status: 200 })
        : challenge({ x402Version: 2, accepts: [recordedRequirements()] });
    };

    const out = await client(createRedirectGuardedFetch(fetchImpl)).fetch("https://res.test/paid", {
      maxAmount: 10_000_000n,
    });

    expect(out.paid).toBe(true);
    expect(seen).toHaveLength(2);
  });
});

describe("createRedirectGuardedFetch", () => {
  it("asks the underlying fetch not to follow redirects itself", async () => {
    const base = vi.fn<FetchLike>(async () => new Response("ok"));
    await createRedirectGuardedFetch(base)("https://res.test/a", { method: "GET" });
    expect(base.mock.calls[0]![1]).toMatchObject({ redirect: "manual", method: "GET" });
  });

  it("refuses an opaque redirect it cannot inspect (browser manual mode)", async () => {
    const opaque = { type: "opaqueredirect", status: 0, headers: new Headers() } as Response;
    const err = await createRedirectGuardedFetch(async () => opaque)("https://res.test/a").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(X402CrossOriginRedirectError);
    expect((err as X402CrossOriginRedirectError).to).toBeNull();
  });

  it("stops after maxRedirects same-origin hops", async () => {
    let n = 0;
    const loop: FetchLike = async () =>
      new Response(null, { status: 302, headers: { Location: `/hop-${n++}` } });
    await expect(
      createRedirectGuardedFetch(loop, { maxRedirects: 2 })("https://res.test/start"),
    ).rejects.toBeInstanceOf(X402TooManyRedirectsError);
    expect(n).toBe(3);
  });

  it("turns a 303 into a body-less GET, like fetch does", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const base: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return calls.length === 1
        ? new Response(null, { status: 303, headers: { Location: "/done" } })
        : new Response("ok");
    };
    await createRedirectGuardedFetch(base)("https://res.test/form", { method: "POST", body: "x" });
    expect(calls[1]!.url).toBe("https://res.test/done");
    expect(calls[1]!.init).toMatchObject({ method: "GET", body: undefined });
  });

  it("returns a 3xx without a Location unchanged", async () => {
    const res = await createRedirectGuardedFetch(async () => new Response(null, { status: 304 }))(
      "https://res.test/a",
    );
    expect(res.status).toBe(304);
  });
});

describe("loopback proof with Node's real fetch", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });

  async function listen(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Promise<string> {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  /** Seller on one origin that redirects the paid retry to a collector on another. */
  async function sellerAndCollector() {
    const collected: Array<string | undefined> = [];
    const collector = await listen((req, res) => {
      collected.push(req.headers["payment-signature"] as string | undefined);
      res.writeHead(200).end("ok");
    });
    const seller = await listen((req, res) => {
      if (!req.headers["payment-signature"]) {
        const body = { x402Version: 2, accepts: [recordedRequirements()] };
        res
          .writeHead(402, {
            "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(body)).toString("base64"),
          })
          .end("{}");
        return;
      }
      res.writeHead(302, { Location: `${collector}/collect` }).end();
    });
    return { seller, collected };
  }

  it("UNGUARDED: fetch follows the redirect and hands the signed payment to the other origin", async () => {
    const { seller, collected } = await sellerAndCollector();

    const out = await client((url, init) => fetch(url, init)).fetch(`${seller}/paid`, {
      maxAmount: 10_000_000n,
    });

    // This is the vulnerability the guard exists for.
    expect(collected).toHaveLength(1);
    expect(collected[0]).toBeTruthy();
    expect(out.paid).toBe(true);
  });

  it("GUARDED: the same seller is refused and the other origin receives nothing", async () => {
    const { seller, collected } = await sellerAndCollector();

    await expect(
      client(createRedirectGuardedFetch((url, init) => fetch(url, init))).fetch(`${seller}/paid`, {
        maxAmount: 10_000_000n,
      }),
    ).rejects.toBeInstanceOf(X402CrossOriginRedirectError);
    expect(collected).toHaveLength(0);
  });
});
