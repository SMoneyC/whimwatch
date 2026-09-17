import { dateFormat, formatShortDate } from '../../shared/dates';
import type { RemoteInfo } from '../../shared/types';
import { formatVersion } from '../../shared/version';

export { formatShortDate } from '../../shared/dates';
export { SOURCE_LABEL } from '../../shared/labels';

const utcDateFormat = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const numbers = new Intl.NumberFormat('en');

export function formatDate(t?: number): string {
  return t === undefined ? '—' : dateFormat.format(new Date(t));
}

/** For values that are a calendar date without a time (stored as UTC midnight), e.g. a release day. */
export function formatCalendarDate(t?: number): string {
  return t === undefined ? '—' : utcDateFormat.format(new Date(t));
}

export function formatTime(t: number): string {
  return timeFormat.format(new Date(t));
}

export function formatCount(n: number): string {
  return numbers.format(n);
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${formatCount(n)} ${n === 1 ? word : pluralWord}`;
}

/** "just now", "12 minutes ago", "3 hours ago", "yesterday", "2 weeks ago"… */
export function timeAgo(t: number, now = Date.now()): string {
  const seconds = (t - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return 'just now';
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2629800],
    ['year', 31557600],
  ];
  let unit = steps[0]!;
  for (const step of steps) if (abs >= step[1]) unit = step;
  // Up to 5 weeks read better as weeks than as "1 month".
  if (unit[0] === 'month' && abs < 5 * 604800) unit = steps[3]!;
  return relative.format(Math.round(seconds / unit[1]), unit[0]);
}

export function remoteSummary(r: RemoteInfo): string {
  if (r.status === 'ok') {
    const parts = [formatShortDate(r.updatedAt)];
    if (r.version) parts.push(formatVersion(r.version));
    return parts.join(' · ');
  }
  if (r.status === 'needs-verification') return 'Wants a human check';
  if (r.status === 'not-found') return 'Page not found';
  return r.error ?? "Couldn't check";
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Page names run long ("… REMAKE ~UNDRESSABLE ✦ 2026"); whole characters, so emoji aren't split. */
export function shortTitle(title: string, max = 34): string {
  const chars = [...title.trim()];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : title.trim();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Electron accelerator → keys to show, e.g. "CommandOrControl+Shift+H" → ["Ctrl", "Shift", "H"]. */
export function acceleratorKeys(accelerator: string, platform: string): string[] {
  const mac = platform === 'darwin';
  const names: Record<string, string> = {
    CommandOrControl: mac ? '⌘' : 'Ctrl',
    CmdOrCtrl: mac ? '⌘' : 'Ctrl',
    Command: '⌘',
    Control: 'Ctrl',
    Ctrl: 'Ctrl',
    Alt: mac ? '⌥' : 'Alt',
    Option: '⌥',
    Shift: mac ? '⇧' : 'Shift',
  };
  return accelerator.split('+').map((part) => names[part] ?? part);
}

/** A key press → Electron accelerator, or undefined unless it's a modifier plus a letter, digit or F-key. */
export function acceleratorFromKey(
  e: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
  platform: string,
): string | undefined {
  const key = /^Key([A-Z])$/.exec(e.code)?.[1] ?? /^Digit([0-9])$/.exec(e.code)?.[1] ?? /^(F(?:[1-9]|1[0-9]|2[0-4]))$/.exec(e.code)?.[1];
  if (!key) return undefined;
  const mac = platform === 'darwin';
  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push('CommandOrControl');
  if (mac && e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  // Shift alone would take over typing a capital letter everywhere.
  if (!parts.some((p) => p !== 'Shift') && !key.startsWith('F')) return undefined;
  return [...parts, key].join('+');
}
