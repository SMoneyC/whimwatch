import type { SourceId } from '../../shared/types.js';

/** Maps a link to the source that can check it, or undefined if unsupported. */
export function classifyUrl(raw: string): SourceId | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'wicked.cc') return 'wickedcc';
  if (host === 'loverslab.com') return /^\/files\/file\/\d+/.test(url.pathname) ? 'loverslab' : undefined;
  if (host === 'patreon.com') return patreonVanity(raw) ? 'patreon' : undefined;
  if (host === 'wickedwhimsmod.com') return 'wwmod';
  return undefined;
}

const PATREON_RESERVED = new Set([
  'posts', 'join', 'login', 'signup', 'home', 'search', 'messages', 'settings', 'notifications',
  'explore', 'create', 'about', 'policy', 'file', 'bepatron', 'checkout', 'collection', 'api', 'm', 'user',
]);

/** Returns the creator vanity for patreon.com/<vanity>, /c/<vanity> or /cw/<vanity> (optionally /posts). */
export function patreonVanity(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.hostname.replace(/^www\./, '') !== 'patreon.com') return undefined;
  const parts = url.pathname.split('/').filter(Boolean);
  const offset = parts[0] === 'c' || parts[0] === 'cw' ? 1 : 0;
  const vanity = parts[offset];
  const rest = parts.slice(offset + 1);
  if (!vanity || PATREON_RESERVED.has(vanity.toLowerCase())) return undefined;
  if (rest.length > 1 || (rest.length === 1 && rest[0] !== 'posts')) return undefined;
  return /^[A-Za-z0-9_-]+$/.test(vanity) ? vanity : undefined;
}

/**
 * One key per page, for de-duplication and removed links. Patreon links differ in form
 * (/c/, /cw/, /posts, www) but name the same creator.
 */
export function linkKey(raw: string): string {
  const vanity = patreonVanity(raw);
  return vanity ? `patreon:${vanity.toLowerCase()}` : canonicalUrl(raw);
}

/** Canonical form of a link: no fragment, www or trailing slash. */
export function canonicalUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.replace(/^www\./, '');
    url.protocol = 'https:';
    let s = url.toString();
    if (s.endsWith('/') && url.pathname !== '/') s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** Parses dates like "2024-04-10T21:52:40+0000", "2026-08-28" or "May 23rd, 2026" to epoch ms (UTC). */
export function parseDate(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return iso;
  const m = /([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(raw);
  if (m) {
    const t = Date.parse(`${m[1]} ${m[2]}, ${m[3]} 00:00:00 UTC`);
    if (!Number.isNaN(t)) return t;
  }
  return undefined;
}
