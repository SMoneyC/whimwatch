import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, chmod, constants, copyFile, mkdir, readdir, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import sevenBin from '7zip-bin';
import yauzl from 'yauzl';
import { translatedError } from '../shared/i18n/index.js';
import { CancelledError, throwIfCancelled } from './fetcher.js';

const run = promisify(execFile);

export const MOD_FILE = /\.(?:package|ts4script)$/i;
export const ARCHIVE_FILE = /\.(?:zip|rar|7z)$/i;
/** Nothing in a mod download should ever run; refuse archives that contain these. */
const BLOCKED_FILE = /\.(?:exe|dll|msi|bat|cmd|com|scr|ps1|psm1|vbs|vbe|js|jse|wsf|hta|jar|sh|command|app|lnk|reg|cpl|pif|appimage|dmg|pkg)$/i;
const MAX_ENTRIES = 5000;
const MAX_TOTAL_BYTES = 8 * 1024 ** 3;

export class UnsafeArchiveError extends Error {}

export interface ArchiveEntry {
  name: string;
  size: number;
  directory: boolean;
  /** Symbolic links are never extracted. */
  symlink?: boolean;
}

export function isSafeEntryPath(name: string): boolean {
  const n = name.replace(/\\/g, '/');
  if (!n || n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.includes('\0')) return false;
  return !n.split('/').some((segment) => segment === '..');
}

export function validateEntries(entries: ArchiveEntry[]): void {
  if (entries.length > MAX_ENTRIES) throw translatedError((m) => m.downloads.tooManyFiles(entries.length), UnsafeArchiveError);
  let total = 0;
  for (const e of entries) {
    if (!isSafeEntryPath(e.name)) throw translatedError((m) => m.downloads.unsafePath(e.name), UnsafeArchiveError);
    if (e.symlink) throw translatedError((m) => m.downloads.link(basename(e.name)), UnsafeArchiveError);
    if (!e.directory && BLOCKED_FILE.test(e.name)) {
      throw translatedError((m) => m.downloads.program(basename(e.name)), UnsafeArchiveError);
    }
    total += e.size;
  }
  if (total > MAX_TOTAL_BYTES) throw translatedError((m) => m.downloads.tooLargeUnpacked, UnsafeArchiveError);
}

export async function listArchive(file: string, signal?: AbortSignal): Promise<ArchiveEntry[]> {
  if (/\.zip$/i.test(file)) return listZip(file);
  if (/\.rar$/i.test(file)) return (await runRarWorker(file, undefined, signal)).entries ?? [];
  return listSevenZip(file);
}

/**
 * Safely extracts a download into `dest` and returns every extracted file
 * (relative paths). A download that only contains more archives is unpacked
 * one level further.
 */
export async function extractDownload(file: string, dest: string, signal?: AbortSignal): Promise<string[]> {
  if (MOD_FILE.test(file)) {
    // Some creators share the .package directly.
    await mkdir(dest, { recursive: true });
    await copyFile(file, join(dest, basename(file)));
    return [basename(file)];
  }
  if (!ARCHIVE_FILE.test(file)) throw translatedError((m) => m.downloads.unsupportedType(basename(file)), UnsafeArchiveError);

  await extractOne(file, dest, signal);
  let files = await walkFiles(dest);
  if (!files.some((f) => MOD_FILE.test(f))) {
    for (const nested of files.filter((f) => ARCHIVE_FILE.test(f))) {
      await extractOne(join(dest, nested), join(dest, `${nested}.contents`), signal);
    }
    files = await walkFiles(dest);
  }
  return files;
}

async function extractOne(file: string, dest: string, signal?: AbortSignal): Promise<void> {
  validateEntries(await listArchive(file, signal));
  throwIfCancelled(signal);
  await mkdir(dest, { recursive: true });
  if (/\.zip$/i.test(file)) await extractZip(file, dest, signal);
  else if (/\.rar$/i.test(file)) await runRarWorker(file, dest, signal);
  else await extractSevenZip(file, dest, signal);
}

/** Lists regular files under `root`, refusing anything that resolves outside it. */
export async function walkFiles(root: string): Promise<string[]> {
  const realRoot = await realpath(root);
  const out: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await realpath(full).catch(() => '');
        if (!target.startsWith(realRoot + sep)) throw translatedError((m) => m.downloads.linkOutside(entry.name), UnsafeArchiveError);
        continue;
      }
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) out.push(relative(root, full));
    }
  };
  await visit(root);
  return out.sort();
}

// ── zip (yauzl: pure JS, never creates links, checks entry sizes) ─────────────

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolvePromise, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (err, zip) =>
      err ? reject(zipError(err)) : resolvePromise(zip),
    ),
  );
}

/** yauzl rejects traversal and absolute names itself; report those as unsafe, not as broken. */
function zipError(err: Error): Error {
  return /invalid relative path|absolute path|invalid characters/i.test(err.message)
    ? translatedError((m) => m.downloads.unsafePathReason(err.message), UnsafeArchiveError)
    : err;
}

function zipEntry(entry: yauzl.Entry): ArchiveEntry {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0o170000;
  return {
    name: entry.fileName,
    size: entry.uncompressedSize,
    directory: entry.fileName.endsWith('/'),
    symlink: unixMode === 0o120000,
  };
}

async function listZip(file: string): Promise<ArchiveEntry[]> {
  const zip = await openZip(file);
  return new Promise((resolvePromise, reject) => {
    const entries: ArchiveEntry[] = [];
    zip.on('entry', (entry: yauzl.Entry) => {
      entries.push(zipEntry(entry));
      zip.readEntry();
    });
    zip.on('end', () => resolvePromise(entries));
    zip.on('error', (err: Error) => reject(zipError(err)));
    zip.readEntry();
  });
}

async function extractZip(file: string, dest: string, signal?: AbortSignal): Promise<void> {
  const zip = await openZip(file);
  const root = resolve(dest);
  await new Promise<void>((resolvePromise, reject) => {
    const fail = (err: Error): void => {
      zip.close();
      reject(signal?.aborted ? new CancelledError() : zipError(err));
    };
    zip.on('entry', (entry: yauzl.Entry) => {
      void (async () => {
        throwIfCancelled(signal);
        const info = zipEntry(entry);
        const target = resolve(root, entry.fileName);
        if (info.symlink || !isSafeEntryPath(entry.fileName) || !target.startsWith(root + sep)) {
          throw translatedError((m) => m.downloads.unsafePath(entry.fileName), UnsafeArchiveError);
        }
        if (info.directory) {
          await mkdir(target, { recursive: true });
        } else {
          await mkdir(dirname(target), { recursive: true });
          const stream = await new Promise<NodeJS.ReadableStream>((ok, bad) =>
            zip.openReadStream(entry, (err, s) => (err ? bad(err) : ok(s))),
          );
          await pipeline(stream, createWriteStream(target), { signal });
        }
        zip.readEntry();
      })().catch(fail);
    });
    zip.on('end', () => resolvePromise());
    zip.on('error', fail);
    zip.readEntry();
  });
}

// ── rar (node-unrar-js is synchronous WebAssembly: run it off the main thread) ─

const RAR_WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const { createExtractorFromFile } = require(workerData.modulePath);
(async () => {
  try {
    const extractor = await createExtractorFromFile({ filepath: workerData.file, targetPath: workerData.dest });
    if (workerData.dest === undefined) {
      const entries = [...extractor.getFileList().fileHeaders].map((h) => ({ name: h.name, size: h.unpSize, directory: h.flags.directory }));
      parentPort.postMessage({ ok: true, entries });
    } else {
      for (const _ of extractor.extract().files) void _;
      parentPort.postMessage({ ok: true });
    }
  } catch (err) {
    parentPort.postMessage({ ok: false, message: (err && err.message) || String(err) });
  }
})();
`;

/** Where node-unrar-js lives on disk (outside app.asar when packaged, so the worker can load it). */
function unrarModulePath(): string {
  return createRequire(import.meta.url).resolve('node-unrar-js').replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
}

function runRarWorker(file: string, dest: string | undefined, signal?: AbortSignal): Promise<{ entries?: ArchiveEntry[] }> {
  throwIfCancelled(signal);
  const worker = new Worker(RAR_WORKER, { eval: true, workerData: { file, dest, modulePath: unrarModulePath() } });
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = (): void => finish(() => {
      void worker.terminate();
      reject(new CancelledError());
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.once('message', (msg: { ok: boolean; message?: string; entries?: ArchiveEntry[] }) =>
      finish(() => (msg.ok ? resolvePromise({ entries: msg.entries }) : reject(translatedError((m) => m.downloads.rar(String(msg.message)))))),
    );
    worker.once('error', (err) => finish(() => reject(err)));
    worker.once('exit', (code) => finish(() => reject(new Error(`RAR worker stopped (exit ${code})`))));
  });
}

// ── 7z (bundled 7za; only used for .7z, which is rare for Sims mods) ──────────

/** Path to the bundled 7za, outside app.asar when packaged. */
export function sevenZipPath(): string {
  return sevenBin.path7za.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
}

async function ensureExecutable(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    await access(path, constants.X_OK);
  } catch {
    await chmod(path, 0o755);
  }
}

async function listSevenZip(file: string): Promise<ArchiveEntry[]> {
  const bin = sevenZipPath();
  await ensureExecutable(bin);
  // -t7z: 7-Zip reads dozens of formats (disk images, installers…); a file named .7z must really be one.
  const { stdout } = await run(bin, ['l', '-t7z', '-slt', '-ba', '-sccUTF-8', file], { maxBuffer: 64 * 1024 * 1024 });
  return parseSevenZipListing(stdout);
}

async function extractSevenZip(file: string, dest: string, signal?: AbortSignal): Promise<void> {
  const bin = sevenZipPath();
  await ensureExecutable(bin);
  await run(bin, ['x', '-t7z', '-y', '-bd', '-sccUTF-8', `-o${dest}`, file], { maxBuffer: 64 * 1024 * 1024, signal }).catch((err: Error) => {
    throw signal?.aborted ? new CancelledError() : err;
  });
}

export function parseSevenZipListing(stdout: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  for (const block of stdout.split(/\r?\n\r?\n/)) {
    const fields = Object.fromEntries(
      block
        .split(/\r?\n/)
        .map((line) => /^([^=]+?) = (.*)$/.exec(line))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [m[1]!, m[2]!]),
    );
    if (fields.Path === undefined) continue;
    const attributes = fields.Attributes ?? '';
    const directory = fields.Folder === '+' || (fields.Folder === undefined && /^D/.test(attributes));
    // Unix mode "lrwxrwxrwx", or an explicit link target, marks a symbolic link.
    const symlink = /(^|\s)l[rwxst-]{9}/.test(attributes) || Boolean(fields['Symbolic Link']);
    entries.push({ name: fields.Path, size: Number(fields.Size ?? 0) || 0, directory, symlink });
  }
  return entries;
}
