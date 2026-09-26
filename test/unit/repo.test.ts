import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../src/background/repo';
import { exportAll, importAll, parseExport } from '../../src/background/transfer';
import type { ColorId } from '../../src/shared/colors';
import type { PageIdentity, TextAnchor } from '../../src/shared/types';
import { siteOf } from '../../src/shared/url';

function identity(url: string, title = 'A title', locationUrl = url): PageIdentity {
  const hostname = new URL(url).hostname;
  return { canonicalUrl: url, locationUrl, hostname, site: siteOf(hostname), title };
}

function anchor(exact: string): TextAnchor {
  return { exact, prefix: 'before ', suffix: ' after', start: 10, end: 10 + exact.length };
}

function highlight(url: string, exact: string, color: ColorId = 'yellow', title?: string) {
  return repo.createHighlight({ identity: identity(url, title), fingerprint: 'fp', anchor: anchor(exact), color });
}

const HW_A = 'https://www.hwupgrade.it/news/cpu/nuove-cpu_1.html';
const HW_B = 'https://www.hwupgrade.it/news/gpu/nuove-gpu_2.html';
const MP = 'https://multiplayer.it/notizie/un-gioco.html';

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('jah');
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pages and highlights', () => {
  it('creates a page on the first highlight and reuses it, keeping URL aliases', async () => {
    const first = await highlight(HW_A, 'prima frase');
    const second = await repo.createHighlight({
      identity: identity(HW_A, 'Nuove CPU', `${HW_A}?page=2`),
      fingerprint: 'fp2',
      anchor: anchor('seconda frase'),
      color: 'green',
    });
    expect(second.page.id).toBe(first.page.id);
    expect(second.page.highlightCount).toBe(2);
    expect(second.page.site).toBe('hwupgrade.it');
    expect(second.page.title).toBe('Nuove CPU');

    // A later visit that only knows the alias still finds the page.
    const found = await repo.lookupPage(identity('https://www.hwupgrade.it/other', '', `${HW_A}?page=2`));
    expect(found?.page.id).toBe(first.page.id);
    expect(found?.highlights.map((item) => item.anchor.exact).sort()).toEqual(['prima frase', 'seconda frase']);
  });

  it('returns nothing for pages without highlights', async () => {
    expect(await repo.lookupPage(identity('https://example.com/nothing'))).toBeNull();
  });

  it('groups pages by site, most recently updated first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000);
    await highlight(HW_A, 'one');
    vi.setSystemTime(2_000);
    await highlight(HW_B, 'two');
    await highlight(HW_B, 'three');
    vi.setSystemTime(3_000);
    await highlight(MP, 'four');

    const sites = await repo.listSites();
    expect(sites.map((site) => [site.site, site.pageCount, site.highlightCount])).toEqual([
      ['multiplayer.it', 1, 1],
      ['hwupgrade.it', 2, 3],
    ]);
    const pages = await repo.listPages('hwupgrade.it');
    expect(pages.map((page) => page.canonicalUrl)).toEqual([HW_B, HW_A]);
  });

  it('removes the page together with its last highlight', async () => {
    const one = await highlight(HW_A, 'one');
    const two = await highlight(HW_A, 'two');
    expect((await repo.deleteHighlight(one.highlight.id))?.pageDeleted).toBe(false);
    expect((await repo.getPage(one.page.id))?.highlightCount).toBe(1);
    expect((await repo.deleteHighlight(two.highlight.id))?.pageDeleted).toBe(true);
    expect(await repo.getPage(one.page.id)).toBeUndefined();
    expect(await repo.listSites()).toEqual([]);
  });

  it('updates color, note and group', async () => {
    const { highlight: created } = await highlight(HW_A, 'one');
    const group = await repo.createGroup('  Hardware  ');
    expect(group.name).toBe('Hardware');

    const { highlight: updated } = await repo.updateHighlight(created.id, {
      color: 'blue',
      note: '  worth re-reading  ',
      groupId: group.id,
    });
    expect(updated).toMatchObject({ color: 'blue', note: 'worth re-reading', groupId: group.id });

    const { highlight: cleared } = await repo.updateHighlight(created.id, { note: '   ', groupId: null });
    expect(cleared.note).toBeUndefined();
    expect(cleared.groupId).toBeUndefined();

    await expect(repo.updateHighlight(created.id, { groupId: 'missing' })).rejects.toThrow(/group/);
    await expect(repo.updateHighlight('missing', { color: 'green' })).rejects.toThrow(/no longer exists/);
  });
});

describe('groups', () => {
  it('reuses an existing group with the same name', async () => {
    const a = await repo.createGroup('Letture');
    const b = await repo.createGroup('letture');
    expect(b.id).toBe(a.id);
    await expect(repo.createGroup('   ')).rejects.toThrow();
  });

  it('keeps highlights when their group is deleted', async () => {
    const { highlight: created } = await highlight(HW_A, 'one');
    const group = await repo.createGroup('Temp');
    await repo.updateHighlight(created.id, { groupId: group.id });
    expect((await repo.listGroups())[0]).toMatchObject({ count: 1 });

    await repo.deleteGroup(group.id);
    expect(await repo.listGroups()).toEqual([]);
    expect((await repo.getHighlight(created.id))?.groupId).toBeUndefined();
  });

  it('lists the highlights of a group with their pages', async () => {
    const a = await highlight(HW_A, 'one');
    const b = await highlight(MP, 'two');
    const group = await repo.createGroup('Mixed');
    await repo.updateHighlight(a.highlight.id, { groupId: group.id });
    await repo.updateHighlight(b.highlight.id, { groupId: group.id });
    const { items } = await repo.groupHighlights(group.id);
    expect(items.map((item) => item.page.site).sort()).toEqual(['hwupgrade.it', 'multiplayer.it']);
  });
});

describe('search', () => {
  it('matches quotes, notes, titles, sites and groups, ignoring case and accents', async () => {
    const cpu = await highlight(HW_A, 'La velocità della CPU è aumentata', 'yellow', 'Nuove CPU Intel');
    const game = await highlight(MP, 'Il gioco esce a novembre', 'green', 'Un gioco atteso');
    await repo.updateHighlight(game.highlight.id, { note: 'Da comprare subito' });
    const group = await repo.createGroup('Wishlist');
    await repo.updateHighlight(game.highlight.id, { groupId: group.id });

    const ids = async (query: string) => (await repo.search(query, 50)).items.map((item) => item.highlight.id);
    expect(await ids('velocita')).toEqual([cpu.highlight.id]);
    expect(await ids('COMPRARE')).toEqual([game.highlight.id]);
    expect(await ids('intel cpu')).toEqual([cpu.highlight.id]);
    expect(await ids('multiplayer')).toEqual([game.highlight.id]);
    expect(await ids('wishlist')).toEqual([game.highlight.id]);
    expect(await ids('"esce a novembre"')).toEqual([game.highlight.id]);
    expect(await ids('novembre intel')).toEqual([]);
    expect(await ids('   ')).toEqual([]);
  });

  it('returns the most recent highlights first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000);
    await highlight(HW_A, 'older');
    vi.setSystemTime(2_000);
    await highlight(MP, 'newer');
    const recent = await repo.recentHighlights(10);
    expect(recent.map((item) => item.highlight.anchor.exact)).toEqual(['newer', 'older']);
    expect((await repo.recentHighlights(1)).length).toBe(1);
  });
});

describe('export / import', () => {
  it('round-trips the whole knowledge base', async () => {
    const a = await highlight(HW_A, 'one');
    await highlight(MP, 'two');
    const group = await repo.createGroup('G');
    await repo.updateHighlight(a.highlight.id, { groupId: group.id, note: 'n' });
    const file = await exportAll();
    expect(file).toMatchObject({ format: 'jah-export', version: 1 });

    const stats = await importAll(JSON.parse(JSON.stringify(file)), 'replace');
    expect(stats).toMatchObject({ pages: 2, highlights: 2, groups: 1, skipped: 0 });
    const again = await exportAll();
    expect(again.highlights.length).toBe(2);
    expect(again.highlights.find((item) => item.id === a.highlight.id)).toMatchObject({ groupId: group.id, note: 'n' });
  });

  it('merges without duplicating what is already there', async () => {
    await highlight(HW_A, 'one');
    const file = await exportAll();
    const stats = await importAll(file, 'merge');
    expect(stats).toMatchObject({ pages: 0, highlights: 0, groups: 0 });
    expect((await exportAll()).highlights.length).toBe(1);
    expect((await repo.listSites())[0].highlightCount).toBe(1);
  });

  it('matches imported pages to existing ones by URL', async () => {
    const existing = await highlight(HW_A, 'mine');
    const file = await exportAll();
    file.pages[0].id = 'other-page-id';
    file.highlights[0] = { ...file.highlights[0], id: 'other-highlight', pageId: 'other-page-id' };
    await importAll(file, 'merge');
    const page = await repo.pageWithHighlights(existing.page.id);
    expect(page.highlights.map((item) => item.id).sort()).toEqual([existing.highlight.id, 'other-highlight'].sort());
    expect(page.page?.highlightCount).toBe(2);
  });

  it('replace wipes existing data', async () => {
    await highlight(HW_A, 'old');
    await importAll({ format: 'jah-export', version: 1, pages: [], highlights: [], groups: [] }, 'replace');
    expect(await repo.listSites()).toEqual([]);
  });

  it('rejects files that are not exports', async () => {
    await expect(importAll({ hello: 'world' }, 'merge')).rejects.toThrow(/not a Just Another Highlighter export/);
    await expect(importAll([], 'merge')).rejects.toThrow();
  });

  it('bounds timestamps and anchor sizes from untrusted files', () => {
    const parsed = parseExport({
      format: 'jah-export',
      version: 1,
      pages: [{ id: 'p', canonicalUrl: 'https://ok.example/a', createdAt: 9e15, updatedAt: -5 }],
      highlights: [
        {
          id: 'h1',
          pageId: 'p',
          createdAt: 1e20,
          anchor: { exact: 'quote', prefix: 'p'.repeat(10_000), suffix: 's'.repeat(10_000), start: 0, end: 5 },
        },
        { id: 'h2', pageId: 'p', anchor: { exact: 'q'.repeat(30_000), prefix: '', suffix: '', start: 0, end: 1 } },
      ],
      groups: [],
    });
    const [page] = parsed.pages;
    expect(page.createdAt).toBeLessThanOrEqual(Date.now());
    expect(page.updatedAt).toBe(page.createdAt);
    expect(parsed.highlights).toHaveLength(1);
    const [highlight] = parsed.highlights;
    expect(highlight.createdAt).toBeLessThanOrEqual(Date.now());
    expect(highlight.anchor.prefix).toHaveLength(256);
    expect(highlight.anchor.suffix).toHaveLength(256);
    expect(parsed.skipped).toBe(1);
  });

  it('drops unsafe URLs and malformed records', () => {
    const parsed = parseExport({
      format: 'jah-export',
      version: 1,
      pages: [
        { id: 'p1', canonicalUrl: 'javascript:alert(1)' },
        { id: 'p2', canonicalUrl: 'https://ok.example/a?utm_source=x', url: 'javascript:alert(2)', title: 'Ok' },
        'garbage',
      ],
      highlights: [
        { id: 'h1', pageId: 'p2', anchor: { exact: 'x', prefix: '', suffix: '', start: 0, end: 1 }, color: 'neon' },
        { id: 'h2', pageId: 'p2', anchor: { exact: '', prefix: '', suffix: '', start: 0, end: 0 } },
      ],
      groups: [{ id: 'g1', name: '   ' }],
    });
    expect(parsed.pages).toHaveLength(1);
    expect(parsed.pages[0]).toMatchObject({ canonicalUrl: 'https://ok.example/a', url: 'https://ok.example/a', site: 'ok.example' });
    expect(parsed.highlights).toHaveLength(1);
    expect(parsed.highlights[0].color).toBe('yellow');
    expect(parsed.groups).toHaveLength(0);
    expect(parsed.skipped).toBe(4);
  });
});
