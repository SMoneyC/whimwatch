import type { SourceId } from './types.js';

export const SOURCE_LABEL: Record<SourceId, string> = {
  wwmod: 'WickedWhims',
  wickedcc: 'wicked.cc',
  loverslab: 'LoversLab',
  patreon: 'Patreon',
};

/**
 * A page title as plain text. Creators style names with Unicode's mathematical letters
 * ("𝑴𝒐𝒐𝒏𝒃𝒆𝒓𝒓𝒚") and hide zero-width spaces around them: without a font that has those letters they
 * show as empty boxes, and either way they defeat search and pack-name matching. NFKC turns the
 * letters back into ordinary ones; emoji are left as they are. Only the invisible spaces go: the
 * zero-width joiners (U+200C, U+200D) stay, since they hold emoji like 👩‍💻 together, and words
 * together in some scripts.
 */
export function plainTitle(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/[\u200B\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
