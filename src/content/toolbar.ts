import { COLORS, type ColorId } from '../shared/colors';
import { close, pencil } from '../shared/icons';
import { el, placeNear, svgIcon } from './ui/dom';
import { UiHost } from './ui/host';
import { TOOLBAR_CSS } from './ui/styles';

export interface ToolbarActions {
  /** `color` is undefined for "highlight with note", which uses the last used color. */
  highlight(range: Range, color: ColorId | undefined, openNote: boolean): void;
}

/** Floating color bar shown next to a text selection. */
export class SelectionToolbar {
  private readonly host = new UiHost(TOOLBAR_CSS);
  private panel: HTMLElement | null = null;
  private range: Range | null = null;
  private pointer: { x: number; y: number } | undefined;
  private frame = 0;

  constructor(private readonly actions: ToolbarActions) {}

  get visible(): boolean {
    return this.panel !== null;
  }

  owns(event: Event): boolean {
    return this.host.owns(event);
  }

  show(range: Range, pointer?: { x: number; y: number }): void {
    this.range = range;
    this.pointer = pointer;
    const root = this.host.mount();
    this.panel?.remove();
    this.panel = this.render();
    root.append(this.panel);
    this.reposition();
  }

  hide(): void {
    cancelAnimationFrame(this.frame);
    this.panel?.remove();
    this.panel = null;
    this.range = null;
    this.host.unmount();
  }

  /** Keeps the bar attached to the selection while the page scrolls. */
  scheduleReposition(): void {
    if (!this.panel) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.reposition());
  }

  buttonRects(): Record<string, DOMRect> {
    const rects: Record<string, DOMRect> = {};
    this.panel?.querySelectorAll<HTMLElement>('[data-action]').forEach((button) => {
      rects[button.dataset.action!] = button.getBoundingClientRect();
    });
    return rects;
  }

  private reposition(): void {
    if (!this.panel || !this.range) return;
    const rect = this.range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      this.hide();
      return;
    }
    // Hidden (not removed) while the selection is scrolled out of view.
    const offscreen = rect.bottom < 0 || rect.top > window.innerHeight;
    this.panel.style.visibility = offscreen ? 'hidden' : 'visible';
    placeNear(this.panel, rect, this.pointer);
    this.pointer = undefined;
  }

  private render(): HTMLElement {
    const row = el('div', { class: 'row' });
    for (const color of COLORS) {
      const swatch = el('button', {
        class: 'swatch',
        type: 'button',
        title: `Highlight (${color.label.toLowerCase()})`,
        'aria-label': `Highlight ${color.label.toLowerCase()}`,
        'data-action': `color:${color.id}`,
      });
      swatch.style.setProperty('--swatch', color.swatch);
      row.append(swatch);
    }
    row.append(
      el('span', { class: 'sep' }),
      this.iconButton('note', pencil, 'Highlight and add a note'),
      this.iconButton('close', close, 'Close'),
    );

    const panel = el('div', { class: 'panel', role: 'toolbar', 'aria-label': 'Highlight selection' }, row);
    // Keep the page selection alive while clicking the toolbar.
    panel.addEventListener('mousedown', (event) => event.preventDefault());
    panel.addEventListener('click', (event) => {
      const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
      const range = this.range;
      if (!action || !range) return;
      this.hide();
      if (action === 'close') return;
      if (action === 'note') this.actions.highlight(range, undefined, true);
      else this.actions.highlight(range, action.slice('color:'.length) as ColorId, false);
    });
    return panel;
  }

  private iconButton(action: string, paths: readonly string[], label: string): HTMLButtonElement {
    return el(
      'button',
      { class: 'icon', type: 'button', title: label, 'aria-label': label, 'data-action': action },
      svgIcon(paths),
    );
  }
}
