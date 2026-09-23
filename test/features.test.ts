import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNewerRelease, latestRelease } from '../src/core/app-update.js';
import { parseGameVersion, parseOptionsIni, readGameInfo } from '../src/core/game.js';
import { applyInstall, markUnchanged, planInstall } from '../src/core/installer.js';
import { compareVersions, gameWarnings } from '../src/shared/game.js';
import type { CoreResult, LocalFile } from '../src/shared/types.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'whimwatch-features-'));
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

describe('already up to date', () => {
  const local = (path: string, root: string): LocalFile => ({
    path,
    root,
    relPath: path.slice(root.length + 1),
    size: 0,
    mtimeMs: 0,
    kind: 'ww-animation',
    authors: {},
  });

  it('marks identical files and treats an all-identical download as up to date', async () => {
    const mods = join(tmp, 'Mods');
    const x = join(tmp, 'x');
    await mkdir(mods);
    await mkdir(x);
    await writeFile(join(mods, 'WW_A.package'), 'same bytes');
    await writeFile(join(x, 'WW_A.package'), 'same bytes');
    const plan = planInstall({
      id: 'p',
      creatorKey: 'a',
      name: 'A',
      downloadUrl: '',
      source: 'loverslab',
      downloads: ['A.zip'],
      extractedDir: x,
      extractedFiles: ['WW_A.package'],
      installedFiles: [local(join(mods, 'WW_A.package'), mods)],
      modsRoots: [mods],
    });
    await markUnchanged(plan);
    expect(plan.files[0]!.unchanged).toBe(true);
    expect(plan.upToDate).toBe(true);
  });

  it('installs only the files that changed, without backing up identical ones', async () => {
    const mods = join(tmp, 'Mods');
    const x = join(tmp, 'x');
    await mkdir(mods);
    await mkdir(x);
    await writeFile(join(mods, 'WW_A.package'), 'same');
    await writeFile(join(mods, 'WW_B.package'), 'old');
    await writeFile(join(x, 'WW_A.package'), 'same');
    await writeFile(join(x, 'WW_B.package'), 'new!');
    const plan = planInstall({
      id: 'p',
      creatorKey: 'a',
      name: 'A',
      downloadUrl: '',
      source: 'wickedcc',
      downloads: ['A.zip'],
      extractedDir: x,
      extractedFiles: ['WW_A.package', 'WW_B.package'],
      installedFiles: [local(join(mods, 'WW_A.package'), mods), local(join(mods, 'WW_B.package'), mods)],
      modsRoots: [mods],
    });
    await markUnchanged(plan);
    expect(plan.files.map((f) => f.unchanged)).toEqual([true, false]);
    expect(plan.upToDate).toBe(false);
    // A file of theirs changed: a real update, not just new files.
    expect(plan.onlyAdds).toBe(false);
    const record = await applyInstall({ plan, remove: [], backupRoot: join(tmp, 'b'), modsRoots: [mods], isGameRunning: async () => false });
    expect(record.operations.map((o) => o.target)).toEqual([join(mods, 'WW_B.package')]);
    expect(await readFile(join(mods, 'WW_B.package'), 'utf8')).toBe('new!');
  });

  it("tells a page that only added a new pack apart from an update to the user's", async () => {
    // The page's date moved because the creator put a new pack on it; their pack is untouched.
    const mods = join(tmp, 'Mods');
    const x = join(tmp, 'x');
    await mkdir(mods);
    await mkdir(x);
    await writeFile(join(mods, 'WW_Moonberry_Animations.package'), 'same');
    await writeFile(join(x, 'WW_Moonberry_Animations.package'), 'same');
    await writeFile(join(x, 'WW_Moonberry_Juniper_Petal.package'), 'new pack');
    const plan = planInstall({
      id: 'p',
      creatorKey: 'moonberry',
      name: 'Moonberry',
      downloadUrl: '',
      source: 'loverslab',
      downloads: ['Moonberry.zip'],
      extractedDir: x,
      extractedFiles: ['WW_Moonberry_Animations.package', 'WW_Moonberry_Juniper_Petal.package'],
      installedFiles: [local(join(mods, 'WW_Moonberry_Animations.package'), mods)],
      modsRoots: [mods],
    });
    await markUnchanged(plan);
    expect(plan.files.map((f) => [f.kind, f.unchanged ?? false])).toEqual([
      ['replace', true],
      ['add', false],
    ]);
    expect(plan).toMatchObject({ upToDate: false, onlyAdds: true });

    // Nothing of theirs in the download at all: not this case, whatever it is.
    const unrelated = planInstall({
      id: 'q',
      creatorKey: 'moonberry',
      name: 'Moonberry',
      downloadUrl: '',
      source: 'loverslab',
      downloads: ['Juniper Petal.zip'],
      extractedDir: x,
      extractedFiles: ['WW_Moonberry_Juniper_Petal.package'],
      installedFiles: [local(join(mods, 'WW_Moonberry_Animations.package'), mods)],
      modsRoots: [mods],
    });
    await markUnchanged(unrelated);
    expect(unrelated.onlyAdds).toBe(false);
  });
});

describe('game status', () => {
  it('reads GameVersion.txt and Options.ini next to the Mods folder', async () => {
    const game = join(tmp, 'The Sims 4');
    await mkdir(join(game, 'Mods'), { recursive: true });
    await writeFile(join(game, 'GameVersion.txt'), Buffer.concat([Buffer.from([13, 0, 0, 0]), Buffer.from('1.127.41.1030')]));
    await writeFile(join(game, 'Options.ini'), '[options]\nscriptmodsenabled = 1\nmodsdisabled = 0\n');
    expect(await readGameInfo([join(game, 'Mods')])).toEqual({ version: '1.127.41.1030', modsEnabled: true, scriptModsEnabled: true });
    expect(await readGameInfo([join(tmp, 'Somewhere else')])).toBeUndefined();
  });

  it('parses the raw formats', () => {
    expect(parseGameVersion(Buffer.from('   1.128.9.1010'))).toBe('1.128.9.1010');
    expect(parseOptionsIni('scriptmodsenabled = 0\nmodsdisabled = 1')).toEqual({ scriptModsEnabled: false, modsEnabled: false });
    expect(parseOptionsIni('[options]\nsomething = 1')).toEqual({ scriptModsEnabled: undefined, modsEnabled: undefined });
  });

  const core: CoreResult = { status: 'up-to-date', latestVersion: '185k', supportedGameVersions: ['1.127.41', '1.126.78', '1.125.59'] };

  it('warns about a game patch WickedWhims does not support yet', () => {
    expect(gameWarnings({ version: '1.127.41.1030', modsEnabled: true, scriptModsEnabled: true }, core)).toEqual([]);
    const [newer] = gameWarnings({ version: '1.128.2.1020' }, core);
    expect(newer).toMatchObject({ tone: 'warn' });
    expect(newer!.text).toContain('updated to 1.128.2');
    expect(newer!.text).toContain('only supports up to 1.127.41');
    expect(gameWarnings({ version: '1.100.1.1' }, core)[0]!.text).toContain('older');
  });

  it('warns when mods or script mods are switched off', () => {
    const warnings = gameWarnings({ modsEnabled: false, scriptModsEnabled: false }, core);
    expect(warnings.map((w) => w.tone)).toEqual(['error', 'error']);
    expect(warnings[1]!.text).toContain('Script mods');
  });

  it('compares versions numerically', () => {
    expect(compareVersions('1.127.41', '1.127.9')).toBe(1);
    expect(compareVersions('v0.2.0', '0.10.0')).toBe(-1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });
});

describe('app update notice', () => {
  const release = (body: object, ok = true) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 404 })) as unknown as typeof fetch;

  it('reads the latest GitHub release', async () => {
    const found = await latestRelease('me/whimwatch', release({ tag_name: 'v0.3.0', html_url: 'https://github.com/me/whimwatch/releases/tag/v0.3.0' }));
    expect(found).toEqual({ version: '0.3.0', url: 'https://github.com/me/whimwatch/releases/tag/v0.3.0' });
    expect(isNewerRelease(found, '0.2.9')).toBe(true);
    expect(isNewerRelease(found, '0.3.0')).toBe(false);
  });

  it('ignores missing releases and links outside the repository', async () => {
    expect(await latestRelease('me/whimwatch', release({}, false))).toBeUndefined();
    expect(await latestRelease('me/whimwatch', release({ tag_name: 'v9', html_url: 'https://evil.example/download' }))).toBeUndefined();
  });
});
