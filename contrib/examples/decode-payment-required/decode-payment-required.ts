// Example: decode a base64-encoded JSON string as a mock x402
// PAYMENT-REQUIRED header value (x402 v2 carries payment requirements this
// way — see vellar-sdk's src/x402-client.ts decodePaymentRequired).
//
// Run with: npx tsx decode-payment-required.ts <base64String>

// Browser-safe base64 helpers, matching src/x402-client.ts's utf8ToBase64 /
// base64ToUtf8 (this package targets bundlers/browsers, no Buffer).
function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function decodePaymentRequiredHeader(base64: string): unknown {
  let json: string;
  try {
    json = base64ToUtf8(base64);
  } catch {
    throw new Error(`"${base64}" is not valid base64`);
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new Error(`Decoded base64 is not valid JSON: ${json}`);
  }
}

function main() {
  const base64 = process.argv[2];
  if (!base64) {
    console.error("Usage: npx tsx decode-payment-required.ts <base64String>");
    process.exitCode = 1;
    return;
  }

  try {
    const decoded = decodePaymentRequiredHeader(base64);
    console.log(JSON.stringify(decoded, null, 2));
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
