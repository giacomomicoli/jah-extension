import { describe, expect, it } from 'vitest';
import { acceptCanonical, isSameSite, normalizeUrl, siteOf } from '../../src/shared/url';

describe('normalizeUrl', () => {
  it('drops tracking parameters and fragments, keeping meaningful parameters', () => {
    expect(normalizeUrl('https://example.com/article?id=42&utm_source=google#comments')).toBe(
      'https://example.com/article?id=42',
    );
    expect(normalizeUrl('https://example.com/article?id=42&utm_source=twitter&fbclid=abc')).toBe(
      'https://example.com/article?id=42',
    );
  });

  it('sorts parameters so their order does not change the identity', () => {
    expect(normalizeUrl('https://example.com/?b=2&a=1')).toBe(normalizeUrl('https://example.com/?a=1&b=2'));
  });

  it('keeps client-side routes in fragments', () => {
    expect(normalizeUrl('https://app.example.com/#/notes/7')).toBe('https://app.example.com/#/notes/7');
    expect(normalizeUrl('https://app.example.com/#!/notes/7')).toBe('https://app.example.com/#!/notes/7');
  });

  it('removes credentials, default ports and trailing dots', () => {
    expect(normalizeUrl('https://user:pw@Example.COM.:443/a')).toBe('https://example.com/a');
  });

  it('rejects non-web URLs', () => {
    expect(normalizeUrl('chrome://extensions')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('sites', () => {
  it('groups hostnames without www', () => {
    expect(siteOf('www.hwupgrade.it')).toBe('hwupgrade.it');
    expect(siteOf('www2.example.com')).toBe('example.com');
    expect(siteOf('multiplayer.it')).toBe('multiplayer.it');
    expect(siteOf('forum.hwupgrade.it')).toBe('forum.hwupgrade.it');
  });

  it('treats subdomains as the same site for canonical validation', () => {
    expect(isSameSite('m.example.com', 'www.example.com')).toBe(true);
    expect(isSameSite('example.com', 'example.org')).toBe(false);
    expect(isSameSite('badexample.com', 'example.com')).toBe(false);
  });
});

describe('acceptCanonical', () => {
  const article = 'https://www.hwupgrade.it/news/cpu/some-article_123.html?utm_source=x';

  it('accepts a same-site canonical', () => {
    expect(acceptCanonical('https://www.hwupgrade.it/news/cpu/some-article_123.html', article)).toBe(true);
    expect(acceptCanonical('https://hwupgrade.it/news/cpu/some-article_123.html', article)).toBe(true);
  });

  it('rejects cross-site canonicals', () => {
    expect(acceptCanonical('https://syndication.example.com/story', article)).toBe(false);
  });

  it('rejects a canonical pointing every article at the homepage', () => {
    expect(acceptCanonical('https://www.hwupgrade.it/', article)).toBe(false);
    expect(acceptCanonical('https://www.hwupgrade.it/', 'https://www.hwupgrade.it/')).toBe(true);
  });
});
