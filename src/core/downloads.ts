import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { basename, join, posix } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import type * as cheerio from 'cheerio';
import { File as MegaFile } from 'megajs';
import type { RemoteInfo } from '../shared/types.js';
import { ARCHIVE_FILE, MOD_FILE } from './archive.js';
import { CancelledError, type Fetcher, throwIfCancelled, USER_AGENT } from './fetcher.js';
import { getFollowingRefresh, parseWickedCcPage } from './sources/wickedcc.js';

/** Downloads that need no browser session: wicked.cc, Mega and Google Drive. */

export type ProgressFn = (received: number, total?: number) => void;

export const MAX_DOWNLOAD_BYTES = 4 * 1024 ** 3;
export const DOWNLOADABLE = /\.(?:zip|rar|7z|package|ts4script)$/i;

export class DownloadUnavailableError extends Error {}

const ALLOWED_HOSTS = [
  /(^|\.)wicked\.cc$/,
  /(^|\.)loverslab\.com$/,
  /(^|\.)patreon\.com$/,
  /(^|\.)patreonusercontent\.com$/,
  /^mega\.(nz|io)$/,
  /^drive\.google\.com$/,
  /^drive\.usercontent\.google\.com$/,
];

/** Downloads only ever come from the sites WhimWatch supports, over HTTPS. */
export function isAllowedDownloadHost(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && ALLOWED_HOSTS.some((re) => re.test(hostname.replace(/^www\./, '')));
  } catch {
    return false;
  }
}

/** Picks a safe local file name from Content-Disposition or the URL. */
export function fileNameFrom(disposition: string | null, url: string): string {
  const star = disposition ? /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] : undefined;
  const plain = disposition ? /filename="?([^";]+)"?/i.exec(disposition)?.[1] : undefined;
  const fromUrl = safeDecode(basename(new URL(url).pathname));
  return safeFileName(star ? safeDecode(star) : (plain ?? fromUrl));
}

/** decodeURIComponent that keeps malformed input as-is instead of throwing. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const MAX_REDIRECTS = 5;

/**
 * GET that follows redirects itself so every hop is checked against the
 * download allowlist (and can never drop from HTTPS to HTTP).
 */
export async function fetchAllowed(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedDownloadHost(current)) {
      throw new DownloadUnavailableError(`Downloads from ${hostOf(current)} aren't supported.`);
    }
    const res = await fetch(current, { headers: { 'User-Agent': USER_AGENT, ...headers }, redirect: 'manual', signal }).catch((err: Error) => {
      throw signal?.aborted ? new CancelledError() : err;
    });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel();
    current = new URL(location, current).toString();
  }
  throw new Error('Too many redirects.');
}

function hostOf(url: string): string {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' ? hostname : `${hostname} (not HTTPS)`;
  } catch {
    return 'an invalid address';
  }
}

/**
 * A file name from a site, safe to create on every system. Always splits paths the POSIX way (after
 * turning backslashes into slashes): on Windows, basename() would read "a:b.zip" as a drive letter.
 */
export function safeFileName(name: string): string {
  const cleaned = posix
    .basename(name.replace(/\\/g, '/'))
    // Control characters are exactly what this strips.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .trim()
    // Windows drops trailing dots and spaces from names.
    .replace(/[. ]+$/, '');
  if (!cleaned) return 'download';
  // Names Windows reserves for devices, with or without an extension.
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(cleaned) ? `_${cleaned}` : cleaned;
}

export async function downloadWickedCc(remote: RemoteInfo, dir: string, fetcher: Fetcher, onProgress: ProgressFn, signal?: AbortSignal): Promise<string> {
  const pageUrl = remote.listing.url;
  let downloadUrl = remote.downloadUrl;
  let referer = pageUrl;
  if (!downloadUrl) {
    const page = await getFollowingRefresh(fetcher, pageUrl);
    downloadUrl = parseWickedCcPage(page.body, page.url).downloadUrl;
    referer = page.url;
  }
  if (!downloadUrl) throw new DownloadUnavailableError('wicked.cc has no download button on this page.');

  // /download/<id> redirects to files.wicked.cc, which only serves requests referred from the pack page.
  throwIfCancelled(signal);
  return downloadHttp(downloadUrl, dir, { Referer: referer }, onProgress, signal);
}

export async function downloadHttp(
  url: string,
  dir: string,
  headers: Record<string, string>,
  onProgress: ProgressFn,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetchAllowed(url, headers, signal);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  if ((res.headers.get('content-type') ?? '').includes('text/html')) {
    await res.body.cancel();
    throw new DownloadUnavailableError('The site returned a web page instead of the file. Try downloading it in your browser.');
  }
  const total = Number(res.headers.get('content-length')) || undefined;
  if (total && total > MAX_DOWNLOAD_BYTES) throw new Error('The download is too large.');

  const name = fileNameFrom(res.headers.get('content-disposition'), res.url || url);
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      received += chunk.length;
      if (received > MAX_DOWNLOAD_BYTES) return done(new Error('The download is too large.'));
      onProgress(received, total);
      done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as ReadableStream), counter, createWriteStream(path));
  } catch (err) {
    await rm(path, { force: true });
    throw signal?.aborted ? new CancelledError() : err;
  }
  return path;
}

export function externalLinks($: cheerio.CheerioAPI): string | undefined {
  return singleExternalLink($('a[href]').map((_, a) => $(a).attr('href') ?? '').get());
}

/** The Mega or Google Drive link, when there's exactly one (several are ambiguous: the user picks). */
export function singleExternalLink(urls: string[]): string | undefined {
  const links = [...new Set(urls.filter((u) => /^https:\/\/(mega\.nz|mega\.io|drive\.google\.com)\//.test(u)))];
  return links.length === 1 ? links[0] : undefined;
}

export async function downloadExternal(url: string, dir: string, onProgress: ProgressFn, signal?: AbortSignal): Promise<string> {
  const host = new URL(url).hostname;
  if (host.startsWith('mega.')) return downloadMega(url, dir, onProgress, signal);
  const id = /\/file\/d\/([\w-]+)/.exec(url)?.[1] ?? new URL(url).searchParams.get('id');
  if (!id) throw new DownloadUnavailableError('Unsupported Google Drive link. Open it in your browser.');
  return downloadHttp(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`, dir, {}, onProgress, signal);
}

async function downloadMega(url: string, dir: string, onProgress: ProgressFn, signal?: AbortSignal): Promise<string> {
  let file = (await MegaFile.fromURL(url).loadAttributes()) as MegaFile;
  if (file.directory) {
    const candidates = (file.children ?? []).filter((c) => !c.directory && c.name && DOWNLOADABLE.test(c.name));
    if (candidates.length !== 1) throw new DownloadUnavailableError('The Mega folder has several files. Open it in your browser.');
    file = candidates[0]!;
  }
  if (!file.name || !(ARCHIVE_FILE.test(file.name) || MOD_FILE.test(file.name))) {
    throw new DownloadUnavailableError('The Mega link is not an archive or mod file.');
  }
  if ((file.size ?? 0) > MAX_DOWNLOAD_BYTES) throw new Error('The download is too large.');
  await mkdir(dir, { recursive: true });
  const path = join(dir, safeFileName(file.name));
  let received = 0;
  const stream = file.download({});
  stream.on('data', (chunk: Buffer) => {
    received += chunk.length;
    onProgress(received, file.size);
  });
  const abort = (): void => void stream.destroy(new CancelledError());
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await pipeline(stream, createWriteStream(path));
  } catch (err) {
    await rm(path, { force: true });
    throw signal?.aborted ? new CancelledError() : err;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
  return path;
}

/**
 * The files to download from LoversLab's list of an entry's files: its mod files (screenshots and
 * readmes are skipped), or with `only` just the file of that name. Getting a new file off a page
 * that also holds the user's pack must not bring the pack's variants, or files they said no to,
 * along with it; and an update must not bring the page's new packs (`except`, by name) either,
 * which is how "installing the update" came to add a pack nobody asked for.
 */
export function chooserDownloads(listed: readonly { href: string; name: string }[], only?: string, except: readonly string[] = []): string[] {
  if (only) {
    const file = listed.find((f) => f.name.toLowerCase() === only.toLowerCase());
    if (!file) throw new DownloadUnavailableError(`${only} isn't on the LoversLab page any more. Open the page to check.`);
    return [file.href];
  }
  const left = new Set(except.map((n) => n.toLowerCase()));
  const files = listed.filter((f) => (!f.name || DOWNLOADABLE.test(f.name)) && !left.has(f.name.toLowerCase())).map((f) => f.href);
  if (!files.length && left.size) throw new DownloadUnavailableError('This page only has files you set aside. Open the page to check.');
  return files;
}
