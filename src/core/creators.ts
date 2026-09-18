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

export interface CreatorGroup {
  key: string;
  name: string;
  files: LocalFile[];
}

/** Groups tracked packages by primary author, applying `aliases` (normalized → canonical key). */
export function groupByCreator(files: LocalFile[], aliases: Record<string, string> = {}): CreatorGroup[] {
  const groups = new Map<string, CreatorGroup>();
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
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
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
