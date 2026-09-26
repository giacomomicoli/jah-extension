import { COLORS, type ColorId } from '../shared/colors';
import type { EditorPanel, PanelFocus } from '../shared/messages';
import type { GroupSummary, Highlight, HighlightPatch } from '../shared/types';
import { check, folder, pencil, plus, trash } from '../shared/icons';
import { el, placeNear, svgIcon } from './ui/dom';
import { UiHost } from './ui/host';
import { EDITOR_CSS } from './ui/editor-styles';

export interface EditorDeps {
  record(id: string): Highlight | undefined;
  range(id: string): Range | undefined;
  setActive(id: string | null): void;
  update(id: string, patch: HighlightPatch): Promise<void>;
  remove(id: string): Promise<void>;
  groups(): Promise<GroupSummary[]>;
  /** Continues in the side panel, where the page cannot observe what is typed. */
  openInPanel(id: string, focus: PanelFocus): void;
}

/**
 * Popover for acting on an existing highlight: color, group, delete. It deliberately has no
 * text inputs: a page's scripts can read keystrokes typed into UI shown on top of it, so notes
 * and new group names are written in the side panel.
 */
export class HighlightEditor {
  private readonly host = new UiHost(EDITOR_CSS);
  private panel: HTMLElement | null = null;
  private toastElement: HTMLElement | null = null;
  private toastTimer: number | undefined;
  private disarmTimer: number | undefined;
  private frame = 0;
  private id: string | null = null;
  private view: EditorPanel = 'main';
  private point: { x: number; y: number } | undefined;
  private rectIndex = 0;
  private groups: GroupSummary[] | null = null;

  constructor(private readonly deps: EditorDeps) {}

  get openId(): string | null {
    return this.id;
  }

  owns(event: Event): boolean {
    return this.host.owns(event);
  }

  open(id: string, point?: { x: number; y: number }, view: EditorPanel = 'main'): void {
    const range = this.deps.range(id);
    if (!this.deps.record(id) || !range) return;
    this.id = id;
    this.view = view;
    this.point = point;
    this.rectIndex = nearestRectIndex(range, point);
    this.groups = null;
    this.deps.setActive(id);
    this.render();
    void this.loadGroups();
  }

  close(): void {
    if (!this.id && !this.panel) return;
    this.id = null;
    window.clearTimeout(this.disarmTimer);
    cancelAnimationFrame(this.frame);
    this.panel?.remove();
    this.panel = null;
    this.deps.setActive(null);
    if (!this.toastElement) this.host.unmount();
  }

  /** Re-renders after the record changed elsewhere (side panel, another tab). */
  refresh(id: string): void {
    if (this.id === id && this.view === 'main') this.render();
  }

  invalidateGroups(): void {
    if (!this.id) return;
    this.groups = null;
    void this.loadGroups();
  }

  scheduleReposition(): void {
    if (!this.panel) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.reposition());
  }

  toast(message: string): void {
    const root = this.host.mount();
    this.toastElement?.remove();
    const toast = el('div', { class: 'toast', role: 'status' }, message);
    root.append(toast);
    this.toastElement = toast;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      toast.remove();
      if (this.toastElement === toast) this.toastElement = null;
      if (!this.panel) this.host.unmount();
    }, 3000);
  }

  /** Every control currently shown, by action (text inputs would appear as "textarea"/"input"). */
  buttonRects(): Record<string, DOMRect> {
    const rects: Record<string, DOMRect> = {};
    this.panel?.querySelectorAll<HTMLElement>('[data-action]').forEach((element) => {
      rects[element.dataset.action!] = element.getBoundingClientRect();
    });
    this.panel?.querySelectorAll<HTMLElement>('textarea, input').forEach((element) => {
      rects[element.localName] = element.getBoundingClientRect();
    });
    return rects;
  }

  private async loadGroups(): Promise<void> {
    const id = this.id;
    try {
      const groups = await this.deps.groups();
      if (this.id !== id) return;
      this.groups = groups;
      this.render();
    } catch {
      // The group list is optional decoration; the editor still works without it.
    }
  }

  private render(): void {
    const record = this.id ? this.deps.record(this.id) : undefined;
    if (!record) {
      this.close();
      return;
    }
    const panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': 'Highlight' });
    if (this.view === 'group') this.renderGroups(panel, record);
    else this.renderMain(panel, record);
    // No text inputs here, so keeping focus (and the page selection) where it is costs nothing.
    panel.addEventListener('mousedown', (event) => event.preventDefault());

    const root = this.host.mount();
    this.panel?.remove();
    this.panel = panel;
    root.append(panel);
    this.reposition();
  }

  private renderMain(panel: HTMLElement, record: Highlight): void {
    const row = el('div', { class: 'row' });
    for (const color of COLORS) {
      const swatch = el('button', {
        class: 'swatch',
        type: 'button',
        title: color.label,
        'aria-label': `Color ${color.label.toLowerCase()}`,
        'aria-pressed': record.color === color.id ? 'true' : 'false',
        'data-action': `color:${color.id}`,
      });
      swatch.style.setProperty('--swatch', color.swatch);
      row.append(swatch);
    }
    const noteLabel = record.note ? 'Edit the note in the side panel' : 'Add a note in the side panel';
    row.append(
      el('span', { class: 'sep' }),
      iconButton('note', pencil, noteLabel),
      iconButton('group', folder, 'Group'),
      iconButton('delete', trash, 'Delete highlight'),
    );
    panel.append(row);

    if (record.note) {
      panel.append(el('div', { class: 'note-preview', 'data-action': 'note', title: noteLabel }, record.note));
    }
    const groupName = record.groupId ? this.groups?.find((item) => item.group.id === record.groupId)?.group.name : undefined;
    if (groupName) panel.append(el('div', { class: 'meta' }, `Group: ${groupName}`));

    panel.addEventListener('click', (event) => {
      const target = (event.target as Element).closest<HTMLElement>('[data-action]');
      const action = target?.dataset.action;
      if (!action || !this.id) return;
      if (action.startsWith('color:')) {
        void this.apply({ color: action.slice('color:'.length) as ColorId });
      } else if (action === 'note') {
        this.continueInPanel('note');
      } else if (action === 'group') {
        this.switchTo('group');
      } else if (action === 'delete') {
        this.confirmDelete(target!);
      }
    });
  }

  private renderGroups(panel: HTMLElement, record: Highlight): void {
    const options = el('div', { class: 'options', role: 'listbox', 'aria-label': 'Groups' });
    const addOption = (groupId: string | null, label: string) => {
      const selected = (record.groupId ?? null) === groupId;
      const option = el(
        'button',
        { class: 'option', type: 'button', role: 'option', 'aria-selected': selected ? 'true' : 'false', 'data-action': `group:${groupId ?? ''}` },
        el('span', { class: 'tick' }, selected ? svgIcon(check) : null),
        el('span', { class: 'label' }, label),
      );
      option.addEventListener('click', () => void this.apply({ groupId }, 'main'));
      options.append(option);
    };
    addOption(null, 'No group');
    if (this.groups) {
      for (const { group } of this.groups) addOption(group.id, group.name);
    } else {
      options.append(el('div', { class: 'meta' }, 'Loading groups…'));
    }

    const create = el(
      'button',
      { class: 'option', type: 'button', 'data-action': 'new-group', title: 'Name the new group in the side panel' },
      el('span', { class: 'tick' }, svgIcon(plus)),
      el('span', { class: 'label' }, 'New group…'),
    );
    create.addEventListener('click', () => this.continueInPanel('group'));
    options.append(create);

    const back = el('button', { class: 'btn', type: 'button', 'data-action': 'back' }, 'Back');
    back.addEventListener('click', () => this.switchTo('main'));
    panel.append(options, el('div', { class: 'actions' }, back));
  }

  private switchTo(view: EditorPanel): void {
    this.view = view;
    this.render();
  }

  private continueInPanel(focus: PanelFocus): void {
    const id = this.id;
    if (!id) return;
    this.close();
    this.deps.openInPanel(id, focus);
  }

  private async apply(patch: HighlightPatch, nextView?: EditorPanel): Promise<void> {
    const id = this.id;
    if (!id) return;
    try {
      await this.deps.update(id, patch);
      if (this.id !== id) return;
      if (nextView) this.view = nextView;
      this.render();
    } catch (error) {
      this.toast(errorMessage(error));
    }
  }

  private confirmDelete(button: HTMLElement): void {
    const id = this.id;
    if (!id) return;
    if (button.dataset.armed === 'true') {
      window.clearTimeout(this.disarmTimer);
      this.close();
      void this.deps.remove(id).catch((error: unknown) => this.toast(errorMessage(error)));
      return;
    }
    button.dataset.armed = 'true';
    button.title = 'Click again to delete';
    window.clearTimeout(this.disarmTimer);
    this.disarmTimer = window.setTimeout(() => {
      button.dataset.armed = 'false';
      button.title = 'Delete highlight';
    }, 3000);
  }

  private reposition(): void {
    if (!this.panel || !this.id) return;
    const range = this.deps.range(this.id);
    if (!range) {
      this.close();
      return;
    }
    const rects = range.getClientRects();
    const rect = rects[Math.min(this.rectIndex, rects.length - 1)] ?? range.getBoundingClientRect();
    const offscreen = rect.bottom < 0 || rect.top > window.innerHeight;
    this.panel.style.visibility = offscreen ? 'hidden' : 'visible';
    placeNear(this.panel, rect, this.point);
    this.point = undefined;
  }
}

function iconButton(action: string, paths: readonly string[], label: string): HTMLButtonElement {
  return el('button', { class: 'icon', type: 'button', title: label, 'aria-label': label, 'data-action': action }, svgIcon(paths));
}

function nearestRectIndex(range: Range, point?: { x: number; y: number }): number {
  if (!point) return 0;
  const rects = range.getClientRects();
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
    const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}
