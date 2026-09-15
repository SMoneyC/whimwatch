import { deflateSync } from 'node:zlib';

export interface BuildResource {
  type: number;
  group?: number;
  instance?: bigint;
  data: Buffer | string;
  compression?: 'zlib' | 'none';
}

/** Builds a minimal DBPF 2.1 package in memory (for tests only). */
export function buildDbpf(resources: BuildResource[], opts: { sharedType?: number } = {}): Buffer {
  const header = Buffer.alloc(96);
  header.write('DBPF', 0, 'latin1');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(1, 8);

  const blobs: Buffer[] = [];
  const entries: Buffer[] = [];
  let offset = 96;
  for (const res of resources) {
    const raw = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data, 'utf8');
    const zlib = (res.compression ?? 'zlib') === 'zlib';
    const stored = zlib ? deflateSync(raw) : raw;
    const instance = res.instance ?? BigInt(entries.length + 1);

    const fields: number[] = [];
    if (opts.sharedType === undefined) fields.push(res.type);
    fields.push(res.group ?? 0, Number(instance >> 32n), Number(instance & 0xffffffffn), offset, stored.length | 0x80000000, raw.length);
    const entry = Buffer.alloc(fields.length * 4 + 4);
    fields.forEach((v, i) => entry.writeUInt32LE(v >>> 0, i * 4));
    entry.writeUInt16LE(zlib ? 0x5a42 : 0x0000, fields.length * 4);
    entry.writeUInt16LE(1, fields.length * 4 + 2);

    entries.push(entry);
    blobs.push(stored);
    offset += stored.length;
  }

  const flags = Buffer.alloc(4);
  const shared: Buffer[] = [];
  if (opts.sharedType !== undefined) {
    flags.writeUInt32LE(1, 0);
    const t = Buffer.alloc(4);
    t.writeUInt32LE(opts.sharedType, 0);
    shared.push(t);
  }
  const index = Buffer.concat([flags, ...shared, ...entries]);

  header.writeUInt32LE(resources.length, 36);
  header.writeUInt32LE(index.length, 44);
  header.writeUInt32LE(offset, 64);
  return Buffer.concat([header, ...blobs, index]);
}

export function wwTuningXml(opts: { cls?: string; authors: string[]; field?: string }): string {
  const field = opts.field ?? 'animation_author';
  const items = opts.authors.map((a) => `<U><T n="${field}">${a}</T><T n="animation_raw_display_name">Anim</T></U>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>\r\n<I c="${opts.cls ?? 'WickedWhimsAnimationPackage'}" i="snippet" m="wickedwhims.x" n="test" s="1"><L n="animations">${items}</L></I>`;
}
