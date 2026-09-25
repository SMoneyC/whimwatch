import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { shell } from 'electron';
import { translatedError } from '../shared/i18n/index.js';
import { isWsl, WIN } from './browsers.js';

const run = promisify(execFile);

export async function openUrl(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only web links can be opened.');
  if (isWsl) {
    try {
      // WSL has no Linux browser registered; wslview hands the link to Windows.
      await run('wslview', [url], { timeout: 15_000 });
      return;
    } catch {
      throw translatedError((m) => m.main.wslBrowser);
    }
  }
  await shell.openExternal(url);
}

export async function revealFile(path: string): Promise<void> {
  if (isWsl) return explorer([`/select,${await windowsPath(path)}`]);
  shell.showItemInFolder(path);
}

export async function openFolder(path: string): Promise<void> {
  if (isWsl) return explorer([await windowsPath(path)]);
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
}

async function windowsPath(path: string): Promise<string> {
  const { stdout } = await run('wslpath', ['-w', path], { timeout: 5_000 });
  return stdout.trim();
}

async function explorer(args: string[]): Promise<void> {
  // explorer.exe exits with 1 even when it succeeds.
  await run(WIN.explorer, args, { timeout: 15_000 }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') throw translatedError((m) => m.main.wslExplorer);
  });
}
