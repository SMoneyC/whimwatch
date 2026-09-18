import type { LocalFile, RemoteInfo } from '../shared/types.js';
import { type CreatorGroup, fileNameKey, normalizeName } from './creators.js';

/**
 * Telling a creator's pages apart: which are packs the user has, and which are
 * packs they don't. A creator with a wicked.cc pack page per release has a
 * newest page most of the time, and calling that an update when it is a pack
 * the user never had sends them to a download that turns out to contain
 * nothing for them.
 *
 * The only certain answer comes from downloading and comparing, so this says
 * nothing it can't see: a page is `no` only when not one distinctive word of
 * its name appears anywhere in the creator's file names, `yes` only when every
 * word does, and undefined the rest of the time. Undefined keeps today's
 * behaviour, so a page this can't read is still checked for updates.
 */

/** Words that say nothing about which pack a page is: they sit on half a creator's pages. */
const NOISE = new Set([
  // Release decoration.
  'update', 'updated', 'updates', 'new', 'fix', 'fixes', 'fixed', 'patch', 'remake', 'remade', 'version',
  'public', 'early', 'access', 'release', 'released', 'edition', 'beta', 'final', 'part', 'vol', 'wip',
  'free', 'total', 'mega', 'bonus', 'preview', 'exclusive',
  // What every pack on the site is.
  'animation', 'animations', 'anim', 'anims', 'pack', 'packs', 'set', 'sets', 'mod', 'mods', 'collection',
  'item', 'items', 'prop', 'props', 'object', 'objects', 'clothing', 'clothes', 'accessory', 'accessories',
  'overlay', 'overlays', 'preset', 'presets', 'pose', 'poses', 'sound', 'sounds', 'effect', 'effects', 'custom',
  // The mod and the game.
  'wicked', 'whims', 'wickedwhims', 'wickedcc', 'sim', 'sims', 'thesims', 'ts4', 'sex', 'adult', 'nsfw',
  // Filler.
  'the', 'and', 'for', 'with', 'from', 'your', 'you', 'all',
]);

/**
 * A page can only be called new when its name has a word this long to be missing.
 *
 * Only `no` carries this floor, and deliberately: `no` is the verdict that changes what the app
 * does, so it is the one that has to be hard to reach. Every consumer filters on `owned !== 'no'`
 * (see ownedRemotes), which makes `yes` and "couldn't tell" the same answer everywhere — a `yes`
 * reached on a short, coincidental word costs nothing today beyond leaving the page where it
 * already was. If `yes` ever gains behaviour of its own, it needs this floor too.
 */
const DISTINCTIVE = 5;

/**
 * Pages named after one pack, rather than a creator's whole catalogue. One
 * page is the creator's catalogue however it's titled, and calling that new
 * would bury every update they ever post.
 */
const MIN_PAGES = 2;

export type Ownership = NonNullable<RemoteInfo['owned']>;

/**
 * Which of a page's name-words are worth looking for: the ones that name the
 * pack rather than the creator, the site or the release.
 */
export function packWords(title: string, creatorKey: string): string[] {
  const cleaned = title
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/~[^~]*~/g, ' ')
    // "EVE V10.2 ✦ 2026-02-24 UPDATE": everything after the separator is the release, not the pack.
    .replace(/[✦★☆♥❤•|].*$/su, ' ')
    .replace(/~.*$/su, ' ');
  const words: string[] = [];
  for (const raw of cleaned.split(/[^\p{L}\p{N}]+/u)) {
    const word = normalizeName(raw);
    if (word.length < 3 || words.includes(word)) continue;
    if (NOISE.has(word) || /^\d+$/.test(word) || /^v\d+$/.test(word)) continue;
    // The creator's own name is on all of their pages.
    if (creatorKey.includes(word)) continue;
    words.push(word);
  }
  return words;
}

/**
 * Whether the creator's files show this pack. `fileNames` are normalized file
 * names (see fileNameKey), which run words together, so words are looked for
 * as substrings: "Verbena Lace Lingerie" is in "moonberryverbenalacelingerietopremake".
 */
export function packFiles(title: string | undefined, files: LocalFile[], creatorKey: string): LocalFile[] {
  if (!title) return [];
  const words = packWords(title, creatorKey);
  if (!words.length) return [];
  // Every word in the one file's own name, not spread across the creator's whole folder: this asks
  // which files came from this page, so it has to be the file that carries the pack's name.
  return files.filter((f) => {
    const name = fileNameKey(f.path);
    return words.every((w) => name.includes(w));
  });
}

export function packOwnership(title: string | undefined, fileNames: string[], creatorKey: string): Ownership | undefined {
  if (!title || !fileNames.length) return undefined;
  const words = packWords(title, creatorKey);
  if (!words.length) return undefined;
  const matched = words.filter((w) => fileNames.some((name) => name.includes(w)));
  if (matched.length === words.length) return 'yes';
  if (matched.length === 0 && words.some((w) => w.length >= DISTINCTIVE)) return 'no';
  return undefined;
}

/**
 * Dates each page against the files that came from it, where its name says which those are.
 *
 * Unlike the ownership verdict below, this runs on every site. Saying "you don't have this" from a
 * name is only safe where a creator has a page per pack, because WhimWatch follows a single
 * LoversLab or Patreon entry per creator and a wrong `no` would mute the whole site for them. But
 * reading a date off a page that plainly names one pack is safe anywhere: it only engages when the
 * name matches files of yours, and where it doesn't the creator-wide date is used exactly as before.
 * A Patreon post titled "Lantern Expansions Update" dates that pack, and nothing else.
 */
export function datePacks(group: CreatorGroup, remotes: RemoteInfo[]): RemoteInfo[] {
  if (!group.files.length) return remotes;
  return remotes.map((r) => {
    if (r.status !== 'ok' || r.updatedAt === undefined) return r;
    const mine = packFiles(r.title, group.files, group.key);
    return mine.length ? { ...r, yoursAt: Math.max(...mine.map((f) => f.mtimeMs)) } : r;
  });
}

/**
 * Marks the creator's wicked.cc pages as packs they have or don't. Only wicked.cc, where a creator
 * has a page per pack; see datePacks above for why the other sites are left alone.
 */
export function classifyRemotes(group: CreatorGroup, remotes: RemoteInfo[]): RemoteInfo[] {
  const pages = remotes.filter((r) => r.listing.source === 'wickedcc' && r.status === 'ok');
  if (pages.length < MIN_PAGES) return remotes;
  const fileNames = packFileNames(group.files);
  if (!fileNames.length) return remotes;
  const marked = remotes.map((r) => {
    if (!pages.includes(r)) return r;
    const owned = packOwnership(r.title, fileNames, group.key);
    return owned ? { ...r, owned } : r;
  });
  // Nothing of theirs left to compare dates against means the names simply didn't work for this
  // creator, not that they own none of it — and a creator with pages that reads "No page found"
  // is worse than the update this was meant to stop. Keep today's behaviour instead.
  return marked.some((r) => r.status === 'ok' && r.owned !== 'no') ? marked : remotes;
}

function packFileNames(files: LocalFile[]): string[] {
  return [...new Set(files.map((f) => fileNameKey(f.path)).filter(Boolean))];
}
