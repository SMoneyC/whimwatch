import { BrowserUnavailableError, isChallengePage, VerificationRequiredError } from '../fetcher.js';
import type { SourceChecker } from './types.js';
import { parseDate, patreonVanity } from './urls.js';

export interface PatreonPost {
  id: string;
  title: string;
  publishedAt?: number;
  viewable: boolean;
  url?: string;
}

export function parseCampaignId(html: string): string | undefined {
  return (
    /"campaign":\{"data":\{"id":"(\d+)"/.exec(html)?.[1] ??
    /"id":"(\d+)","type":"campaign"/.exec(html)?.[1] ??
    /\/campaigns?\/(\d{4,})/.exec(html)?.[1]
  );
}

export function postsApiUrl(campaignId: string, count = 10): string {
  const params = new URLSearchParams({
    'filter[campaign_id]': campaignId,
    'filter[contains_exclusive_posts]': 'true',
    sort: '-published_at',
    'page[count]': String(count),
    'fields[post]': 'title,published_at,current_user_can_view,url,post_type',
  });
  return `https://www.patreon.com/api/posts?${params}`;
}

export function parsePosts(json: string): PatreonPost[] {
  const doc = JSON.parse(json) as { data?: { id: string; attributes?: Record<string, unknown> }[] };
  return (doc.data ?? []).map((p) => {
    const a = p.attributes ?? {};
    return {
      id: p.id,
      title: typeof a.title === 'string' ? a.title.trim() : '',
      publishedAt: parseDate(typeof a.published_at === 'string' ? a.published_at : undefined),
      viewable: a.current_user_can_view === true,
      url: typeof a.url === 'string' ? a.url : undefined,
    };
  });
}

const RELEASE_TITLE = /anim|pack|update|release|download|\bv\d|version|\.package|mod\b/i;

/**
 * Newest post that looks like a release. Polls, previews and chatter don't
 * count: a missed release is less annoying than a false "update available".
 */
export function pickReleasePost(posts: PatreonPost[]): PatreonPost | undefined {
  return posts.find((p) => p.publishedAt !== undefined && RELEASE_TITLE.test(p.title));
}

export const checkPatreon: SourceChecker = async (listing, fetcher) => {
  if (!fetcher.browserGet || !fetcher.browserFetch) throw new BrowserUnavailableError('Patreon');
  const vanity = patreonVanity(listing.url);
  if (!vanity) return { status: 'error', error: 'Not a creator page' };
  const pageUrl = `https://www.patreon.com/${vanity}`;
  const page = await fetcher.browserGet(pageUrl);
  if (isChallengePage(page.body)) throw new VerificationRequiredError('Patreon');
  if (page.status === 404) return { status: 'not-found', error: 'Creator not found' };
  const campaignId = parseCampaignId(page.body);
  // Deleted or renamed creator pages render a generic page without a campaign.
  if (!campaignId) return { status: 'not-found', error: 'No Patreon page for this name' };

  const api = await fetcher.browserFetch(pageUrl, postsApiUrl(campaignId));
  if (api.status !== 200) return { status: 'error', error: `Posts API HTTP ${api.status}` };
  const posts = parsePosts(api.body);
  const post = pickReleasePost(posts);
  if (!post) {
    return { status: 'not-found', error: posts.length ? 'No release posts among the latest posts' : 'No posts on this Patreon page' };
  }
  return {
    updatedAt: post.publishedAt,
    title: post.title,
    locked: !post.viewable,
    downloadUrl: post.url,
  };
};

/** A single post, reduced to what downloading needs. */
export interface PatreonPostDetail {
  id: string;
  /** The creator (campaign) the post belongs to. */
  campaignId?: string;
  viewable: boolean;
  publishedAt?: number;
  /** Attached files (not inline images), with when each was uploaded. */
  files: { name: string; url: string; createdAt?: number }[];
  /** Every web address in the post text, from the old HTML or the newer editor's JSON. */
  links: string[];
}

/** How long before a release post a linked post's file may have been uploaded and still count as part of it. */
export const LINKED_FILE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** A release post links to at most this many other posts we'll look at. */
const MAX_LINKED_POSTS = 3;

export function postDetailApiUrl(postId: string): string {
  const params = new URLSearchParams({
    include: 'attachments_media,campaign',
    'fields[post]': 'post_file,content,content_json_string,current_user_can_view,published_at',
    'fields[media]': 'file_name,download_url,created_at',
    'fields[campaign]': 'vanity',
  });
  return `https://www.patreon.com/api/posts/${encodeURIComponent(postId)}?${params}`;
}

/**
 * Post id from either address form: the API's "https://www.patreon.com/LAMABOY/posts/august-168696378" or
 * the short "https://www.patreon.com/posts/download-files-84153874" that post text links use.
 */
export function patreonPostId(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (!/(^|\.)patreon\.com$/.test(u.hostname)) return undefined;
    return /^\/(?:[^/]+\/)?posts\/(?:[^/]*-)?(\d+)\/?$/.exec(u.pathname)?.[1];
  } catch {
    return undefined;
  }
}

/** Web addresses in a post's text. New posts keep it as editor JSON; older ones as HTML. */
export function postLinks(html: unknown, json: unknown): string[] {
  const links: string[] = [];
  if (typeof html === 'string') {
    for (const m of html.matchAll(/href="([^"]+)"/g)) links.push(m[1]!.replace(/&amp;/g, '&'));
  }
  if (typeof json === 'string' && json) {
    const walk = (v: unknown): void => {
      if (typeof v === 'string') {
        if (/^https?:\/\//.test(v)) links.push(v);
      } else if (Array.isArray(v)) {
        v.forEach(walk);
      } else if (v && typeof v === 'object') {
        Object.values(v).forEach(walk);
      }
    };
    try {
      walk(JSON.parse(json));
    } catch {
      for (const m of json.matchAll(/https?:\/\/[^"\s\\]+/g)) links.push(m[0]);
    }
  }
  return [...new Set(links)];
}

export function parsePostDetail(json: string): PatreonPostDetail {
  const doc = JSON.parse(json) as {
    data?: {
      id?: string;
      attributes?: Record<string, unknown>;
      relationships?: { campaign?: { data?: { id?: string } } };
    };
    included?: { type?: string; attributes?: { file_name?: unknown; download_url?: unknown; created_at?: unknown } }[];
  };
  const a = doc.data?.attributes ?? {};
  const postFile = a.post_file as { name?: unknown; url?: unknown } | undefined;
  const attachments = (doc.included ?? [])
    .filter((i) => i.type === 'media')
    .map((i) => ({
      name: typeof i.attributes?.file_name === 'string' ? i.attributes.file_name : '',
      url: typeof i.attributes?.download_url === 'string' ? i.attributes.download_url : '',
      createdAt: parseDate(typeof i.attributes?.created_at === 'string' ? i.attributes.created_at : undefined),
    }));
  if (typeof postFile?.name === 'string' && typeof postFile.url === 'string') attachments.push({ name: postFile.name, url: postFile.url, createdAt: undefined });
  return {
    id: doc.data?.id ?? '',
    campaignId: doc.data?.relationships?.campaign?.data?.id,
    viewable: a.current_user_can_view !== false,
    publishedAt: parseDate(typeof a.published_at === 'string' ? a.published_at : undefined),
    files: attachments.filter((f, i, all) => f.name && f.url && all.findIndex((x) => x.url === f.url) === i),
    links: postLinks(a.content, a.content_json_string),
  };
}

/** Other posts a release post links to, which may hold its files (e.g. one "download files" post updated each release). */
export function linkedPostIds(post: PatreonPostDetail): string[] {
  const ids = post.links.map(patreonPostId).filter((id): id is string => Boolean(id) && id !== post.id);
  return [...new Set(ids)].slice(0, MAX_LINKED_POSTS);
}

/**
 * The files to download for a release post: its own mod or archive attachments or, when it has none, those
 * of posts it links to. Linked posts only count if they belong to the same creator, and only their files
 * uploaded around this release, so links to requirements or other creators' mods aren't installed by mistake.
 */
export function releaseDownloads(release: PatreonPostDetail, linked: PatreonPostDetail[], downloadable: RegExp): { name: string; url: string }[] {
  const own = release.files.filter((f) => downloadable.test(f.name));
  if (own.length || !release.campaignId || release.publishedAt === undefined) return own;
  const since = release.publishedAt - LINKED_FILE_WINDOW_MS;
  const files = linked
    .filter((p) => p.viewable && p.campaignId === release.campaignId)
    .flatMap((p) => p.files.filter((f) => downloadable.test(f.name) && f.createdAt !== undefined && f.createdAt >= since));
  return files.filter((f, i, all) => all.findIndex((x) => x.url === f.url) === i);
}
