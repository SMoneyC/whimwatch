/**
 * Collects the licences of everything WhimWatch ships: the runtime dependencies packaged into the app,
 * the packages bundled into the window (React, icons, fonts), and the archive tools. The renderer
 * build writes them to out/renderer/licenses/, and Settings → About shows them.
 *
 * The build fails if a dependency's licence isn't on the allowlist, so an incompatible licence can't
 * slip in through a dependency update.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export const ALLOWED_LICENSES = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'OFL-1.1',
]);

export interface PackageNotice {
  name: string;
  version: string;
  license: string;
  homepage?: string;
  text?: string;
}

/** Binaries bundled through npm packages whose own licences differ from the wrapper package's. */
const EXTRA_NOTICES = [
  {
    title: '7-Zip (7za, bundled by 7zip-bin to unpack .7z downloads)',
    file: 'build/licenses/7-Zip.txt',
    note: 'Unmodified 7za executable. Source code: https://www.7-zip.org (Windows, macOS) and https://github.com/p7zip-project/p7zip (Linux).',
  },
  {
    title: 'UnRAR (compiled to WebAssembly by node-unrar-js to unpack .rar downloads)',
    file: 'build/licenses/UnRAR.txt',
    note: 'UnRAR source code: https://www.rarlab.com/rar_add.htm. It may not be used to re-create the RAR compression algorithm.',
  },
];

/** "…/node_modules/@scope/name/lib/x.js?query" → "@scope/name" (the innermost node_modules wins). */
export function packageNameFromModuleId(id: string): string | undefined {
  const path = id.replace(/\\/g, '/').replace(/[?#].*$/, '');
  const at = path.lastIndexOf('/node_modules/');
  if (at < 0) return undefined;
  const parts = path.slice(at + '/node_modules/'.length).split('/');
  if (!parts[0]) return undefined;
  return parts[0].startsWith('@') ? (parts[1] ? `${parts[0]}/${parts[1]}` : undefined) : parts[0];
}

/** Every package npm installs for production (what electron-builder copies into the app). */
export function productionPackages(root: string): string[] {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { dev?: boolean; devOptional?: boolean }>;
  };
  return Object.entries(lock.packages)
    .filter(([path, meta]) => path.startsWith('node_modules/') && !meta.dev && !meta.devOptional)
    .map(([path]) => path);
}

export function readNotice(packageDir: string): PackageNotice {
  const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
    license?: string | { type?: string };
    homepage?: string;
    repository?: string | { url?: string };
  };
  const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN');
  const file = readdirSync(packageDir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return {
    name: pkg.name,
    version: pkg.version,
    license,
    homepage: pkg.homepage ?? repository?.replace(/^git\+/, '').replace(/\.git$/, ''),
    text: file ? readFileSync(join(packageDir, file), 'utf8').replace(/\r\n/g, '\n').trim() : undefined,
  };
}

/** Throws for any licence expression that isn't built only from allowed licences. */
export function assertAllowed(notices: PackageNotice[]): void {
  const bad = notices.filter((n) => {
    const ids = n.license.replace(/[()]/g, ' ').split(/\s+(?:OR|AND)\s+|\s+/).filter(Boolean);
    // "A OR B" only needs one allowed option; anything with AND needs all of them.
    return /\sAND\s/.test(n.license) ? !ids.every((id) => ALLOWED_LICENSES.has(id)) : !ids.some((id) => ALLOWED_LICENSES.has(id));
  });
  if (bad.length) {
    throw new Error(
      `Dependencies with licences that need a review before shipping: ${bad.map((n) => `${n.name}@${n.version} (${n.license})`).join(', ')}. ` +
        'If the licence is compatible, add it to ALLOWED_LICENSES in scripts/third-party-licenses.ts.',
    );
  }
}

export function renderNotices(notices: PackageNotice[], root: string): string {
  const rule = '='.repeat(78);
  const sections = [...notices]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((n) =>
      [
        rule,
        `${n.name} ${n.version}`,
        `License: ${n.license}${n.homepage ? `\n${n.homepage}` : ''}`,
        '',
        n.text ?? `(No licence file in the package; licensed under ${n.license}.)`,
      ].join('\n'),
    );
  const extras = EXTRA_NOTICES.map((e) => [rule, e.title, e.note, '', readFileSync(join(root, e.file), 'utf8').trim()].join('\n'));
  return [
    'WhimWatch includes the following third-party software.',
    '',
    'Electron and Chromium ship their own licences next to the app (LICENSE.electron.txt and',
    'LICENSES.chromium.html in the installation folder).',
    '',
    ...extras,
    ...sections,
    '',
  ].join('\n\n');
}

/** Vite plugin for the renderer build: writes licenses/LICENSE.txt and licenses/THIRD_PARTY_LICENSES.txt. */
export function thirdPartyLicenses(root: string = process.cwd()): Plugin {
  return {
    name: 'whimwatch-third-party-licenses',
    apply: 'build',
    generateBundle() {
      const dirs = new Set<string>();
      for (const id of this.getModuleIds()) {
        const name = packageNameFromModuleId(id);
        if (name) dirs.add(join(root, 'node_modules', name));
      }
      for (const path of productionPackages(root)) dirs.add(join(root, path));
      const notices = [...dirs].filter((dir) => existsSync(join(dir, 'package.json'))).map(readNotice);
      // The same package can be installed twice (nested versions); list each version once.
      const unique = [...new Map(notices.map((n) => [`${n.name}@${n.version}`, n])).values()];
      assertAllowed(unique);
      this.emitFile({ type: 'asset', fileName: 'licenses/LICENSE.txt', source: readFileSync(join(root, 'LICENSE'), 'utf8') });
      this.emitFile({ type: 'asset', fileName: 'licenses/THIRD_PARTY_LICENSES.txt', source: renderNotices(unique, root) });
    },
  };
}
