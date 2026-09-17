import type { BrowserSite } from '../shared/api.js';

/** Sign-in services a site's login page can hand you over to. */
const PROVIDERS: { name: string; host: RegExp }[] = [
  { name: 'Google', host: /(^|\.)accounts\.google\.com$/ },
  { name: 'Apple', host: /(^|\.)appleid\.apple\.com$/ },
  { name: 'Facebook', host: /(^|\.)facebook\.com$/ },
];

export function signInProvider(url: string): string | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return PROVIDERS.find((p) => p.host.test(host))?.name;
}

/**
 * Google won't sign anyone in from inside another app ("This browser or app may
 * not be secure"), so that a host app can't read what you type on its page. It
 * says so on a page of its own, which is where the sign-in ends: these are the
 * addresses that page has.
 */
export function isSignInRejection(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // The refusal also comes back as an error on the address Google sends the user back to, which is
  // the site's own — so this one isn't limited to Google's addresses. It reads the values of the
  // parameters that carry it, not the address as text, so a page that merely mentions the word
  // somewhere isn't mistaken for a refusal.
  const carriers = [parsed.searchParams, new URLSearchParams(parsed.hash.replace(/^#/, ''))];
  const refused = (params: URLSearchParams): boolean =>
    ['error', 'rejectReason'].some((key) => params.get(key)?.toLowerCase().includes('disallowed_useragent'));
  if (carriers.some(refused)) return true;

  if (signInProvider(url) !== 'Google') return false;
  return /\/signin\/rejected/i.test(parsed.pathname) || carriers.some((params) => params.has('rejectReason'));
}

/** The heading that page carries, for when the address alone doesn't give it away. */
export function isRejectionTitle(title: string): boolean {
  return /could\s?n[’']?t sign you in|can[’']?t sign you in/i.test(title);
}

/**
 * Where to send someone whose account has no password of its own: the site's
 * login page in their real browser, where Google does work, so they can sign in
 * there and add a password in their account settings.
 */
export const PASSWORD_HELP: Partial<Record<BrowserSite, string>> = {
  patreon: 'https://www.patreon.com/login',
};

/**
 * Where the password is set once signed in there. An account made through
 * Google has none, and Patreon offers to set one (no old password to give).
 */
export const PASSWORD_PATH: Partial<Record<BrowserSite, string>> = {
  patreon: 'set one under Settings → Account → Login → Set Password',
};
