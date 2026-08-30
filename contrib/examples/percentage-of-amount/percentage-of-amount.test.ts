import { describe, expect, it } from 'vitest';
import { percentageOf } from './percentage-of-amount';

describe('percentage-of-amount (#109)', () => {
  it('handles 0% edge case returning 0n', () => {
    expect(percentageOf(1000000n, 0)).toBe(0n);
    expect(percentageOf('5000000', 0)).toBe(0n);
  });

  it('handles 100% edge case returning full base amount', () => {
    expect(percentageOf(1000000n, 100)).toBe(1000000n);
    expect(percentageOf('5000000', 100)).toBe(5000000n);
  });

  it('computes standard percentages correctly', () => {
    expect(percentageOf(10000000n, 5)).toBe(500000n);
    expect(percentageOf('100', 50)).toBe(50n);
  });

  it('computes fractional percentages using basis points accurately', () => {
    expect(percentageOf(10000000n, 2.5)).toBe(250000n);
    expect(percentageOf(500000000n, 0.5)).toBe(2500000n);
  });

  it('accepts bigint, string, or number input types', () => {
    expect(percentageOf(1000n, 10)).toBe(100n);
    expect(percentageOf('1000', 10)).toBe(100n);
    expect(percentageOf(1000, 10)).toBe(100n);
  });
});
