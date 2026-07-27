// Example: compare two Stellar address strings for equality after
// normalizing case (Stellar strkey addresses are conventionally uppercase,
// but comparisons should be case-insensitive against a source that isn't).
//
// Run with: npx tsx compare-addresses.ts

export function addressesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) {
    return false;
  }
  return a.toUpperCase() === b.toUpperCase();
}

function main() {
  const examples: [string | null | undefined, string | null | undefined][] = [
    ["GABC123DEF456", "GABC123DEF456"],
    ["GABC123DEF456", "gabc123def456"],
    ["GABC123DEF456", "GDIFFERENT789"],
    [null, "GABC123DEF456"],
    [undefined, undefined],
  ];

  for (const [a, b] of examples) {
    console.log(`${a ?? "(null)"} === ${b ?? "(null)"}  ->  ${addressesEqual(a, b)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
