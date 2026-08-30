// Example: shorten a long Stellar address to a display-friendly form — the
// first six and last four characters, joined by dots.
//
// Run with: npx tsx truncate-address.ts

/** Truncates an address to "<first 6>...<last 4>". An address no longer
 * than headLen + tailLen is returned unchanged. */
export function truncateAddress(address: string, headLen = 6, tailLen = 4): string {
  if (address.length <= headLen + tailLen) {
    return address;
  }
  return `${address.slice(0, headLen)}...${address.slice(-tailLen)}`;
}

function main() {
  const examples = [
    "GABC123DEF456GHI789JKL012MNO345PQR678STU901VWX234YZ",
    "CDFDULU2JWKGMIJW6FJWJJKNB3JIDQK54YTBDQUNPZTBYXCXCSO3MVZG",
    "GSHORT",
  ];
  for (const address of examples) {
    console.log(`${address}  ->  ${truncateAddress(address)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
