import { describe, expect, it } from 'vitest';
import { isChallengePage } from '../src/core/fetcher.js';
import { checkLoversLab, chooserFor, parseDownloadChooser, parseLoversLabFile } from '../src/core/sources/loverslab.js';
import { formatVersion } from '../src/shared/version.js';
import {
  linkedPostIds,
  parseCampaignId,
  parsePostDetail,
  parsePosts,
  patreonPostId,
  pickReleasePost,
  postLinks,
  postsApiUrl,
  releaseDownloads,
} from '../src/core/sources/patreon.js';
import { DOWNLOADABLE, singleExternalLink } from '../src/core/downloads.js';
import { canonicalUrl, classifyUrl, linkKey, parseDate, patreonVanity } from '../src/core/sources/urls.js';
import { parseCreatorIndex, parseWickedCcPage } from '../src/core/sources/wickedcc.js';
import { parseWwModPage } from '../src/core/sources/wwmod.js';
import { metaRefreshTarget } from '../src/core/sources/html.js';
import * as pages from './fixtures/pages.js';

describe('wickedwhimsmod.com download page', () => {
  const page = parseWwModPage(pages.WWMOD_DOWNLOAD);

  it('reads the core version, date and game version', () => {
    expect(page.version).toBe('185k');
    expect(page.releasedAt).toBe(Date.UTC(2026, 4, 23));
    expect(page.gameVersions).toBe('1.127.41 (August 25)');
    expect(page.supportedGameVersions).toEqual(['1.127.41', '1.126.78', '1.125.59', '1.124.63']);
    expect(page.coreLinks).toEqual(['https://wicked.cc/mods/admin/wickedwhims/', 'https://turbodriver.itch.io/wickedwhims']);
  });

  it('reads artist boxes with sections and supported links', () => {
    expect(page.directory).toEqual([
      {
        name: 'Moonberry',
        section: 'Honorary Animators (Compatible)',
        links: [
          { source: 'wickedcc', url: 'https://wicked.cc/animations/moonberry/sex-animations/', origin: 'directory' },
          { source: 'loverslab', url: 'https://www.loverslab.com/files/file/3528-moonberry-animations/', origin: 'directory' },
        ],
      },
      {
        name: 'Willow Bank',
        section: 'Inactive Animators (Compatible)',
        links: [{ source: 'loverslab', url: 'https://www.loverslab.com/files/file/8755-willows-animations/', origin: 'directory' }],
      },
      {
        name: 'Moonberry',
        item: 'Bondage Devices',
        section: 'Devices & Accessories (Optional)',
        links: [{ source: 'loverslab', url: 'https://www.loverslab.com/files/file/3527-bondage-devices/', origin: 'directory' }],
      },
    ]);
  });
});

describe('wicked.cc', () => {
  it('parses a pack page', () => {
    const page = parseWickedCcPage(pages.WICKEDCC_PACK, 'https://wicked.cc/animations/tester/testers-animations/');
    expect(page).toEqual({
      title: "Tester's Animations",
      author: 'Tester',
      updatedAt: Date.parse('2026-08-28T12:04:47Z'),
      publishedAt: Date.parse('2024-01-26T00:00:00Z'),
      version: undefined,
      downloadUrl: 'https://wicked.cc/animations/tester/testers-animations/download/AbC123',
      patreonLinks: ['https://www.patreon.com/tester'],
    });
  });

  it('lists packs on a creator index page', () => {
    expect(parseCreatorIndex(pages.WICKEDCC_CREATOR_INDEX, '/animations/tester/')).toEqual([
      'https://wicked.cc/animations/tester/testers-animations',
    ]);
  });

  it('finds meta refresh redirects', () => {
    expect(metaRefreshTarget(pages.WICKEDCC_REDIRECT, 'https://wicked.cc/mods/admin/wickedwhims/')).toBe(
      'https://wicked.cc/mods/TURBODRIVER/wickedwhims',
    );
  });
});

describe('LoversLab', () => {
  it('reads version, date, author and Patreon links from JSON-LD', () => {
    expect(parseLoversLabFile(pages.LOVERSLAB_FILE)).toEqual({
      title: 'Tester Adult Animations',
      author: 'Tester',
      version: '2.6',
      updatedAt: Date.parse('2024-04-10T21:52:40Z'),
      publishedAt: undefined,
      patreonLinks: ['https://www.patreon.com/Tester'],
      chooserUrl: undefined,
    });
  });

  it('tells a download button that opens the file list from one that downloads the file', () => {
    expect(parseLoversLabFile(pages.LOVERSLAB_FILE_SEVERAL).chooserUrl).toBe('https://www.loverslab.com/files/file/3528-moonberry-animations/?do=download');
    // One file: the button is the download, which a check must never follow.
    expect(parseLoversLabFile(pages.LOVERSLAB_FILE_SINGLE).chooserUrl).toBeUndefined();
  });

  it('follows a file list only on LoversLab itself, over https, for the same file', () => {
    const page = 'https://www.loverslab.com/files/file/3528-moonberry-animations/';
    expect(chooserFor('/files/file/3528-moonberry-animations/?do=download', page, page)).toBe(`${page}?do=download`);
    for (const href of [
      'https://other.example/files/file/3528-x/?do=download',
      'https://loverslab.com.evil.example/files/file/3528-x/?do=download',
      'http://www.loverslab.com/files/file/3528-x/?do=download',
      'https://www.loverslab.com/files/file/9999-other/?do=download',
      'https://[not an address',
    ]) {
      expect(chooserFor(href, page, page), href).toBeUndefined();
    }
  });

  it("reads each file's own date from the file list", () => {
    expect(parseDownloadChooser(pages.LOVERSLAB_CHOOSER_DATED, 'https://www.loverslab.com/files/file/3528-moonberry-animations/').map(({ name, updatedAt }) => ({ name, updatedAt }))).toEqual([
      { name: 'WW_Moonberry_Animations.package', updatedAt: Date.parse('2026-07-30T13:30:28Z') },
      { name: 'WW_Moonberry_Juniper_Petal.package', updatedAt: Date.parse('2026-09-11T11:55:39Z') },
    ]);
  });

  it('lists every file on the download chooser', () => {
    expect(parseDownloadChooser(pages.LOVERSLAB_CHOOSER, 'https://www.loverslab.com/files/file/29320-0rchid/')).toEqual([
      { href: 'https://www.loverslab.com/files/file/29320-0rchid/?do=download&r=1001&confirm=1&t=1&csrfKey=abc', name: 'WW_0rchid_SpecialGift_Animations.package' },
      { href: 'https://www.loverslab.com/files/file/29320-0rchid/?do=download&r=1002&confirm=1&t=1&csrfKey=abc', name: 'WW_0rchid_Animations.package' },
      { href: 'https://www.loverslab.com/files/file/29320-0rchid/?do=download&r=1003&confirm=1&t=1&csrfKey=abc', name: 'preview.jpg' },
    ]);
  });

  it('rejects a page for a different file id', async () => {
    const listing = { source: 'loverslab' as const, url: 'https://www.loverslab.com/files/file/3528-old-slug/', origin: 'directory' as const };
    const respond = (url: string) => async () => ({ status: 200, url, body: pages.LOVERSLAB_FILE, headers: {} });
    const unused = async () => ({ status: 500, url: '', body: '', headers: {} });

    const renamed = await checkLoversLab(listing, { get: unused, head: unused, browserGet: respond('https://www.loverslab.com/files/file/3528-new-slug/') });
    expect(renamed.version).toBe('2.6');

    const other = await checkLoversLab(listing, { get: unused, head: unused, browserGet: respond('https://www.loverslab.com/files/file/28988-someone-else/') });
    expect(other).toMatchObject({ status: 'error', problem: { code: 'different-page' }, error: 'LoversLab showed a different page' });
  });

  it('recognizes Cloudflare challenge pages', () => {
    expect(isChallengePage(pages.CHALLENGE)).toBe(true);
    // Not every challenge says "Just a moment"; a challenge read as a real page checks out as nonsense.
    expect(isChallengePage(pages.CHALLENGE_UNTITLED)).toBe(true);
    expect(isChallengePage(pages.LOVERSLAB_FILE)).toBe(false);
    // Cloudflare puts its detection script on ordinary pages: reading that as a challenge would
    // stop every check and ask the user to verify for nothing.
    expect(isChallengePage(pages.PATREON_WITH_CF_SCRIPT)).toBe(false);
    expect(isChallengePage(pages.PATREON_PAGE)).toBe(false);
  });
});

describe('Patreon', () => {
  it('finds the campaign id', () => {
    expect(parseCampaignId(pages.PATREON_PAGE)).toBe('10577235');
  });

  it('prefers the newest release-like post over polls', () => {
    const post = pickReleasePost(parsePosts(pages.PATREON_POSTS));
    expect(post).toMatchObject({ id: '2', viewable: false, publishedAt: Date.parse('2026-09-05T15:58:19Z') });
  });

  it('ignores posts that do not look like releases', () => {
    const posts = parsePosts(pages.PATREON_POSTS).filter((p) => p.id === '3');
    expect(pickReleasePost(posts)).toBeUndefined();
  });

  // Shaped like the real API: the release post has only preview GIFs, and its editor-JSON text links to a
  // long-lived "download files" post whose attachment is swapped each release. Names and ids are made up.
  const editorText = (...hrefs: string[]): string =>
    JSON.stringify({
      type: 'doc',
      content: hrefs.map((href) => ({ type: 'paragraph', content: [{ type: 'text', text: 'here', marks: [{ type: 'link', attrs: { href } }] }] })),
    });
  const post = (id: string, campaign: string, published: string, files: [string, string][], text = ''): string =>
    JSON.stringify({
      data: {
        id,
        type: 'post',
        attributes: { current_user_can_view: true, published_at: published, content: null, content_json_string: text, post_file: { url: 'https://c10.patreonusercontent.com/header' } },
        relationships: { campaign: { data: { id: campaign, type: 'campaign' } } },
      },
      included: [
        { type: 'campaign', id: campaign, attributes: { vanity: 'Someone' } },
        ...files.map(([name, created], i) => ({ type: 'media', id: `${id}${i}`, attributes: { file_name: name, created_at: created, download_url: `https://c10.patreonusercontent.com/${id}/${i}` } })),
      ],
    });

  const release = parsePostDetail(
    post('900', '77', '2026-09-05T15:58:00Z', [['preview01.gif', '2026-09-05T15:35:00Z']], editorText('https://www.patreon.com/posts/download-files-500', 'https://www.redgifs.com/watch/x')),
  );
  const hub = parsePostDetail(
    post('500', '77', '2023-06-06T13:15:00Z', [['WW_Someone_Animation.package', '2026-09-05T15:49:00Z'], ['old-banner.png', '2023-06-06T12:24:00Z'], ['WW_Someone_Retired.package', '2024-01-02T00:00:00Z']], editorText('https://www.patreon.com/posts/requirement-300')),
  );
  const otherCreator = parsePostDetail(post('300', '12', '2020-07-17T14:17:00Z', [['Requirement.package', '2026-09-05T10:00:00Z']]));

  it('reads a post: attachments with upload times, creator, and links from the editor JSON', () => {
    expect(release).toMatchObject({ id: '900', campaignId: '77', viewable: true, publishedAt: Date.parse('2026-09-05T15:58:00Z') });
    expect(release.files).toEqual([{ name: 'preview01.gif', url: 'https://c10.patreonusercontent.com/900/0', createdAt: Date.parse('2026-09-05T15:35:00Z') }]);
    expect(linkedPostIds(release)).toEqual(['500']);
    expect(postLinks('<p><a href="https://mega.nz/file/abc#key">Mega</a> &amp; more</p>', null)).toEqual(['https://mega.nz/file/abc#key']);
    expect(patreonPostId('https://www.patreon.com/posts/august-animations-168696378')).toBe('168696378');
    // The posts API gives addresses with the creator's name in them.
    expect(patreonPostId('https://www.patreon.com/Someone/posts/august-turn-me-168696378')).toBe('168696378');
    expect(patreonPostId('https://www.patreon.com/posts/84153874/')).toBe('84153874');
    expect(patreonPostId('https://www.patreon.com/Someone/about')).toBeUndefined();
    expect(patreonPostId('https://example.com/posts/1')).toBeUndefined();
  });

  it("downloads the linked post's file uploaded for this release, and nothing from other creators or older uploads", () => {
    expect(releaseDownloads(release, [hub, otherCreator], DOWNLOADABLE)).toEqual([
      { name: 'WW_Someone_Animation.package', url: 'https://c10.patreonusercontent.com/500/0', createdAt: Date.parse('2026-09-05T15:49:00Z') },
    ]);
  });

  it("prefers the release post's own attachments over anything it links to", () => {
    const withFile = parsePostDetail(post('901', '77', '2026-09-05T15:58:00Z', [['WW_Someone_Direct.zip', '2026-09-05T15:40:00Z']], editorText('https://www.patreon.com/posts/500')));
    expect(releaseDownloads(withFile, [hub], DOWNLOADABLE).map((f) => f.name)).toEqual(['WW_Someone_Direct.zip']);
  });

  it('falls back to a single Mega or Drive link, but not to several', () => {
    expect(singleExternalLink(['https://mega.nz/file/a#k', 'https://www.redgifs.com/x'])).toBe('https://mega.nz/file/a#k');
    expect(singleExternalLink(['https://mega.nz/file/a#k', 'https://drive.google.com/file/d/b/view'])).toBeUndefined();
  });

  it('builds a sorted posts API URL', () => {
    const url = new URL(postsApiUrl('42'));
    expect(url.searchParams.get('filter[campaign_id]')).toBe('42');
    expect(url.searchParams.get('sort')).toBe('-published_at');
  });
});

describe('URL helpers', () => {
  it.each([
    ['https://wicked.cc/animations/a/b/', 'wickedcc'],
    ['https://www.loverslab.com/files/file/27388-pineglen/', 'loverslab'],
    ['https://www.loverslab.com/topic/79210-eve-mesh/', undefined],
    ['https://www.patreon.com/PINEGLEN', 'patreon'],
    ['https://www.patreon.com/posts/abc-123', undefined],
    ['https://example.com/', undefined],
  ])('classifies %s', (url, source) => {
    expect(classifyUrl(url)).toBe(source);
  });

  it.each([
    ['https://www.patreon.com/thornwood', 'thornwood'],
    ['https://patreon.com/c/Amberlily', 'Amberlily'],
    ['https://www.patreon.com/cw/Northwind_WW', 'Northwind_WW'],
    ['https://www.patreon.com/PINEGLEN/posts', 'PINEGLEN'],
    ['https://www.patreon.com/join/PINEGLEN?u=1', undefined],
    ['https://www.patreon.com/posts/august-1', undefined],
    ['https://www.patreon.com/user?u=123', undefined],
  ])('extracts the Patreon vanity from %s', (url, vanity) => {
    expect(patreonVanity(url)).toBe(vanity);
  });

  it('parses the date formats the sites use', () => {
    expect(parseDate('2024-04-10T21:52:40+0000')).toBe(Date.parse('2024-04-10T21:52:40Z'));
    expect(parseDate('2026-08-28')).toBe(Date.UTC(2026, 7, 28));
    expect(parseDate('May 23rd, 2026')).toBe(Date.UTC(2026, 4, 23));
    expect(parseDate('August 1st 2025')).toBe(Date.UTC(2025, 7, 1));
    expect(parseDate('soon')).toBeUndefined();
  });

  it('canonicalizes URLs for comparison', () => {
    expect(canonicalUrl('http://www.LoversLab.com/files/file/1-x/#comments')).toBe('https://loverslab.com/files/file/1-x');
  });

  it('gives every address form of a Patreon page the same key', () => {
    const key = linkKey('https://www.patreon.com/SimsLarkspur');
    for (const form of ['https://patreon.com/cw/SimsLarkspur', 'https://www.patreon.com/c/simslarkspur/posts', 'https://www.patreon.com/SimsLarkspur/']) {
      expect(linkKey(form)).toBe(key);
    }
    expect(linkKey('https://www.patreon.com/Thornwood')).not.toBe(key);
    expect(linkKey('http://www.LoversLab.com/files/file/1-x/')).toBe('https://loverslab.com/files/file/1-x');
  });
});

describe('formatVersion', () => {
  it.each([
    ['2.6', 'v2.6'],
    ['v0.1.145', 'v0.1.145'],
    ['185k', 'v185k'],
    ['UPDATED  - 07/08/2023', '“UPDATED  - 07/08/2023”'],
    ['1.3.1 🚨8 new animations🚨 and a very long tail', '“1.3.1 🚨8 new animations🚨 an…”'],
  ])('formats %s', (input, output) => {
    expect(formatVersion(input)).toBe(output);
  });
});
