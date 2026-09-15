import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
