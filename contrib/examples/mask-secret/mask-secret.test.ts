import { describe, expect, it } from 'vitest';
import { maskSecret } from './mask-secret';

describe('mask-secret (#113)', () => {
  it('masks secret key showing only first 4 characters by default', () => {
    const secret =
      'SD4V5Q7Z3X8K9L0M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9F0G';
    const masked = maskSecret(secret);
    expect(masked.startsWith('SD4V')).toBe(true);
    expect(masked.slice(4)).toBe('*'.repeat(secret.length - 4));
    expect(masked.length).toBe(secret.length);
  });

  it('customizes visible length and mask character', () => {
    const secret = 'SBXZ9876543210';
    const masked = maskSecret(secret, 2, '#');
    expect(masked.startsWith('SB')).toBe(true);
    expect(masked.slice(2)).toBe('#'.repeat(secret.length - 2));
  });

  it('masks short strings entirely to avoid leaking secrets', () => {
    expect(maskSecret('S123')).toBe('****');
    expect(maskSecret('AB')).toBe('**');
  });

  it('handles empty or null inputs gracefully', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret(null as any)).toBe('');
  });
});
