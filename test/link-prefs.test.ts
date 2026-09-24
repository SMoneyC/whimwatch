import { describe, expect, it } from 'vitest';
import type { CreatorLinkPrefs } from '../src/core/check.js';
import { removeLink, restoreLink } from '../src/core/link-prefs.js';

const added = 'https://www.loverslab.com/files/file/3528-moonberry-thornwood/';
const found = 'https://wicked.cc/animations/moonberry/juniper-petal';

describe('removing a page and showing it again', () => {
  it('adds a page the user had added back, since no check would find it', () => {
    const prefs: CreatorLinkPrefs = { rejected: [], manual: [added] };
    expect(removeLink(prefs, added)).toBe(true);
    expect(prefs).toEqual({ rejected: [added], manual: [], rejectedManual: [added] });

    // "Show again", long after the toast: matched in another address form.
    restoreLink(prefs, 'https://loverslab.com/files/file/3528-moonberry-thornwood');
    expect(prefs).toEqual({ rejected: [], manual: [added] });
  });

  it('leaves a page the check found to be found again', () => {
    const prefs: CreatorLinkPrefs = { rejected: [], manual: [] };
    expect(removeLink(prefs, found)).toBe(false);
    restoreLink(prefs, found);
    expect(prefs).toEqual({ rejected: [], manual: [] });
  });
});
