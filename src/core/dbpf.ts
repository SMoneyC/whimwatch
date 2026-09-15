import { open, type FileHandle } from 'node:fs/promises';
import { constants as zlibConstants, inflateSync } from 'node:zlib';

/** Reader for The Sims 4 `.package` files (DBPF 2.x). */

export const Compression = {
  None: 0x0000,
  Zlib: 0x5a42,
  RefPack: 0xffff,
  Streamable: 0xfffe,
  Deleted: 0xffe0,
} as const;

export interface DbpfEntry {
  type: number;
  group: number;
  instance: bigint;
  offset: number;
  /** Size on disk (compressed). */
  fileSize: number;
  /** Size once decompressed. */
  memSize: number;
  compression: number;
}

export class DbpfError extends Error {}

const HEADER_SIZE = 96;

/** Largest single resource WhimWatch will decompress (tuning XML is a few MB at most). */
const MAX_RESOURCE_BYTES = 512 * 1024 * 1024;

export async function readDbpfIndex(fh: FileHandle, fileSize?: number): Promise<DbpfEntry[]> {
  const size = fileSize ?? (await fh.stat()).size;
  const header = Buffer.alloc(HEADER_SIZE);
  const { bytesRead } = await fh.read(header, 0, HEADER_SIZE, 0);
  if (bytesRead < HEADER_SIZE || header.toString('latin1', 0, 4) !== 'DBPF') {
    throw new DbpfError('Not a DBPF package');
  }
  const major = header.readUInt32LE(4);
  if (major !== 2) throw new DbpfError(`Unsupported DBPF version ${major}`);

  const count = header.readUInt32LE(36);
  const indexSize = header.readUInt32LE(44);
  const indexPos = header.readUInt32LE(64) || header.readUInt32LE(40);
  if (count === 0) return [];
  // Header values come from the file; never allocate more than the file could hold.
  if (indexPos + indexSize > size || indexSize < 4 || count > indexSize / 16) throw new DbpfError('Corrupt package index');

  const index = Buffer.alloc(indexSize);
  const read = await fh.read(index, 0, indexSize, indexPos);
  if (read.bytesRead < indexSize) throw new DbpfError('Truncated index');
  return parseIndex(index, count);
}

export function parseIndex(buf: Buffer, count: number): DbpfEntry[] {
  let p = 0;
  const u32 = (): number => {
    if (p + 4 > buf.length) throw new DbpfError('Truncated index');
    const v = buf.readUInt32LE(p);
    p += 4;
    return v;
  };
  const u16 = (): number => {
    if (p + 2 > buf.length) throw new DbpfError('Truncated index');
    const v = buf.readUInt16LE(p);
    p += 2;
    return v;
  };

  // Bits 0-2 mark type, group and instance-high as shared by every entry.
  const flags = u32();
  const constType = flags & 1 ? u32() : undefined;
  const constGroup = flags & 2 ? u32() : undefined;
  const constInstHi = flags & 4 ? u32() : undefined;

  const entries: DbpfEntry[] = [];
  for (let i = 0; i < count; i++) {
    const type = constType ?? u32();
    const group = constGroup ?? u32();
    const instHi = constInstHi ?? u32();
    const instLo = u32();
    const offset = u32();
    const rawSize = u32();
    const memSize = u32();
    const extended = (rawSize & 0x80000000) !== 0;
    let compression: number = Compression.None;
    if (extended) {
      compression = u16();
      u16(); // "committed"
    }
    entries.push({
      type,
      group,
      instance: (BigInt(instHi) << 32n) | BigInt(instLo),
      offset,
      fileSize: rawSize & 0x7fffffff,
      memSize,
      compression,
    });
  }
  return entries;
}

/**
 * Reads and decompresses a resource. Returns null for deleted or streamable
 * entries and for anything larger than `maxMemSize`.
 */
export async function readResource(
  fh: FileHandle,
  entry: DbpfEntry,
  maxMemSize = MAX_RESOURCE_BYTES,
  fileSize = Number.POSITIVE_INFINITY,
): Promise<Buffer | null> {
  if (entry.memSize > Math.min(maxMemSize, MAX_RESOURCE_BYTES)) return null;
  if (entry.compression === Compression.Deleted || entry.compression === Compression.Streamable) return null;
  if (entry.offset + entry.fileSize > fileSize) throw new DbpfError('Resource points past the end of the package');
  const raw = Buffer.alloc(entry.fileSize);
  const { bytesRead } = await fh.read(raw, 0, entry.fileSize, entry.offset);
  if (bytesRead < entry.fileSize) throw new DbpfError('Truncated resource');
  switch (entry.compression) {
    case Compression.None:
      return raw;
    case Compression.Zlib:
      return inflateResource(raw, Math.min(entry.memSize, maxMemSize, MAX_RESOURCE_BYTES));
    case Compression.RefPack:
      return refpackDecompress(raw);
    default:
      return null;
  }
}

/**
 * A few KB of zlib can inflate to gigabytes, and the index's memSize is just a
 * claim, so output is capped at that size.
 */
export function inflateResource(raw: Buffer, maxBytes: number): Buffer {
  try {
    // Some tools write streams without a final block; accept what inflates.
    return inflateSync(raw, { finishFlush: zlibConstants.Z_SYNC_FLUSH, maxOutputLength: Math.max(1, maxBytes) });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new DbpfError('Resource is larger than the package index says');
    throw err;
  }
}

/** EA RefPack (LZ77 variant) used by older Sims tooling. */
export function refpackDecompress(input: Buffer): Buffer {
  if (input.length < 5 || input[1] !== 0xfb) throw new DbpfError('Invalid RefPack header');
  const flags = input[0]!;
  let p = 2;
  let outSize: number;
  if (flags & 0x80) {
    outSize = input.readUInt32BE(p);
    p += 4;
  } else {
    outSize = (input[p]! << 16) | (input[p + 1]! << 8) | input[p + 2]!;
    p += 3;
  }
  if (outSize > MAX_RESOURCE_BYTES) throw new DbpfError('RefPack output too large');
  const out = Buffer.alloc(outSize);
  let o = 0;

  const byte = (): number => {
    if (p >= input.length) throw new DbpfError('Truncated RefPack stream');
    return input[p++]!;
  };

  for (;;) {
    const b0 = byte();
    let plain: number;
    let copy = 0;
    let offset = 0;
    let stop = false;
    if (b0 < 0x80) {
      const b1 = byte();
      plain = b0 & 0x03;
      copy = ((b0 & 0x1c) >> 2) + 3;
      offset = ((b0 & 0x60) << 3) + b1 + 1;
    } else if (b0 < 0xc0) {
      const b1 = byte();
      const b2 = byte();
      plain = (b1 & 0xc0) >> 6;
      copy = (b0 & 0x3f) + 4;
      offset = ((b1 & 0x3f) << 8) + b2 + 1;
    } else if (b0 < 0xe0) {
      const b1 = byte();
      const b2 = byte();
      const b3 = byte();
      plain = b0 & 0x03;
      copy = ((b0 & 0x0c) << 6) + b3 + 5;
      offset = ((b0 & 0x10) << 12) + (b1 << 8) + b2 + 1;
    } else if (b0 < 0xfc) {
      plain = ((b0 & 0x1f) << 2) + 4;
    } else {
      plain = b0 & 0x03;
      stop = true;
    }

    if (o + plain + copy > outSize) throw new DbpfError('RefPack output overflow');
    for (let i = 0; i < plain; i++) out[o++] = byte();
    if (copy) {
      if (offset > o) throw new DbpfError('RefPack back-reference out of range');
      for (let i = 0; i < copy; i++, o++) out[o] = out[o - offset]!;
    }
    if (stop) break;
  }
  return out;
}

export interface OpenPackage {
  entries: DbpfEntry[];
  read(entry: DbpfEntry, maxMemSize?: number): Promise<Buffer | null>;
}

export async function withPackage<T>(path: string, fn: (pkg: OpenPackage) => Promise<T>): Promise<T> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const entries = await readDbpfIndex(fh, size);
    return await fn({ entries, read: (entry, max) => readResource(fh, entry, max, size) });
  } finally {
    await fh.close();
  }
}
