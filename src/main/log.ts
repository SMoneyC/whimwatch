import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { format } from 'node:util';

/** Enough for the last few sessions; bug reports only ever need the end. */
const MAX_LOG_BYTES = 128 * 1024;
let logFile: string | undefined;

/**
 * Mirrors console output into the logs folder so users can attach it to bug
 * reports. Lines never contain full URLs (only the site) or the home folder.
 */
export function installFileLog(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'whimwatch.log');
  // Earlier versions kept a rotated copy and logged full page addresses.
  rmSync(join(dir, 'whimwatch.old.log'), { force: true });
  compactLog(file);
  logFile = file;
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const message = format(...args);
      if (isExpectedNoise(message)) return;
      original(...args);
      try {
        appendFileSync(file, `${new Date().toISOString()} [${level}] ${redact(message)}\n`);
      } catch {
        // Never let logging break the app.
      }
    };
  }
  return file;
}

/**
 * Electron warns "Failed to load URL … ERR_BLOCKED_BY_CLIENT" for every embed, ad or tracker frame the
 * hidden site browser skips on purpose (see request-filter.ts), plus Node's one-time "--trace-warnings"
 * hint after it. They aren't problems, and they'd print page addresses, so they go nowhere: not the
 * terminal, not the log file.
 */
export function isExpectedNoise(message: string): boolean {
  return /Failed to load URL: .* with error: ERR_BLOCKED_BY_CLIENT/.test(message) || /^\(Use `\S+ --trace-warnings \.\.\.` to show where the warning was created\)$/.test(message.trim());
}

/** Scrubs lines written by older versions and keeps only the newest part of the log. */
export function compactLog(file: string): void {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  try {
    let lines = text
      .split('\n')
      .filter((line) => line && !isExpectedNoise(line.replace(/^\S+ \[\w+\] /, '')))
      .map(redact);
    let size = lines.reduce((n, line) => n + Buffer.byteLength(line) + 1, 0);
    while (size > MAX_LOG_BYTES / 2 && lines.length) {
      size -= Buffer.byteLength(lines[0]!) + 1;
      lines = lines.slice(1);
    }
    const next = lines.length ? `${lines.join('\n')}\n` : '';
    if (next !== text) writeFileSync(file, next);
  } catch {
    // Best effort.
  }
}

export function recentLogLines(count: number): string[] {
  if (!logFile) return [];
  try {
    return readFileSync(logFile, 'utf8').trimEnd().split('\n').filter(Boolean).slice(-count).map(redact);
  } catch {
    return [];
  }
}

/** Empties the log (Settings → Storage → Clear, and removing all data). */
export function clearLog(): void {
  if (!logFile) return;
  try {
    writeFileSync(logFile, '');
  } catch {
    // Best effort.
  }
}

/**
 * Hides the home folder (it contains the account name) and cuts web addresses
 * down to the site: page paths name the creators and packs someone looked at.
 */
export function redact(text: string): string {
  let out = text.replace(/\b(https?|wss?):\/\/([^\s/?#'"<>()[\]]+)[^\s'"<>)]*/gi, (match, scheme: string, authority: string) => {
    const rest = match.slice(scheme.length + 3 + authority.length);
    const host = authority.slice(authority.lastIndexOf('@') + 1);
    return `${scheme}://${host}${rest && rest !== '/' ? '/…' : rest}`;
  });
  out = out.replace(/\bfile:\/\/[^\s'"<>)]+/gi, 'file://…');
  const home = homedir();
  if (!home) return out;
  const variants = new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')]);
  for (const v of variants) out = out.split(v).join('~');
  return out;
}
