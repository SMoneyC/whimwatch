export const dateFormat = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' });
const shortDateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

/** "Sep 11", with the year only when it isn't this year. */
export function formatShortDate(t?: number, now = Date.now()): string {
  if (t === undefined) return '—';
  return new Date(t).getFullYear() === new Date(now).getFullYear() ? shortDateFormat.format(new Date(t)) : dateFormat.format(new Date(t));
}
