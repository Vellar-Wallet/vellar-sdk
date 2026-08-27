import { describe, expect, it } from 'vitest';
import { isValidBigIntString } from './check-bigint-string';

describe('check-bigint-string (#114)', () => {
  it('accepts valid non-negative integer strings', () => {
    expect(isValidBigIntString('0')).toBe(true);
    expect(isValidBigIntString('123')).toBe(true);
    expect(isValidBigIntString('100000000000000000000')).toBe(true);
  });

  it('rejects leading plus sign', () => {
    expect(isValidBigIntString('+100')).toBe(false);
    expect(isValidBigIntString('+0')).toBe(false);
  });

  it('rejects negative numbers', () => {
    expect(isValidBigIntString('-50')).toBe(false);
    expect(isValidBigIntString('-1')).toBe(false);
  });

  it('rejects decimal points', () => {
    expect(isValidBigIntString('10.5')).toBe(false);
    expect(isValidBigIntString('0.0')).toBe(false);
  });

  it('rejects non-numeric characters and whitespace', () => {
    expect(isValidBigIntString('100n')).toBe(false);
    expect(isValidBigIntString(' 123 ')).toBe(false);
    expect(isValidBigIntString('abc')).toBe(false);
    expect(isValidBigIntString('')).toBe(false);
  });
});
