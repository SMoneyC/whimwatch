/** The GitHub repository: project links, the community catalog and the new-version notice. */
export const REPO_SLUG = 'forthewhimsy/whimwatch';

/**
 * Reverse-DNS app id (Windows notifications and shortcuts, macOS bundle id). Must match appId in
 * electron-builder.yml, and must not change after the first release.
 */
export const APP_ID = 'io.github.forthewhimsy.whimwatch';

export const repoUrl = (): string => `https://github.com/${REPO_SLUG}`;

/** The README on GitHub: installing, how checks and updates work, privacy, troubleshooting. */
export const docsUrl = (): string => `${repoUrl()}#readme`;

/** The issue forms in .github/ISSUE_TEMPLATE. */
export type IssueForm = 'bug_report' | 'site_changed' | 'creator_link' | 'feature_request';

/**
 * A new issue on the given form. `fields` pre-fill form inputs by id; only ever pass harmless values
 * (like the app version), since the address ends up in browser history.
 */
export const newIssueUrl = (form: IssueForm, fields: Record<string, string> = {}): string =>
  `${repoUrl()}/issues/new?${new URLSearchParams({ template: `${form}.yml`, ...fields })}`;

/** Private vulnerability reports (SECURITY.md). */
export const securityReportUrl = (): string => `${repoUrl()}/security/advisories/new`;

/** Where people can support development (Settings → Help & about, README, the repository's Sponsor button). */
export const SUPPORT_URL = 'https://buymeacoffee.com/forthewhimsy';

export const overridesUrl = (): string => `https://raw.githubusercontent.com/${REPO_SLUG}/main/catalog/overrides.json`;
