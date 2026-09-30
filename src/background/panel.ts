import { ext } from '../shared/ext';

/** Firefox's per-window sidebar, which stands in for Chrome's side panel. */
interface SidebarAction {
  open(): Promise<void>;
  toggle(): Promise<void>;
  isOpen(details: { windowId?: number }): Promise<boolean>;
}

const sidebar = () => (ext as unknown as { sidebarAction: SidebarAction }).sidebarAction;

/** Makes the toolbar button show the panel. Call from the top level of the background script. */
export function openPanelOnActionClick(): void {
  if (__BROWSER__ === 'firefox') {
    ext.action.onClicked.addListener(() => void sidebar().toggle());
    return;
  }
  const enable = () =>
    void ext.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) => console.warn('[JAH] side panel behavior', error));
  ext.runtime.onInstalled.addListener(enable);
  ext.runtime.onStartup.addListener(enable);
}

/**
 * Opens the panel next to the tab. Both browsers only allow it in response to a user action,
 * which survives only while the message or menu handler runs synchronously: call this before
 * any await. Firefox never counts a message from a page as a user action, so there it only
 * succeeds from a menu click, and otherwise reports whether the sidebar is already open.
 */
export function openPanel(tab: { id: number; windowId: number }): Promise<boolean> {
  if (__BROWSER__ === 'firefox') {
    return sidebar()
      .open()
      .then(
        () => true,
        () => sidebar().isOpen({ windowId: tab.windowId }).catch(() => false),
      );
  }
  return ext.sidePanel.open({ tabId: tab.id }).then(
    () => true,
    () => false,
  );
}
