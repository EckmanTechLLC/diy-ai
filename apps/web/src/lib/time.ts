const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "5 minutes ago", "yesterday", "just now". `ms` is epoch milliseconds. */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const seconds = Math.round((ms - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  for (const [unit, size] of STEPS) {
    if (abs >= size || unit === 'minute') return rtf.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export function fullDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
