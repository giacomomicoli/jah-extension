import { fingerprint } from '../shared/hash';

/** Subtrees that never contribute readable article text. */
const SKIPPED = new Set([
  'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'canvas',
  'svg', 'math', 'textarea', 'select', 'video', 'audio', 'head', 'title', 'jah-ui',
]);

/** Elements that start a new line of text; crossing one inserts a virtual space. */
const BLOCKS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'dd', 'details',
  'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'html', 'legend', 'li',
  'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'ul',
]);

const LINE_BREAKS = new Set(['br', 'hr']);

const SPACE = 32;

function isSpace(code: number): boolean {
  return (
    code === SPACE || (code >= 9 && code <= 13) || code === 0xa0 || code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 ||
    code === 0x202f || code === 0x205f || code === 0x3000
  );
}

/** Invisible characters dropped from the normalized text (soft hyphen, zero-width space, …). */
function isIgnorable(code: number): boolean {
  return code === 0xad || code === 0x200b || code === 0x2060 || code === 0xfeff;
}

/**
 * One text node's contribution to the normalized text.
 * Breakpoints map normalized indices (relative to `start`) to raw offsets in `node.data`:
 * for k in [bpNorm[i], bpNorm[i + 1]) the raw offset is bpRaw[i] + (k - bpNorm[i]).
 */
export interface Segment {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
  readonly bpNorm: readonly number[];
  readonly bpRaw: readonly number[];
}

export interface DomPoint {
  node: Text;
  offset: number;
}

/**
 * Temporary, never-persisted bridge between the normalized text of a page and its DOM.
 *
 * Normalization: whitespace runs collapse to one space (also across nodes), block boundaries
 * and <br> act as whitespace, invisible characters are dropped, leading whitespace is trimmed.
 */
export class TextMap {
  readonly text: string;
  readonly segments: readonly Segment[];
  private readonly byNode = new Map<Text, Segment>();
  /** Segments that produced at least one character, in document order. */
  private readonly visible: Segment[];
  private cachedFingerprint: string | undefined;

  constructor(readonly root: Element) {
    const { text, segments } = buildTextMap(root);
    this.text = text;
    this.segments = segments;
    this.visible = segments.filter((segment) => segment.end > segment.start);
    for (const segment of segments) this.byNode.set(segment.node, segment);
  }

  /** Fingerprint of the whole normalized text (computed on first use). */
  get fingerprint(): string {
    return (this.cachedFingerprint ??= fingerprint(this.text));
  }

  hasNode(node: Node): boolean {
    return this.byNode.has(node as Text);
  }

  /**
   * Normalized offset of a DOM boundary point. Points outside mapped text snap to the
   * next mapped character (`forward`) or just after the previous one (`backward`).
   */
  pointToOffset(node: Node, offset: number, bias: 'forward' | 'backward' = 'forward'): number {
    const segment = this.byNode.get(node as Text);
    if (segment) return segment.start + rawToNormalized(segment, offset);

    const index = this.firstSegmentAtOrAfter(node, offset);
    if (bias === 'forward') return index < this.segments.length ? this.segments[index].start : this.text.length;
    return index > 0 ? this.segments[index - 1].end : 0;
  }

  /**
   * DOM point for a normalized offset. `start` affinity picks the character at `offset`
   * (skipping virtual separators forward); `end` affinity picks the point right after the
   * character at `offset - 1`.
   */
  offsetToPoint(offset: number, affinity: 'start' | 'end'): DomPoint | null {
    const segments = this.visible;
    if (!segments.length) return null;

    if (affinity === 'start') {
      // First segment whose end is past the offset.
      let lo = 0;
      let hi = segments.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (segments[mid].end > offset) hi = mid;
        else lo = mid + 1;
      }
      const segment = segments[lo];
      if (!segment) return null;
      const k = Math.max(0, offset - segment.start);
      return { node: segment.node, offset: normalizedToRaw(segment, k) };
    }

    // Last segment whose start is before the offset.
    let lo = 0;
    let hi = segments.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (segments[mid].start < offset) lo = mid + 1;
      else hi = mid;
    }
    const segment = segments[lo - 1];
    if (!segment) return null;
    const k = Math.min(offset, segment.end) - segment.start;
    return { node: segment.node, offset: normalizedToRaw(segment, k - 1) + 1 };
  }

  /** Live DOM Range covering normalized [start, end), or null when it cannot be built. */
  rangeFor(start: number, end: number): Range | null {
    if (end <= start) return null;
    const from = this.offsetToPoint(start, 'start');
    const to = this.offsetToPoint(end, 'end');
    if (!from || !to) return null;
    const range = this.root.ownerDocument.createRange();
    try {
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
    } catch {
      return null;
    }
    return range.collapsed ? null : range;
  }

  /** Normalized offsets of a DOM Range, trimmed of surrounding whitespace. */
  rangeToOffsets(range: Range): { start: number; end: number } | null {
    let start = this.pointToOffset(range.startContainer, range.startOffset, 'forward');
    let end = this.pointToOffset(range.endContainer, range.endOffset, 'backward');
    while (start < end && this.text.charCodeAt(start) === SPACE) start++;
    while (end > start && this.text.charCodeAt(end - 1) === SPACE) end--;
    return start < end ? { start, end } : null;
  }

  /** Index of the first segment whose text node starts at or after the boundary point. */
  private firstSegmentAtOrAfter(node: Node, offset: number): number {
    const probe = this.root.ownerDocument.createRange();
    try {
      probe.setStart(node, offset);
    } catch {
      return this.segments.length;
    }
    let lo = 0;
    let hi = this.segments.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      let order: number;
      try {
        order = probe.comparePoint(this.segments[mid].node, 0);
      } catch {
        order = 1;
      }
      if (order >= 0) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
}

function rawToNormalized(segment: Segment, raw: number): number {
  const { bpNorm, bpRaw } = segment;
  const length = segment.end - segment.start;
  if (!bpNorm.length) return 0;
  // Last breakpoint whose raw offset is <= raw.
  let lo = 0;
  let hi = bpRaw.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (bpRaw[mid] <= raw) lo = mid + 1;
    else hi = mid;
  }
  const i = lo - 1;
  if (i < 0) return 0;
  const next = i + 1 < bpNorm.length ? bpNorm[i + 1] : length;
  return Math.min(bpNorm[i] + (raw - bpRaw[i]), next);
}

function normalizedToRaw(segment: Segment, k: number): number {
  const { bpNorm, bpRaw } = segment;
  let lo = 0;
  let hi = bpNorm.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (bpNorm[mid] <= k) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(0, lo - 1);
  return bpRaw[i] + (k - bpNorm[i]);
}

function buildTextMap(root: Element): { text: string; segments: Segment[] } {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
      const element = node as Element;
      return SKIPPED.has(element.localName) || element.hasAttribute('hidden')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  let buffer = new Uint16Array(8192);
  let length = 0;
  const push = (code: number) => {
    if (length === buffer.length) {
      const grown = new Uint16Array(buffer.length * 2);
      grown.set(buffer);
      buffer = grown;
    }
    buffer[length++] = code;
  };

  const segments: Segment[] = [];
  const blockOf = createBlockResolver(root);
  let lastWasSpace = true;
  let pendingBreak = false;
  let previousBlock: Element | null = null;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (LINE_BREAKS.has((node as Element).localName)) pendingBreak = true;
      continue;
    }
    const textNode = node as Text;
    const block = blockOf(textNode.parentElement);
    if (block !== previousBlock) {
      if (previousBlock) pendingBreak = true;
      previousBlock = block;
    }
    if (pendingBreak) {
      pendingBreak = false;
      if (!lastWasSpace) {
        push(SPACE); // virtual separator, owned by no segment
        lastWasSpace = true;
      }
    }

    const data = textNode.data;
    const start = length;
    const bpNorm: number[] = [];
    const bpRaw: number[] = [];
    let needBreakpoint = true;
    for (let i = 0; i < data.length; i++) {
      const code = data.charCodeAt(i);
      if (isIgnorable(code)) {
        needBreakpoint = true;
        continue;
      }
      const space = isSpace(code);
      if (space && lastWasSpace) {
        needBreakpoint = true;
        continue;
      }
      if (needBreakpoint) {
        bpNorm.push(length - start);
        bpRaw.push(i);
        needBreakpoint = false;
      }
      push(space ? SPACE : code);
      lastWasSpace = space;
    }
    segments.push({ node: textNode, start, end: length, bpNorm, bpRaw });
  }

  return { text: decode(buffer, length), segments };
}

function createBlockResolver(root: Element): (element: Element | null) => Element {
  const cache = new Map<Element, Element>();
  return (element) => {
    const visited: Element[] = [];
    let result: Element = root;
    for (let current = element; current && current !== root; current = current.parentElement) {
      const cached = cache.get(current);
      if (cached) {
        result = cached;
        break;
      }
      visited.push(current);
      if (BLOCKS.has(current.localName)) {
        result = current;
        break;
      }
    }
    for (const item of visited) cache.set(item, result);
    return result;
  };
}

function decode(buffer: Uint16Array, length: number): string {
  let out = '';
  const chunk = 8192;
  for (let i = 0; i < length; i += chunk) {
    out += String.fromCharCode(...buffer.subarray(i, Math.min(length, i + chunk)));
  }
  return out;
}
