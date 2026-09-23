import { basename } from 'node:path';
import type { LocalFile, RemoteInfo } from '../shared/types.js';
import { TOLERANCE_MS } from '../shared/updatable.js';
import type { ChooserFile } from './sources/loverslab.js';

/**
 * Dates a LoversLab page by its files instead of by the page.
 *
 * LoversLab moves an entry's date for any edit, and for a new file put on it: a creator adding a
 * Simlish edition of their pack to the same entry made every user of the pack look behind, and
 * installing "the update" added a pack they never asked for. The entry's file list dates each file
 * on its own, so the page is dated by the newest of the files the user has (matched by exact name,
 * as the installer matches them) and the files they don't have are kept aside as newFiles.
 *
 * Only files posted more than a day after theirs count as new: a variant uploaded with their pack (a
 * no-sound edition, say) is one they chose not to install, not news. A newer file that is one of
 * theirs under a new version number (Pack_v2 beside their Pack_v1) is their update, not a new pack,
 * so it dates the page: calling it new would hide a real update, which is worse than a false alarm.
 * With no file of theirs on the list by name (an entry offering a zip) nothing can be told, and the
 * page keeps its own date as before.
 */
export function datePageByFiles(remote: RemoteInfo, listed: ChooserFile[], yours: readonly LocalFile[]): RemoteInfo {
  const mine = new Set(yours.map((f) => basename(f.path).toLowerCase()));
  const dated = listed.filter((f): f is ChooserFile & { updatedAt: number } => Boolean(f.name) && f.updatedAt !== undefined);
  const matched = dated.filter((f) => mine.has(f.name.toLowerCase()));
  if (!matched.length) return remote;
  const theirsAt = Math.max(...matched.map((f) => f.updatedAt));
  // Their files on this page, not all of theirs: a numbered file from another page of the creator's
  // shouldn't make a new pack here read as its update. A name of only digits has no stem to match.
  const stems = new Set(matched.map((f) => versionless(f.name)).filter(Boolean));
  const later = dated.filter((f) => !mine.has(f.name.toLowerCase()) && f.updatedAt > theirsAt + TOLERANCE_MS);
  const renamed = later.filter((f) => stems.has(versionless(f.name)));
  const updatedAt = Math.max(theirsAt, ...renamed.map((f) => f.updatedAt));
  const newFiles = later.filter((f) => !renamed.includes(f)).map(({ name, updatedAt: at }) => ({ name, updatedAt: at }));
  const { newFiles: _old, ...page } = remote;
  return newFiles.length ? { ...page, updatedAt, newFiles } : { ...page, updatedAt };
}

/**
 * A file name without its extension, version and separators: "WW_Moonberry_v1.2.package" and
 * "WW_Moonberry_V2.package" come to the same thing. Numbers go too, so two numbered packs of one
 * name read as one pack's versions: a false "update" rather than a hidden one.
 */
export function versionless(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/\d+/g, '')
    .replace(/(^|[^a-z])v(?=[^a-z]|$)/g, '$1')
    .replace(/[^a-z]+/g, '');
}

/** Takes the new files the user now has (installed with Get it) off the page, without waiting for a check. */
export function dropInstalledFiles(remote: RemoteInfo, files: readonly LocalFile[]): RemoteInfo {
  if (!remote.newFiles) return remote;
  const have = new Set(files.map((f) => basename(f.path).toLowerCase()));
  const newFiles = remote.newFiles.filter((f) => !have.has(f.name.toLowerCase()));
  if (newFiles.length === remote.newFiles.length) return remote;
  const { newFiles: _old, ...page } = remote;
  return newFiles.length ? { ...page, newFiles } : page;
}

/**
 * The files an update from this page leaves out, by name: its new packs and the ones the user said
 * no to, which are offered on their own (Get it) rather than slipped in with an update. A file they
 * said no to and then installed anyway is theirs now, so its own updates aren't held back. Nothing
 * for a page without a file list: there is nothing to pick from, and asking would be a wasted
 * request to the download itself.
 */
export function updateExclusions(remote: RemoteInfo, ignored: readonly string[], installed: readonly LocalFile[]): string[] {
  if (remote.listing.source !== 'loverslab' || !remote.chooserUrl) return [];
  const have = new Set(installed.map((f) => basename(f.path).toLowerCase()));
  return [...(remote.newFiles ?? []).map((f) => f.name), ...ignored.filter((name) => !have.has(name.toLowerCase()))];
}
