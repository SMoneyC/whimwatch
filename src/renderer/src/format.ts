import { dateFormat, formatShortDate } from '../../shared/dates';
import { count, dateTimeFormat, numberFormat, relativeTimeFormat } from '../../shared/i18n/format';
import { t } from '../../shared/i18n';
import { describeProblem } from '../../shared/problems';
import type { RemoteInfo } from '../../shared/types';
import { formatVersion } from '../../shared/version';

export { formatShortDate } from '../../shared/dates';
export { SOURCE_LABEL } from '../../shared/labels';

export function formatDate(t?: number): string {
  return t === undefined ? '—' : dateFormat().format(new Date(t));
}

/** For values that are a calendar date without a time (stored as UTC midnight), e.g. a release day. */
export function formatCalendarDate(t?: number): string {
  return t === undefined ? '—' : dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(t));
}

export function formatTime(t: number): string {
  return dateTimeFormat({ hour: 'numeric', minute: '2-digit' }).format(new Date(t));
}

/** 3812 → "3,812" (or "3.812", as the language groups digits). */
export const formatCount = count;

/** "just now", "12 minutes ago", "3 hours ago", "yesterday", "2 weeks ago"… */
export function timeAgo(at: number, now = Date.now()): string {
  const seconds = (at - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return t().time.justNow;
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
  // Whole units gone by, as "ago" is counted: 6 years and 7 months is "6 years ago", not 7.
  return relativeTimeFormat(unit[0]).format(Math.trunc(seconds / unit[1]), unit[0]);
}

export function remoteSummary(r: RemoteInfo): string {
  if (r.status === 'ok') {
    const parts = [formatShortDate(r.updatedAt)];
    if (r.version) parts.push(formatVersion(r.version));
    return parts.join(' · ');
  }
  const m = t().remote;
  if (r.status === 'needs-verification') return m.wantsHumanCheck;
  if (r.status === 'not-found') return m.notFound;
  // Saved English words: from a version before codes (until the next check replaces them), or for
  // a code this version doesn't know.
  return (r.problem && describeProblem(r.problem)) || r.error || m.couldntCheck;
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
  if (n < 1024) return `${count(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value < 10 ? 1 : 0;
  return `${numberFormat({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
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

/**
 * A page known only by its address (one removed, or added and not read yet), since its title isn't
 * kept: its site plus the readable end of the address ("wicked.cc · moonberry/juniper-petal"); with
 * page titles hidden, the site alone, since the address names the pack as plainly as a title would.
 */
export function pageLabel(url: string, hideTitles: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return t().remote.aPage;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const site = host === 'wicked.cc' ? 'wicked.cc' : host === 'loverslab.com' ? 'LoversLab' : host === 'patreon.com' ? 'Patreon' : host;
  if (hideTitles) return t().remote.aSitePage(site);
  const parts = parsed.pathname.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  // LoversLab: /files/file/1234-the-slug; wicked.cc: /animations/creator/pack; Patreon: /creator or /posts/title-id.
  const readable = site === 'LoversLab' ? parts.at(-1)?.replace(/^\d+-/, '') : parts.slice(-2).join('/');
  return readable ? `${site} · ${shortTitle(readable, 48)}` : site;
}
