import * as cheerio from 'cheerio';
import { BrowserUnavailableError, isChallengePage, VerificationRequiredError } from '../fetcher.js';
import { jsonLd, meta, str } from './html.js';
import type { SourceChecker } from './types.js';
import { parseDate, patreonVanity } from './urls.js';

export interface LoversLabFile {
  title?: string;
  author?: string;
  version?: string;
  updatedAt?: number;
  publishedAt?: number;
  patreonLinks: string[];
}

export function parseLoversLabFile(html: string): LoversLabFile {
  const $ = cheerio.load(html);
  let file: Record<string, unknown> | undefined;
  for (const obj of jsonLd($)) {
    if (obj['@type'] === 'WebApplication' || obj.softwareVersion !== undefined) {
      file = obj;
      break;
    }
  }
  const title = str(file?.name) ?? meta($, 'og:title');
  let updatedAt = parseDate(str(file?.dateModified));
  if (updatedAt === undefined) {
    // Fallback: the "Updated" row in the file information sidebar.
    const row = $('li, div').filter((_, el) => /^\s*Updated\s*$/.test($(el).children().first().text())).first();
    updatedAt = parseDate(row.find('time').attr('datetime'));
  }
  const patreonLinks = [
    ...new Set(
      $('a[href*="patreon.com"]')
        .map((_, a) => $(a).attr('href') ?? '')
        .get()
        .filter((u) => patreonVanity(u)),
    ),
  ];
  return {
    title,
    author: str(file?.author),
    version: str(file?.softwareVersion),
    updatedAt,
    publishedAt: parseDate(str(file?.datePublished)),
    patreonLinks,
  };
}

export interface ChooserFile {
  href: string;
  /** File name shown next to the link; empty when the page doesn't show one. */
  name: string;
}

/** Files listed on the download chooser LoversLab shows when a page has several attachments. */
export function parseDownloadChooser(html: string, baseUrl: string): ChooserFile[] {
  const $ = cheerio.load(html);
  const files: ChooserFile[] = [];
  $('a[href*="do=download"][href*="r="]').each((_, a) => {
    const href = new URL($(a).attr('href')!, baseUrl).toString();
    if (files.some((f) => f.href === href)) return;
    const row = $(a).closest('li, tr, .ipsDataItem');
    const text = (row.length ? row : $(a).parent()).text().replace(/\s+/g, ' ');
    const name =
      row.find('.ipsDataItem_title').first().text().trim() ||
      /[\w .()[\]-]+\.(?:zip|rar|7z|package|ts4script)\b/i.exec(text)?.[0]?.trim() ||
      /[\w.()[\]-]+\.[a-z0-9]{2,5}\b/i.exec(text)?.[0]?.trim() ||
      '';
    files.push({ href, name });
  });
  return files;
}

export function fileId(url: string): string | undefined {
  return /\/files\/file\/(\d+)/.exec(url)?.[1];
}

export const checkLoversLab: SourceChecker = async (listing, fetcher) => {
  if (!fetcher.browserGet) throw new BrowserUnavailableError('LoversLab');
  const res = await fetcher.browserGet(listing.url);
  if (isChallengePage(res.body)) throw new VerificationRequiredError('LoversLab');
  if (res.status === 404) return { status: 'not-found', error: 'File not found' };
  if (res.status >= 400) return { status: 'error', error: `HTTP ${res.status}` };
  // LoversLab rewrites file slugs, but the numeric id must match what was asked for.
  if (fileId(res.url) !== fileId(listing.url)) return { status: 'error', error: 'LoversLab showed a different page' };
  const file = parseLoversLabFile(res.body);
  if (file.updatedAt === undefined) return { status: 'error', error: 'No update date on page', title: file.title };
  return {
    updatedAt: file.updatedAt,
    version: file.version,
    title: file.title,
    author: file.author,
    downloadUrl: listing.url,
    patreonLinks: file.patreonLinks,
  };
};
