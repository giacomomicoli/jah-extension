/**
 * Service worker: sole owner of the IndexedDB knowledge base. Content scripts and the side
 * panel talk to it through runtime messages; it injects content-main only where needed.
 */
import { DEFAULT_COLOR, isColorId, type ColorId } from '../shared/colors';
import { MAX_TITLE_LENGTH } from '../shared/limits';
import type {
  AnyRequest,
  KbChange,
  KbChangedEvent,
  PanelFocus,
  PanelFocusEvent,
  PanelFocusRequest,
  RequestOf,
  RequestType,
  ResponseOf,
  TabPage,
  TabStatus,
  TabStatusEvent,
} from '../shared/messages';
import type { HighlightPatch, Page, PageIdentity, TextAnchor } from '../shared/types';
import { acceptCanonical, isSameSiteUrl, normalizeUrl, siteOf } from '../shared/url';
import { createMenus, parseMenuCommand, setHighlightItemsVisible } from './menus';
import * as repo from './repo';
import {
  activateTab,
  broadcastToTabs,
  clearPendingFocus,
  ensureMain,
  findTabForPage,
  forgetTab,
  injectBoot,
  injectIntoOpenTabs,
  rememberTabPage,
  sendToTab,
  sendToTabs,
  setBadge,
  setPendingFocus,
  takePendingFocus,
  tabsShowing,
} from './tabs';
import { exportAll, importAll, parseAnchor } from './transfer';

// ── Lifecycle ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  createMenus();
  void enablePanelOnActionClick();
  if (details.reason === 'install' || details.reason === 'update') void injectIntoOpenTabs();
});

chrome.runtime.onStartup.addListener(() => void enablePanelOnActionClick());

function enablePanelOnActionClick(): Promise<void> {
  return chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.warn('[JAH] side panel behavior', error));
}

// ── Change notifications ───────────────────────────────────────────────────

/**
 * Notifies the side panel and the tabs concerned. Changes carrying a page's data only go to
 * tabs showing that page; data-less changes ("groups", "reset") go to every tab.
 */
function publish(change: KbChange, page?: Page): void {
  const event: KbChangedEvent = { type: 'kb:changed', change };
  chrome.runtime.sendMessage(event).catch(() => undefined); // no side panel open
  const message = { type: 'content:kb-changed', change } as const;
  if (change.kind === 'groups' || change.kind === 'reset') {
    void broadcastToTabs(message);
  } else if (page) {
    void tabsShowing(page).then((tabIds) => sendToTabs(tabIds, message));
  }
}

async function updateHighlight(id: string, patch: HighlightPatch) {
  const result = await repo.updateHighlight(id, patch);
  publish({ kind: 'highlight-upsert', highlight: result.highlight, page: result.page }, result.page);
  return result;
}

async function deleteHighlight(id: string): Promise<void> {
  const result = await repo.deleteHighlight(id);
  if (result) publish({ kind: 'highlight-delete', highlightId: id, pageId: result.highlight.pageId }, result.page);
}

// ── Side panel ─────────────────────────────────────────────────────────────

/**
 * Opens the side panel in the tab. Chrome only allows it in response to a user gesture, which
 * survives only while the message or menu handler runs synchronously: call this before any await.
 */
function openSidePanel(tabId: number): Promise<boolean> {
  return chrome.sidePanel.open({ tabId }).then(
    () => true,
    () => false,
  );
}

/** Asks the side panel of `windowId` to show a highlight with its note or group editor open. */
async function focusInPanel(highlightId: string, focus: PanelFocus, windowId: number | undefined): Promise<void> {
  const highlight = await repo.getHighlight(highlightId);
  if (!highlight) throw new Error('This highlight no longer exists');
  const request: PanelFocusRequest = { highlightId, pageId: highlight.pageId, focus, windowId, at: Date.now() };
  // Stored for a panel that is still loading, sent for one that is already open.
  await chrome.storage.session.set({ panelFocus: request });
  const event: PanelFocusEvent = { type: 'panel:focus', highlightId, pageId: highlight.pageId, focus, windowId };
  chrome.runtime.sendMessage(event).catch(() => undefined);
}

// ── Preferences ────────────────────────────────────────────────────────────

async function lastColor(): Promise<ColorId> {
  const { lastColor } = await chrome.storage.local.get('lastColor');
  return isColorId(lastColor) ? lastColor : DEFAULT_COLOR;
}

async function rememberColor(color: ColorId): Promise<void> {
  await chrome.storage.local.set({ lastColor: color });
}

// ── Context menu target ────────────────────────────────────────────────────

interface ContextTarget {
  tabId: number;
  highlightId: string;
}

let contextTarget: ContextTarget | null = null;

async function setContextTarget(target: ContextTarget | null): Promise<void> {
  contextTarget = target;
  await Promise.all([setHighlightItemsVisible(target !== null), chrome.storage.session.set({ contextTarget: target })]);
}

async function currentContextTarget(): Promise<ContextTarget | null> {
  if (contextTarget) return contextTarget;
  const { contextTarget: stored } = await chrome.storage.session.get('contextTarget');
  return (stored as ContextTarget | undefined) ?? null;
}

// ── Validation of incoming data ────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireString(value: unknown, what = 'value'): string {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid ${what}`);
  return value;
}

/**
 * A page identity claimed by a content script, checked against the URL the browser reports for
 * its frame: the location must match and the canonical URL must pass the same-site rules.
 */
function requireIdentity(value: unknown, frameUrl: string | undefined): PageIdentity {
  if (!isObject(value) || typeof value.locationUrl !== 'string') throw new Error('Invalid page');
  const locationUrl = frameUrl ? normalizeUrl(frameUrl) : null;
  if (!locationUrl) throw new Error('This page cannot be highlighted');
  if (normalizeUrl(value.locationUrl) !== locationUrl) throw new Error('The page changed, try again');
  const claimed = typeof value.canonicalUrl === 'string' ? normalizeUrl(value.canonicalUrl) : null;
  const canonicalUrl = claimed && acceptCanonical(claimed, locationUrl) ? claimed : locationUrl;
  const hostname = new URL(canonicalUrl).hostname;
  const title = typeof value.title === 'string' ? value.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH) : '';
  return { canonicalUrl, locationUrl, hostname, site: siteOf(hostname), title: title || hostname };
}

function requireAnchor(value: unknown): TextAnchor {
  const anchor = parseAnchor(value);
  if (!anchor) throw new Error('Invalid highlight');
  return anchor;
}

function requirePatch(value: unknown): HighlightPatch {
  if (!isObject(value)) throw new Error('Invalid change');
  const patch: HighlightPatch = {};
  if (value.color !== undefined) {
    if (!isColorId(value.color)) throw new Error('Unknown color');
    patch.color = value.color;
  }
  if (value.note !== undefined) patch.note = requireStringOrEmpty(value.note);
  if (value.groupId !== undefined) patch.groupId = value.groupId === null ? null : requireString(value.groupId, 'group');
  return patch;
}

function requireStringOrEmpty(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid text');
  return value;
}

function clampInt(value: unknown, fallback: number, max: number): number {
  return Number.isInteger(value) ? Math.min(Math.max(value as number, 0), max) : fallback;
}

function requireTab(sender: chrome.runtime.MessageSender): number {
  const tabId = sender.tab?.id;
  if (tabId === undefined) throw new Error('Not sent from a tab');
  return tabId;
}

/** Extension pages (side panel, or the same page opened in a tab) run on the extension origin. */
function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return (sender.url ?? '').startsWith(chrome.runtime.getURL(''));
}

/** A web page may only act on highlights that belong to its own site. */
async function assertSameSite(highlightId: string, pageUrl: string | undefined): Promise<void> {
  const highlight = await repo.getHighlight(highlightId);
  if (!highlight) throw new Error('This highlight no longer exists');
  const page = await repo.getPage(highlight.pageId);
  if (!page || !pageUrl || !isSameSiteUrl(pageUrl, page.canonicalUrl)) throw new Error('Not allowed');
}

async function assertMayEdit(highlightId: string, sender: chrome.runtime.MessageSender): Promise<void> {
  if (!fromExtensionPage(sender)) await assertSameSite(highlightId, sender.url);
}

// ── Request handlers ───────────────────────────────────────────────────────

type Handler<T extends RequestType> = (
  request: RequestOf<T>,
  sender: chrome.runtime.MessageSender,
) => Promise<ResponseOf<T>>;

const handlers: { [T in RequestType]: Handler<T> } = {
  'page:lookup': async ({ identity }, sender) => {
    const tabId = requireTab(sender);
    const found = await repo.lookupPage(requireIdentity(identity, sender.url));
    if (!found) return { page: null, highlights: [] };
    // The exact document that asked: it may be a prerendered page, not the visible one.
    await ensureMain({ tabId, documentId: sender.documentId });
    await rememberTabPage(tabId, found.page.id);
    void repo.touchPage(found.page.id).catch(() => undefined);
    const focusId = await takePendingFocus(tabId, found.page.id);
    return { page: found.page, highlights: found.highlights, focusId };
  },

  'content:ensure-main': async (_request, sender) => {
    await ensureMain({ tabId: requireTab(sender), documentId: sender.documentId });
    return { ready: true };
  },

  'content:report': async ({ total, unresolved }, sender) => {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return null;
    await setBadge(tabId, clampInt(total, 0, 99_999), clampInt(unresolved, 0, 99_999));
    const event: TabStatusEvent = { type: 'tab:status', tabId };
    chrome.runtime.sendMessage(event).catch(() => undefined);
    return null;
  },

  'ctx:target': async ({ highlightId }, sender) => {
    const tabId = sender.tab?.id;
    await setContextTarget(
      typeof highlightId === 'string' && highlightId && tabId !== undefined ? { tabId, highlightId } : null,
    );
    return null;
  },

  'highlight:create': async ({ identity, fingerprint, anchor, color }, sender) => {
    const tabId = requireTab(sender);
    const chosen = isColorId(color) ? color : await lastColor();
    const result = await repo.createHighlight({
      identity: requireIdentity(identity, sender.url),
      fingerprint: typeof fingerprint === 'string' ? fingerprint.slice(0, 64) : '',
      anchor: requireAnchor(anchor),
      color: chosen,
    });
    await Promise.all([rememberColor(chosen), rememberTabPage(tabId, result.page.id)]);
    publish({ kind: 'highlight-upsert', highlight: result.highlight, page: result.page }, result.page);
    return result;
  },

  'highlight:update': async ({ id, patch }, sender) => {
    const highlightId = requireString(id, 'highlight');
    await assertMayEdit(highlightId, sender);
    const { highlight } = await updateHighlight(highlightId, requirePatch(patch));
    return { highlight };
  },

  'highlight:delete': async ({ id }, sender) => {
    const highlightId = requireString(id, 'highlight');
    await assertMayEdit(highlightId, sender);
    await deleteHighlight(highlightId);
    return null;
  },

  'groups:list': async () => ({ groups: await repo.listGroups() }),

  'group:create': async ({ name }) => {
    const group = await repo.createGroup(requireString(name, 'group name'));
    publish({ kind: 'groups' });
    return { group };
  },

  'group:rename': async ({ id, name }) => {
    const group = await repo.renameGroup(requireString(id, 'group'), requireString(name, 'group name'));
    publish({ kind: 'groups' });
    return { group };
  },

  'group:delete': async ({ id }) => {
    await repo.deleteGroup(requireString(id, 'group'));
    publish({ kind: 'groups' });
    return null;
  },

  'panel:open': async ({ highlightId, focus }, sender) => {
    const opening = openSidePanel(requireTab(sender)); // first: keeps the user gesture
    const id = requireString(highlightId, 'highlight');
    await assertMayEdit(id, sender);
    await focusInPanel(id, focus === 'group' ? 'group' : 'note', sender.tab?.windowId);
    return { opened: await opening };
  },

  'kb:sites': async () => ({ sites: await repo.listSites() }),
  'kb:pages': async ({ site }) => ({ pages: await repo.listPages(requireString(site, 'site')) }),
  'kb:page': async ({ pageId }) => repo.pageWithHighlights(requireString(pageId, 'page')),
  'kb:recent': async ({ limit }) => ({ items: await repo.recentHighlights(clampInt(limit, 50, 500)) }),
  'kb:group': async ({ groupId }) => repo.groupHighlights(requireString(groupId, 'group')),
  'kb:search': async ({ query, limit }) =>
    repo.search(typeof query === 'string' ? query.slice(0, 500) : '', clampInt(limit, 200, 1000)),
  'kb:tab-page': async ({ tabId }) => tabPage(clampInt(tabId, -1, Number.MAX_SAFE_INTEGER)),
  'kb:export': async () => ({ data: await exportAll() }),

  'kb:import': async ({ data, mode }) => {
    const stats = await importAll(data, mode === 'replace' ? 'replace' : 'merge');
    publish({ kind: 'reset' });
    return stats;
  },

  'page:delete': async ({ pageId }) => {
    const id = requireString(pageId, 'page');
    const page = await repo.deletePage(id);
    publish({ kind: 'page-delete', pageId: id }, page);
    return null;
  },

  'nav:open-highlight': async ({ highlightId }) => {
    await openHighlight(requireString(highlightId, 'highlight'));
    return null;
  },

  'nav:open-page': async ({ pageId }) => {
    await openPage(requireString(pageId, 'page'));
    return null;
  },
};

/** Requests content scripts may send; everything else is reserved to extension pages. */
const CONTENT_REQUESTS = new Set<RequestType>([
  'page:lookup',
  'content:ensure-main',
  'content:report',
  'ctx:target',
  'highlight:create',
  'highlight:update',
  'highlight:delete',
  'groups:list',
  'group:create',
  'panel:open',
]);

function isAllowed(type: RequestType, sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  // Content scripts report the URL of the web page they run in, never the extension origin.
  return fromExtensionPage(sender) || (sender.tab !== undefined && CONTENT_REQUESTS.has(type));
}

function isRequest(message: unknown): message is AnyRequest {
  return isObject(message) && typeof message.type === 'string' && Object.hasOwn(handlers, message.type);
}

function dispatch<T extends RequestType>(request: RequestOf<T>, sender: chrome.runtime.MessageSender) {
  const handler = handlers[request.type] as Handler<T>;
  return handler(request, sender);
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRequest(message)) return false;
  if (!isAllowed(message.type, sender)) {
    sendResponse({ ok: false, error: 'Not allowed' });
    return false;
  }
  dispatch(message, sender).then(
    (data) => sendResponse({ ok: true, data }),
    (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  return true;
});

// ── Side panel helpers ─────────────────────────────────────────────────────

async function tabPage(tabId: number): Promise<TabPage> {
  const empty: TabPage = { identity: null, page: null, highlights: [], statuses: null };
  if (tabId < 0) return empty;
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab?.url || !/^https?:/.test(tab.url)) return empty;
  let claimed = await sendToTab<PageIdentity | null>(tabId, { type: 'content:identity' });
  if (!claimed) {
    // Tabs opened before the extension was installed or updated have no content script yet.
    if (tab.discarded || tab.status !== 'complete') return empty;
    try {
      await injectBoot(tabId);
    } catch {
      return empty;
    }
    claimed = await sendToTab<PageIdentity | null>(tabId, { type: 'content:identity' });
    if (!claimed) return empty;
  }
  let identity: PageIdentity;
  try {
    identity = requireIdentity(claimed, tab.url);
  } catch {
    return empty;
  }
  const found = await repo.lookupPage(identity);
  if (!found) return { ...empty, identity };
  const status = await sendToTab<TabStatus>(tabId, { type: 'content:status' });
  const highlights = found.highlights.sort((a, b) => a.anchor.start - b.anchor.start);
  return {
    identity,
    page: found.page,
    highlights,
    statuses: status?.pageId === found.page.id ? status.statuses : null,
  };
}

async function openHighlight(highlightId: string): Promise<void> {
  const highlight = await repo.getHighlight(highlightId);
  if (!highlight) throw new Error('This highlight no longer exists');
  const page = await repo.getPage(highlight.pageId);
  if (!page) throw new Error('The page of this highlight no longer exists');

  const tab = await findTabForPage(page);
  if (tab?.id !== undefined) {
    await activateTab(tab);
    if (await sendToTab<boolean>(tab.id, { type: 'content:focus', highlightId })) return;
    await setPendingFocus(tab.id, highlightId, page.id);
    await chrome.tabs.reload(tab.id);
    return;
  }
  const created = await chrome.tabs.create({ url: page.url, active: true });
  if (created.id !== undefined) await setPendingFocus(created.id, highlightId, page.id);
}

async function openPage(pageId: string): Promise<void> {
  const page = await repo.getPage(pageId);
  if (!page) throw new Error('This page no longer exists');
  const tab = await findTabForPage(page);
  if (tab) await activateTab(tab);
  else await chrome.tabs.create({ url: page.url, active: true });
}

// ── Context menu & keyboard shortcut ───────────────────────────────────────

async function highlightSelection(tabId: number, color: ColorId): Promise<void> {
  await ensureMain({ tabId });
  await sendToTab(tabId, { type: 'content:create-from-selection', color });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id;
  const command = parseMenuCommand(info.menuItemId);
  if (tabId === undefined || !command) return;
  // Notes are written in the side panel; open it while the menu click still counts as a gesture.
  if (command.kind === 'note') void openSidePanel(tabId);
  void (async () => {
    if (command.kind === 'highlight') {
      await highlightSelection(tabId, command.color);
      return;
    }
    const target = await currentContextTarget();
    if (!target || target.tabId !== tabId) return;
    await assertSameSite(target.highlightId, tab?.url);
    if (command.kind === 'recolor') await updateHighlight(target.highlightId, { color: command.color });
    else if (command.kind === 'delete') await deleteHighlight(target.highlightId);
    else if (command.kind === 'note') await focusInPanel(target.highlightId, 'note', tab?.windowId);
    else await sendToTab(tabId, { type: 'content:open-editor', highlightId: target.highlightId, panel: 'group' });
  })().catch((error: unknown) => console.warn('[JAH] context menu action failed', error));
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'highlight-selection' || tab?.id === undefined) return;
  const tabId = tab.id;
  void lastColor()
    .then((color) => highlightSelection(tabId, color))
    .catch((error: unknown) => console.warn('[JAH] shortcut failed', error));
});

// A right-click target never survives a tab switch.
chrome.tabs.onActivated.addListener(() => {
  if (contextTarget) void setContextTarget(null);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearPendingFocus(tabId).catch(() => undefined);
  void forgetTab(tabId).catch(() => undefined);
});
