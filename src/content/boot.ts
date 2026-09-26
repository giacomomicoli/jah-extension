/**
 * Runs on every page, so it must stay cheap: it computes the page identity, asks the service
 * worker once whether this page has stored highlights, and shows the selection toolbar.
 * Everything expensive (text map, resolver, renderer) lives in content-main, which the
 * service worker injects only when this page has highlights or the user creates one.
 */
import type { ColorId } from '../shared/colors';
import { TAKEOVER_EVENT, request, type KbChange, type TabMessage } from '../shared/messages';
import type { PageIdentity } from '../shared/types';
import { computeIdentity } from './identity';
import { jah, runtimeAlive, type BootApi, type MainApi } from './shared';
import { SelectionToolbar } from './toolbar';

bootstrap();

function bootstrap(): void {
  if (window.top !== window || !(document.documentElement instanceof HTMLElement) || !document.body) return;

  const shared = jah();
  // A previous instance in this world (re-injected after an update) steps aside. Copies in another
  // isolated world were already told to stop by the TAKEOVER_EVENT the service worker fires.
  shared.boot?.dispose();
  shared.main?.dispose();
  shared.main = undefined;

  let identity: PageIdentity | null = computeIdentity();
  let lookupSeq = 0;
  const cleanups: Array<() => void> = [];

  const toolbar = new SelectionToolbar({
    highlight: (range, color, openNote) => void createHighlight(range, color, openNote),
  });

  const api: BootApi = {
    alive: () => runtimeAlive() && shared.boot === api,
    dispose: () => teardown(),
    identity: () => identity,
    lookup,
    hideToolbar: () => toolbar.hide(),
  };
  shared.boot = api;
  shared.debug.toolbarButtons = () => toolbar.buttonRects();

  function on<E extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
    options?: AddEventListenerOptions | boolean,
  ): void {
    const listener = (event: Event) => {
      if (!api.alive()) {
        teardown();
        return;
      }
      handler(event as E);
    };
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  }

  function teardown(): void {
    for (const cleanup of cleanups.splice(0)) cleanup();
    toolbar.hide();
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // Orphaned context: nothing left to unregister.
    }
  }

  async function lookup(): Promise<void> {
    const seq = ++lookupSeq;
    if (!identity) return;
    try {
      const { page, highlights, focusId } = await request('page:lookup', { identity });
      if (seq !== lookupSeq || !page) return;
      await jah().main?.restore(page, highlights, focusId);
    } catch (error) {
      if (runtimeAlive()) console.debug('[JAH] lookup failed', error);
    }
  }

  async function ensureMain(): Promise<MainApi> {
    const current = jah().main;
    if (current?.alive()) return current;
    await request('content:ensure-main', {});
    const main = jah().main;
    if (!main) throw new Error('The highlighter could not be loaded on this page');
    return main;
  }

  async function createHighlight(range: Range, color: ColorId | undefined, openNote: boolean): Promise<void> {
    try {
      const main = await ensureMain();
      await main.createFromRange(range, color, { openNote });
    } catch (error) {
      console.warn('[JAH] could not create highlight', error);
    }
  }

  async function focusHighlight(highlightId: string): Promise<void> {
    if (!jah().main?.alive()) await lookup();
    await jah().main?.focus(highlightId);
  }

  function concernsThisPage(change: KbChange): boolean {
    if (change.kind === 'reset') return true;
    if (change.kind !== 'highlight-upsert' || !identity) return false;
    const { canonicalUrl, locationUrl } = identity;
    return change.page.urls.some((url) => url === canonicalUrl || url === locationUrl);
  }

  function onMessage(message: TabMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) {
    if (!api.alive()) return;
    switch (message.type) {
      case 'content:identity':
        sendResponse(identity);
        return;
      case 'content:focus':
        void focusHighlight(message.highlightId);
        sendResponse(true);
        return;
      case 'content:kb-changed':
        // Once loaded, content-main applies changes itself.
        if (!jah().main?.alive() && concernsThisPage(message.change)) void lookup();
        return;
    }
  }

  // ── Selection toolbar ────────────────────────────────────────────────────

  function evaluateSelection(pointer?: { x: number; y: number }): void {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      toolbar.hide();
      return;
    }
    const range = selection.getRangeAt(0);
    if (
      !document.body.contains(range.commonAncestorContainer) ||
      isEditable(range.startContainer) ||
      isEditable(range.endContainer) ||
      !selection.toString().trim()
    ) {
      toolbar.hide();
      return;
    }
    jah().main?.closeEditor();
    toolbar.show(range.cloneRange(), pointer);
  }

  on<MouseEvent>(document, 'mouseup', (event) => {
    if (event.button !== 0 || toolbar.owns(event)) return;
    const pointer = { x: event.clientX, y: event.clientY };
    window.setTimeout(() => evaluateSelection(pointer), 0);
  }, true);

  on<KeyboardEvent>(document, 'keyup', (event) => {
    if (toolbar.owns(event)) return;
    if (event.key === 'Shift' || (event.shiftKey && /^(Arrow|Home|End|Page)/.test(event.key))) evaluateSelection();
  }, true);

  on<KeyboardEvent>(document, 'keydown', (event) => {
    if (event.key === 'Escape' && toolbar.visible) toolbar.hide();
  }, true);

  on<MouseEvent>(document, 'mousedown', (event) => {
    if (toolbar.visible && !toolbar.owns(event)) toolbar.hide();
  }, true);

  on(document, 'selectionchange', () => {
    if (!toolbar.visible) return;
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) toolbar.hide();
  });

  on(window, 'scroll', () => toolbar.scheduleReposition(), { capture: true, passive: true });
  on(window, 'resize', () => toolbar.scheduleReposition(), { passive: true });
  // No-op for the live instance: the `on` wrapper tears orphaned instances down.
  on(document, TAKEOVER_EVENT, () => undefined);

  // ── Same-document navigations (SPAs) ─────────────────────────────────────

  let lastHref = location.href;
  let navigationTimer: number | undefined;
  const onNavigation = () => {
    window.clearTimeout(navigationTimer);
    // Give the app a moment to update the title and canonical link.
    navigationTimer = window.setTimeout(() => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      const next = computeIdentity();
      const changed = next?.canonicalUrl !== identity?.canonicalUrl || next?.locationUrl !== identity?.locationUrl;
      identity = next;
      if (!changed) return;
      toolbar.hide();
      jah().main?.reset();
      void lookup();
    }, 500);
  };
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  if (navigation) on(navigation, 'navigatesuccess', onNavigation);
  on(window, 'popstate', onNavigation);
  on(window, 'hashchange', onNavigation);

  chrome.runtime.onMessage.addListener(onMessage);
  // A prerendered page is not shown yet: look up its highlights once it is activated.
  if ((document as Document & { prerendering?: boolean }).prerendering) {
    on(document, 'prerenderingchange', () => void lookup(), { once: true });
  } else {
    void lookup();
  }
}

function isEditable(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!element) return false;
  return (element as HTMLElement).isContentEditable || !!element.closest('input, textarea, select');
}
