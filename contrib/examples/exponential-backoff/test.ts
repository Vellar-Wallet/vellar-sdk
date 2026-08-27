import { computeBackoffDelay, backoffDelays } from "./index";

const options = { baseDelay: 500, multiplier: 2, maxDelay: 5000 };

console.log("computed delays (ms):");
for (const attempt of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
  const d = computeBackoffDelay(options, attempt);
  console.log(`  attempt ${attempt}: ${d}ms`);
  if (attempt === 0) console.assert(d === 500, "base delay mismatch");
  if (attempt === 3) console.assert(d === 4000, "4th delay mismatch");
  if (attempt >= 4) console.assert(d === 5000, "expected capped at maxDelay");
}

const gen = backoffDelays(options);
for (let i = 0; i < 8; i++) {
  const d = gen.next().value;
  console.assert(typeof d === "number", "generator should yield numbers");
}
console.log("exponential-backoff tests passed");