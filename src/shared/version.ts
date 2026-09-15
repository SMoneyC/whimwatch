/**
 * Formats a source's version field. LoversLab's is free text, so only values
 * that look like version numbers get a "v"; the rest are quoted and shortened.
 */
export function formatVersion(version: string): string {
  const v = version.trim();
  if (/^v?\d+(?:\.\d+)*[a-z]?$/i.test(v)) return v.toLowerCase().startsWith('v') ? v : `v${v}`;
  const chars = [...v]; // whole characters, so emoji aren't split
  return `“${chars.length > 28 ? `${chars.slice(0, 27).join('')}…` : v}”`;
}
