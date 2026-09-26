import type { ColorId } from '../shared/colors';
import { fold, parseQuery } from '../shared/fold';
import { MAX_GROUP_NAME_LENGTH, MAX_NOTE_LENGTH } from '../shared/limits';
import type {
  Group,
  GroupSummary,
  Highlight,
  HighlightPatch,
  HighlightWithPage,
  Page,
  PageIdentity,
  SiteSummary,
  TextAnchor,
} from '../shared/types';
import { get, getAll, promisify, transaction } from './db';

const now = () => Date.now();
const newId = () => crypto.randomUUID();
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

// ── Pages ──────────────────────────────────────────────────────────────────

export async function findPageByUrls(tx: IDBTransaction, urls: string[]): Promise<Page | undefined> {
  const index = tx.objectStore('pages').index('urls');
  for (const url of unique(urls)) {
    const page = (await promisify(index.get(url))) as Page | undefined;
    if (page) return page;
  }
  return undefined;
}

function highlightsOf(tx: IDBTransaction, pageId: string): Promise<Highlight[]> {
  return promisify(tx.objectStore('highlights').index('pageId').getAll(pageId)) as Promise<Highlight[]>;
}

function countHighlights(tx: IDBTransaction, pageId: string): Promise<number> {
  return promisify(tx.objectStore('highlights').index('pageId').count(pageId));
}

/** Page and highlights stored for a page identity, or null when it has none. */
export async function lookupPage(identity: PageIdentity): Promise<{ page: Page; highlights: Highlight[] } | null> {
  return transaction(['pages', 'highlights'], 'readonly', async (tx) => {
    const page = await findPageByUrls(tx, [identity.canonicalUrl, identity.locationUrl]);
    if (!page) return null;
    const highlights = await highlightsOf(tx, page.id);
    return highlights.length ? { page, highlights } : null;
  });
}

export async function touchPage(pageId: string): Promise<void> {
  await transaction(['pages'], 'readwrite', async (tx) => {
    const page = await get<Page>(tx, 'pages', pageId);
    if (!page) return;
    page.lastVisitedAt = now();
    tx.objectStore('pages').put(page);
  });
}

export async function getPage(pageId: string): Promise<Page | undefined> {
  return transaction(['pages'], 'readonly', (tx) => get<Page>(tx, 'pages', pageId));
}

export async function pageWithHighlights(pageId: string): Promise<{ page: Page | null; highlights: Highlight[] }> {
  return transaction(['pages', 'highlights'], 'readonly', async (tx) => {
    const page = await get<Page>(tx, 'pages', pageId);
    if (!page) return { page: null, highlights: [] };
    const highlights = await highlightsOf(tx, pageId);
    highlights.sort((a, b) => a.anchor.start - b.anchor.start);
    return { page, highlights };
  });
}

export async function listSites(): Promise<SiteSummary[]> {
  const pages = await transaction(['pages'], 'readonly', (tx) => getAll<Page>(tx, 'pages'));
  const sites = new Map<string, SiteSummary>();
  for (const page of pages) {
    const summary = sites.get(page.site) ?? {
      site: page.site,
      pageCount: 0,
      highlightCount: 0,
      updatedAt: 0,
      sampleUrl: page.url,
    };
    summary.pageCount++;
    summary.highlightCount += page.highlightCount;
    if (page.updatedAt > summary.updatedAt) {
      summary.updatedAt = page.updatedAt;
      summary.sampleUrl = page.url;
    }
    sites.set(page.site, summary);
  }
  return [...sites.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listPages(site: string): Promise<Page[]> {
  const pages = await transaction(['pages'], 'readonly', (tx) =>
    promisify(tx.objectStore('pages').index('site').getAll(site)) as Promise<Page[]>,
  );
  return pages.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Deletes a page and all its highlights; returns the deleted page, if it existed. */
export async function deletePage(pageId: string): Promise<Page | undefined> {
  return transaction(['pages', 'highlights'], 'readwrite', async (tx) => {
    const page = await get<Page>(tx, 'pages', pageId);
    const keys = await promisify(tx.objectStore('highlights').index('pageId').getAllKeys(pageId));
    for (const key of keys) tx.objectStore('highlights').delete(key);
    tx.objectStore('pages').delete(pageId);
    return page;
  });
}

// ── Highlights ─────────────────────────────────────────────────────────────

export async function getHighlight(id: string): Promise<Highlight | undefined> {
  return transaction(['highlights'], 'readonly', (tx) => get<Highlight>(tx, 'highlights', id));
}

export async function createHighlight(input: {
  identity: PageIdentity;
  fingerprint: string;
  anchor: TextAnchor;
  color: ColorId;
}): Promise<{ highlight: Highlight; page: Page }> {
  return transaction(['pages', 'highlights'], 'readwrite', async (tx) => {
    const { identity } = input;
    const time = now();
    let page = await findPageByUrls(tx, [identity.canonicalUrl, identity.locationUrl]);
    if (!page) {
      page = {
        id: newId(),
        canonicalUrl: identity.canonicalUrl,
        urls: unique([identity.canonicalUrl, identity.locationUrl]),
        url: identity.locationUrl,
        hostname: identity.hostname,
        site: identity.site,
        title: identity.title,
        contentFingerprint: input.fingerprint,
        highlightCount: 0,
        createdAt: time,
        updatedAt: time,
        lastVisitedAt: time,
      };
    } else {
      page.urls = unique([...page.urls, identity.canonicalUrl, identity.locationUrl]);
      if (identity.title) page.title = identity.title;
      page.contentFingerprint = input.fingerprint;
      page.updatedAt = time;
      page.lastVisitedAt = time;
    }

    const highlight: Highlight = {
      id: newId(),
      pageId: page.id,
      anchor: input.anchor,
      color: input.color,
      createdAt: time,
      updatedAt: time,
    };
    tx.objectStore('highlights').put(highlight);
    page.highlightCount = await countHighlights(tx, page.id);
    tx.objectStore('pages').put(page);
    return { highlight, page };
  });
}

export async function updateHighlight(
  id: string,
  patch: HighlightPatch,
): Promise<{ highlight: Highlight; page: Page }> {
  return transaction(['pages', 'highlights', 'groups'], 'readwrite', async (tx) => {
    const highlight = await get<Highlight>(tx, 'highlights', id);
    if (!highlight) throw new Error('This highlight no longer exists');
    if (patch.color !== undefined) highlight.color = patch.color;
    if (patch.note !== undefined) {
      const note = patch.note.trim().slice(0, MAX_NOTE_LENGTH);
      if (note) highlight.note = note;
      else delete highlight.note;
    }
    if (patch.groupId !== undefined) {
      if (patch.groupId === null) {
        delete highlight.groupId;
      } else {
        const group = await get<Group>(tx, 'groups', patch.groupId);
        if (!group) throw new Error('This group no longer exists');
        highlight.groupId = group.id;
      }
    }
    highlight.updatedAt = now();
    tx.objectStore('highlights').put(highlight);

    const page = await get<Page>(tx, 'pages', highlight.pageId);
    if (!page) throw new Error('The page of this highlight no longer exists');
    page.updatedAt = highlight.updatedAt;
    tx.objectStore('pages').put(page);
    return { highlight, page };
  });
}

/** Deletes a highlight; the page record goes too once it has no highlights left. */
export async function deleteHighlight(
  id: string,
): Promise<{ highlight: Highlight; page: Page | undefined; pageDeleted: boolean } | null> {
  return transaction(['pages', 'highlights'], 'readwrite', async (tx) => {
    const highlight = await get<Highlight>(tx, 'highlights', id);
    if (!highlight) return null;
    tx.objectStore('highlights').delete(id);
    const page = await get<Page>(tx, 'pages', highlight.pageId);
    if (!page) return { highlight, page, pageDeleted: false };
    page.highlightCount = await countHighlights(tx, page.id);
    if (page.highlightCount === 0) {
      tx.objectStore('pages').delete(page.id);
      return { highlight, page, pageDeleted: true };
    }
    page.updatedAt = now();
    tx.objectStore('pages').put(page);
    return { highlight, page, pageDeleted: false };
  });
}

async function withPages(tx: IDBTransaction, highlights: Highlight[]): Promise<HighlightWithPage[]> {
  const pages = new Map<string, Page | undefined>();
  const items: HighlightWithPage[] = [];
  for (const highlight of highlights) {
    if (!pages.has(highlight.pageId)) pages.set(highlight.pageId, await get<Page>(tx, 'pages', highlight.pageId));
    const page = pages.get(highlight.pageId);
    if (page) items.push({ highlight, page });
  }
  return items;
}

export async function recentHighlights(limit: number): Promise<HighlightWithPage[]> {
  return transaction(['pages', 'highlights'], 'readonly', async (tx) => {
    const highlights: Highlight[] = [];
    const index = tx.objectStore('highlights').index('createdAt');
    await new Promise<void>((resolve, reject) => {
      const cursorRequest = index.openCursor(null, 'prev');
      cursorRequest.onerror = () => reject(cursorRequest.error);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || highlights.length >= limit) {
          resolve();
          return;
        }
        highlights.push(cursor.value as Highlight);
        cursor.continue();
      };
    });
    return withPages(tx, highlights);
  });
}

// ── Search ─────────────────────────────────────────────────────────────────

const foldedCache = new Map<string, { key: string; folded: string }>();

function searchableText(highlight: Highlight, page: Page, groupName: string): string {
  const key = `${highlight.updatedAt}\u0000${page.title}\u0000${page.site}\u0000${groupName}`;
  const cached = foldedCache.get(highlight.id);
  if (cached?.key === key) return cached.folded;
  const folded = fold([highlight.anchor.exact, highlight.note ?? '', page.title, page.site, groupName].join('\n'));
  foldedCache.set(highlight.id, { key, folded });
  return folded;
}

/** Every query term (case/accent-insensitive) must appear in the quote, note, page title, site or group. */
export async function search(query: string, limit: number): Promise<{ items: HighlightWithPage[]; total: number }> {
  const terms = parseQuery(query);
  if (!terms.length) return { items: [], total: 0 };
  const { pages, highlights, groups } = await transaction(['pages', 'highlights', 'groups'], 'readonly', async (tx) => ({
    pages: await getAll<Page>(tx, 'pages'),
    highlights: await getAll<Highlight>(tx, 'highlights'),
    groups: await getAll<Group>(tx, 'groups'),
  }));
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const items: HighlightWithPage[] = [];
  for (const highlight of highlights) {
    const page = pageById.get(highlight.pageId);
    if (!page) continue;
    const text = searchableText(highlight, page, highlight.groupId ? groupNames.get(highlight.groupId) ?? '' : '');
    if (terms.every((term) => text.includes(term))) items.push({ highlight, page });
  }
  items.sort((a, b) => b.highlight.createdAt - a.highlight.createdAt);
  return { items: items.slice(0, limit), total: items.length };
}

// ── Groups ─────────────────────────────────────────────────────────────────

function cleanGroupName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_GROUP_NAME_LENGTH);
  if (!clean) throw new Error('Group names cannot be empty');
  return clean;
}

export async function listGroups(): Promise<GroupSummary[]> {
  return transaction(['groups', 'highlights'], 'readonly', async (tx) => {
    const groups = await getAll<Group>(tx, 'groups');
    const index = tx.objectStore('highlights').index('groupId');
    const summaries: GroupSummary[] = [];
    for (const group of groups) summaries.push({ group, count: await promisify(index.count(group.id)) });
    return summaries.sort((a, b) => a.group.name.localeCompare(b.group.name, undefined, { sensitivity: 'base' }));
  });
}

/** Creates a group, or returns the existing one with the same name (case-insensitive). */
export async function createGroup(name: string): Promise<Group> {
  const clean = cleanGroupName(name);
  return transaction(['groups'], 'readwrite', async (tx) => {
    const groups = await getAll<Group>(tx, 'groups');
    const existing = groups.find((group) => fold(group.name) === fold(clean));
    if (existing) return existing;
    const time = now();
    const group: Group = { id: newId(), name: clean, createdAt: time, updatedAt: time };
    tx.objectStore('groups').put(group);
    return group;
  });
}

export async function renameGroup(id: string, name: string): Promise<Group> {
  const clean = cleanGroupName(name);
  return transaction(['groups'], 'readwrite', async (tx) => {
    const group = await get<Group>(tx, 'groups', id);
    if (!group) throw new Error('This group no longer exists');
    group.name = clean;
    group.updatedAt = now();
    tx.objectStore('groups').put(group);
    return group;
  });
}

/** Deletes a group; its highlights stay, ungrouped. */
export async function deleteGroup(id: string): Promise<void> {
  await transaction(['groups', 'highlights'], 'readwrite', async (tx) => {
    const store = tx.objectStore('highlights');
    const members = (await promisify(store.index('groupId').getAll(id))) as Highlight[];
    for (const highlight of members) {
      delete highlight.groupId;
      store.put(highlight);
    }
    tx.objectStore('groups').delete(id);
  });
}

export async function groupHighlights(groupId: string): Promise<{ group: Group | null; items: HighlightWithPage[] }> {
  return transaction(['groups', 'highlights', 'pages'], 'readonly', async (tx) => {
    const group = (await get<Group>(tx, 'groups', groupId)) ?? null;
    const highlights = (await promisify(tx.objectStore('highlights').index('groupId').getAll(groupId))) as Highlight[];
    highlights.sort((a, b) => b.createdAt - a.createdAt);
    return { group, items: await withPages(tx, highlights) };
  });
}
