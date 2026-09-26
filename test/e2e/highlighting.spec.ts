import { badgeText, center, database, expect, extensionState, selectText, tabIdOf, test } from './fixtures';
import { HOSTS, HW_PATH, PLAIN_PATH } from './site';

const WATT = 'sotto carico il sistema completo resta sotto i 250 watt';
const CACHE = 'il risultato viene memorizzato nella cache';

test('pages without highlights only get the boot script', async ({ context, sw, site }) => {
  const page = await context.newPage();
  await page.goto(site.url(HOSTS.plain, PLAIN_PATH));
  const tabId = await tabIdOf(sw, page);
  await expect.poll(async () => (await extensionState(sw, tabId)).boot).toBe(true);
  // Give the lookup round-trip time to (not) inject anything.
  await page.waitForTimeout(500);
  const state = await extensionState(sw, tabId);
  expect(state.main).toBe(false);
  expect(state.highlights).toEqual({});
});

test('highlight from the toolbar, restore on reload, follow page changes', async ({ context, sw, site }) => {
  const page = await context.newPage();
  // Tracking parameters must not change the page identity.
  await page.goto(`${site.url(HOSTS.hw, HW_PATH)}?utm_source=newsletter`);
  const tabId = await tabIdOf(sw, page);
  await expect.poll(async () => (await extensionState(sw, tabId)).boot).toBe(true);

  await test.step('create with the floating toolbar', async () => {
    await selectText(page, WATT);
    await expect.poll(async () => Object.keys((await extensionState(sw, tabId)).toolbar)).toContain('color:yellow');
    const { toolbar } = await extensionState(sw, tabId);
    const target = center(toolbar['color:yellow']);
    await page.mouse.click(target.x, target.y);
    await expect.poll(async () => (await extensionState(sw, tabId)).highlights['jah-yellow']).toEqual([WATT]);
    expect(await page.evaluate(() => getSelection()?.isCollapsed)).toBe(true);
    await expect.poll(() => badgeText(sw, tabId)).toBe('1');
  });

  await test.step('stored as a text anchor on a normalized page', async () => {
    const { pages, highlights } = await database(sw);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ site: 'hwupgrade.it', canonicalUrl: site.url(HOSTS.hw, HW_PATH), highlightCount: 1 });
    expect(highlights[0].anchor).toMatchObject({ exact: WATT });
    expect(highlights[0].anchor.prefix.endsWith('wattmetro alla presa: ')).toBe(true);
  });

  await test.step('restored after a reload', async () => {
    await page.reload();
    await expect.poll(async () => (await extensionState(sw, tabId)).highlights['jah-yellow']).toEqual([WATT]);
  });

  await test.step('restored after the page content and structure changed', async () => {
    site.variant = 'shifted';
    await page.reload();
    await expect.poll(async () => (await extensionState(sw, tabId)).highlights['jah-yellow']).toEqual([WATT]);
    expect(await page.locator('.wrapper').count()).toBe(1);
  });

  await test.step('left unresolved when its paragraph disappears', async () => {
    site.variant = 'removed';
    await page.reload();
    await expect.poll(async () => (await extensionState(sw, tabId)).main).toBe(true);
    await page.waitForTimeout(300);
    const state = await extensionState(sw, tabId);
    expect(state.highlights['jah-yellow'] ?? []).toEqual([]);
    await expect.poll(() => badgeText(sw, tabId)).toBe('1');
  });
});

test('repeated phrases resolve to the occurrence that was highlighted', async ({ context, sw, site }) => {
  const page = await context.newPage();
  await page.goto(site.url(HOSTS.hw, HW_PATH));
  const tabId = await tabIdOf(sw, page);
  await expect.poll(async () => (await extensionState(sw, tabId)).boot).toBe(true);

  // Second occurrence of the phrase: the conclusion paragraph.
  await selectText(page, CACHE, 1);
  await expect.poll(async () => Object.keys((await extensionState(sw, tabId)).toolbar)).toContain('color:green');
  const target = center((await extensionState(sw, tabId)).toolbar['color:green']);
  await page.mouse.click(target.x, target.y);
  await expect.poll(async () => (await database(sw)).highlights.length).toBe(1);
  expect((await database(sw)).highlights[0].anchor.prefix).toContain('In conclusione');

  const before = await extensionState(sw, tabId);
  expect(before.blocks['jah-green']).toEqual(['In conclusione, il risultato viene memor']);

  site.variant = 'shifted';
  await page.reload();
  await expect.poll(async () => (await extensionState(sw, tabId)).highlights['jah-green']).toEqual([CACHE]);
  // Same words exist in the second paragraph: the range must still be in the conclusion.
  expect((await extensionState(sw, tabId)).blocks['jah-green']).toEqual(['In conclusione, il risultato viene memor']);
});
