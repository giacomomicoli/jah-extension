import { fingerprint } from '../shared/hash';
import type { DomHint, TextAnchor } from '../shared/types';
import { nodePath, resolveNodePath } from './dompath';
import type { ResolveTarget } from './resolver';
import type { TextMap } from './textmap';

/** Characters of normalized context stored on each side of the quote. */
export const CONTEXT_LENGTH = 64;
/** Characters on each side covered by the local fingerprint (wider than the stored context). */
export const LOCAL_WINDOW = 256;

export function localFingerprintAt(text: string, start: number, end: number): string {
  return fingerprint(text.slice(Math.max(0, start - LOCAL_WINDOW), Math.min(text.length, end + LOCAL_WINDOW)));
}

/** Serializes normalized offsets [start, end) of `map` into a persistent anchor. */
export function createAnchor(map: TextMap, start: number, end: number): TextAnchor {
  const { text } = map;
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH),
    start,
    end,
    domHint: createDomHint(map, start, end),
    localFingerprint: localFingerprintAt(text, start, end),
    textFingerprint: map.fingerprint,
  };
}

function createDomHint(map: TextMap, start: number, end: number): DomHint | undefined {
  const from = map.offsetToPoint(start, 'start');
  const to = map.offsetToPoint(end, 'end');
  if (!from || !to) return undefined;
  const startPath = nodePath(from.node, map.root);
  const endPath = nodePath(to.node, map.root);
  if (startPath === null || endPath === null) return undefined;
  return { startPath, startOffset: from.offset, endPath, endOffset: to.offset };
}

/** Normalized offset a DOM hint points at today, if its path still leads to mapped text. */
export function hintOffset(map: TextMap, hint: DomHint): number | null {
  const node = resolveNodePath(hint.startPath, map.root);
  if (!node || !map.hasNode(node)) return null;
  const length = (node as Text).data.length;
  if (hint.startOffset > length) return null;
  return map.pointToOffset(node, hint.startOffset);
}

/** Adapts a text map to the resolver's input. */
export function resolveTarget(map: TextMap): ResolveTarget {
  return {
    text: map.text,
    get fingerprint() {
      return map.fingerprint;
    },
    hintOffset: (hint) => hintOffset(map, hint),
  };
}
