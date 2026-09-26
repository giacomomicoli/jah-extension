import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'node:path';
import { HOSTS, startSite, type FixtureSite } from './site';

interface Fixtures {
  site: FixtureSite;
  context: BrowserContext;
  sw: Worker;
  extensionId: string;
}

export const test = base.extend<Fixtures>({
  site: async ({}, use) => {
    const site = await startSite();
    await use(site);
    await site.close();
  },

  context: async ({ site }, use) => {
    void site;
    const extension = path.resolve('dist');
    const hosts = Object.values(HOSTS).map((host) => `MAP ${host} 127.0.0.1`).join(', ');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      viewport: { width: 1100, height: 800 },
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        `--host-resolver-rules=${hosts}`,
      ],
    });
    await use(context);
    await context.close();
  },

  sw: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ sw }, use) => {
    await use(new URL(sw.url()).host);
  },
});

export { expect };

/**
 * Anything that evaluates code in the extension's own origin: the service worker, or an
 * extension page (needed after an extension reload, when Playwright loses the worker).
 */
export type ExtensionContext = Pick<Worker, 'evaluate'>;

export async function tabIdOf(sw: ExtensionContext, page: Page): Promise<number> {
  const url = page.url();
  return sw.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === target);
    if (tab?.id === undefined) throw new Error(`No tab for ${target}`);
    return tab.id;
  }, url);
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtensionState {
  boot: boolean;
  main: boolean;
  toolbar: Record<string, Rect>;
  editor: Record<string, Rect>;
  /** Highlight bucket name → text of each range. */
  highlights: Record<string, string[]>;
  /** Highlight bucket name → start of the paragraph containing each range. */
  blocks: Record<string, string[]>;
}

/** Reads the extension's state from its isolated world in the tab. */
export async function extensionState(sw: ExtensionContext, tabId: number): Promise<ExtensionState> {
  return sw.evaluate(async (id) => {
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
        const highlights: Record<string, string[]> = {};
        const blocks: Record<string, string[]> = {};
        for (const [name, highlight] of CSS.highlights) {
          const ranges = [...highlight] as Range[];
          highlights[name] = ranges.map((range) => range.toString().replace(/\s+/g, ' ').trim());
          blocks[name] = ranges.map((range) => {
            const start = range.startContainer;
            const element = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
            return (element?.closest('p, li, h1, h2, h3, blockquote')?.textContent ?? '').slice(0, 40);
          });
        }
        return {
          boot: !!scope.__jah?.boot,
          main: !!scope.__jah?.main,
          toolbar: plain(scope.__jah?.debug?.toolbarButtons?.()),
          editor: plain(scope.__jah?.debug?.editorButtons?.()),
          highlights,
          blocks,
        };
      },
    });
    return injection.result as ExtensionState;
  }, tabId);
}

/** Selects the `occurrence`-th match of `text` (inside a single text node) and fires mouseup like a user would. */
export async function selectText(page: Page, text: string, occurrence = 0): Promise<void> {
  await page.evaluate(
    ({ text, occurrence }) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        for (let index = node.data.indexOf(text); index !== -1; index = node.data.indexOf(text, index + 1)) {
          if (seen++ !== occurrence) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + text.length);
          range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
          const selection = getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          const rect = range.getBoundingClientRect();
          document.dispatchEvent(
            new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: rect.right, clientY: rect.bottom }),
          );
          return;
        }
      }
      throw new Error(`Text not found: ${text}`);
    },
    { text, occurrence },
  );
}

export function center(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Viewport point in the middle of the first occurrence of `text`. */
export async function pointOf(page: Page, text: string): Promise<{ x: number; y: number }> {
  return page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const index = node.data.indexOf(needle);
      if (index === -1) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const rect = range.getClientRects()[0];
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    throw new Error(`Text not found: ${needle}`);
  }, text);
}

export async function badgeText(sw: ExtensionContext, tabId: number): Promise<string> {
  return sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
}

/** Raw dump of the extension database, read inside the service worker. */
export async function database(sw: ExtensionContext): Promise<{ pages: any[]; highlights: any[]; groups: any[] }> {
  return sw.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('jah');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = (store: string) =>
      new Promise<unknown[]>((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const result = { pages: await all('pages'), highlights: await all('highlights'), groups: await all('groups') };
    db.close();
    return result as { pages: any[]; highlights: any[]; groups: any[] };
  });
}

/** Selects `text`, clicks the toolbar color and waits until the highlight is stored. */
export async function createHighlight(page: Page, sw: ExtensionContext, text: string, color = 'yellow'): Promise<void> {
  const tabId = await tabIdOf(sw, page);
  await expect.poll(async () => (await extensionState(sw, tabId)).boot).toBe(true);
  const before = (await database(sw)).highlights.length;
  await selectText(page, text);
  await expect.poll(async () => Object.keys((await extensionState(sw, tabId)).toolbar)).toContain(`color:${color}`);
  const target = center((await extensionState(sw, tabId)).toolbar[`color:${color}`]);
  await page.mouse.click(target.x, target.y);
  await expect.poll(async () => (await database(sw)).highlights.length).toBe(before + 1);
}

/** Sends a runtime message from the tab's content-script world, as a (possibly hostile) page would. */
export async function sendFromTab(sw: ExtensionContext, tabId: number, message: unknown): Promise<any> {
  return sw.evaluate(
    async ({ id, payload }) => {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: (m: unknown) => chrome.runtime.sendMessage(m),
        args: [payload],
      });
      return injection.result;
    },
    { id: tabId, payload: message },
  );
}

/** Starts recording the types of messages delivered to the tab's content scripts. */
export async function recordTabMessages(sw: ExtensionContext, tabId: number): Promise<void> {
  await sw.evaluate(async (id) => {
    await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => {
        const scope = globalThis as unknown as { __seen?: string[] };
        scope.__seen = [];
        chrome.runtime.onMessage.addListener((message: { type?: string }) => void scope.__seen!.push(String(message?.type)));
      },
    });
  }, tabId);
}

export async function recordedTabMessages(sw: ExtensionContext, tabId: number): Promise<string[]> {
  return sw.evaluate(async (id) => {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => (globalThis as unknown as { __seen?: string[] }).__seen ?? [],
    });
    return injection.result as string[];
  }, tabId);
}
