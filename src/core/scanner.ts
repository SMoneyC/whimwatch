import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import type { LocalFile, PackageKind } from '../shared/types.js';
import { withPackage } from './dbpf.js';

/** Snippet tuning: where WickedWhims keeps its animation/CAS package XML. */
export const SNIPPET_TUNING_TYPE = 0x7df2169c;

const CORE_FILE = /^TURBODRIVER_WickedWhims_(?:Scripts\.ts4script|Tuning\.package)$/i;
const WW_CLASS = /<I c="((?:WickedWhims|WickedWoohoo|StripClub)\w*Package)"/;
const AUTHOR_FIELD = /<T n="(?:\w+_author|author_name)">([^<]*)<\/T>/g;
const MAX_TUNING_BYTES = 64 * 1024 * 1024;

export type ScanCacheEntry = Pick<LocalFile, 'root' | 'relPath' | 'size' | 'mtimeMs' | 'kind' | 'authors' | 'error'>;
/** Everything learned about each file, by path. Lets rescans skip unchanged files. */
export type ScanCache = Record<string, ScanCacheEntry>;

export interface ScanOptions {
  cache?: ScanCache;
  concurrency?: number;
  onProgress?: (done: number, total: number, path: string) => void;
}

export interface ScanResult {
  files: LocalFile[];
  cache: ScanCache;
}

export async function scanDirs(dirs: string[], opts: ScanOptions = {}): Promise<ScanResult> {
  const found: { path: string; root: string }[] = [];
  const seen = new Set<string>();
  for (const root of dirs) {
    for await (const path of walk(root)) {
      if (seen.has(path)) continue;
      seen.add(path);
      found.push({ path, root });
    }
  }

  const oldCache = opts.cache ?? {};
  const cache: ScanCache = {};
  const files: LocalFile[] = new Array(found.length);
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    while (next < found.length) {
      const i = next++;
      const { path, root } = found[i]!;
      files[i] = await scanFile(path, root, oldCache[path]);
      cache[path] = cacheEntry(files[i]!);
      opts.onProgress?.(++done, found.length, path);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  return { files: files.filter(Boolean), cache };
}

function cacheEntry(f: LocalFile): ScanCacheEntry {
  return { root: f.root, relPath: f.relPath, size: f.size, mtimeMs: f.mtimeMs, kind: f.kind, authors: f.authors, error: f.error };
}

/** Rebuilds the file list from a cache (undefined if the cache predates stored roots). */
export function filesFromCache(cache: ScanCache): LocalFile[] | undefined {
  const files: LocalFile[] = [];
  for (const [path, entry] of Object.entries(cache)) {
    if (entry.root === undefined || entry.relPath === undefined) return undefined;
    files.push(withPrimary({ path, ...entry }));
  }
  return files;
}

/**
 * Updates the cache for just these paths (after an install or undo), instead
 * of walking every Mods folder again. Missing paths are dropped.
 */
export async function rescanPaths(paths: string[], dirs: string[], cache: ScanCache): Promise<ScanCache> {
  const next = { ...cache };
  for (const path of paths) {
    const root = dirs.find((d) => path.startsWith(d.endsWith(sep) ? d : d + sep));
    const isFile = await stat(path).then((st) => st.isFile(), () => false);
    if (!root || !isFile || !/\.(?:package|ts4script)$/i.test(path)) {
      delete next[path];
      continue;
    }
    next[path] = cacheEntry(await scanFile(path, root, undefined));
  }
  return next;
}

/**
 * Mod files under `dir`. Symlinked and junctioned folders are followed (players
 * use them to keep mods on another drive); each real folder is visited once.
 */
async function* walk(dir: string, visited = new Set<string>()): AsyncGenerator<string> {
  const real = await realpath(dir).catch(() => undefined);
  if (!real || visited.has(real)) return;
  visited.add(real);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    let isDir = e.isDirectory();
    let isFile = e.isFile();
    if (e.isSymbolicLink()) {
      const target = await stat(p).catch(() => undefined);
      isDir = Boolean(target?.isDirectory());
      isFile = Boolean(target?.isFile());
    }
    if (isDir) yield* walk(p, visited);
    else if (isFile && /\.(?:package|ts4script)$/i.test(e.name)) yield p;
  }
}

async function scanFile(path: string, root: string, cached: ScanCache[string] | undefined): Promise<LocalFile> {
  const st = await stat(path);
  const base: LocalFile = {
    path,
    root,
    relPath: relative(root, path),
    size: st.size,
    mtimeMs: st.mtimeMs,
    kind: 'other',
    authors: {},
  };

  if (CORE_FILE.test(basename(path))) return { ...base, kind: 'ww-core' };
  if (/\.ts4script$/i.test(path)) return base;

  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
    return withPrimary({ ...base, kind: cached.kind, authors: cached.authors, error: cached.error });
  }

  try {
    const { kind, authors } = await readWickedTuning(path);
    return withPrimary({ ...base, kind, authors });
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}

export async function readWickedTuning(path: string): Promise<{ kind: PackageKind; authors: Record<string, number> }> {
  return withPackage(path, async (pkg) => {
    let kind: PackageKind = 'other';
    const authors: Record<string, number> = {};
    for (const entry of pkg.entries) {
      if (entry.type !== SNIPPET_TUNING_TYPE) continue;
      let buf: Buffer | null;
      try {
        buf = await pkg.read(entry, MAX_TUNING_BYTES);
      } catch {
        continue;
      }
      if (!buf) continue;
      const found = parseWickedTuning(buf.toString('utf8'));
      if (!found) continue;
      if (kind === 'other' || (kind === 'ww-cas' && found.kind === 'ww-animation')) kind = found.kind;
      for (const [name, n] of Object.entries(found.authors)) authors[name] = (authors[name] ?? 0) + n;
    }
    return { kind, authors };
  });
}

export function parseWickedTuning(xml: string): { kind: PackageKind; authors: Record<string, number> } | null {
  const cls = WW_CLASS.exec(xml.slice(0, 512))?.[1];
  if (!cls) return null;
  const kind: PackageKind = /CASParts/i.test(cls) ? 'ww-cas' : 'ww-animation';
  const authors: Record<string, number> = {};
  for (const m of xml.matchAll(AUTHOR_FIELD)) {
    const name = decodeXml(m[1]!).trim();
    if (name) authors[name] = (authors[name] ?? 0) + 1;
  }
  return { kind, authors };
}

function withPrimary(file: LocalFile): LocalFile {
  let best: string | undefined;
  let bestCount = 0;
  for (const [name, n] of Object.entries(file.authors)) {
    if (n > bestCount) {
      best = name;
      bestCount = n;
    }
  }
  return best ? { ...file, primaryAuthor: best } : file;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}
