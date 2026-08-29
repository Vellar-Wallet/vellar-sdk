// Example: encode a small JSON object describing a payment as a base64
// string suitable for an x402 PAYMENT-SIGNATURE request header (the shape
// vellar-sdk's src/x402-client.ts buildSignedPayment produces).
//
// Run with: npx tsx encode-payment-signature.ts ['<json>']
// If no argument is given, a hardcoded sample payload is used.

// Browser-safe base64 helper, matching src/x402-client.ts's utf8ToBase64
// (this package targets bundlers/browsers, no Buffer).
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function encodePaymentSignature(payload: unknown): string {
  return utf8ToBase64(JSON.stringify(payload));
}

const SAMPLE_PAYLOAD = {
  x402Version: 2,
  accepted: {
    scheme: "exact",
    network: "stellar:testnet",
    asset: "CUSDCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    amount: "2500000",
    payTo: "CPAYTOSAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  },
  payload: { transaction: "MOCKXDRTRANSACTIONBASE64==" },
};

function main() {
  const jsonArg = process.argv[2];
  let payload: unknown = SAMPLE_PAYLOAD;

  if (jsonArg) {
    try {
      payload = JSON.parse(jsonArg);
    } catch {
      console.error(`Error: "${jsonArg}" is not valid JSON`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(encodePaymentSignature(payload));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
