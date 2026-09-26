import { highlightStylesheet } from '../shared/colors';
import type { TabMessage } from '../shared/messages';
import type { Page } from '../shared/types';
import { isSameSite, normalizeUrl } from '../shared/url';

const WEB_PAGES = ['http://*/*', 'https://*/*'];
const inflightInjections = new Map<string, Promise<void>>();

/** A tab's top frame, optionally pinned to one document (e.g. the prerendered page that asked). */
export interface DocumentTarget {
  tabId: number;
  documentId?: string;
}

/**
 * Makes sure content-main (and the `::highlight()` rules) are present in the document.
 * This is the only place where the expensive part of the extension enters a page.
 */
export function ensureMain(document: DocumentTarget): Promise<void> {
  const key = document.documentId ?? `tab:${document.tabId}`;
  let pending = inflightInjections.get(key);
  if (!pending) {
    pending = injectMain(document).finally(() => inflightInjections.delete(key));
    inflightInjections.set(key, pending);
  }
  return pending;
}

async function injectMain({ tabId, documentId }: DocumentTarget): Promise<void> {
  const target: chrome.scripting.InjectionTarget = documentId
    ? { tabId, documentIds: [documentId] }
    : { tabId, frameIds: [0] };
  const [probe] = await chrome.scripting.executeScript({
    target,
    func: () => {
      const scope = globalThis as { __jah?: { main?: { alive(): boolean } } };
      return Boolean(scope.__jah?.main?.alive());
    },
  });
  if (probe?.result) return;
  await chrome.scripting.insertCSS({ target, css: highlightStylesheet() });
  await chrome.scripting.executeScript({ target, files: ['content-main.js'] });
}

export async function injectBoot(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content-boot.js'] });
}

/** Content scripts are not injected into tabs that were open before install/update. */
export async function injectIntoOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: WEB_PAGES });
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined && !tab.discarded)
      .map((tab) => injectBoot(tab.id!).catch(() => undefined)),
  );
}

export async function sendToTab<T>(tabId: number, message: TabMessage): Promise<T | undefined> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message, { frameId: 0 })) as T;
  } catch {
    return undefined;
  }
}

/** Only for messages that carry no highlight data. */
export async function broadcastToTabs(message: TabMessage): Promise<void> {
  const tabs = await chrome.tabs.query({ url: WEB_PAGES });
  await sendToTabs(tabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id])), message);
}

export async function sendToTabs(tabIds: number[], message: TabMessage): Promise<void> {
  await Promise.all(tabIds.map((id) => chrome.tabs.sendMessage(id, message, { frameId: 0 }).catch(() => undefined)));
}

// ── Which tabs may receive a page's highlights ─────────────────────────────

const TAB_PAGES_KEY = 'tabPages';
let tabPages: Map<number, string> | undefined;

async function loadTabPages(): Promise<Map<number, string>> {
  if (!tabPages) {
    const stored = (await chrome.storage.session.get(TAB_PAGES_KEY))[TAB_PAGES_KEY] as Record<string, string> | undefined;
    tabPages ??= new Map(Object.entries(stored ?? {}).map(([tabId, pageId]) => [Number(tabId), pageId]));
  }
  return tabPages;
}

/** Remembers that a tab loaded a page's highlights (it may show it under an unrecorded URL). */
export async function rememberTabPage(tabId: number, pageId: string): Promise<void> {
  const map = await loadTabPages();
  if (map.get(tabId) === pageId) return;
  map.set(tabId, pageId);
  await chrome.storage.session.set({ [TAB_PAGES_KEY]: Object.fromEntries(map) });
}

export async function forgetTab(tabId: number): Promise<void> {
  const map = await loadTabPages();
  if (map.delete(tabId)) await chrome.storage.session.set({ [TAB_PAGES_KEY]: Object.fromEntries(map) });
}

/**
 * Tabs allowed to receive a page's highlights: those showing one of its URLs, or known to have
 * loaded it and still on the same site. Other sites never get another site's quotes or notes.
 */
export async function tabsShowing(page: Page): Promise<number[]> {
  const known = await loadTabPages();
  const urls = new Set(page.urls);
  const tabs = await chrome.tabs.query({ url: WEB_PAGES });
  return tabs.flatMap((tab) => {
    if (tab.id === undefined || !tab.url) return [];
    if (urls.has(normalizeUrl(tab.url) ?? '')) return [tab.id];
    const sameSite = isSameSite(new URL(tab.url).hostname, page.hostname);
    return known.get(tab.id) === page.id && sameSite ? [tab.id] : [];
  });
}

/** An open tab showing the page, preferring the active tab, then the focused window. */
export async function findTabForPage(page: Page): Promise<chrome.tabs.Tab | undefined> {
  const urls = new Set(page.urls);
  const tabs = await chrome.tabs.query({ url: WEB_PAGES });
  const matches = tabs.filter((tab) => tab.url && urls.has(normalizeUrl(tab.url) ?? ''));
  if (!matches.length) return undefined;
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return (
    matches.find((tab) => tab.id === active?.id) ??
    matches.find((tab) => tab.windowId === active?.windowId) ??
    matches[0]
  );
}

export async function activateTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

export async function setBadge(tabId: number, total: number, unresolved: number): Promise<void> {
  const title = total
    ? `Just Another Highlighter: ${total} highlight${total === 1 ? '' : 's'} on this page` +
      (unresolved ? ` (${unresolved} not found)` : '')
    : 'Just Another Highlighter';
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: total ? String(total) : '' }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: unresolved ? '#e8590c' : '#495057' }),
    chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' }),
    chrome.action.setTitle({ tabId, title }),
  ]);
}

// ── Jump-to-highlight in a tab that is still loading ───────────────────────

interface PendingFocus {
  highlightId: string;
  pageId: string;
  at: number;
}

const PENDING_TTL = 120_000;
const pendingFocus = new Map<number, PendingFocus>();
const pendingKey = (tabId: number) => `focus:${tabId}`;

export async function setPendingFocus(tabId: number, highlightId: string, pageId: string): Promise<void> {
  const entry = { highlightId, pageId, at: Date.now() };
  pendingFocus.set(tabId, entry);
  await chrome.storage.session.set({ [pendingKey(tabId)]: entry });
}

/** Highlight to focus once `pageId` finished loading in `tabId`, if one was requested. */
export async function takePendingFocus(tabId: number, pageId: string): Promise<string | undefined> {
  const key = pendingKey(tabId);
  const entry =
    pendingFocus.get(tabId) ?? ((await chrome.storage.session.get(key))[key] as PendingFocus | undefined);
  if (!entry) return undefined;
  const expired = Date.now() - entry.at > PENDING_TTL;
  if (!expired && entry.pageId !== pageId) return undefined;
  await clearPendingFocus(tabId);
  return expired ? undefined : entry.highlightId;
}

export async function clearPendingFocus(tabId: number): Promise<void> {
  pendingFocus.delete(tabId);
  await chrome.storage.session.remove(pendingKey(tabId));
}
