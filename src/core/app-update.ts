import { compareVersions } from '../shared/game.js';
import { USER_AGENT } from './fetcher.js';

export interface AppRelease {
  version: string;
  url: string;
}

/**
 * The newest published (non-draft, non-prerelease) GitHub release. Site layouts
 * change and parsers break, so users need to hear when a fixed version exists.
 */
export async function latestRelease(repoSlug: string, fetchImpl: typeof fetch = fetch): Promise<AppRelease | undefined> {
  const res = await fetchImpl(`https://api.github.com/repos/${repoSlug}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) return undefined;
  const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
  if (typeof body.tag_name !== 'string' || typeof body.html_url !== 'string') return undefined;
  if (!body.html_url.startsWith(`https://github.com/${repoSlug}/`)) return undefined;
  return { version: body.tag_name.replace(/^v/i, ''), url: body.html_url };
}

export function isNewerRelease(release: AppRelease | undefined, currentVersion: string): release is AppRelease {
  return release !== undefined && compareVersions(release.version, currentVersion) > 0;
}
