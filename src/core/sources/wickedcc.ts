import * as cheerio from 'cheerio';
import type { Listing } from '../../shared/types.js';
import type { Fetcher, HttpResponse } from '../fetcher.js';
import { jsonLd, meta, metaRefreshTarget, str } from './html.js';
import type { SourceChecker, SourceFindings } from './types.js';
import { parseDate, patreonVanity } from './urls.js';

/** Index pages can list dozens of items; only the first (newest) few are checked. */
const MAX_INDEX_PACKS = 10;

export interface WickedCcPage {
  title?: string;
  author?: string;
  updatedAt?: number;
  publishedAt?: number;
  version?: string;
  downloadUrl?: string;
  patreonLinks: string[];
}

export function parseWickedCcPage(html: string, pageUrl: string): WickedCcPage {
  const $ = cheerio.load(html);
  let updatedAt: number | undefined;
  let publishedAt: number | undefined;
  let author: string | undefined;
  for (const obj of jsonLd($)) {
    updatedAt ??= parseDate(str(obj.dateModified));
    publishedAt ??= parseDate(str(obj.datePublished));
    author ??= str(obj.author);
  }
  updatedAt ??= parseDate(meta($, 'article:modified_time'));
  if (updatedAt === undefined) {
    const m = /Updated:\s*(\d{4}-\d{2}-\d{2})/.exec($('body').text());
    updatedAt = parseDate(m?.[1]);
  }

  const title = (meta($, 'og:title') ?? $('title').text()).replace(/\s*-\s*WickedCC\s*$/, '').trim() || undefined;
  const href = $('a.download-btn').first().attr('href');
  const downloadUrl = href ? new URL(href, pageUrl).toString() : undefined;

  // The WickedWhims page names its version in the body ("v185k").
  const version = /\bv(\d{3}[a-z]?(?:\.\d+)?)\b/.exec($('.mod-content, article, main').first().text() || $('body').text())?.[1];

  const patreonLinks = [
    ...new Set(
      $('a[href*="patreon.com"]')
        .map((_, a) => $(a).attr('href') ?? '')
        .get()
        .filter((u) => patreonVanity(u)),
    ),
  ];
  return { title, author, updatedAt, publishedAt, version, downloadUrl, patreonLinks };
}

/** Pack links listed on a creator index page such as /animations/anarcis/. */
export function parseCreatorIndex(html: string, creatorPath: string): string[] {
  const $ = cheerio.load(html);
  const prefix = `https://wicked.cc${creatorPath.replace(/\/$/, '')}/`;
  return [
    ...new Set(
      $('a[href]')
        .map((_, a) => $(a).attr('href') ?? '')
        .get()
        .map((u) => u.replace(/\/$/, ''))
        .filter((u) => u.startsWith(prefix) && !u.slice(prefix.length).includes('/')),
    ),
  ];
}

/** GET that also follows wicked.cc's meta-refresh redirects (old /mods/admin/... URLs). */
export async function getFollowingRefresh(fetcher: Fetcher, url: string): Promise<HttpResponse> {
  let res = await fetcher.get(url);
  for (let hops = 0; hops < 3 && res.status === 200 && res.body.length < 4000; hops++) {
    const target = metaRefreshTarget(res.body, res.url);
    if (!target) break;
    res = await fetcher.get(target);
  }
  return res;
}

export const checkWickedCc: SourceChecker = async (listing, fetcher) => {
  const res = await getFollowingRefresh(fetcher, listing.url);
  if (res.status === 404) return { status: 'not-found', error: 'Page not found' };
  if (res.status !== 200) return { status: 'error', error: `HTTP ${res.status}` };
  const page = parseWickedCcPage(res.body, res.url);
  if (page.updatedAt === undefined) {
    const packs = parseCreatorIndex(res.body, new URL(res.url).pathname).slice(0, MAX_INDEX_PACKS);
    if (packs.length) return { status: 'ok', expandTo: packs };
  }
  const findings: SourceFindings = {
    updatedAt: page.updatedAt,
    title: page.title,
    version: page.version,
    downloadUrl: page.downloadUrl,
    fileCount: page.downloadUrl ? 1 : undefined,
    author: page.author,
    patreonLinks: page.patreonLinks,
  };
  if (page.updatedAt === undefined) return { ...findings, status: 'error', error: 'No update date on page' };
  return findings;
};

/**
 * Looks for a creator's packs on wicked.cc when the directory has no link:
 * probes /animations/<slug>/ using a few slug spellings.
 */
export async function discoverWickedCc(names: string[], fetcher: Fetcher): Promise<Listing[]> {
  const slugs = new Set<string>();
  for (const name of names) {
    const base = name.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    slugs.add(base.replace(/\s+/g, '-'));
    slugs.add(base.replace(/\s+/g, '_'));
    slugs.add(base.replace(/[^a-z0-9]/g, ''));
  }
  for (const slug of [...slugs].filter(Boolean).slice(0, 3)) {
    const path = `/animations/${encodeURIComponent(slug)}/`;
    const res = await fetcher.get(`https://wicked.cc${path}`);
    if (res.status !== 200) continue;
    const packs = parseCreatorIndex(res.body, path);
    if (packs.length) return packs.map((url) => ({ source: 'wickedcc', url, origin: 'discovered' }));
  }
  return [];
}
