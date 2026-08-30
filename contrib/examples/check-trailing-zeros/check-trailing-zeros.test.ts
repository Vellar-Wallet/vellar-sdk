import { describe, expect, it } from 'vitest';
import { hasTrailingZeros } from './check-trailing-zeros';

describe('check-trailing-zeros (#110)', () => {
  it('detects trailing zeros after decimal point', () => {
    expect(hasTrailingZeros('10.50')).toBe(true);
    expect(hasTrailingZeros('1.000')).toBe(true);
    expect(hasTrailingZeros('10.0')).toBe(true);
    expect(hasTrailingZeros('0.050')).toBe(true);
  });

  it('returns false for normalized decimal strings without trailing zeros', () => {
    expect(hasTrailingZeros('10.5')).toBe(false);
    expect(hasTrailingZeros('0.05')).toBe(false);
    expect(hasTrailingZeros('3.14159')).toBe(false);
  });

  it('handles integer amounts without decimal points safely without throwing', () => {
    expect(hasTrailingZeros('100')).toBe(false);
    expect(hasTrailingZeros('0')).toBe(false);
    expect(hasTrailingZeros('1000')).toBe(false);
  });

  it('handles empty or non-string inputs safely', () => {
    expect(hasTrailingZeros('')).toBe(false);
    expect(hasTrailingZeros(null as any)).toBe(false);
  });
});
