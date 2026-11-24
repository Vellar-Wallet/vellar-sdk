import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSellerServer,
  listenSeller,
  PAYMENT_HEADER,
  REQUIRED_HEADER,
} from "./seller.mjs";

describe("minimal x402 seller (#875)", () => {
  let server: ReturnType<typeof createSellerServer>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createSellerServer();
    const port = await listenSeller(server);
    baseUrl = `http://127.0.0.1:${port}/paid`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("challenges an unpaid request with a decodable PAYMENT-REQUIRED header", async () => {
    const response = await fetch(baseUrl);

    expect(response.status).toBe(402);
    const encoded = response.headers.get(REQUIRED_HEADER);
    expect(encoded).toBeTruthy();
    const challenge = JSON.parse(Buffer.from(encoded!, "base64").toString("utf8"));
    expect(challenge.x402Version).toBe(1);
    expect(challenge.accepts[0].scheme).toBe("exact");
    expect(challenge.accepts[0].network).toBe("stellar:testnet");
    expect(challenge.accepts[0].amount).toBe("10000000");
  });

  it("serves the resource when a signature header is present", async () => {
    const response = await fetch(baseUrl, { headers: { [PAYMENT_HEADER]: "demo-signature" } });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-vellar-demo-seller")).toBe("unverified");
    expect(await response.json()).toMatchObject({ ok: true, amount: "10000000" });
  });

  it("re-challenges when an injected verifier rejects the payment", async () => {
    const rejecting = createSellerServer({
      verifyPayment: () => ({ valid: false, reason: "facilitator refused" }),
    });
    const port = await listenSeller(rejecting);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/paid`, {
        headers: { [PAYMENT_HEADER]: "bad-signature" },
      });
      expect(response.status).toBe(402);
      expect((await response.json()).error).toBe("facilitator refused");
    } finally {
      await new Promise<void>((resolve, reject) => {
        rejecting.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("returns 404 outside the single demo route", async () => {
    const url = baseUrl.replace("/paid", "/other");
    expect((await fetch(url)).status).toBe(404);
  });
});
