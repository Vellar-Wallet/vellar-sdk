import { describe, expect, it } from 'vitest';
import {
  buildWalletSession,
  isContractAddress,
} from './build-wallet-session';

describe('build-wallet-session (#115)', () => {
  const validContractId =
    'CA7QY3Z54G5P6H7J8K9L0M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D';

  it('validates contract addresses correctly', () => {
    expect(isContractAddress(validContractId)).toBe(true);
    expect(isContractAddress('GABC1234567890')).toBe(false);
    expect(isContractAddress('')).toBe(false);
  });

  it('builds a WalletSession object with accountId', () => {
    const session = buildWalletSession(validContractId);
    expect(session.accountId).toBe(validContractId);
    expect(session.keyId).toBeUndefined();
    expect(typeof session.createdAt).toBe('string');
  });

  it('includes keyId when provided', () => {
    const keyId = 'passkey-01';
    const session = buildWalletSession(validContractId, keyId);
    expect(session.accountId).toBe(validContractId);
    expect(session.keyId).toBe(keyId);
  });

  it('throws an error for invalid accountId', () => {
    expect(() => buildWalletSession('INVALID_ADDRESS')).toThrow(
      /is not a valid contract address/,
    );
  });
});
