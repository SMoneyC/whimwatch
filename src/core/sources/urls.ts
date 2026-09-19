import type { SourceId } from '../../shared/types.js';

/**
 * A pasted address, made into one WhimWatch can read. Browsers hide the "https://" in the address
 * bar, so what people copy often arrives without it — which used to be turned away as unsupported.
 */
export function normalizeUserUrl(raw: string): string {
  const s = raw.trim();
  // No dot in the scheme: a real one never carries one, so "wicked.cc:8080/x" is a host and port,
  // not the scheme "wicked.cc" the URL parser would otherwise read it as — which left a pasted
  // address with a port being turned away as not a web address.
  return s && !/^[a-z][a-z0-9+-]*:/i.test(s) ? `https://${s.replace(/^\/+/, '')}` : s;
}

/**
 * Only http(s). Without this check "javascript://wicked.cc/…" parses with hostname wicked.cc and
 * classifies as a wicked.cc page, and a stored link is handed to loadURL when a check runs.
 * canonicalUrl can't undo it afterwards either: the URL spec forbids the protocol setter turning a
 * non-special scheme into https, so it passes javascript: and data: through untouched.
 */
const isWebUrl = (url: URL): boolean => url.protocol === 'https:' || url.protocol === 'http:';

/** Shared by linkProblem and classifyUrl so a change to the rule can't reach only one of them. */
const LOVERSLAB_FILE = /^\/files\/file\/\d+/;

/**
 * Why WhimWatch can't use this address, in words aimed at the person who pasted it. Undefined when
 * it can. Naming the actual problem matters: "only these are supported" leaves someone re-pasting
 * the same wrong kind of page, which is what one bug report showed happening five times over.
 */
export function linkProblem(raw: string): string | undefined {
  const link = normalizeUserUrl(raw);
  if (!link) return 'Paste the address of a download page.';
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return "That doesn't look like a web address. Copy the whole address of the page from your browser.";
  }
  if (!isWebUrl(url)) {
    return 'Only web addresses can be added. Copy the whole address of the page from your browser.';
  }
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'loverslab.com' && !LOVERSLAB_FILE.test(url.pathname)) {
    return 'That is a LoversLab page, but not a file page. Open the creator\'s download on LoversLab — its address looks like loverslab.com/files/file/12345-name/.';
  }
  if (host === 'patreon.com' && !patreonVanity(link)) {
    return "That is a link to one Patreon post. Use the creator's page instead — patreon.com/theirname.";
  }
  if (host === 'wickedwhimsmod.com') {
    return 'WhimWatch always reads the WickedWhims site — add a creator\'s own page on wicked.cc, LoversLab or Patreon instead.';
  }
  if (!classifyUrl(link)) {
    return `WhimWatch checks wicked.cc, LoversLab and Patreon. ${host} isn't one of those.`;
  }
  return undefined;
}

/** Maps a link to the source that can check it, or undefined if unsupported. */
export function classifyUrl(raw: string): SourceId | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (!isWebUrl(url)) return undefined;
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'wicked.cc') return 'wickedcc';
  if (host === 'loverslab.com') return LOVERSLAB_FILE.test(url.pathname) ? 'loverslab' : undefined;
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
