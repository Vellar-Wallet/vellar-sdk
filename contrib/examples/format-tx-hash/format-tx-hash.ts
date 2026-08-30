// Example: format a full transaction hash as a shortened display string
// (first six + last four characters), for showing in a UI without wrapping.
//
// Run with: npx tsx format-tx-hash.ts

/**
 * Shortens a hash to "<first 6>...<last 4>". A hash no longer than
 * headLen + tailLen is returned unchanged rather than throwing or producing
 * a nonsensical (or negative-length) slice.
 */
export function formatTxHash(hash: string, headLen = 6, tailLen = 4): string {
  if (hash.length <= headLen + tailLen) {
    return hash;
  }
  return `${hash.slice(0, headLen)}...${hash.slice(-tailLen)}`;
}

function main() {
  const examples = [
    "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
    "shorthash123",
    "abc",
  ];
  for (const hash of examples) {
    console.log(`${hash}  ->  ${formatTxHash(hash)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
