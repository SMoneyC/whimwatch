import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * How the Mods folders sit on disk, for a bug report — never the paths themselves.
 *
 * redact() only swaps the home folder for "~", which covers the usual Documents case and nothing
 * else: a folder on another drive, a network share, or a Windows partition mounted under /mnt all
 * keep whatever name is in them, and "OneDrive - Some Company" survives the ~ as well. A folder can
 * be any folder at all — the picker doesn't constrain it — so the shape is the part worth sending.
 */
export function describeModsDirs(dirs: string[], opts: { home: string; documents: string; platform: string }): string {
  if (!dirs.length) return 'none';
  const kinds = new Set<string>();
  // Compare on the shape of the paths being described, not the separator of whichever machine is
  // running: a Windows path is still a Windows path when a test (or WSL) looks at it.
  const norm = (p: string): string => (opts.platform === 'win32' ? p.replace(/\\/g, '/').toLowerCase() : p);
  for (const dir of dirs) {
    const under = (root: string): boolean => {
      if (!root) return false;
      const r = norm(root).replace(/\/+$/, '');
      const d = norm(dir);
      return d === r || d.startsWith(`${r}/`);
    };
    if (/^\\\\|^\/\/[^/]/.test(dir)) kinds.add('a network share');
    else if (/onedrive/i.test(dir)) kinds.add('OneDrive-redirected');
    else if (under(opts.documents)) kinds.add('the default Documents location');
    else if (opts.platform === 'linux' && dir.startsWith('/mnt/')) kinds.add('a mounted Windows drive');
    else if (under(opts.home)) kinds.add('elsewhere in your home folder');
    else kinds.add('another drive or folder');
  }
  return `${dirs.length} · ${[...kinds].join(', ')}`;
}

/** Steam app id of The Sims 4, for Proton prefixes on Linux. */
const SIMS4_STEAM_APP_ID = '1222670';

/**
 * Finds Sims 4 Mods folders. The game folder name is localized ("The Sims 4",
 * "Die Sims 4", "Les Sims 4"…), so any Electronic Arts/<x>/Mods counts.
 */
export async function detectModsDirs(documentsDir: string): Promise<string[]> {
  const roots = new Set<string>([join(documentsDir, 'Electronic Arts')]);
  const home = homedir();

  if (process.platform === 'linux') {
    for (const steam of ['.steam/steam', '.local/share/Steam', '.var/app/com.valvesoftware.Steam/.local/share/Steam']) {
      roots.add(join(home, steam, 'steamapps/compatdata', SIMS4_STEAM_APP_ID, 'pfx/drive_c/users/steamuser/Documents/Electronic Arts'));
    }
    // Development under WSL: the Windows user profiles.
    if (existsSync('/mnt/c/Users')) {
      for (const user of await safeReaddir('/mnt/c/Users')) {
        roots.add(join('/mnt/c/Users', user, 'Documents/Electronic Arts'));
        roots.add(join('/mnt/c/Users', user, 'OneDrive/Documents/Electronic Arts'));
      }
    }
  }
  if (process.platform === 'win32') {
    // app.getPath('documents') already follows OneDrive redirection; this catches unsynced copies.
    roots.add(join(home, 'OneDrive', 'Documents', 'Electronic Arts'));
  }

  const found: string[] = [];
  for (const root of roots) {
    for (const game of await safeReaddir(root)) {
      const mods = join(root, game, 'Mods');
      if (existsSync(mods)) found.push(mods);
    }
  }
  return [...new Set(found)];
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
