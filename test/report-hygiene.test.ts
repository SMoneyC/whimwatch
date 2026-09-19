import { describe, expect, it } from 'vitest';
import { describeModsDirs } from '../src/main/modsdir.js';

describe('diagnostics say the shape of the Mods folders, never the path', () => {
  const win = { home: 'C:\\Users\\Jane', documents: 'C:\\Users\\Jane\\Documents', platform: 'win32' };
  const linux = { home: '/home/jane', documents: '/home/jane/Documents', platform: 'linux' };

  it('names the usual case without naming anything', () => {
    expect(describeModsDirs(['C:\\Users\\Jane\\Documents\\Electronic Arts\\The Sims 4\\Mods'], win)).toBe('1 · the default Documents location');
    expect(describeModsDirs([], win)).toBe('none');
  });

  it('carries no part of the paths that redact() used to leave in', () => {
    // Each of these kept a real name in a bug report: a Windows user name, an employer, a machine.
    const leaky = [
      ['/mnt/c/Users/jane/Documents/Electronic Arts/The Sims 4/Mods', linux],
      ['D:\\JaneSmith\\SimsBackup\\Mods', win],
      ['\\\\JANES-PC\\share\\Mods', win],
      ['C:\\Users\\Jane\\OneDrive - Contoso Ltd\\Documents\\Electronic Arts\\The Sims 4\\Mods', win],
    ] as const;
    for (const [dir, opts] of leaky) {
      const out = describeModsDirs([dir], opts);
      expect(out.toLowerCase()).not.toContain('jane');
      expect(out.toLowerCase()).not.toContain('contoso');
      expect(out).not.toContain('\\');
      expect(out).not.toContain('/');
    }
  });

  it('still says the things worth knowing', () => {
    expect(describeModsDirs(['C:\\Users\\Jane\\OneDrive\\Documents\\Electronic Arts\\The Sims 4\\Mods'], win)).toContain('OneDrive-redirected');
    expect(describeModsDirs(['/mnt/c/Users/jane/Documents/Electronic Arts/The Sims 4/Mods'], linux)).toContain('a mounted Windows drive');
    expect(describeModsDirs(['\\\\PC\\share\\Mods'], win)).toContain('a network share');
    expect(describeModsDirs(['D:\\Sims\\Mods'], win)).toContain('another drive or folder');
    const two = describeModsDirs(['C:\\Users\\Jane\\Documents\\Electronic Arts\\The Sims 4\\Mods', 'D:\\Sims\\Mods'], win);
    expect(two).toBe('2 · the default Documents location, another drive or folder');
  });
});
