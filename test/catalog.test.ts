import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupByCreator, normalizeName } from '../src/core/creators.js';
import { classifyUrl } from '../src/core/sources/urls.js';
import type { LocalFile } from '../src/shared/types.js';

/**
 * catalog/overrides.json is served live from main to every user, so a bad
 * entry shouldn't be able to slip through review.
 */
describe('community catalog', () => {
  const raw = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'catalog', 'overrides.json'), 'utf8')) as {
    version: unknown;
    aliases: Record<string, unknown>;
    creators: Record<string, { name?: unknown; links?: unknown }>;
  };

  it('has the expected shape', () => {
    expect(raw.version).toBe(1);
    expect(typeof raw.aliases).toBe('object');
    expect(typeof raw.creators).toBe('object');
  });

  it('uses normalized names for every key and alias target', () => {
    for (const [alias, target] of Object.entries(raw.aliases)) {
      expect(alias, `alias "${alias}"`).toBe(normalizeName(alias));
      expect(typeof target).toBe('string');
      expect(target, `alias target "${String(target)}"`).toBe(normalizeName(String(target)));
    }
    for (const key of Object.keys(raw.creators)) expect(key, `creator "${key}"`).toBe(normalizeName(key));
  });

  it('points aliases straight at a creator, not at another alias', () => {
    // Aliases are looked up once, so a chain would leave files under the middle name.
    for (const [alias, target] of Object.entries(raw.aliases)) {
      expect(raw.aliases[String(target)], `alias "${alias}" → "${String(target)}" is itself an alias`).toBeUndefined();
    }
  });

  it('only links to supported creator pages over HTTPS', () => {
    for (const [key, creator] of Object.entries(raw.creators)) {
      expect(typeof creator.name, `${key}.name`).toBe('string');
      expect(Array.isArray(creator.links), `${key}.links`).toBe(true);
      const links = creator.links as unknown[];
      expect(new Set(links).size, `${key} has duplicate links`).toBe(links.length);
      for (const link of links) {
        expect(typeof link).toBe('string');
        expect(String(link), `${key}: ${String(link)}`).toMatch(/^https:\/\//);
        const source = classifyUrl(String(link));
        expect(source && source !== 'wwmod', `${key}: unsupported link ${String(link)}`).toBe(true);
      }
    }
  });
});

describe('groupByCreator', () => {
  const file = (name: string, primaryAuthor: string): LocalFile => ({
    path: `/mods/${name}.package`,
    root: '/mods',
    relPath: `${name}.package`,
    size: 1,
    mtimeMs: 0,
    kind: 'ww-animation',
    authors: { [primaryAuthor]: 1 },
    primaryAuthor,
  });
  const aliases = { echosims: 'echo', echoheight: 'echo' };

  it('merges aliases under the creator and shows the creator’s own name whichever file comes first', () => {
    for (const files of [
      [file('a', 'EchoSims'), file('b', 'Echo'), file('c', 'Echo:HEIGHT')],
      [file('b', 'Echo'), file('a', 'EchoSims'), file('c', 'Echo:HEIGHT')],
    ]) {
      const groups = groupByCreator(files, aliases);
      expect(groups.map((g) => [g.key, g.name, g.files.length])).toEqual([['echo', 'Echo', 3]]);
    }
  });

  it('keeps the first file’s name when none of the files use the creator’s own name', () => {
    const groups = groupByCreator([file('a', 'HBR Animations (AP)')], { hbranimationsap: 'harborworld' });
    expect(groups.map((g) => [g.key, g.name])).toEqual([['harborworld', 'HBR Animations (AP)']]);
  });
});
