import type { CheerioAPI } from 'cheerio';

/** Collects JSON-LD objects (flattening arrays and @graph). */
export function jsonLd($: CheerioAPI): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data: unknown = JSON.parse($(el).text());
      const stack = [data];
      while (stack.length) {
        const item = stack.pop();
        if (Array.isArray(item)) stack.push(...item);
        else if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          out.push(obj);
          if (Array.isArray(obj['@graph'])) stack.push(...obj['@graph']);
        }
      }
    } catch {
      // Ignore malformed blocks.
    }
  });
  return out;
}

export function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && 'name' in v) return str((v as { name: unknown }).name);
  return undefined;
}

export function meta($: CheerioAPI, property: string): string | undefined {
  return $(`meta[property="${property}"], meta[name="${property}"]`).attr('content') || undefined;
}

/** Returns the target of a `<meta http-equiv="refresh">` redirect, if any. */
export function metaRefreshTarget(html: string, base: string): string | undefined {
  const m = /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=['"]?([^'">]+)/i.exec(html);
  if (!m) return undefined;
  try {
    return new URL(m[1]!.trim(), base).toString();
  } catch {
    return undefined;
  }
}
