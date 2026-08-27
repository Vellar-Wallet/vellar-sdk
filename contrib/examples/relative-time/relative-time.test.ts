import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relative-time';

describe('relative-time (#112)', () => {
  const baseNow = new Date('2026-08-27T12:00:00.000Z');

  it('formats past timestamps correctly', () => {
    expect(formatRelativeTime('2026-08-27T11:59:58.000Z', baseNow)).toBe(
      'just now',
    );
    expect(formatRelativeTime('2026-08-27T11:55:00.000Z', baseNow)).toBe(
      '5 minutes ago',
    );
    expect(formatRelativeTime('2026-08-27T10:00:00.000Z', baseNow)).toBe(
      '2 hours ago',
    );
    expect(formatRelativeTime('2026-08-24T12:00:00.000Z', baseNow)).toBe(
      '3 days ago',
    );
  });

  it('handles future timestamps with "in X" phrasing instead of negative values', () => {
    expect(formatRelativeTime('2026-08-27T12:10:00.000Z', baseNow)).toBe(
      'in 10 minutes',
    );
    expect(formatRelativeTime('2026-08-29T12:00:00.000Z', baseNow)).toBe(
      'in 2 days',
    );
  });

  it('handles invalid timestamps gracefully', () => {
    expect(formatRelativeTime('invalid-date-string', baseNow)).toBe(
      'invalid date',
    );
  });
});
