import { describe, expect, it } from 'vitest';
import type { CreatorLinkPrefs } from '../src/core/check.js';
import { removeLink, restoreLink, unreadLinks } from '../src/core/link-prefs.js';
import { linkKey } from '../src/core/sources/urls.js';
import type { RemoteInfo } from '../src/shared/types.js';

const added = 'https://www.loverslab.com/files/file/3528-moonberry-thornwood/';
const found = 'https://wicked.cc/animations/moonberry/juniper-petal';

describe('removing a page and showing it again', () => {
  it('adds a page the user had added back, since no check would find it', () => {
    const prefs: CreatorLinkPrefs = { rejected: [], manual: [added] };
    expect(removeLink(prefs, added)).toBe(true);
    expect(prefs).toEqual({ rejected: [added], manual: [], rejectedManual: [added] });

    // "Show again", long after the toast: matched in another address form.
    restoreLink(prefs, 'https://loverslab.com/files/file/3528-moonberry-thornwood');
    // Back as one they added, dated now: nothing has read it since it was removed.
    expect(prefs).toEqual({ rejected: [], manual: [added], addedAt: { [linkKey(added)]: expect.any(Number) } });
  });

  it('leaves a page the check found to be found again', () => {
    const prefs: CreatorLinkPrefs = { rejected: [], manual: [] };
    expect(removeLink(prefs, found)).toBe(false);
    restoreLink(prefs, found);
    expect(prefs).toEqual({ rejected: [], manual: [] });
  });
});

describe('telling which added pages are still unread', () => {
  const index = 'https://wicked.cc/animations/moonberry/';
  const page = (url: string): RemoteInfo => ({ listing: { source: 'loverslab', url, origin: 'manual' }, status: 'ok', checkedAt: 0 });
  const prefs = (urls: string[], at: number): CreatorLinkPrefs => ({ rejected: [], manual: urls, addedAt: Object.fromEntries(urls.map((u) => [linkKey(u), at])) });

  it('counts an added index as read once a check has finished since, though it is never a page itself', () => {
    // A check replaces an index with the packs it lists: the index's own address never shows up.
    expect(unreadLinks(prefs([index], 100), [], 50)).toEqual([index]);
    expect(unreadLinks(prefs([index], 100), [], 200)).toEqual([]);
  });

  it('keeps a page unread when the only check since was already running when it was added', () => {
    // Added at 100, during a check that started at 50 (and finished at 200): it planned without the page.
    expect(unreadLinks(prefs([added], 100), [], 50)).toEqual([added]);
  });

  it('forgets when a removed page was added, and dates it afresh when shown again', () => {
    const p = prefs([added], 100);
    removeLink(p, added);
    expect(p.addedAt).toBeUndefined();
    restoreLink(p, added, 300);
    expect(p.addedAt).toEqual({ [linkKey(added)]: 300 });
  });

  it('counts a page as read when it was kept under another form of its address', () => {
    // Typed with www. and a trailing slash; kept without either.
    expect(unreadLinks(prefs([added], 100), [page('https://loverslab.com/files/file/3528-moonberry-thornwood')], 50)).toEqual([]);
  });

  it("keeps a page unread while it isn't among the pages and no check has run since", () => {
    expect(unreadLinks(prefs([added, found], 100), [page(found)], 50)).toEqual([added]);
    // Added before add times were kept: unread until it is read.
    expect(unreadLinks({ rejected: [], manual: [added] }, [], 500)).toEqual([added]);
  });
});
