import bundled from '../../catalog/overrides.json' with { type: 'json' };
import { overridesUrl } from '../shared/config.js';
import type { Fetcher } from './fetcher.js';
import { normalizeName } from './creators.js';

/**
 * Community-maintained extras for creators the WickedWhims directory misses.
 * Keys are normalized creator names (see normalizeName).
 */
export interface Overrides {
  version: 1;
  /** normalized alias → normalized canonical name */
  aliases: Record<string, string>;
  creators: Record<string, { name: string; links: string[] }>;
}

export const BUNDLED_OVERRIDES = sanitizeOverrides(bundled);

export function sanitizeOverrides(raw: unknown): Overrides {
  const out: Overrides = { version: 1, aliases: {}, creators: {} };
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;
  if (obj.aliases && typeof obj.aliases === 'object') {
    for (const [k, v] of Object.entries(obj.aliases)) {
      if (typeof v === 'string') out.aliases[normalizeName(k)] = normalizeName(v);
    }
  }
  if (obj.creators && typeof obj.creators === 'object') {
    for (const [k, v] of Object.entries(obj.creators)) {
      if (!v || typeof v !== 'object') continue;
      const c = v as Record<string, unknown>;
      const links = Array.isArray(c.links) ? c.links.filter((l): l is string => typeof l === 'string' && /^https:\/\//.test(l)) : [];
      out.creators[normalizeName(k)] = { name: typeof c.name === 'string' ? c.name : k, links };
    }
  }
  return out;
}

/** Fetches the latest overrides from the repository, falling back to the bundled copy. */
export async function loadOverrides(fetcher: Fetcher, url = overridesUrl()): Promise<Overrides> {
  if (!url) return BUNDLED_OVERRIDES;
  try {
    const res = await fetcher.get(url, { accept: 'application/json' });
    if (res.status === 200) return mergeOverrides(BUNDLED_OVERRIDES, sanitizeOverrides(JSON.parse(res.body)));
  } catch {
    // Offline or repository moved; bundled copy is fine.
  }
  return BUNDLED_OVERRIDES;
}

function mergeOverrides(a: Overrides, b: Overrides): Overrides {
  const creators = { ...a.creators };
  for (const [k, v] of Object.entries(b.creators)) {
    creators[k] = { name: v.name, links: [...new Set([...(creators[k]?.links ?? []), ...v.links])] };
  }
  return { version: 1, aliases: { ...a.aliases, ...b.aliases }, creators };
}
