// Example: a minimal in-process mock of an x402-protected resource server.
// Returns a mock PAYMENT-REQUIRED-style payload (402) until a payment header
// is present on the request, then returns the resource.
//
// Run with: npx tsx mock-x402-resource.ts

export interface MockRequest {
  headers: Record<string, string>;
}

export interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

// Browser-safe base64, matching src/x402-client.ts's utf8ToBase64 (this
// package targets bundlers/browsers, no Buffer).
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const PAYMENT_HEADER = "PAYMENT-SIGNATURE";

const PAYMENT_REQUIRED_PAYLOAD = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "stellar:testnet",
      asset: "CUSDCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      amount: "1000000",
      payTo: "CPAYTOSAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    },
  ],
};

/** Handles a request to a protected resource: 402 without a payment header,
 * 200 with the resource once one is present (this mock never validates the
 * header's actual signature — a real facilitator would). */
export function handleResourceRequest(request: MockRequest): MockResponse {
  const paymentHeader = request.headers[PAYMENT_HEADER] ?? request.headers[PAYMENT_HEADER.toLowerCase()];

  if (!paymentHeader) {
    return {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": utf8ToBase64(JSON.stringify(PAYMENT_REQUIRED_PAYLOAD)),
      },
      body: { error: "Payment required" },
    };
  }

  return { status: 200, headers: {}, body: { data: "the protected resource content" } };
}

function main() {
  console.log("Unpaid request:");
  console.log(handleResourceRequest({ headers: {} }));

  console.log();
  console.log("Paid request (payment header present):");
  console.log(handleResourceRequest({ headers: { "PAYMENT-SIGNATURE": "mock-signature-value" } }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
