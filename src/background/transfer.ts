import { DEFAULT_COLOR, isColorId } from '../shared/colors';
import { fold } from '../shared/fold';
import {
  MAX_CONTEXT_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_QUOTE_LENGTH,
  MAX_TIME,
  MAX_TITLE_LENGTH,
} from '../shared/limits';
import type { DomHint, ExportFile, Group, Highlight, ImportStats, Page, TextAnchor } from '../shared/types';
import { normalizeUrl, siteOf } from '../shared/url';
import { get, getAll, promisify, transaction } from './db';
import { findPageByUrls } from './repo';

export async function exportAll(): Promise<ExportFile> {
  const { pages, highlights, groups } = await transaction(['pages', 'highlights', 'groups'], 'readonly', async (tx) => ({
    pages: await getAll<Page>(tx, 'pages'),
    highlights: await getAll<Highlight>(tx, 'highlights'),
    groups: await getAll<Group>(tx, 'groups'),
  }));
  return { format: 'jah-export', version: 1, exportedAt: new Date().toISOString(), pages, highlights, groups };
}

export interface ParsedExport {
  pages: Page[];
  highlights: Highlight[];
  groups: Group[];
  skipped: number;
}

/** Validates an untrusted export file, rebuilding every record from known fields only. */
export function parseExport(data: unknown): ParsedExport {
  if (!isObject(data) || data.format !== 'jah-export' || data.version !== 1) {
    throw new Error('This is not a Just Another Highlighter export file');
  }
  let skipped = 0;
  const collect = <T>(list: unknown, parse: (value: unknown) => T | null): T[] => {
    if (!Array.isArray(list)) return [];
    const result: T[] = [];
    for (const value of list) {
      const parsed = parse(value);
      if (parsed) result.push(parsed);
      else skipped++;
    }
    return result;
  };
  const pages = collect(data.pages, parsePage);
  const groups = collect(data.groups, parseGroup);
  const highlights = collect(data.highlights, parseHighlight);
  return { pages, groups, highlights, skipped };
}

/**
 * Imports an export file. `merge` keeps existing data (newer records win, pages are matched by
 * URL, groups by name); `replace` wipes the knowledge base first.
 */
export async function importAll(data: unknown, mode: 'merge' | 'replace'): Promise<ImportStats> {
  const parsed = parseExport(data);
  return transaction(['pages', 'highlights', 'groups'], 'readwrite', async (tx) => {
    const stats: ImportStats = { pages: 0, highlights: 0, groups: 0, skipped: parsed.skipped };
    const pageStore = tx.objectStore('pages');
    const highlightStore = tx.objectStore('highlights');
    const groupStore = tx.objectStore('groups');

    if (mode === 'replace') {
      pageStore.clear();
      highlightStore.clear();
      groupStore.clear();
    }

    const groupIds = new Map<string, string>();
    const knownGroups = await getAll<Group>(tx, 'groups');
    for (const group of parsed.groups) {
      const sameId = knownGroups.find((known) => known.id === group.id);
      const sameName = knownGroups.find((known) => fold(known.name) === fold(group.name));
      if (sameId) {
        groupIds.set(group.id, sameId.id);
        if (group.updatedAt > sameId.updatedAt) groupStore.put(group);
      } else if (sameName) {
        groupIds.set(group.id, sameName.id);
      } else {
        groupStore.put(group);
        knownGroups.push(group);
        groupIds.set(group.id, group.id);
        stats.groups++;
      }
    }

    const pageIds = new Map<string, string>();
    for (const page of parsed.pages) {
      const existing = (await get<Page>(tx, 'pages', page.id)) ?? (await findPageByUrls(tx, page.urls));
      if (existing) {
        existing.urls = [...new Set([...existing.urls, ...page.urls])];
        existing.createdAt = Math.min(existing.createdAt, page.createdAt);
        existing.updatedAt = Math.max(existing.updatedAt, page.updatedAt);
        existing.lastVisitedAt = Math.max(existing.lastVisitedAt, page.lastVisitedAt);
        if (!existing.title) existing.title = page.title;
        pageStore.put(existing);
        pageIds.set(page.id, existing.id);
      } else {
        pageStore.put({ ...page, highlightCount: 0 });
        pageIds.set(page.id, page.id);
        stats.pages++;
      }
    }

    const touchedPages = new Set<string>();
    for (const highlight of parsed.highlights) {
      const pageId = pageIds.get(highlight.pageId);
      if (!pageId) {
        stats.skipped++;
        continue;
      }
      const existing = await get<Highlight>(tx, 'highlights', highlight.id);
      if (existing && existing.updatedAt >= highlight.updatedAt) continue;
      const record: Highlight = { ...highlight, pageId };
      const groupId = highlight.groupId ? groupIds.get(highlight.groupId) : undefined;
      if (groupId) record.groupId = groupId;
      else delete record.groupId;
      highlightStore.put(record);
      touchedPages.add(pageId);
      if (existing) touchedPages.add(existing.pageId);
      else stats.highlights++;
    }

    for (const pageId of new Set([...touchedPages, ...pageIds.values()])) {
      const page = await get<Page>(tx, 'pages', pageId);
      if (!page) continue;
      page.highlightCount = await promisify(highlightStore.index('pageId').count(pageId));
      if (page.highlightCount === 0) pageStore.delete(pageId);
      else pageStore.put(page);
    }
    return stats;
  });
}

// ── Record validation ──────────────────────────────────────────────────────

type Loose = Record<string, unknown>;

function isObject(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_TIME;
const isOffset = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isShortString = (value: unknown): value is string => isString(value) && value.length <= 64;
const isPath = (value: unknown): value is string => isString(value) && value.length <= 4096;
const timeOr = (value: unknown, fallback: number) => (isTime(value) ? value : fallback);

function parsePage(value: unknown): Page | null {
  if (!isObject(value) || !isString(value.id) || !value.id || !isString(value.canonicalUrl)) return null;
  const canonicalUrl = normalizeUrl(value.canonicalUrl);
  if (!canonicalUrl) return null;
  const urls = [canonicalUrl];
  if (Array.isArray(value.urls)) {
    for (const url of value.urls) {
      const normalized = isString(url) ? normalizeUrl(url) : null;
      if (normalized && !urls.includes(normalized)) urls.push(normalized);
    }
  }
  const url = (isString(value.url) && normalizeUrl(value.url)) || canonicalUrl;
  const hostname = new URL(canonicalUrl).hostname;
  const created = timeOr(value.createdAt, Date.now());
  const updated = timeOr(value.updatedAt, created);
  return {
    id: value.id,
    canonicalUrl,
    urls,
    url,
    hostname,
    site: siteOf(hostname),
    title: isString(value.title) ? value.title.slice(0, MAX_TITLE_LENGTH) : hostname,
    ...(isShortString(value.contentFingerprint) ? { contentFingerprint: value.contentFingerprint } : {}),
    highlightCount: 0,
    createdAt: created,
    updatedAt: updated,
    lastVisitedAt: timeOr(value.lastVisitedAt, updated),
  };
}

/**
 * Validates an anchor from an untrusted source (import file or content script). Context is
 * truncated to the lengths the resolver compares, so crafted data cannot stall it.
 */
export function parseAnchor(value: unknown): TextAnchor | null {
  if (!isObject(value) || !isString(value.exact) || !value.exact || value.exact.length > MAX_QUOTE_LENGTH) return null;
  if (!isString(value.prefix) || !isString(value.suffix) || !isOffset(value.start) || !isOffset(value.end)) return null;
  const anchor: TextAnchor = {
    exact: value.exact,
    prefix: value.prefix.slice(-MAX_CONTEXT_LENGTH),
    suffix: value.suffix.slice(0, MAX_CONTEXT_LENGTH),
    start: value.start,
    end: value.end,
  };
  const hint = value.domHint;
  if (
    isObject(hint) &&
    isPath(hint.startPath) &&
    isPath(hint.endPath) &&
    isOffset(hint.startOffset) &&
    isOffset(hint.endOffset)
  ) {
    const domHint: DomHint = {
      startPath: hint.startPath,
      startOffset: hint.startOffset,
      endPath: hint.endPath,
      endOffset: hint.endOffset,
    };
    anchor.domHint = domHint;
  }
  if (isShortString(value.localFingerprint)) anchor.localFingerprint = value.localFingerprint;
  if (isShortString(value.textFingerprint)) anchor.textFingerprint = value.textFingerprint;
  return anchor;
}

function parseHighlight(value: unknown): Highlight | null {
  if (!isObject(value) || !isString(value.id) || !value.id || !isString(value.pageId)) return null;
  const anchor = parseAnchor(value.anchor);
  if (!anchor) return null;
  const created = timeOr(value.createdAt, Date.now());
  const highlight: Highlight = {
    id: value.id,
    pageId: value.pageId,
    anchor,
    color: isColorId(value.color) ? value.color : DEFAULT_COLOR,
    createdAt: created,
    updatedAt: timeOr(value.updatedAt, created),
  };
  if (isString(value.groupId) && value.groupId) highlight.groupId = value.groupId;
  if (isString(value.note) && value.note.trim()) highlight.note = value.note.trim().slice(0, MAX_NOTE_LENGTH);
  return highlight;
}

function parseGroup(value: unknown): Group | null {
  if (!isObject(value) || !isString(value.id) || !value.id || !isString(value.name)) return null;
  const name = value.name.replace(/\s+/g, ' ').trim().slice(0, MAX_GROUP_NAME_LENGTH);
  if (!name) return null;
  const created = timeOr(value.createdAt, Date.now());
  return { id: value.id, name, createdAt: created, updatedAt: timeOr(value.updatedAt, created) };
}
