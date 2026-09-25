import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import {
  chooserDownloads,
  DOWNLOADABLE,
  DownloadUnavailableError,
  downloadExternal,
  downloadWickedCc,
  externalLinks,
  isAllowedDownloadHost,
  singleExternalLink,
  MAX_DOWNLOAD_BYTES,
  type ProgressFn,
  safeFileName,
} from '../core/downloads.js';
import { CancelledError, type Fetcher, throwIfCancelled } from '../core/fetcher.js';
import { type ChooserFile, chooserFor, parseDownloadChooser, parseLoversLabFile } from '../core/sources/loverslab.js';
import { linkedPostIds, parsePostDetail, patreonPostId, type PatreonPostDetail, postDetailApiUrl, releaseDownloads } from '../core/sources/patreon.js';
import { translatedError } from '../shared/i18n/index.js';
import type { RemoteInfo } from '../shared/types.js';
import { type BrowserPool, type BrowserSite, useSiteSession } from './browser.js';

/** Progress for one file of a (possibly multi-file) download. */
export type FileProgressFn = (received: number, total: number | undefined, file: { index: number; count: number }) => void;

/**
 * What a LoversLab page or Patreon post offers:
 * - `files`: direct download links (all get downloaded)
 * - `external`: a single Mega/Google Drive link
 * - `button`: LoversLab's download button, not yet followed. It answers with
 *   either the file itself or a chooser page listing several files.
 */
export type Offer = { files: string[] } | { external: string } | { button: string };

/**
 * Downloads everything the listing offers for the newest version into `dir`
 * and returns the paths. `offer` reuses what source comparison already found.
 */
export async function downloadForRemote(
  remote: RemoteInfo,
  dir: string,
  deps: { fetcher: Fetcher; pool: BrowserPool },
  onProgress: FileProgressFn,
  signal?: AbortSignal,
  offer?: Offer,
  /** Files to leave out if following the download leads to a list of files (see updateExclusions). */
  except: readonly string[] = [],
): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  switch (remote.listing.source) {
    case 'wickedcc':
      return [await downloadWickedCc(remote, dir, deps.fetcher, (r, t) => onProgress(r, t, { index: 0, count: 1 }), signal)];
    case 'loverslab':
    case 'patreon': {
      const site = remote.listing.source;
      const resolved = offer ?? (await resolveOffer(remote, deps.pool, { probe: false, signal }));
      return downloadOffer(site, resolved, dir, onProgress, signal, except);
    }
    default:
      throw translatedError((m) => m.downloads.noDownloads, DownloadUnavailableError);
  }
}

/**
 * Finds what a LoversLab/Patreon source offers. With `probe`, LoversLab's
 * download button is looked at too, so the number of files is known (used only
 * to break ties between sources; it costs one extra request).
 */
export async function resolveOffer(
  remote: RemoteInfo,
  pool: BrowserPool,
  opts: { probe: boolean; only?: string; except?: readonly string[]; signal?: AbortSignal },
): Promise<Offer> {
  if (remote.listing.source === 'patreon') return patreonOffer(remote, pool, opts.signal);
  if (remote.listing.source !== 'loverslab') throw translatedError((m) => m.downloads.noDownloads, DownloadUnavailableError);
  const offer = await loversLabOffer(remote.listing.url, pool, opts.signal);
  // One file by name needs the list of files to pick it from.
  if ((!opts.probe && !opts.only) || !('button' in offer)) {
    const { only } = opts;
    if (only) throw translatedError((m) => m.downloads.cantPickOut(only), DownloadUnavailableError);
    return offer;
  }

  const probe = await pool.probeInPage(remote.listing.url, offer.button);
  throwIfCancelled(opts.signal);
  if (probe.status >= 400) throw translatedError((m) => m.downloads.siteHttp('LoversLab', probe.status));
  const { only } = opts;
  if (!probe.body && only) throw translatedError((m) => m.downloads.cantPickOut(only), DownloadUnavailableError);
  return probe.body ? chooserOffer(probe.body, remote.listing.url, opts.only, opts.except) : { files: [offer.button] };
}

/**
 * A LoversLab entry's list of files, with each file's name and upload date, when its button opens
 * one. Whether it does is read from the entry page as it is now, not from the last check, so results
 * saved by an older version work too; a single-file entry's button is the download itself and is
 * never followed here, or the file would be fetched twice. Without a list, the page's download
 * button comes back instead, so the download needn't load the page again to find it.
 */
export async function loversLabFileList(remote: RemoteInfo, pool: BrowserPool, signal?: AbortSignal): Promise<{ listed?: ChooserFile[]; button?: string }> {
  const page = await pool.fetcher().browserGet!(remote.listing.url);
  throwIfCancelled(signal);
  const list = chooserFor(parseLoversLabFile(page.body).chooserUrl, page.url, remote.listing.url);
  if (!list) {
    const href = cheerio.load(page.body)('a[href*="do=download"]').first().attr('href');
    return { button: href ? new URL(href, remote.listing.url).toString() : undefined };
  }
  const probe = await pool.probeInPage(remote.listing.url, list);
  throwIfCancelled(signal);
  if (probe.status >= 400 || !probe.body) return {};
  const listed = parseDownloadChooser(probe.body, remote.listing.url);
  return listed.length ? { listed } : {};
}

export function offerFileCount(offer: Offer): number {
  return 'files' in offer ? offer.files.length : 1;
}

async function loversLabOffer(fileUrl: string, pool: BrowserPool, signal?: AbortSignal): Promise<Offer> {
  const page = await pool.fetcher().browserGet!(fileUrl);
  throwIfCancelled(signal);
  const $ = cheerio.load(page.body);
  const button = $('a[href*="do=download"]').first().attr('href');
  if (button) return { button: new URL(button, fileUrl).toString() };

  const external = externalLinks($);
  if (external) return { external };
  if (/sign in|log in|register/i.test($('.ipsType_warning, .ipsMessage').text())) {
    throw translatedError((m) => m.downloads.signInAgain, DownloadUnavailableError);
  }
  throw translatedError((m) => m.downloads.noLoversLabButton, DownloadUnavailableError);
}

/** The files to get from LoversLab's list of an entry's files; see chooserDownloads. */
function chooserOffer(html: string, pageUrl: string, only?: string, except?: readonly string[]): Offer {
  const files = chooserDownloads(parseDownloadChooser(html, pageUrl), only, except);
  if (!files.length) throw translatedError((m) => m.downloads.noLoversLabFiles, DownloadUnavailableError);
  return { files };
}

/**
 * Patreon files can be attached to the release post itself, sit in another post it links to (some creators
 * keep one "download files" post and swap its file each release), or be a Mega/Google Drive link.
 */
async function patreonOffer(remote: RemoteInfo, pool: BrowserPool, signal?: AbortSignal): Promise<Offer> {
  const postUrl = remote.downloadUrl;
  const postId = postUrl ? patreonPostId(postUrl) : undefined;
  if (!postUrl || !postId) throw translatedError((m) => m.downloads.noPatreonPost, DownloadUnavailableError);

  const release = await patreonPost(pool, postUrl, postId, signal);
  if (!release.viewable) throw translatedError((m) => m.downloads.notInMembership, DownloadUnavailableError);

  const linked: PatreonPostDetail[] = [];
  if (!release.files.some((f) => DOWNLOADABLE.test(f.name))) {
    for (const id of linkedPostIds(release)) {
      try {
        linked.push(await patreonPost(pool, postUrl, id, signal));
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        // A linked post that's deleted or out of reach just doesn't contribute files.
      }
    }
  }

  const files = releaseDownloads(release, linked, DOWNLOADABLE);
  if (files.length) return { files: files.map((f) => f.url) };
  const external = singleExternalLink(release.links);
  if (external) return { external };
  throw translatedError((m) => m.downloads.noPatreonFile, DownloadUnavailableError);
}

async function patreonPost(pool: BrowserPool, pageUrl: string, postId: string, signal?: AbortSignal): Promise<PatreonPostDetail> {
  const res = await pool.fetcher().browserFetch!(pageUrl, postDetailApiUrl(postId));
  throwIfCancelled(signal);
  if (res.status !== 200) throw translatedError((m) => m.downloads.siteHttp('Patreon', res.status));
  return parsePostDetail(res.body);
}

async function downloadOffer(
  site: BrowserSite,
  offer: Offer,
  dir: string,
  onProgress: FileProgressFn,
  signal?: AbortSignal,
  except: readonly string[] = [],
): Promise<string[]> {
  if ('external' in offer) return [await downloadExternal(offer.external, dir, (r, t) => onProgress(r, t, { index: 0, count: 1 }), signal)];
  if ('files' in offer) return downloadAll(site, offer.files, dir, onProgress, signal);

  // One request: LoversLab answers the button with the file, or with a chooser page for several files.
  const first = await downloadViaSession(site, offer.button, dir, (r, t) => onProgress(r, t, { index: 0, count: 1 }), signal);
  if (!first.html) return [first.path];
  const html = await readFile(first.path, 'utf8');
  await rm(first.path, { force: true });
  // The button led to a list after all: what the user set aside stays out, however it was reached.
  return downloadOffer(site, chooserOffer(html, offer.button, undefined, except), dir, onProgress, signal);
}

/** Downloads one after another (never in parallel) to stay gentle with the site. */
async function downloadAll(site: BrowserSite, urls: string[], dir: string, onProgress: FileProgressFn, signal?: AbortSignal): Promise<string[]> {
  const paths: string[] = [];
  for (const [index, url] of urls.entries()) {
    throwIfCancelled(signal);
    const result = await downloadViaSession(site, url, dir, (r, t) => onProgress(r, t, { index, count: urls.length }), signal);
    if (result.html) {
      await rm(result.path, { force: true });
      throw translatedError((m) => m.downloads.webPageOpen, DownloadUnavailableError);
    }
    paths.push(result.path);
  }
  return paths;
}

/**
 * Downloads with the site's signed-in browser session (cookies, Cloudflare
 * clearance). Every URL in the redirect chain must be on the allowlist.
 */
function downloadViaSession(
  site: BrowserSite,
  url: string,
  dir: string,
  onProgress: ProgressFn,
  signal?: AbortSignal,
): Promise<{ path: string; html: boolean }> {
  if (!isAllowedDownloadHost(url)) throw translatedError((m) => m.downloads.notSupportedHost(new URL(url).hostname), DownloadUnavailableError);
  const ses = useSiteSession(site);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ses.off('will-download', onWillDownload);
      reject(translatedError((m) => m.downloads.didntStart, DownloadUnavailableError));
    }, 60_000);
    const onWillDownload = (_event: Electron.Event, item: Electron.DownloadItem): void => {
      clearTimeout(timer);
      ses.off('will-download', onWillDownload);
      const chain = item.getURLChain();
      if (!chain.every(isAllowedDownloadHost)) {
        item.cancel();
        reject(translatedError((m) => m.downloads.offsiteRedirect, DownloadUnavailableError));
        return;
      }
      const html = /^text\/html/i.test(item.getMimeType());
      const path = uniquePath(dir, html ? 'page.html' : safeFileName(item.getFilename()));
      item.setSavePath(path);
      const abort = (): void => item.cancel();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) item.cancel();
      item.on('updated', () => {
        const total = item.getTotalBytes() || undefined;
        if (item.getReceivedBytes() > MAX_DOWNLOAD_BYTES) item.cancel();
        if (!html) onProgress(item.getReceivedBytes(), total);
      });
      item.once('done', (_e, state) => {
        signal?.removeEventListener('abort', abort);
        if (state === 'completed') resolve({ path, html });
        else reject(signal?.aborted ? new CancelledError() : new Error(`Download ${state}`));
      });
    };
    ses.on('will-download', onWillDownload);
    ses.downloadURL(url);
  });
}

/** Two attachments can share a file name; keep both. Downloads run one at a time, so checking the disk is enough. */
function uniquePath(dir: string, name: string): string {
  let path = join(dir, name);
  for (let n = 2; existsSync(path); n++) path = join(dir, name.replace(/(\.[^.]+)?$/, ` (${n})$1`));
  return path;
}
