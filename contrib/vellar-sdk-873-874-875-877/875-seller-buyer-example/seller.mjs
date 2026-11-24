// Minimal x402-challenging seller example (issue #875).
//
// Deliberately small: it demonstrates the challenge-and-verify shape only, not
// production seller infrastructure. The real settlement happens on the
// facilitator when the SDK buyer flow submits the signed payment. The default
// verifier just checks that a signature header was supplied; inject a stricter
// verifier to check with the facilitator before granting access.

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

export const PAYMENT_HEADER = "PAYMENT-SIGNATURE";
export const REQUIRED_HEADER = "PAYMENT-REQUIRED";

/** A demo verifier. Accepts any non-empty signature and marks the result as
 * unverified so callers cannot mistake this for real settlement checks. */
export function demoVerifier(payload) {
  return {
    valid: typeof payload === "string" && payload.trim().length > 0,
    demo: true,
  };
}

/** Build a server whose only route, /paid, issues an x402 challenge.
 * `verifyPayment(payload, request)` may be async and must return
 * `{ valid: boolean, reason?: string, demo?: boolean }`. */
export function createSellerServer(options = {}) {
  const {
    verifyPayment = demoVerifier,
    amount = "10000000",
    asset = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    payTo = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  } = options;

  const challenge = {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "stellar:testnet",
        asset,
        amount,
        payTo,
        maxTimeoutSeconds: 60,
      },
    ],
    resource: { url: "/paid", description: "Minimal demo resource", mimeType: "application/json" },
  };
  const encodedChallenge = Buffer.from(JSON.stringify(challenge)).toString("base64");

  return createServer(async (request, response) => {
    const path = (request.url ?? "").split("?")[0];
    if (path !== "/paid") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }

    const headerValue = request.headers[PAYMENT_HEADER.toLowerCase()];
    if (typeof headerValue !== "string" || headerValue.length === 0) {
      response.writeHead(402, {
        "content-type": "application/json",
        [REQUIRED_HEADER]: encodedChallenge,
      });
      response.end(JSON.stringify(challenge));
      return;
    }

    let verdict;
    try {
      verdict = await verifyPayment(headerValue, request);
    } catch (error) {
      verdict = { valid: false, reason: error instanceof Error ? error.message : String(error) };
    }

    if (!verdict.valid) {
      response.writeHead(402, {
        "content-type": "application/json",
        [REQUIRED_HEADER]: encodedChallenge,
      });
      response.end(JSON.stringify({ ...challenge, error: verdict.reason ?? "payment rejected" }));
      return;
    }

    response.writeHead(200, {
      "content-type": "application/json",
      "x-vellar-demo-seller": verdict.demo ? "unverified" : "verified",
    });
    response.end(JSON.stringify({ ok: true, amount, asset }));
  });
}

/** Start a seller on a loopback port. Port 0 lets tests pick a free port. */
export function listenSeller(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function main() {
  const port = Number(process.env.SELLER_PORT ?? 4021);
  const server = createSellerServer();
  listenSeller(server, port).then((actualPort) => {
    process.stdout.write(`demo seller listening on http://127.0.0.1:${actualPort}/paid\n`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
