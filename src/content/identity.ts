import type { PageIdentity } from '../shared/types';
import { acceptCanonical, normalizeUrl, siteOf } from '../shared/url';

/** Cheap page identity: a canonical link lookup plus URL normalization, no text traversal. */
export function computeIdentity(doc: Document = document): PageIdentity | null {
  const href = doc.location?.href ?? '';
  const locationUrl = normalizeUrl(href);
  if (!locationUrl) return null;

  let canonicalUrl = locationUrl;
  const link = doc.querySelector<HTMLLinkElement>('link[rel~="canonical" i][href]');
  if (link?.href && acceptCanonical(link.href, href)) canonicalUrl = normalizeUrl(link.href) ?? locationUrl;

  const hostname = new URL(canonicalUrl).hostname;
  return { canonicalUrl, locationUrl, hostname, site: siteOf(hostname), title: pageTitle(doc, canonicalUrl) };
}

function pageTitle(doc: Document, url: string): string {
  const title = doc.title.replace(/\s+/g, ' ').trim();
  if (title) return title;
  const ogTitle = doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content?.trim();
  if (ogTitle) return ogTitle;
  const { hostname, pathname } = new URL(url);
  return pathname === '/' ? hostname : hostname + pathname;
}
