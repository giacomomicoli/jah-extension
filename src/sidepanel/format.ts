import { ext } from '../shared/ext';

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600_000],
  ['month', 30 * 24 * 3600_000],
  ['week', 7 * 24 * 3600_000],
  ['day', 24 * 3600_000],
  ['hour', 3600_000],
  ['minute', 60_000],
];

export function timeAgo(time: number, now = Date.now()): string {
  if (!Number.isFinite(time)) return '';
  const diff = time - now;
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return relative.format(Math.round(diff / size), unit);
  }
  return 'just now';
}

/** ISO date for `<time datetime>`, or null for timestamps a Date cannot represent. */
export function isoDate(time: number): string | null {
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function fullDate(time: number): string {
  return new Date(time).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "hwupgrade.it/news/…" without scheme, "www." or trailing slash. */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return (parsed.hostname.replace(/^www\./, '') + parsed.pathname + parsed.search).replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** Chrome's favicon cache (needs the "favicon" permission). Firefox offers extensions none. */
export function faviconUrl(pageUrl: string, size = 32): string | undefined {
  if (__BROWSER__ === 'firefox') return undefined;
  const url = new URL(ext.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(size));
  return url.href;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
