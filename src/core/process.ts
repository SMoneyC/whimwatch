import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Best effort: false when the process list can't be read. */
export async function isGameRunning(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 10_000, windowsHide: true });
      return /"TS4(?:_DX9)?_x64\.exe"/i.test(stdout);
    }
    const pattern = process.platform === 'darwin' ? 'The Sims 4.app/Contents/MacOS' : 'TS4(_DX9)?_x64\\.exe';
    await run('pgrep', ['-f', pattern], { timeout: 10_000 });
    return true; // pgrep exits non-zero when nothing matches
  } catch {
    return false;
  }
}
