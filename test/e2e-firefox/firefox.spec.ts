import { test as base } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import {
  badgeText,
  center,
  database,
  expect,
  pointOf,
  recordedTabMessages,
  recordTabMessages,
  selectText,
  sendFromTab,
  tabIdOf,
  type Rect,
} from '../e2e/fixtures';
import { HOSTS, HW_PATH, PLAIN_PATH, startSite, type FixtureSite } from '../e2e/site';
import { FIREFOX_EXTENSION_UUID, launchFirefox, type ExtensionDocument, type FirefoxExtension } from './firefox';

// A smoke run of the main paths in Firefox; test/e2e covers the rest in Chromium.

const WATT = 'sotto carico il sistema completo resta sotto i 250 watt';
const PRICE = 'Il prezzo di listino parte da 329 euro';

const test = base.extend<{ site: FixtureSite; firefox: { context: BrowserContext; extension: FirefoxExtension }; sw: ExtensionDocument }>({
  site: async ({}, use) => {
    const site = await startSite();
    await use(site);
    await site.close();
  },
  firefox: async ({ site }, use) => {
    void site;
    const firefox = await launchFirefox(Object.values(HOSTS));
    await use(firefox);
    await firefox.context.close();
  },
  sw: async ({ firefox }, use) => {
    await use(firefox.extension.background);
  },
});

interface UiState {
  boot: boolean;
  main: boolean;
  toolbar: Record<string, Rect>;
  editor: Record<string, Rect>;
}

/** The extension's scripts and UI in the tab, read from its isolated world. */
async function uiState(sw: ExtensionDocument, tabId: number): Promise<UiState> {
  return sw.evaluate(async (id: number) => {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => {
        type Rects = Record<string, DOMRect> | undefined;
        const scope = globalThis as unknown as {
          __jah?: { boot?: unknown; main?: unknown; debug?: { toolbarButtons?(): Rects; editorButtons?(): Rects } };
        };
        const plain = (rects: Rects) =>
          Object.fromEntries(
            Object.entries(rects ?? {}).map(([key, rect]) => [key, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }]),
          );
        return {
          boot: !!scope.__jah?.boot,
          main: !!scope.__jah?.main,
          toolbar: plain(scope.__jah?.debug?.toolbarButtons?.()),
          editor: plain(scope.__jah?.debug?.editorButtons?.()),
        };
      },
    });
    return injection.result as UiState;
  }, tabId);
}

/**
 * Highlight bucket name → text of each range, read by the page itself: Firefox doesn't let
 * content scripts iterate the page's highlight registry, but the page sees the extension's entries.
 */
function pageHighlights(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(() => {
    const highlights: Record<string, string[]> = {};
    for (const [name, highlight] of CSS.highlights) {
      highlights[name] = [...highlight].map((range) => range.toString().replace(/\s+/g, ' ').trim());
    }
    return highlights;
  });
}

/** Selects `text`, clicks the toolbar color and waits until the highlight is stored. */
async function createHighlight(page: Page, sw: ExtensionDocument, text: string, color = 'yellow'): Promise<void> {
  const tabId = await tabIdOf(sw, page);
  await expect.poll(async () => (await uiState(sw, tabId)).boot).toBe(true);
  const before = (await database(sw)).highlights.length;
  await selectText(page, text);
  await expect.poll(async () => Object.keys((await uiState(sw, tabId)).toolbar)).toContain(`color:${color}`);
  await page.mouse.click(...xy(center((await uiState(sw, tabId)).toolbar[`color:${color}`])));
  await expect.poll(async () => (await database(sw)).highlights.length).toBe(before + 1);
}

const xy = ({ x, y }: { x: number; y: number }): [number, number] => [x, y];

/** Opens the knowledge manager in a tab and returns a handle to evaluate code in it. */
async function openPanel(extension: FirefoxExtension): Promise<ExtensionDocument> {
  await extension.background.evaluate(
    (url: string) => chrome.tabs.create({ url }).then(() => null),
    `moz-extension://${FIREFOX_EXTENSION_UUID}/sidepanel.html`,
  );
  const panel = extension.document('/sidepanel.html');
  await expect.poll(() => panel.evaluate(() => document.readyState)).toBe('complete');
  return panel;
}

test('pages without highlights only get the boot script', async ({ firefox, sw, site }) => {
  const page = await firefox.context.newPage();
  await page.goto(site.url(HOSTS.plain, PLAIN_PATH));
  const tabId = await tabIdOf(sw, page);
  await expect.poll(async () => (await uiState(sw, tabId)).boot).toBe(true);
  await page.waitForTimeout(500);
  expect((await uiState(sw, tabId)).main).toBe(false);
  expect(await pageHighlights(page)).toEqual({});
});

test('highlight from the toolbar, restore on reload and after the event page stops', async ({ firefox, sw, site }) => {
  const page = await firefox.context.newPage();
  await page.goto(site.url(HOSTS.hw, HW_PATH));
  const tabId = await tabIdOf(sw, page);
  await expect.poll(async () => (await uiState(sw, tabId)).boot).toBe(true);

  await test.step('create with the floating toolbar', async () => {
    await selectText(page, WATT);
    await expect.poll(async () => Object.keys((await uiState(sw, tabId)).toolbar)).toContain('color:yellow');
    await page.mouse.click(...xy(center((await uiState(sw, tabId)).toolbar['color:yellow'])));
    await expect.poll(async () => (await pageHighlights(page))['jah-yellow']).toEqual([WATT]);
    expect(await page.evaluate(() => getSelection()?.isCollapsed)).toBe(true);
    expect(await page.locator('jah-ui').count()).toBe(0); // the toolbar is gone, nothing else was added
    await expect.poll(() => badgeText(sw, tabId)).toBe('1');
    const [stored] = (await database(sw)).highlights;
    expect(stored.anchor).toMatchObject({ exact: WATT });
  });

  await test.step('restored after a reload', async () => {
    await page.reload();
    await expect.poll(async () => (await pageHighlights(page))['jah-yellow']).toEqual([WATT]);
  });

  await test.step('restored after Firefox unloads the event page', async () => {
    await firefox.extension.terminateBackground();
    await page.reload();
    await expect.poll(async () => (await pageHighlights(page))['jah-yellow']).toEqual([WATT]);
    await expect.poll(() => badgeText(sw, tabId)).toBe('1');
  });
});

test('the toolbar keeps its styles on pages with a strict Content Security Policy', async ({ firefox, sw, site }) => {
  const page = await firefox.context.newPage();
  const url = site.url(HOSTS.hw, '/strict.html');
  await page.route(url, (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "default-src 'none'; style-src 'none'" },
      body: `<!doctype html><title>Strict</title><p>${WATT}.</p>`,
    }),
  );
  await page.goto(url);
  const tabId = await tabIdOf(sw, page);
  await expect.poll(async () => (await uiState(sw, tabId)).boot).toBe(true);
  await selectText(page, WATT);
  await expect.poll(async () => Object.keys((await uiState(sw, tabId)).toolbar)).toContain('color:yellow');
  // 22×22 comes from the toolbar's stylesheet (once its pop-in animation ends).
  await expect
    .poll(async () => {
      const swatch = (await uiState(sw, tabId)).toolbar['color:yellow'];
      return [Math.round(swatch.width), Math.round(swatch.height)];
    })
    .toEqual([22, 22]);
});

test('edit a highlight from the page', async ({ firefox, sw, site }) => {
  const page = await firefox.context.newPage();
  await page.goto(site.url(HOSTS.hw, HW_PATH));
  const tabId = await tabIdOf(sw, page);
  await createHighlight(page, sw, PRICE);

  const point = await pointOf(page, PRICE);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => Object.keys((await uiState(sw, tabId)).editor)).toContain('color:green');
  expect((await pageHighlights(page))['jah-active']).toEqual([PRICE]);
  await page.mouse.click(...xy(center((await uiState(sw, tabId)).editor['color:green'])));
  await expect.poll(async () => (await database(sw)).highlights[0].color).toBe('green');
  await expect.poll(async () => (await pageHighlights(page))['jah-green']).toEqual([PRICE]);
});

test('the sidebar lists sites and pages', async ({ firefox, sw, site }) => {
  const page = await firefox.context.newPage();
  await page.goto(site.url(HOSTS.hw, HW_PATH));
  await createHighlight(page, sw, WATT);

  const panel = await openPanel(firefox.extension);
  await expect
    .poll(() => panel.evaluate(() => [...document.querySelectorAll('.row-title')].map((row) => row.textContent)))
    .toEqual(['hwupgrade.it']);
  const row = await panel.evaluate(() => ({
    favicons: document.querySelectorAll('img.favicon').length,
    icons: document.querySelectorAll('.row .row-icon svg').length,
    accessNotice: document.getElementById('access')!.hidden,
  }));
  // Firefox has no favicon service for extensions: a globe instead of a broken image.
  expect(row).toEqual({ favicons: 0, icons: 1, accessNotice: true });

  await panel.evaluate(() => (document.querySelector('.row') as HTMLElement).click());
  await expect.poll(() => panel.evaluate(() => document.querySelector('.view-header h2')?.textContent)).toBe('hwupgrade.it');
});

test('pages neither receive nor reach highlights of other sites', async ({ firefox, sw, site }) => {
  const plain = await firefox.context.newPage();
  await plain.goto(site.url(HOSTS.plain, PLAIN_PATH));
  const plainTab = await tabIdOf(sw, plain);
  await expect.poll(async () => (await uiState(sw, plainTab)).boot).toBe(true);
  await recordTabMessages(sw, plainTab);

  const article = await firefox.context.newPage();
  const articleUrl = site.url(HOSTS.hw, HW_PATH);
  await article.goto(articleUrl);
  await createHighlight(article, sw, WATT);
  const [{ id: highlightId }] = (await database(sw)).highlights;

  await plain.waitForTimeout(300);
  expect(await recordedTabMessages(sw, plainTab)).not.toContain('content:kb-changed');

  const forged = { canonicalUrl: articleUrl, locationUrl: articleUrl, hostname: HOSTS.hw, site: 'hwupgrade.it', title: 'x' };
  expect(await sendFromTab(sw, plainTab, { type: 'page:lookup', identity: forged })).toMatchObject({ ok: false });
  expect(await sendFromTab(sw, plainTab, { type: 'highlight:delete', id: highlightId })).toMatchObject({
    ok: false,
    error: 'Not allowed',
  });
  expect(await sendFromTab(sw, plainTab, { type: 'kb:export' })).toMatchObject({ ok: false, error: 'Not allowed' });
});
