import { describe, expect, it } from 'vitest';
import { fileNameFrom, isAllowedDownloadHost, safeFileName } from '../src/core/downloads.js';

describe('download helpers', () => {
  it.each([
    ['https://files.wicked.cc/file/wickedcc/WW_Thornwood.zip', true],
    ['https://www.loverslab.com/files/file/1-x/?do=download', true],
    ['https://c10.patreonusercontent.com/abc', true],
    ['https://mega.nz/file/abc#key', true],
    ['http://files.wicked.cc/x.zip', false],
    ['https://wicked.cc.evil.example/x.zip', false],
    ['https://example.com/x.zip', false],
  ])('allows %s: %s', (url, allowed) => {
    expect(isAllowedDownloadHost(url)).toBe(allowed);
  });

  it('prefers Content-Disposition names and strips paths', () => {
    expect(fileNameFrom('attachment; filename="WW_Pack.zip"', 'https://x/y')).toBe('WW_Pack.zip');
    expect(fileNameFrom("attachment; filename*=UTF-8''WW%20Pack%E2%99%A5.zip", 'https://x/y')).toBe('WW Pack♥.zip');
    expect(fileNameFrom(null, 'https://files.wicked.cc/file/wickedcc/WW_Thornwood.zip')).toBe('WW_Thornwood.zip');
    expect(fileNameFrom('attachment; filename="../../evil.zip"', 'https://x/y')).toBe('evil.zip');
  });

  it('never returns an empty or special name', () => {
    expect(safeFileName('..')).toBe('download');
    expect(safeFileName('a:b?.zip')).toBe('a_b_.zip');
    // Read the same on every system: not a drive letter on Windows, not a folder anywhere.
    expect(safeFileName('C:evil.package')).toBe('C_evil.package');
    expect(safeFileName('C:\\Users\\x\\evil.package')).toBe('evil.package');
    expect(safeFileName('WW_Pack.zip. . ')).toBe('WW_Pack.zip');
    expect(safeFileName('CON.zip')).toBe('_CON.zip');
    expect(safeFileName('Console.zip')).toBe('Console.zip');
  });
});
