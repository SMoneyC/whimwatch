import { dateTimeFormat } from './i18n/format.js';

/** "Sep 11, 2026" ("11 set 2026"), in the current language. */
export const dateFormat = (): Intl.DateTimeFormat => dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' });

/** "Sep 11", with the year only when it isn't this year. */
export function formatShortDate(t?: number, now = Date.now()): string {
  if (t === undefined) return '—';
  return new Date(t).getFullYear() === new Date(now).getFullYear()
    ? dateTimeFormat({ month: 'short', day: 'numeric' }).format(new Date(t))
    : dateFormat().format(new Date(t));
}
