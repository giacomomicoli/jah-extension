import { el } from '../shared/dom';
import { icon } from '../shared/icons';
import { request, type KbChangedEvent, type TabPage, type TabStatusEvent } from '../shared/messages';
import type { GroupSummary } from '../shared/types';
import { highlightCard, type EditorState } from './card';
import { errorMessage, faviconUrl, plural } from './format';
import {
  emptyState,
  groupView,
  groupsView,
  pageView,
  recentView,
  searchView,
  siteView,
  sitesView,
  type Route,
  type ViewEnv,
} from './views';

type HomeTab = 'sites' | 'groups' | 'recent';

const state = {
  route: { name: 'home' } as Route,
  history: [] as Route[],
  tab: 'sites' as HomeTab,
  query: '',
  groups: [] as GroupSummary[],
  current: null as TabPage | null,
  currentExpanded: true,
  windowId: undefined as number | undefined,
};
const editors = new Map<string, EditorState>();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const view = $<HTMLElement>('view');
const tabs = $<HTMLElement>('tabs');
const currentSection = $<HTMLElement>('current');
const searchInput = $<HTMLInputElement>('search');
const menuButton = $<HTMLButtonElement>('menu-button');
const menu = $<HTMLElement>('menu');
const fileInput = $<HTMLInputElement>('file');
const toastElement = $<HTMLElement>('toast');
const confirmBar = $<HTMLElement>('confirm');

const env: ViewEnv = {
  groups: () => state.groups,
  editors,
  toast,
  openPage: (page) => navigate({ name: 'page', pageId: page.id }),
  navigate,
  back,
};

// ── Navigation & rendering ─────────────────────────────────────────────────

function navigate(route: Route): void {
  state.history.push(state.route);
  state.route = route;
  clearSearch();
  void render().then(() => window.scrollTo(0, 0));
}

function back(): void {
  state.route = state.history.pop() ?? { name: 'home' };
  void render();
}

function searching(): boolean {
  return state.query.trim().length > 0;
}

function routeView(): Promise<Node> {
  const route = state.route;
  switch (route.name) {
    case 'site':
      return siteView(route.site, env);
    case 'page':
      return pageView(route.pageId, env);
    case 'group':
      return groupView(route.groupId, env);
    case 'home':
      if (state.tab === 'groups') return groupsView(env);
      if (state.tab === 'recent') return recentView(env);
      return sitesView(env);
  }
}

let renderSeq = 0;

async function render(): Promise<void> {
  const seq = ++renderSeq;
  let content: Node;
  try {
    state.groups = (await request('groups:list', {})).groups;
    content = searching() ? await searchView(state.query, env) : await routeView();
  } catch (error) {
    content = emptyState('Something went wrong', errorMessage(error));
  }
  if (seq !== renderSeq) return;
  view.replaceChildren(content);
  const home = state.route.name === 'home' && !searching();
  tabs.hidden = !home;
  for (const button of tabs.querySelectorAll<HTMLElement>('[data-tab]')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === state.tab));
  }
  renderCurrent();
}

// ── "This page" section ────────────────────────────────────────────────────

async function refreshCurrent(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    state.current = tab?.id !== undefined ? await request('kb:tab-page', { tabId: tab.id }) : null;
  } catch {
    state.current = null;
  }
  renderCurrent();
}

function renderCurrent(): void {
  try {
    renderCurrentSection();
  } catch (error) {
    currentSection.hidden = true;
    console.warn('[JAH] could not render the current page', error);
  }
}

function renderCurrentSection(): void {
  const current = state.current;
  const identity = current?.identity;
  if (!identity || state.route.name !== 'home' || searching()) {
    currentSection.hidden = true;
    return;
  }
  currentSection.hidden = false;
  const count = current.highlights.length;
  const expanded = state.currentExpanded && count > 0;
  const header = el(
    'button',
    { class: 'current-header', type: 'button', 'aria-expanded': String(expanded), disabled: count === 0 },
    el('img', { class: 'favicon', src: faviconUrl(identity.locationUrl), alt: '', width: 16, height: 16 }),
    el(
      'span',
      { class: 'current-title' },
      el('span', { class: 'eyebrow' }, 'This page'),
      el('span', { class: 'current-name' }, current.page?.title ?? identity.title),
    ),
    count ? el('span', { class: 'count' }, String(count)) : null,
    count ? icon(expanded ? 'chevronDown' : 'chevronRight') : null,
  );
  header.addEventListener('click', () => {
    state.currentExpanded = !state.currentExpanded;
    renderCurrent();
  });

  const body = el('div', { class: 'current-body' });
  if (!count) {
    body.append(el('p', { class: 'hint' }, 'No highlights here yet. Select some text on the page to add one.'));
  } else if (expanded) {
    const unresolved = current.highlights.filter((highlight) => current.statuses?.[highlight.id] === 'unresolved').length;
    if (unresolved) {
      body.append(
        el('p', { class: 'hint warn' }, `${plural(unresolved, 'highlight')} could not be found in the current version of this page.`),
      );
    }
    const cards = el('div', { class: 'cards' });
    for (const highlight of current.highlights) {
      cards.append(highlightCard(highlight, { status: current.statuses?.[highlight.id] ?? null }, env));
    }
    body.append(cards);
    const site = identity.site;
    const all = el('button', { class: 'link', type: 'button' }, `All pages from ${site}`, icon('chevronRight'));
    all.addEventListener('click', () => navigate({ name: 'site', site }));
    body.append(all);
  }
  currentSection.replaceChildren(header, body);
}

// ── Toast & confirmation ───────────────────────────────────────────────────

let toastTimer: number | undefined;

function toast(message: string, isError = false): void {
  toastElement.textContent = message;
  toastElement.classList.toggle('error', isError);
  toastElement.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastElement.hidden = true), isError ? 5000 : 3000);
}

function confirmAction(message: string, confirmLabel: string, onConfirm: () => void): void {
  const cancel = el('button', { class: 'button', type: 'button' }, 'Cancel');
  const confirm = el('button', { class: 'button danger', type: 'button' }, confirmLabel);
  cancel.addEventListener('click', () => (confirmBar.hidden = true));
  confirm.addEventListener('click', () => {
    confirmBar.hidden = true;
    onConfirm();
  });
  confirmBar.replaceChildren(el('p', {}, message), el('div', { class: 'confirm-actions' }, cancel, confirm));
  confirmBar.hidden = false;
}

// ── Export / import ────────────────────────────────────────────────────────

async function exportData(): Promise<void> {
  const { data } = await request('kb:export', {});
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `jah-highlights-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  toast(`Exported ${plural(data.highlights.length, 'highlight')} from ${plural(data.pages.length, 'page')}`);
}

let importMode: 'merge' | 'replace' = 'merge';

function pickImportFile(mode: 'merge' | 'replace'): void {
  importMode = mode;
  fileInput.value = '';
  fileInput.click();
}

async function importFile(file: File, mode: 'merge' | 'replace'): Promise<void> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('This file is not valid JSON', true);
    return;
  }
  const run = async () => {
    try {
      const stats = await request('kb:import', { data, mode });
      const skipped = stats.skipped ? `, ${stats.skipped} skipped` : '';
      toast(`Imported ${plural(stats.highlights, 'new highlight')}, ${plural(stats.pages, 'new page')}${skipped}`);
    } catch (error) {
      toast(errorMessage(error), true);
    }
  };
  if (mode === 'replace') {
    confirmAction(
      `Replace your whole knowledge base with “${file.name}”? Current highlights not in the file will be lost.`,
      'Replace everything',
      () => void run(),
    );
  } else {
    await run();
  }
}

// ── Wiring ─────────────────────────────────────────────────────────────────

function clearSearch(): void {
  searchInput.value = '';
  state.query = '';
}

let searchTimer: number | undefined;
searchInput.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    state.query = searchInput.value;
    void render();
  }, 150);
});
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && searchInput.value) {
    clearSearch();
    void render();
  }
});

document.addEventListener('keydown', (event) => {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (event.key === '/' && !typing) {
    event.preventDefault();
    searchInput.focus();
  }
});

tabs.addEventListener('click', (event) => {
  const tab = (event.target as Element).closest<HTMLElement>('[data-tab]')?.dataset.tab as HomeTab | undefined;
  if (!tab || tab === state.tab) return;
  state.tab = tab;
  void render();
});

menuButton.addEventListener('click', () => {
  menu.hidden = !menu.hidden;
  menuButton.setAttribute('aria-expanded', String(!menu.hidden));
});
document.addEventListener('click', (event) => {
  if (!menu.hidden && !menu.contains(event.target as Node) && !menuButton.contains(event.target as Node)) {
    menu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
  }
});
menu.addEventListener('click', (event) => {
  const command = (event.target as Element).closest<HTMLElement>('[data-command]')?.dataset.command;
  if (!command) return;
  menu.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
  if (command === 'export') exportData().catch((error: unknown) => toast(errorMessage(error), true));
  if (command === 'import-merge') pickImportFile('merge');
  if (command === 'import-replace') pickImportFile('replace');
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void importFile(file, importMode);
});

let refreshTimer: number | undefined;
function scheduleRefresh(): void {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    void render();
    void refreshCurrent();
  }, 120);
}

let currentTimer: number | undefined;
function scheduleCurrent(): void {
  window.clearTimeout(currentTimer);
  currentTimer = window.setTimeout(() => void refreshCurrent(), 250);
}

function isKbChanged(message: unknown): message is KbChangedEvent {
  return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'kb:changed';
}

function isTabStatus(message: unknown): message is TabStatusEvent {
  return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'tab:status';
}

// Never answer: requests are for the service worker, this page only listens to broadcasts.
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isKbChanged(message)) scheduleRefresh();
  else if (isTabStatus(message)) scheduleCurrent();
});

chrome.tabs.onActivated.addListener((info) => {
  if (info.windowId === state.windowId) void refreshCurrent();
});
chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (tab.active && tab.windowId === state.windowId && (info.status === 'complete' || info.url)) scheduleCurrent();
});

void chrome.windows.getCurrent().then((window) => {
  state.windowId = window.id;
});
void render();
void refreshCurrent();
