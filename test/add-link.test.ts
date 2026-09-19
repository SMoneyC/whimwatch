import { describe, expect, it } from 'vitest';
import { classifyUrl, linkProblem, normalizeUserUrl } from '../src/core/sources/urls.js';

describe('adding a download page', () => {
  it('takes an address pasted without the https:// browsers hide', () => {
    expect(normalizeUserUrl('wicked.cc/animations/moonberry/a-pack')).toBe('https://wicked.cc/animations/moonberry/a-pack');
    expect(classifyUrl(normalizeUserUrl('www.loverslab.com/files/file/12345-a/'))).toBe('loverslab');
    // A port is not a scheme: "wicked.cc:8080/x" reads as scheme "wicked.cc" to the URL parser,
    // which turned a legitimate address away as not a web address.
    expect(normalizeUserUrl('wicked.cc:8080/x')).toBe('https://wicked.cc:8080/x');
    expect(linkProblem('wicked.cc:8080/x')).toBeUndefined();
    // Anything already carrying a scheme is left alone.
    expect(normalizeUserUrl('  https://wicked.cc/x  ')).toBe('https://wicked.cc/x');
  });

  it('says what is wrong with the link, not just what is allowed', () => {
    expect(linkProblem('https://www.loverslab.com/topic/123456-a-thread/')).toContain('not a file page');
    expect(linkProblem('https://www.patreon.com/posts/some-post-12345')).toContain("creator's page");
    expect(linkProblem('https://example.com/whatever')).toContain('example.com');
    expect(linkProblem('not a link at all')).toContain("doesn't look like a web address");
    expect(linkProblem('')).toContain('Paste the address');
  });

  it('turns away a scheme that only looks like one of the three hosts', () => {
    // These parse with hostname wicked.cc, so a hostname-only check lets them through — and
    // canonicalUrl can't strip the scheme afterwards, so they would be stored and later loaded.
    for (const hostile of ['javascript://wicked.cc/%0aalert(document.cookie)', 'data://wicked.cc/x', 'file://wicked.cc/etc/passwd']) {
      expect(classifyUrl(hostile), hostile).toBeUndefined();
      expect(linkProblem(hostile), hostile).toContain('Only web addresses');
    }
    // A host that merely contains or precedes a real one is not that host.
    expect(classifyUrl('https://wicked.cc@evil.com/')).toBeUndefined();
    expect(classifyUrl('https://wicked.cc.evil.com/')).toBeUndefined();
  });

  it('is happy with the three kinds WhimWatch can check', () => {
    for (const ok of ['wicked.cc/animations/moonberry/a-pack', 'https://www.loverslab.com/files/file/12345-a/', 'patreon.com/moonberry']) {
      expect(linkProblem(ok), ok).toBeUndefined();
    }
  });
});
