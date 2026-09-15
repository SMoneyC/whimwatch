import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertAllowed, packageNameFromModuleId, productionPackages, readNotice, renderNotices } from '../scripts/third-party-licenses.js';

const root = join(import.meta.dirname, '..');
let tmp: string | undefined;
afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe('third-party licences', () => {
  it('finds the package a bundled module came from', () => {
    expect(packageNameFromModuleId('/app/node_modules/react-dom/cjs/react-dom.production.js')).toBe('react-dom');
    expect(packageNameFromModuleId('C:\\app\\node_modules\\@fontsource-variable\\manrope\\index.css?used')).toBe('@fontsource-variable/manrope');
    expect(packageNameFromModuleId('/app/node_modules/a/node_modules/b/index.js')).toBe('b');
    expect(packageNameFromModuleId('/app/src/renderer/src/App.tsx')).toBeUndefined();
  });

  it('covers every runtime dependency, all under allowed licences', () => {
    const notices = productionPackages(root).map((path) => readNotice(join(root, path)));
    expect(notices.map((n) => n.name)).toEqual(expect.arrayContaining(['7zip-bin', 'node-unrar-js', 'cheerio', 'yauzl', 'megajs']));
    expect(() => assertAllowed(notices)).not.toThrow();
    const text = renderNotices(notices, root);
    expect(text).toContain('7-Zip');
    expect(text).toContain('GNU LGPL');
    expect(text).toContain('unrar.dll library is freeware');
  });

  it('refuses licences nobody has reviewed', () => {
    expect(() => assertAllowed([{ name: 'copyleft', version: '1.0.0', license: 'GPL-3.0' }])).toThrow(/copyleft@1.0.0 \(GPL-3.0\)/);
    expect(() => assertAllowed([{ name: 'dual', version: '1.0.0', license: '(MIT OR GPL-3.0)' }])).not.toThrow();
    expect(() => assertAllowed([{ name: 'both', version: '1.0.0', license: 'MIT AND GPL-3.0' }])).toThrow();
  });

  it('reads the licence file whatever it is called', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'whimwatch-licence-'));
    const dir = join(tmp, 'pkg');
    await mkdir(dir);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'pkg', version: '2.0.0', license: 'ISC', repository: 'git+https://github.com/x/pkg.git' }));
    await writeFile(join(dir, 'LICENCE.md'), 'ISC licence text\r\n');
    expect(readNotice(dir)).toEqual({ name: 'pkg', version: '2.0.0', license: 'ISC', homepage: 'https://github.com/x/pkg', text: 'ISC licence text' });
  });
});
