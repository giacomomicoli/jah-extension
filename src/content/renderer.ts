import { ACTIVE_HIGHLIGHT, FOCUS_HIGHLIGHT, highlightName, type ColorId } from '../shared/colors';

interface Entry {
  range: Range;
  color: ColorId;
}

/**
 * Paints highlights through the CSS Custom Highlight API: one `Highlight` bucket per color,
 * holding the runtime ranges of every logical highlight with that color. The DOM is untouched.
 *
 * The highlight registry is shared by every script in the document, including an orphaned
 * copy of this extension left behind by an update, so entries are only removed by their owner.
 */
export class Renderer {
  private readonly buckets = new Map<ColorId, Highlight>();
  private readonly entries = new Map<string, Entry>();
  private focusHighlight: Highlight | undefined;
  private activeHighlight: Highlight | undefined;
  private flashTimer: number | undefined;

  has(id: string): boolean {
    return this.entries.has(id);
  }

  range(id: string): Range | undefined {
    return this.entries.get(id)?.range;
  }

  get size(): number {
    return this.entries.size;
  }

  *all(): IterableIterator<[string, Range]> {
    for (const [id, entry] of this.entries) yield [id, entry.range];
  }

  add(id: string, range: Range, color: ColorId): void {
    this.remove(id);
    this.entries.set(id, { range, color });
    this.bucket(color).add(range);
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.buckets.get(entry.color)?.delete(entry.range);
  }

  recolor(id: string, color: ColorId): void {
    const entry = this.entries.get(id);
    if (!entry || entry.color === color) return;
    this.buckets.get(entry.color)?.delete(entry.range);
    entry.color = color;
    this.bucket(color).add(entry.range);
  }

  clear(): void {
    for (const [color, bucket] of this.buckets) release(highlightName(color), bucket);
    if (this.focusHighlight) release(FOCUS_HIGHLIGHT, this.focusHighlight);
    if (this.activeHighlight) release(ACTIVE_HIGHLIGHT, this.activeHighlight);
    window.clearTimeout(this.flashTimer);
    this.focusHighlight = undefined;
    this.activeHighlight = undefined;
    this.buckets.clear();
    this.entries.clear();
  }

  /** Id of the most recently added highlight painted under a viewport point. */
  hitTest(x: number, y: number): string | null {
    const ids = [...this.entries.keys()];
    for (let i = ids.length - 1; i >= 0; i--) {
      const { range } = this.entries.get(ids[i])!;
      for (const rect of range.getClientRects()) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return ids[i];
      }
    }
    return null;
  }

  flash(id: string, duration = 1800): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const highlight = new Highlight(entry.range);
    highlight.priority = 2;
    this.focusHighlight = highlight;
    CSS.highlights.set(FOCUS_HIGHLIGHT, highlight);
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => release(FOCUS_HIGHLIGHT, highlight), duration);
  }

  /** Underlines the highlight whose editor is open. */
  setActive(id: string | null): void {
    if (this.activeHighlight) release(ACTIVE_HIGHLIGHT, this.activeHighlight);
    this.activeHighlight = undefined;
    const entry = id ? this.entries.get(id) : undefined;
    if (!entry) return;
    const highlight = new Highlight(entry.range);
    highlight.priority = 1;
    this.activeHighlight = highlight;
    CSS.highlights.set(ACTIVE_HIGHLIGHT, highlight);
  }

  private bucket(color: ColorId): Highlight {
    let bucket = this.buckets.get(color);
    if (!bucket) {
      bucket = new Highlight();
      this.buckets.set(color, bucket);
    }
    // (Re)register on every use: the page or another script instance may have replaced it.
    const name = highlightName(color);
    if (CSS.highlights.get(name) !== bucket) CSS.highlights.set(name, bucket);
    return bucket;
  }
}

/** Unregisters `highlight` only if the registry still holds this very object. */
function release(name: string, highlight: Highlight): void {
  if (CSS.highlights.get(name) === highlight) CSS.highlights.delete(name);
}
