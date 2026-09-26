import {
  createHighlight,
  database,
  expect,
  extensionState,
  recordTabMessages,
  recordedTabMessages,
  sendFromTab,
  tabIdOf,
  test,
} from './fixtures';
import { COPY_PATH, HOSTS, HW_PATH, PLAIN_PATH } from './site';

const WATT = 'sotto carico il sistema completo resta sotto i 250 watt';
const PRICE = 'Il prezzo di listino parte da 329 euro';

test('an extension update keeps highlights alive in open tabs', async ({ context, sw, site, extensionId }) => {
  const page = await context.newPage();
  await page.goto(site.url(HOSTS.hw, HW_PATH));
  await createHighlight(page, sw, WATT);
  const tabId = await tabIdOf(sw, page);

  // Same as pressing "reload" on chrome://extensions (Developer mode on) after rebuilding.
  const admin = await context.newPage();
  await admin.goto('chrome://extensions');
  const reloaded = await admin.evaluate(
    (id) =>
      new Promise<string>((resolve) => {
        type Callback = () => void;
        const api = (chrome as unknown as {
          developerPrivate: {
            updateProfileConfiguration(update: object, done: Callback): void;
            reload(id: string, options: object, done: Callback): void;
          };
        }).developerPrivate;
        api.updateProfileConfiguration({ inDeveloperMode: true }, () =>
          api.reload(id, { failQuietly: true }, () => resolve(chrome.runtime.lastError?.message ?? 'ok')),
        );
      }),
    extensionId,
  );
  expect(reloaded).toBe('ok');
  await admin.close();

  // Playwright does not surface the restarted worker: probe from an extension page instead.
  const probe = await context.newPage();
  await expect
    .poll(async () => {
      try {
        await probe.goto(`chrome-extension://${extensionId}/sidepanel.html`);
        return await probe.evaluate(() => typeof chrome.scripting?.executeScript);
      } catch {
        return 'unavailable';
      }
    }, { timeout: 15_000 })
    .toBe('function');

  // Re-injected into the open tab, without reloading it.
  await expect.poll(async () => (await extensionState(probe, tabId)).highlights['jah-yellow'], { timeout: 10_000 }).toEqual([WATT]);

  // Scripts orphaned by the update must not take the new rendering down with them.
  await page.bringToFront();
  await page.mouse.move(200, 300);
  await page.mouse.move(420, 480);
  await page.waitForTimeout(1500);
  expect((await extensionState(probe, tabId)).highlights['jah-yellow']).toEqual([WATT]);

  await createHighlight(page, probe, PRICE);
  await expect.poll(async () => (await extensionState(probe, tabId)).highlights['jah-yellow']).toEqual([WATT, PRICE]);
});

test('a highlight inside collapsed content appears once the page reveals it', async ({ context, sw, site }) => {
  const page = await context.newPage();
  await page.goto(site.url(HOSTS.hw, HW_PATH));
  await createHighlight(page, sw, WATT);

  site.variant = 'hidden';
  await page.reload();
  const tabId = await tabIdOf(sw, page);
  await expect.poll(async () => (await extensionState(sw, tabId)).main).toBe(true);
  // Still collapsed: nothing to attach the highlight to yet.
  expect((await extensionState(sw, tabId)).highlights['jah-yellow'] ?? []).toEqual([]);
  await expect.poll(async () => (await extensionState(sw, tabId)).highlights['jah-yellow'], { timeout: 8000 }).toEqual([WATT]);
});

test('late content is picked up promptly even while the page keeps changing', async ({ context, sw, site }) => {
  test.slow();
  const page = await context.newPage();
  await page.goto(site.url(HOSTS.hw, HW_PATH));
  await createHighlight(page, sw, WATT);

  site.variant = 'late';
  await page.reload();
  const tabId = await tabIdOf(sw, page);
  // By now the clock has made retries back off: the next attempt is parked around 16s.
  await page.waitForTimeout(10_500);
  expect((await extensionState(sw, tabId)).highlights['jah-yellow'] ?? []).toEqual([]);
  // The paragraph arrives at 11s and must not wait for the parked retry.
  await expect.poll(async () => (await extensionState(sw, tabId)).highlights['jah-yellow'], { timeout: 3500 }).toEqual([WATT]);
});

test('a page on another subdomain cannot claim a page and receive its highlights', async ({ context, sw, site }) => {
  const article = await context.newPage();
  await article.goto(site.url(HOSTS.hw, HW_PATH));
  await createHighlight(article, sw, WATT);

  const copy = await context.newPage();
  await copy.goto(site.url(HOSTS.evil, COPY_PATH));
  const tabId = await tabIdOf(sw, copy);
  await expect.poll(async () => (await extensionState(sw, tabId)).boot).toBe(true);
  await copy.waitForTimeout(500);
  const state = await extensionState(sw, tabId);
  expect(state.main).toBe(false);
  expect(state.highlights).toEqual({});
});

test('pages neither receive nor reach highlights of other sites', async ({ context, sw, site }) => {
  const plain = await context.newPage();
  await plain.goto(site.url(HOSTS.plain, PLAIN_PATH));
  const plainTab = await tabIdOf(sw, plain);
  await expect.poll(async () => (await extensionState(sw, plainTab)).boot).toBe(true);
  await recordTabMessages(sw, plainTab);

  const article = await context.newPage();
  const articleUrl = site.url(HOSTS.hw, HW_PATH);
  await article.goto(articleUrl);
  await createHighlight(article, sw, WATT);
  const [{ id: highlightId }] = (await database(sw)).highlights;

  await test.step('changes only reach tabs showing the page', async () => {
    await plain.waitForTimeout(300);
    expect(await recordedTabMessages(sw, plainTab)).not.toContain('content:kb-changed');
  });

  await test.step('a page cannot look up highlights of another URL', async () => {
    const forged = { canonicalUrl: articleUrl, locationUrl: articleUrl, hostname: HOSTS.hw, site: 'hwupgrade.it', title: 'x' };
    expect(await sendFromTab(sw, plainTab, { type: 'page:lookup', identity: forged })).toMatchObject({ ok: false });
    const crossSiteCanonical = { ...forged, locationUrl: site.url(HOSTS.plain, PLAIN_PATH) };
    expect(await sendFromTab(sw, plainTab, { type: 'page:lookup', identity: crossSiteCanonical })).toMatchObject({
      ok: true,
      data: { page: null },
    });
  });

  await test.step('a page cannot edit or delete highlights of another site', async () => {
    expect(await sendFromTab(sw, plainTab, { type: 'highlight:delete', id: highlightId })).toMatchObject({ ok: false, error: 'Not allowed' });
    expect(
      await sendFromTab(sw, plainTab, { type: 'highlight:update', id: highlightId, patch: { note: 'overwritten' } }),
    ).toMatchObject({ ok: false, error: 'Not allowed' });
    const [stored] = (await database(sw)).highlights;
    expect(stored.note).toBeUndefined();
  });

  await test.step('knowledge-base requests are reserved to extension pages', async () => {
    expect(await sendFromTab(sw, plainTab, { type: 'kb:export' })).toMatchObject({ ok: false, error: 'Not allowed' });
  });
});
