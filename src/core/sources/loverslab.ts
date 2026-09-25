import * as cheerio from 'cheerio';
import { BrowserUnavailableError, isChallengePage, VerificationRequiredError } from '../fetcher.js';
import { jsonLd, meta, str } from './html.js';
import { problemFields } from '../../shared/problems.js';
import type { SourceChecker } from './types.js';
import { classifyUrl, parseDate, patreonVanity } from './urls.js';

export interface LoversLabFile {
  title?: string;
  author?: string;
  version?: string;
  updatedAt?: number;
  publishedAt?: number;
  patreonLinks: string[];
  /** Where the download button leads when it opens the list of files (several attachments). */
  chooserUrl?: string;
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
  // The main button, not a file's own link (those carry r=). With several files it opens a dialog;
  // with one it is the download itself, and must never be followed during a check.
  const button = $('a[href*="do=download"]')
    .filter((_, a) => !/[?&]r=/.test($(a).attr('href') ?? ''))
    .first();
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
    chooserUrl: button.attr('data-ipsdialog') !== undefined ? button.attr('href') : undefined,
  };
}

export interface ChooserFile {
  href: string;
  /** File name shown next to the link; empty when the page doesn't show one. */
  name: string;
  /** When this file was uploaded: the entry's own date moves for any edit, this one doesn't. */
  updatedAt?: number;
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
    files.push({ href, name, updatedAt: parseDate(row.find('time[datetime]').first().attr('datetime')) });
  });
  return files;
}

export function fileId(url: string): string | undefined {
  return /\/files\/file\/(\d+)/.exec(url)?.[1];
}

/**
 * The file list's address, only when it is on LoversLab itself, over https, and for the file that
 * was checked: it is fetched from inside a signed-in LoversLab page, so nothing else is followed.
 * An address that doesn't parse just means no list, not a failed check.
 */
export function chooserFor(href: string | undefined, pageUrl: string, listingUrl: string): string | undefined {
  if (!href) return undefined;
  let url: URL;
  try {
    url = new URL(href, pageUrl);
  } catch {
    return undefined;
  }
  const ok = url.protocol === 'https:' && classifyUrl(url.toString()) === 'loverslab' && fileId(url.toString()) === fileId(listingUrl);
  return ok ? url.toString() : undefined;
}

export const checkLoversLab: SourceChecker = async (listing, fetcher) => {
  if (!fetcher.browserGet) throw new BrowserUnavailableError('LoversLab');
  const res = await fetcher.browserGet(listing.url);
  if (isChallengePage(res.body)) throw new VerificationRequiredError('LoversLab');
  if (res.status === 404) return { status: 'not-found', ...problemFields({ code: 'file-not-found' }) };
  if (res.status >= 400) return { status: 'error', ...problemFields({ code: 'http', status: res.status }) };
  // LoversLab rewrites file slugs, but the numeric id must match what was asked for.
  if (fileId(res.url) !== fileId(listing.url)) return { status: 'error', ...problemFields({ code: 'different-page' }) };
  const file = parseLoversLabFile(res.body);
  if (file.updatedAt === undefined) return { status: 'error', ...problemFields({ code: 'no-date' }), title: file.title };
  return {
    updatedAt: file.updatedAt,
    version: file.version,
    title: file.title,
    author: file.author,
    downloadUrl: listing.url,
    chooserUrl: chooserFor(file.chooserUrl, res.url, listing.url),
    patreonLinks: file.patreonLinks,
  };
};
