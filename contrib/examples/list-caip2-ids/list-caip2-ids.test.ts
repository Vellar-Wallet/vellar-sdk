import { describe, expect, it } from 'vitest';
import {
  STELLAR_CAIP2_IDENTIFIERS,
  getCaip2Identifiers,
} from './list-caip2-ids';

describe('list-caip2-ids (#111)', () => {
  it('returns both testnet and mainnet CAIP-2 network identifiers', () => {
    const ids = getCaip2Identifiers();
    expect(ids.length).toBeGreaterThanOrEqual(2);

    const caip2Strings = ids.map((item) => item.identifier);
    expect(caip2Strings).toContain('stellar:pubnet');
    expect(caip2Strings).toContain('stellar:testnet');
  });

  it('contains proper labels and environment descriptions', () => {
    const testnet = STELLAR_CAIP2_IDENTIFIERS.find(
      (item) => item.identifier === 'stellar:testnet',
    );
    expect(testnet).toBeDefined();
    expect(testnet?.networkName).toBe('Stellar Testnet');
    expect(testnet?.environment).toBe('testnet');
  });
});
