import type { LocalFile } from '../shared/types.js';

/**
 * Normalizes creator names so "!Northwind", "Grey Harbor" and "pine_glen"
 * compare equal to "Northwind", "GreyHarbor" and "Pine Glen".
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Shortest creator key allowed as a file-name prefix. Three letters would let
 * a name like "Ivy" claim every file starting with those letters.
 */
const MIN_PREFIX = 4;

/** A file's name, normalized like a creator name: "Moonberry-petal.package" → "moonberrypetal". */
export function fileNameKey(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return normalizeName(base.replace(/\.(?:package|ts4script)$/i, ''));
}

export interface CreatorGroup {
  key: string;
  name: string;
  files: LocalFile[];
}

/** Groups tracked packages by primary author, applying `aliases` (normalized → canonical key). */
export function groupByCreator(files: LocalFile[], aliases: Record<string, string> = {}): CreatorGroup[] {
  const groups = new Map<string, CreatorGroup>();
  const claimed = new Set<LocalFile>();
  for (const file of files) {
    if (!file.primaryAuthor || (file.kind !== 'ww-animation' && file.kind !== 'ww-cas')) continue;
    const norm = normalizeName(file.primaryAuthor);
    if (!norm) continue;
    const key = aliases[norm] ?? norm;
    let group = groups.get(key);
    if (!group) {
      group = { key, name: cleanDisplayName(file.primaryAuthor), files: [] };
      groups.set(key, group);
    } else if (norm === key && normalizeName(group.name) !== key) {
      // The creator's own name beats an alias that was scanned first: "Echo", not "EchoSims".
      group.name = cleanDisplayName(file.primaryAuthor);
    }
    group.files.push(file);
    claimed.add(file);
  }
  addNamedAfterCreator(files, groups, claimed, aliases);
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Adds the files a creator named after themselves. Only animation packages
 * carry an `animation_author`, so a creator's CAS and object packages have no
 * tuning to credit them and would otherwise count as somebody else's — on one
 * real install, 16 of a creator's 20 files, which is what made a pack the user
 * owned read as new.
 *
 * A file name never invents a creator: the name has to match one already found
 * from tuning, and tuning always wins where both say something.
 */
function addNamedAfterCreator(
  files: LocalFile[],
  groups: Map<string, CreatorGroup>,
  claimed: Set<LocalFile>,
  aliases: Record<string, string>,
): void {
  const prefixes = new Map<string, string>();
  for (const key of groups.keys()) prefixes.set(key, key);
  // "EchoSims_…" belongs to Echo when the catalog says those are the same person.
  for (const [norm, key] of Object.entries(aliases)) if (groups.has(key)) prefixes.set(norm, key);
  const longestFirst = [...prefixes.keys()].filter((p) => p.length >= MIN_PREFIX).sort((a, b) => b.length - a.length);
  if (!longestFirst.length) return;

  for (const file of files) {
    if (claimed.has(file) || file.kind === 'ww-core') continue;
    const name = fileNameKey(file.path);
    const prefix = longestFirst.find((p) => name.startsWith(p));
    if (prefix) groups.get(prefixes.get(prefix)!)!.files.push(file);
  }
}

/** Drops sort-order prefixes and trailing decoration: "!Northwind" → "Northwind", "LUMEN!" → "LUMEN". */
function cleanDisplayName(name: string): string {
  return name.replace(/^[^\p{L}\p{N}([]+/u, '').replace(/[\s!.,;:_~*-]+$/u, '') || name;
}

/**
 * Finds the directory entry for a creator. Exact normalized match first, then
 * a prefix match for names like "Willow Bank" vs "Willow" (min 4 chars).
 */
export function matchName<T extends { name: string }>(creatorKey: string, candidates: T[]): T | undefined {
  const exact = candidates.find((c) => normalizeName(c.name) === creatorKey);
  if (exact) return exact;
  const prefixed = candidates.filter((c) => {
    const n = normalizeName(c.name);
    const [short, long] = n.length <= creatorKey.length ? [n, creatorKey] : [creatorKey, n];
    return short.length >= 4 && long.startsWith(short);
  });
  return prefixed.length === 1 ? prefixed[0] : undefined;
}
