/** Events that must not leak from our UI to the page's own (bubbling) handlers. */
const CONTAINED_EVENTS = [
  'keydown', 'keyup', 'keypress', 'input', 'beforeinput', 'paste', 'copy', 'cut',
  'mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'contextmenu', 'wheel',
];

/**
 * A closed shadow root hosting transient extension UI (toolbar, editor, toasts).
 * The host is attached to <html> only while something is visible and removed afterwards.
 * It is never used to represent highlights.
 */
export class UiHost {
  private host: HTMLElement | undefined;
  private shadow: ShadowRoot | undefined;

  constructor(private readonly css: string) {}

  mount(): ShadowRoot {
    if (!this.host || !this.shadow) {
      const host = document.createElement('jah-ui');
      host.style.cssText = [
        'all: initial',
        'position: fixed',
        'top: 0',
        'left: 0',
        'width: 0',
        'height: 0',
        'z-index: 2147483647',
        'display: block',
      ]
        .map((rule) => `${rule} !important`)
        .join(';');
      const shadow = host.attachShadow({ mode: 'closed' });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(this.css);
      shadow.adoptedStyleSheets = [sheet];
      for (const type of CONTAINED_EVENTS) shadow.addEventListener(type, (event) => event.stopPropagation());
      this.host = host;
      this.shadow = shadow;
    }
    if (!this.host.isConnected) document.documentElement.append(this.host);
    return this.shadow;
  }

  unmount(): void {
    this.host?.remove();
  }

  /** True when the event originated inside this UI. */
  owns(event: Event): boolean {
    return !!this.host && event.composedPath().includes(this.host);
  }
}
