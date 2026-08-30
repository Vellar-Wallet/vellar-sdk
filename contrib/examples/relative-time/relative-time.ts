// Example: Convert an ISO timestamp into a relative time string (e.g., "5 minutes ago", "in 10 minutes").
//
// Run with: npx tsx contrib/examples/relative-time/relative-time.ts

/**
 * Formats an ISO timestamp string or Date object into a human-readable relative time string.
 * Correctly handles future timestamps by returning "in X ..." instead of negative durations.
 */
export function formatRelativeTime(
  timestamp: string | Date,
  now: Date = new Date(),
): string {
  const targetDate = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const targetMs = targetDate.getTime();
  const nowMs = now.getTime();

  if (isNaN(targetMs)) {
    return 'invalid date';
  }

  const diffMs = targetMs - nowMs;
  const isFuture = diffMs > 0;
  const absSeconds = Math.floor(Math.abs(diffMs) / 1000);

  if (absSeconds < 5) {
    return 'just now';
  }

  const minutes = Math.floor(absSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  let timeUnitString = '';
  if (years >= 1) {
    timeUnitString = `${years} ${years === 1 ? 'year' : 'years'}`;
  } else if (months >= 1) {
    timeUnitString = `${months} ${months === 1 ? 'month' : 'months'}`;
  } else if (days >= 1) {
    timeUnitString = `${days} ${days === 1 ? 'day' : 'days'}`;
  } else if (hours >= 1) {
    timeUnitString = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  } else if (minutes >= 1) {
    timeUnitString = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  } else {
    timeUnitString = `${absSeconds} ${absSeconds === 1 ? 'second' : 'seconds'}`;
  }

  return isFuture ? `in ${timeUnitString}` : `${timeUnitString} ago`;
}

function main() {
  console.log('=== Format Relative Time Example ===\n');

  const now = new Date('2026-08-27T12:00:00.000Z');

  const exampleTimestamps = [
    { label: 'Just now', iso: '2026-08-27T11:59:58.000Z' },
    { label: '5 minutes ago', iso: '2026-08-27T11:55:00.000Z' },
    { label: '2 hours ago', iso: '2026-08-27T10:00:00.000Z' },
    { label: '3 days ago', iso: '2026-08-24T12:00:00.000Z' },
    { label: 'Future: in 10 minutes', iso: '2026-08-27T12:10:00.000Z' },
    { label: 'Future: in 2 days', iso: '2026-08-29T12:00:00.000Z' },
    { label: 'Invalid ISO format', iso: 'not-a-timestamp' },
  ];

  console.log(`Base reference time (NOW): ${now.toISOString()}\n`);
  console.log('Timestamp                              -> Formatted Relative Time');
  console.log('------------------------------------------------------------------');

  for (const item of exampleTimestamps) {
    const formatted = formatRelativeTime(item.iso, now);
    console.log(`${item.iso.padEnd(38)} -> ${formatted}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
