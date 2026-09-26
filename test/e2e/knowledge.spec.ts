import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { badgeText, center, createHighlight, database, expect, extensionState, pointOf, tabIdOf, test } from './fixtures';
import { HOSTS, HW_PATH, MP_PATH } from './site';

const WATT = 'sotto carico il sistema completo resta sotto i 250 watt';
const PRICE = 'Il prezzo di listino parte da 329 euro';
const MAP = 'La mappa promette di essere tre volte più grande';

async function openPanel(context: import('@playwright/test').BrowserContext, extensionId: string): Promise<Page> {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 760 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return panel;
}

test('edit a highlight from the page: color, note, group, delete', async ({ context, sw, site }) => {
  const page = await context.newPage();
  await page.goto(site.url(HOSTS.hw, HW_PATH));
  const tabId = await tabIdOf(sw, page);
  await createHighlight(page, sw, WATT);

  const editor = async () => (await extensionState(sw, tabId)).editor;
  const click = async (action: string) => {
    await expect.poll(async () => Object.keys(await editor())).toContain(action);
    const target = center((await editor())[action]);
    await page.mouse.click(target.x, target.y);
  };

  await test.step('hovering a highlight arms the native context menu', async () => {
    const point = await pointOf(page, 'resta sotto i 250');
    await page.mouse.move(point.x, point.y);
    await expect
      .poll(() => sw.evaluate(async () => (await chrome.storage.session.get('contextTarget')).contextTarget))
      .toMatchObject({ tabId });
  });

  await test.step('clicking a highlight opens its editor; recolor', async () => {
    const point = await pointOf(page, 'resta sotto i 250');
    await page.mouse.click(point.x, point.y);
    await click('color:green');
    await expect.poll(async () => (await extensionState(sw, tabId)).highlights['jah-green']).toEqual([WATT]);
    expect((await extensionState(sw, tabId)).highlights['jah-yellow'] ?? []).toEqual([]);
    expect((await database(sw)).highlights[0].color).toBe('green');
  });

  await test.step('add a note', async () => {
    await click('note');
    await expect.poll(async () => Object.keys(await editor())).toContain('textarea');
    await page.keyboard.type('Consumi migliori della generazione precedente');
    await page.keyboard.press('Control+Enter');
    await expect.poll(async () => (await database(sw)).highlights[0].note).toBe('Consumi migliori della generazione precedente');
  });

  await test.step('create a group and move the highlight into it', async () => {
    await click('group');
    await expect.poll(async () => Object.keys(await editor())).toContain('input');
    await page.keyboard.type('Hardware');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await database(sw)).groups.map((group) => group.name)).toEqual(['Hardware']);
    const { groups, highlights } = await database(sw);
    expect(highlights[0].groupId).toBe(groups[0].id);
  });

  await test.step('delete needs a second click', async () => {
    await click('delete');
    expect((await database(sw)).highlights).toHaveLength(1);
    await click('delete');
    await expect.poll(async () => (await database(sw)).highlights).toHaveLength(0);
    await expect.poll(async () => (await extensionState(sw, tabId)).highlights['jah-green'] ?? []).toEqual([]);
    await expect.poll(() => badgeText(sw, tabId)).toBe('');
    expect((await database(sw)).pages).toHaveLength(0);
  });
});

test('side panel: sites, pages, highlights, search and jump to page', async ({ context, sw, site, extensionId }) => {
  const hw = await context.newPage();
  await hw.goto(site.url(HOSTS.hw, HW_PATH));
  await createHighlight(hw, sw, WATT);
  await createHighlight(hw, sw, PRICE, 'blue');
  const mp = await context.newPage();
  await mp.goto(site.url(HOSTS.mp, MP_PATH));
  await createHighlight(mp, sw, MAP, 'pink');

  const panel = await openPanel(context, extensionId);

  await test.step('sites are listed by name, most recent first', async () => {
    const rows = panel.locator('.view .row .row-title');
    await expect(rows).toHaveText(['multiplayer.it', 'hwupgrade.it']);
    await expect(panel.locator('.view .row').nth(1)).toContainText('1 page · 2 highlights');
  });

  await test.step('site → pages → highlights', async () => {
    await panel.locator('.view .row', { hasText: 'hwupgrade.it' }).click();
    await expect(panel.locator('.view-header h2')).toHaveText('hwupgrade.it');
    await panel.locator('.view .row', { hasText: 'Nuove CPU desktop' }).click();
    await expect(panel.locator('.card .quote')).toHaveText([WATT, PRICE]);
    await panel.locator('.view-header .icon-button[title="Back"]').click();
    await panel.locator('.view-header .icon-button[title="Back"]').click();
    await expect(panel.locator('.tabs')).toBeVisible();
  });

  await test.step('search is accent-insensitive and marks matches', async () => {
    await panel.locator('#search').fill('piu grande');
    await expect(panel.locator('.result-count')).toHaveText('1 result');
    await expect(panel.locator('.card mark')).toHaveText(['più', 'grande']);
    await panel.locator('#search').fill('');
  });

  await test.step('jumping to a highlight reopens its page and flashes it', async () => {
    await mp.close();
    await panel.locator('.tabs [data-tab="recent"]').click();
    const newTab = context.waitForEvent('page');
    await panel.locator('.card .quote', { hasText: MAP }).click();
    const reopened = await newTab;
    await reopened.waitForLoadState();
    const tabId = await tabIdOf(sw, reopened);
    await expect.poll(async () => (await extensionState(sw, tabId)).highlights['jah-focus']).toEqual([MAP]);
    await expect.poll(async () => (await extensionState(sw, tabId)).highlights['jah-pink']).toEqual([MAP]);
  });

  await test.step('deleting from the panel updates the open page', async () => {
    const tabId = await tabIdOf(sw, hw);
    await panel.bringToFront();
    await panel.locator('.tabs [data-tab="recent"]').click();
    const card = panel.locator('.card', { hasText: PRICE });
    await card.hover();
    await card.locator('[data-action="delete"]').click();
    await card.locator('[data-action="delete"]').click();
    await expect(panel.locator('.card', { hasText: PRICE })).toHaveCount(0);
    await expect.poll(async () => (await extensionState(sw, tabId)).highlights['jah-blue'] ?? []).toEqual([]);
    expect((await extensionState(sw, tabId)).highlights['jah-yellow']).toEqual([WATT]);
  });

  await test.step('the service worker reports the page of a tab', async () => {
    const tabId = await tabIdOf(sw, hw);
    const result = await panel.evaluate(
      (id) => chrome.runtime.sendMessage({ type: 'kb:tab-page', tabId: id }),
      tabId,
    );
    expect(result.ok).toBe(true);
    expect(result.data.page.site).toBe('hwupgrade.it');
    expect(Object.values(result.data.statuses)).toEqual(['resolved']);
  });
});

test('export and re-import the knowledge base', async ({ context, sw, site, extensionId }) => {
  const page = await context.newPage();
  await page.goto(site.url(HOSTS.hw, HW_PATH));
  await createHighlight(page, sw, WATT);
  const panel = await openPanel(context, extensionId);

  const download = panel.waitForEvent('download');
  await panel.locator('#menu-button').click();
  await panel.locator('[data-command="export"]').click();
  const file = await (await download).path();
  const exported = JSON.parse(await readFile(file, 'utf8'));
  expect(exported).toMatchObject({ format: 'jah-export', version: 1 });
  expect(exported.highlights).toHaveLength(1);

  await panel.locator('.tabs [data-tab="recent"]').click();
  const card = panel.locator('.card').first();
  await card.hover();
  await card.locator('[data-action="delete"]').click();
  await card.locator('[data-action="delete"]').click();
  await expect.poll(async () => (await database(sw)).highlights).toHaveLength(0);

  const chooser = panel.waitForEvent('filechooser');
  await panel.locator('#menu-button').click();
  await panel.locator('[data-command="import-merge"]').click();
  await (await chooser).setFiles(file);
  await expect(panel.locator('#toast')).toContainText('Imported 1 new highlight');
  await expect.poll(async () => (await database(sw)).highlights).toHaveLength(1);

  // The open page picks the re-imported highlight up again.
  const tabId = await tabIdOf(sw, page);
  await expect.poll(async () => (await extensionState(sw, tabId)).highlights['jah-yellow']).toEqual([WATT]);
});
