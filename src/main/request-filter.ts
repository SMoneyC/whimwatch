import type { BrowserSite } from '../shared/api.js';

/** Domains each site serves its own pages, scripts and files from. */
export const SITE_DOMAINS: Record<BrowserSite, string[]> = {
  loverslab: ['loverslab.com'],
  patreon: ['patreon.com', 'patreonusercontent.com'],
};

/** Cloudflare's "are you human" check loads from here on both sites. */
const CHALLENGE_HOST = 'challenges.cloudflare.com';
const HEAVY = new Set(['image', 'media', 'font', 'subFrame']);

/**
 * Whether a hidden (checking) window may load a request: the page itself, the
 * site's own scripts and data, and Cloudflare's challenge. Ads, analytics and
 * embeds from other companies never load, and nothing heavy loads at all.
 */
export function allowHiddenRequest(site: BrowserSite, url: string, resourceType: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (host === CHALLENGE_HOST || resourceType === 'mainFrame') return true;
  if (!SITE_DOMAINS[site].some((d) => host === d || host.endsWith(`.${d}`))) return false;
  return !HEAVY.has(resourceType);
}
