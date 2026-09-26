const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid',
  'li_fat_id', 'igshid', 'igsh', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'mkt_tok',
  'oly_anon_id', 'oly_enc_id', 'vero_id', 'vero_conv', '_ga', '_gl', '_openstat',
  'wickedid', 'rb_clickid', 's_cid', 'ncid', 'sr_share', 'ref_src', 'ref_url', 'cmpid',
]);

export function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  return key.startsWith('utm_') || TRACKING_PARAMS.has(key);
}

/**
 * Normalizes an http(s) URL into a stable page identity:
 * no credentials, no tracking parameters, sorted query, and no fragment
 * unless it looks like a client-side route (`#/…` or `#!…`).
 */
export function normalizeUrl(input: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.username = '';
  url.password = '';
  if (url.hostname.endsWith('.')) url.hostname = url.hostname.slice(0, -1);

  const kept = [...url.searchParams].filter(([name]) => !isTrackingParam(name));
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = kept.length ? `?${new URLSearchParams(kept).toString()}` : '';

  if (!/^#[!/]/.test(url.hash)) url.hash = '';
  return url.href;
}

/** Grouping key for a hostname: "www.hwupgrade.it" → "hwupgrade.it". */
export function siteOf(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\d*\./, '');
}

/** Prefixes that mark a variant of a site rather than a different site. */
const VARIANT_PREFIX = /^(?:www\d*|m|amp|mobile)\./;

function withoutVariant(hostname: string): string {
  const host = hostname.toLowerCase();
  const stripped = host.replace(VARIANT_PREFIX, '');
  // "m.dev" and "amp.dev" are sites of their own, not variants of "dev".
  return stripped.includes('.') ? stripped : host;
}

/**
 * True when two hostnames are variants of one site ("www.x.com", "m.x.com", "x.com"). Any other
 * subdomain is a different site: a page on "blog.x.com" must never claim pages of "www.x.com".
 */
export function isSameSite(a: string, b: string): boolean {
  return withoutVariant(a) === withoutVariant(b);
}

/**
 * Validates a `<link rel="canonical">` target against the current location.
 * Rejects cross-site canonicals and the common "every page points at the homepage" misconfiguration.
 */
export function acceptCanonical(canonicalHref: string, locationHref: string): boolean {
  let canonical: URL;
  let location: URL;
  try {
    canonical = new URL(canonicalHref);
    location = new URL(locationHref);
  } catch {
    return false;
  }
  if (canonical.protocol !== 'http:' && canonical.protocol !== 'https:') return false;
  if (!isSameSite(canonical.hostname, location.hostname)) return false;
  const canonicalPath = canonical.pathname.replace(/\/+$/, '');
  const locationPath = location.pathname.replace(/\/+$/, '');
  if (canonicalPath === '' && locationPath !== '') return false;
  return true;
}
