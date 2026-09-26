/**
 * Injected by the service worker only when the page has stored highlights or the user
 * creates one. Owns the text map, the anchor resolver, the renderer and the editor.
 */
import type { ColorId } from '../shared/colors';
import { request, type EditorPanel, type KbChange, type TabMessage, type TabStatus } from '../shared/messages';
import type { Highlight, HighlightPatch, Page, ResolutionStatus } from '../shared/types';
import { MAX_QUOTE_LENGTH } from '../shared/limits';
import { createAnchor, resolveTarget } from './anchor';
import { HighlightEditor } from './editor';
import { Renderer } from './renderer';
import { resolveAnchor } from './resolver';
import { RetrySchedule } from './retry';
import { TAKEOVER_EVENT, jah, runtimeAlive, type MainApi } from './shared';
import { TextMap } from './textmap';

const HEALTH_CHECK_DELAY = 1000;
const HOVER_THROTTLE = 120;
/** Added text at least this long counts as new content worth an immediate retry. */
const SUBSTANTIAL_TEXT = 40;

initialize();

function initialize(): void {
  const shared = jah();
  if (shared.main?.alive()) return;
  shared.main?.dispose();

  const renderer = new Renderer();
  const records = new Map<string, Highlight>();
  const statuses = new Map<string, ResolutionStatus>();
  /** Whitespace-free text each rendered range covered when it was rendered. */
  const baselines = new Map<string, string>();
  const cleanups: Array<() => void> = [];

  let pageId: string | null = null;
  let generation = 0;
  let map: TextMap | null = null;
  let mapDirty = true;
  let observer: MutationObserver | null = null;
  let healthTimer: number | undefined;
  let healthDueAt = Infinity;
  const retries = new RetrySchedule();
  let contextTarget: string | null = null;
  let lastRightClick: { x: number; y: number } | undefined;

  const editor = new HighlightEditor({
    record: (id) => records.get(id),
    range: (id) => renderer.range(id),
    setActive: (id) => renderer.setActive(id),
    update: updateHighlight,
    remove: removeHighlight,
    groups: async () => (await request('groups:list', {})).groups,
    createGroup: async (name) => (await request('group:create', { name })).group,
  });

  const api: MainApi = {
    alive: () => runtimeAlive() && shared.main === api,
    dispose,
    restore,
    reset,
    createFromRange,
    createFromSelection,
    focus,
    closeEditor: () => editor.close(),
  };
  shared.main = api;
  shared.debug.editorButtons = () => editor.buttonRects();

  // ── Text map & resolution ───────────────────────────────────────────────

  /** Reuses the current map unless the DOM may have changed since it was built. */
  function textMap(fresh = false): TextMap {
    if (fresh || !map || mapDirty || !observer || map.root !== document.body) {
      map = new TextMap(document.body);
      mapDirty = false;
    }
    return map;
  }

  function render(id: string, range: Range, highlight: Highlight, status: ResolutionStatus): void {
    renderer.add(id, range, highlight.color);
    statuses.set(id, status);
    baselines.set(id, compact(range.toString()));
  }

  function resolvePending(): void {
    const pending = [...records.values()].filter((highlight) => !renderer.has(highlight.id));
    if (!pending.length) return;
    const current = textMap();
    const target = resolveTarget(current);
    for (const highlight of pending) {
      const result = resolveAnchor(highlight.anchor, target);
      const range = result.status === 'unresolved' ? null : current.rangeFor(result.start, result.end);
      if (range) render(highlight.id, range, highlight, result.status);
      else statuses.set(highlight.id, 'unresolved');
    }
  }

  function report(): void {
    let unresolved = 0;
    for (const id of records.keys()) if (!renderer.has(id)) unresolved++;
    void request('content:report', { total: records.size, unresolved }).catch(() => undefined);
  }

  // ── Watching the page (only while it has highlights) ─────────────────────

  function startObserving(): void {
    if (observer || !records.size) return;
    retries.reset();
    observer = new MutationObserver((mutations) => {
      const relevant = mutations.filter((mutation) => !isOwnUi(mutation));
      if (!relevant.length) return;
      mapDirty = true;
      if (relevant.some(revealsContent)) retries.reset();
      scheduleHealthCheck(HEALTH_CHECK_DELAY);
    });
    // The whole document, so a replaced <body> and toggled `hidden` sections are noticed too.
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden'],
    });
  }

  /** Plans a health check in `delay` ms, unless one is already planned no later than that. */
  function scheduleHealthCheck(delay: number): void {
    const due = Date.now() + delay;
    if (healthTimer !== undefined && healthDueAt <= due) return;
    window.clearTimeout(healthTimer);
    healthDueAt = due;
    healthTimer = window.setTimeout(checkHealth, delay);
  }

  function stopObserving(): void {
    observer?.disconnect();
    observer = null;
    window.clearTimeout(healthTimer);
    healthTimer = undefined;
    healthDueAt = Infinity;
  }

  /** Drops ranges whose text changed under them and retries unresolved highlights. */
  function checkHealth(): void {
    healthTimer = undefined;
    healthDueAt = Infinity;
    if (!api.alive()) {
      dispose();
      return;
    }
    const broken: string[] = [];
    for (const [id, range] of renderer.all()) {
      if (range.collapsed || compact(range.toString()) !== baselines.get(id)) broken.push(id);
    }
    for (const id of broken) {
      renderer.remove(id);
      baselines.delete(id);
    }
    const missing = [...records.keys()].some((id) => !renderer.has(id));
    if (!missing) {
      if (broken.length) report();
      return;
    }
    // Broken ranges are re-resolved at once; highlights that were already missing back off.
    const now = Date.now();
    const wait = broken.length ? 0 : retries.wait(now);
    if (wait > 0) {
      scheduleHealthCheck(wait);
      return;
    }
    if (!broken.length) retries.attempted(now);
    resolvePending();
    report();
    if (editor.openId && !renderer.has(editor.openId)) editor.close();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async function restore(page: Page, highlights: Highlight[], focusId?: string): Promise<void> {
    const current = ++generation;
    editor.close();
    renderer.clear();
    records.clear();
    statuses.clear();
    baselines.clear();
    pageId = page.id;
    for (const highlight of highlights) records.set(highlight.id, highlight);
    resolvePending();
    startObserving();
    report();
    if (focusId && current === generation) await focus(focusId);
  }

  function reset(): void {
    generation++;
    stopObserving();
    editor.close();
    renderer.clear();
    records.clear();
    statuses.clear();
    baselines.clear();
    pageId = null;
    map = null;
    syncContextTarget(null);
    report();
  }

  async function createFromRange(range: Range, color?: ColorId, options: { openNote?: boolean } = {}): Promise<void> {
    const identity = jah().boot?.identity();
    if (!identity) {
      editor.toast('This page cannot be highlighted');
      return;
    }
    let current = textMap();
    let offsets = placeSelection(current, range);
    if (!offsets) {
      // The map may predate a DOM change the observer could not see: retry once from scratch.
      current = textMap(true);
      offsets = placeSelection(current, range);
    }
    if (!offsets) {
      editor.toast('This part of the page cannot be highlighted');
      return;
    }
    if (offsets.end - offsets.start > MAX_QUOTE_LENGTH) {
      editor.toast('This selection is too long to highlight');
      return;
    }

    const anchor = createAnchor(current, offsets.start, offsets.end);
    const liveRange = current.rangeFor(offsets.start, offsets.end);
    const { highlight, page } = await request('highlight:create', {
      identity,
      fingerprint: current.fingerprint,
      anchor,
      color,
    });
    pageId = page.id;
    records.set(highlight.id, highlight);
    if (liveRange) render(highlight.id, liveRange, highlight, 'resolved');
    else resolvePending();
    document.getSelection()?.removeAllRanges();
    startObserving();
    report();
    if (options.openNote) editor.open(highlight.id, undefined, 'note');
  }

  async function createFromSelection(color: ColorId): Promise<void> {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      editor.toast('Select some text to highlight');
      return;
    }
    jah().boot?.hideToolbar();
    await createFromRange(selection.getRangeAt(0).cloneRange(), color);
  }

  async function focus(id: string): Promise<void> {
    if (records.has(id) && !renderer.has(id)) {
      resolvePending();
      report();
    }
    const range = renderer.range(id);
    if (!range) {
      editor.toast('This highlight could not be found on the page');
      return;
    }
    const container = range.startContainer;
    const element = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    renderer.flash(id);
  }

  function dispose(): void {
    generation++;
    for (const cleanup of cleanups.splice(0)) cleanup();
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // Orphaned context.
    }
    stopObserving();
    editor.close();
    renderer.clear();
    if (shared.main === api) shared.main = undefined;
  }

  // ── Mutations requested from the page UI ─────────────────────────────────

  async function updateHighlight(id: string, patch: HighlightPatch): Promise<void> {
    const { highlight } = await request('highlight:update', { id, patch });
    applyRecord(highlight);
  }

  async function removeHighlight(id: string): Promise<void> {
    await request('highlight:delete', { id });
    forget(id);
  }

  function applyRecord(highlight: Highlight): void {
    const previous = records.get(highlight.id);
    records.set(highlight.id, highlight);
    if (!previous) {
      resolvePending();
      startObserving();
    } else if (previous.color !== highlight.color) {
      renderer.recolor(highlight.id, highlight.color);
    }
    editor.refresh(highlight.id);
    report();
  }

  function forget(id: string): void {
    if (editor.openId === id) editor.close();
    records.delete(id);
    statuses.delete(id);
    baselines.delete(id);
    renderer.remove(id);
    if (!records.size) stopObserving();
    report();
  }

  function applyChange(change: KbChange): void {
    switch (change.kind) {
      case 'highlight-upsert': {
        const { highlight, page } = change;
        if (highlight.pageId !== pageId) {
          const identity = jah().boot?.identity();
          const samePage =
            pageId === null &&
            !!identity &&
            page.urls.some((url) => url === identity.canonicalUrl || url === identity.locationUrl);
          if (!samePage) return;
          pageId = page.id;
        }
        applyRecord(highlight);
        return;
      }
      case 'highlight-delete':
        if (change.pageId === pageId) forget(change.highlightId);
        return;
      case 'page-delete':
        if (change.pageId === pageId) reset();
        return;
      case 'groups':
        editor.invalidateGroups();
        return;
      case 'reset':
        reset();
        void jah().boot?.lookup();
        return;
    }
  }

  // ── Native context menu support ──────────────────────────────────────────

  /** Tells the service worker which highlight (if any) a right-click would target. */
  function syncContextTarget(id: string | null): void {
    if (id === contextTarget) return;
    contextTarget = id;
    void request('ctx:target', { highlightId: id }).catch(() => undefined);
  }

  function openEditorFromMenu(id: string, panel: EditorPanel): void {
    jah().boot?.hideToolbar();
    editor.open(id, lastRightClick, panel);
  }

  // ── Events ───────────────────────────────────────────────────────────────

  function on<E extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
    options?: AddEventListenerOptions | boolean,
  ): void {
    const listener = (event: Event) => {
      if (!api.alive()) {
        dispose();
        return;
      }
      handler(event as E);
    };
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  }

  on<MouseEvent>(document, 'mousedown', (event) => {
    if (!editor.owns(event)) editor.close();
    if (event.button === 2 && renderer.size) {
      lastRightClick = { x: event.clientX, y: event.clientY };
      syncContextTarget(renderer.hitTest(event.clientX, event.clientY));
    }
  }, true);

  on<MouseEvent>(document, 'click', (event) => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!renderer.size || editor.owns(event)) return;
    const target = event.target as Element | null;
    if (!target || target.localName === 'jah-ui') return;
    if (target.closest('a[href], button, input, textarea, select, label, summary, [contenteditable="true"]')) return;
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed) return;
    const id = renderer.hitTest(event.clientX, event.clientY);
    if (!id) return;
    jah().boot?.hideToolbar();
    editor.open(id, { x: event.clientX, y: event.clientY });
  }, true);

  let hoverTimer: number | undefined;
  let hoverPoint = { x: 0, y: 0 };
  on<MouseEvent>(document, 'mousemove', (event) => {
    hoverPoint = { x: event.clientX, y: event.clientY };
    if (hoverTimer !== undefined || !renderer.size) return;
    // Keeps the native context menu in sync before the right-click happens.
    hoverTimer = window.setTimeout(() => {
      hoverTimer = undefined;
      syncContextTarget(renderer.hitTest(hoverPoint.x, hoverPoint.y));
    }, HOVER_THROTTLE);
  }, { capture: true, passive: true });

  on<KeyboardEvent>(document, 'keydown', (event) => {
    if (event.key === 'Escape' && editor.openId) editor.close();
  }, true);

  on(window, 'scroll', () => editor.scheduleReposition(), { capture: true, passive: true });
  on(window, 'resize', () => editor.scheduleReposition(), { passive: true });
  // No-op for the live instance: the `on` wrapper disposes orphaned instances.
  on(document, TAKEOVER_EVENT, () => undefined);

  function onMessage(message: TabMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) {
    if (!api.alive()) return;
    switch (message.type) {
      case 'content:status': {
        const status: TabStatus = { pageId, statuses: Object.fromEntries(statuses) };
        sendResponse(status);
        return;
      }
      case 'content:create-from-selection':
        void createFromSelection(message.color).catch((error: unknown) => console.warn('[JAH]', error));
        return;
      case 'content:open-editor':
        openEditorFromMenu(message.highlightId, message.panel);
        return;
      case 'content:kb-changed':
        applyChange(message.change);
        return;
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);
}

/** Text without whitespace or invisible characters, for cheap "did this range change?" checks. */
function compact(text: string): string {
  return text.replace(/[\s­​⁠﻿]+/g, '');
}

/**
 * Normalized offsets of a user selection, or null when the map cannot account for it (e.g. the
 * selection lives in a shadow tree or in content the map does not know yet).
 */
function placeSelection(map: TextMap, range: Range): { start: number; end: number } | null {
  const offsets = map.rangeToOffsets(range);
  if (!offsets) return null;
  const selected = compact(range.toString());
  const captured = compact(map.text.slice(offsets.start, offsets.end));
  return selected && captured.length < selected.length / 2 ? null : offsets;
}

/** Mutations caused only by attaching or detaching the extension's own UI host. */
function isOwnUi(mutation: MutationRecord): boolean {
  if (mutation.type !== 'childList' || mutation.target !== document.documentElement) return false;
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return nodes.length > 0 && nodes.every((node) => node.nodeName === 'JAH-UI');
}

/** Whether a mutation may have made new text available (added content, un-hidden sections). */
function revealsContent(mutation: MutationRecord): boolean {
  if (mutation.type === 'attributes') return true;
  if (mutation.type !== 'childList') return false;
  for (const node of mutation.addedNodes) {
    if ((node.textContent?.length ?? 0) >= SUBSTANTIAL_TEXT) return true;
  }
  return false;
}
