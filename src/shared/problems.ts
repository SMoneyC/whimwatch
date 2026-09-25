import { inEnglish, type Messages, t } from './i18n/index.js';
import type { RemoteInfo, RemoteProblem } from './types.js';

/**
 * A page's problem in words: in the current language, or in the catalogue given. Undefined for a code
 * this version doesn't know, which a newer version's state file can hold after a downgrade.
 */
export function describeProblem(problem: RemoteProblem, m: Messages = t()): string | undefined {
  const p = m.problem;
  switch (problem.code) {
    case 'http':
      return p.http(problem.status);
    case 'posts-api':
      return p.postsApi(problem.status);
    case 'verification':
      return p.verification(problem.site);
    case 'desktop-only':
      return p.desktopOnly(problem.site);
    case 'failed':
      return p.failed(problem.reason);
    case 'page-not-found':
      return p.pageNotFound;
    case 'file-not-found':
      return p.fileNotFound;
    case 'creator-not-found':
      return p.creatorNotFound;
    case 'different-page':
      return p.differentPage;
    case 'no-date':
      return p.noDate;
    case 'not-creator-page':
      return p.notCreatorPage;
    case 'no-patreon-page':
      return p.noPatreonPage;
    case 'no-release-posts':
      return p.noReleasePosts;
    case 'no-posts':
      return p.noPosts;
    case 'unsupported-link':
      return p.unsupportedLink;
    case 'interrupted':
      return p.interrupted;
    case 'timeout':
      return p.timeout;
    default:
      return undefined;
  }
}

/**
 * What a check saves about a page it couldn't read: the code, worded when it's shown, and its English
 * words for the report and diagnostics, which stay in English.
 */
export function problemFields(problem: RemoteProblem): Pick<RemoteInfo, 'problem' | 'error'> {
  return { problem, error: inEnglish((m) => describeProblem(problem, m) ?? '') };
}
