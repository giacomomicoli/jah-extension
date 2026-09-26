import { MAX_CONTEXT_LENGTH } from '../shared/limits';
import { similarity } from '../shared/similarity';
import type { DomHint, ResolutionStatus, TextAnchor } from '../shared/types';
import { localFingerprintAt } from './anchor';

export type ResolveMethod = 'fingerprint' | 'offset' | 'dom' | 'context' | 'fuzzy';

export interface Resolution {
  status: ResolutionStatus;
  start: number;
  end: number;
  score: number;
  method?: ResolveMethod;
  reason?: 'empty' | 'not-found' | 'weak-evidence' | 'ambiguous';
}

/** What the resolver needs from the current page. */
export interface ResolveTarget {
  readonly text: string;
  readonly fingerprint: string;
  /** Normalized offset the DOM hint points at today, if it still resolves. */
  hintOffset(hint: DomHint): number | null;
}

// The quote match itself earns nothing: every accepted candidate needs independent evidence.
const WEIGHT_CONTEXT = 0.6;
const WEIGHT_POSITION = 0.15;
const WEIGHT_DOM = 0.125;
const WEIGHT_LOCAL = 0.125;

/** Minimum lead of the best candidate over the runner-up; below it the match is ambiguous. */
const MIN_MARGIN = 0.08;
/** Below this difference in content evidence (context + local fingerprint) two candidates tie. */
const CONTENT_TIE = 0.02;
/** Distance (in characters) at which positional evidence has decayed to ~37%. */
const POSITION_SCALE = 2000;
/** Similarity that unrelated natural-language strings reach anyway; rescaled to 0. */
const CONTEXT_NOISE_FLOOR = 0.3;
/** Weight of an empty stored side, i.e. a quote that touched the start or end of the page text. */
const BOUNDARY_WEIGHT = 16;
const MAX_OCCURRENCES = 5000;
const DETAILED_CANDIDATES = 24;

const FUZZY_MAX_LENGTH = 2000;
const FUZZY_MIN_SIMILARITY = 0.75;
const FUZZY_CONTEXT = 32;

/** Short quotes are ambiguous by nature, so they need more corroboration. */
export function acceptanceThreshold(length: number): number {
  if (length < 12) return 0.42;
  if (length < 40) return 0.38;
  if (length < 120) return 0.3;
  return 0.27;
}

/**
 * Finds where a stored anchor lives in the current page text, or reports it unresolved.
 * Prefers leaving a highlight unresolved over attaching it to text that merely looks similar.
 */
export function resolveAnchor(anchor: TextAnchor, target: ResolveTarget): Resolution {
  const { text } = target;
  const { exact } = anchor;
  const length = exact.length;
  if (!length) return unresolved('empty');

  // Same page text as at creation: offsets, page fingerprint and quote all agree.
  if (anchor.textFingerprint === target.fingerprint && text.startsWith(exact, anchor.start)) {
    return { status: 'resolved', start: anchor.start, end: anchor.start + length, score: 1, method: 'fingerprint' };
  }

  let domStart: number | null = null;
  if (anchor.domHint) {
    const offset = target.hintOffset(anchor.domHint);
    if (offset !== null && text.startsWith(exact, offset)) domStart = offset;
  }

  const occurrences = findOccurrences(text, exact);
  if (occurrences.length) {
    const [best, runnerUp] = rankCandidates(anchor, text, occurrences, domStart);
    if (best.score >= acceptanceThreshold(length)) {
      if (runnerUp) {
        if (best.score - runnerUp.score < MIN_MARGIN) return unresolved('ambiguous');
        // Candidates whose surroundings are indistinguishable may only be told apart by
        // position when the DOM hint agrees: a shifted page can put the wrong copy exactly
        // where the original used to be.
        if (best.content - runnerUp.content < CONTENT_TIE && best.start !== domStart) return unresolved('ambiguous');
      }
      const method: ResolveMethod =
        best.start === domStart ? 'dom' : best.start === anchor.start ? 'offset' : 'context';
      return { status: 'resolved', start: best.start, end: best.start + length, score: best.score, method };
    }
  }

  return fuzzyResolve(anchor, text) ?? unresolved(occurrences.length ? 'weak-evidence' : 'not-found');
}

function unresolved(reason: NonNullable<Resolution['reason']>): Resolution {
  return { status: 'unresolved', start: -1, end: -1, score: 0, reason };
}

function findOccurrences(text: string, exact: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(exact); at !== -1 && found.length < MAX_OCCURRENCES; at = text.indexOf(exact, at + 1)) {
    found.push(at);
  }
  return found;
}

interface Candidate {
  start: number;
  score: number;
  /** Evidence from the text itself (context + local fingerprint), excluding position and DOM. */
  content: number;
}

function rankCandidates(anchor: TextAnchor, text: string, occurrences: number[], domStart: number | null): Candidate[] {
  const length = anchor.exact.length;
  let pool = occurrences;
  if (pool.length > DETAILED_CANDIDATES) {
    // Cheap pre-ranking so the expensive context comparison runs on a handful of candidates.
    pool = occurrences
      .map((start) => ({
        start,
        rough: adjacency(anchor, text, start) + (start === domStart ? 1 : 0) + positionScore(start, anchor.start),
      }))
      .sort((a, b) => b.rough - a.rough)
      .slice(0, DETAILED_CANDIDATES)
      .map((candidate) => candidate.start);
  }

  return pool
    .map((start) => {
      const context = contextScore(anchor, text, start);
      const position = positionScore(start, anchor.start);
      const dom = start === domStart ? 1 : 0;
      const local =
        anchor.localFingerprint !== undefined &&
        localFingerprintAt(text, start, start + length) === anchor.localFingerprint
          ? 1
          : 0;
      const content = WEIGHT_CONTEXT * context + WEIGHT_LOCAL * local;
      return { start, score: content + WEIGHT_POSITION * position + WEIGHT_DOM * dom, content };
    })
    .sort((a, b) => b.score - a.score);
}

/** Stored context, capped to what the resolver compares (stored data may be hostile). */
function storedContext(anchor: TextAnchor): { prefix: string; suffix: string } {
  return { prefix: anchor.prefix.slice(-MAX_CONTEXT_LENGTH), suffix: anchor.suffix.slice(0, MAX_CONTEXT_LENGTH) };
}

/** Share of stored context characters that match verbatim right next to the candidate. */
function adjacency(anchor: TextAnchor, text: string, start: number): number {
  const { prefix, suffix } = storedContext(anchor);
  let before = 0;
  while (
    before < prefix.length &&
    start - 1 - before >= 0 &&
    text.charCodeAt(start - 1 - before) === prefix.charCodeAt(prefix.length - 1 - before)
  ) {
    before++;
  }
  const end = start + anchor.exact.length;
  let after = 0;
  while (after < suffix.length && end + after < text.length && text.charCodeAt(end + after) === suffix.charCodeAt(after)) {
    after++;
  }
  return (before + after) / Math.max(1, prefix.length + suffix.length);
}

/**
 * 0 = unrelated surroundings, 1 = identical surroundings. An empty stored side means the quote
 * touched the edge of the page text; it only counts as evidence if the candidate still does.
 */
export function contextScore(anchor: TextAnchor, text: string, start: number): number {
  const { prefix, suffix } = storedContext(anchor);
  const end = start + anchor.exact.length;
  let weighted = 0;
  let weight = 0;
  if (prefix.length) {
    const actual = text.slice(Math.max(0, start - prefix.length), start);
    weighted += prefix.length * rescale(similarity(prefix, actual));
    weight += prefix.length;
  } else {
    weighted += start === 0 ? BOUNDARY_WEIGHT : 0;
    weight += BOUNDARY_WEIGHT;
  }
  if (suffix.length) {
    const actual = text.slice(end, end + suffix.length);
    weighted += suffix.length * rescale(similarity(suffix, actual));
    weight += suffix.length;
  } else {
    weighted += end === text.length ? BOUNDARY_WEIGHT : 0;
    weight += BOUNDARY_WEIGHT;
  }
  return weighted / weight;
}

function rescale(value: number): number {
  return Math.min(1, Math.max(0, (value - CONTEXT_NOISE_FLOOR) / (1 - CONTEXT_NOISE_FLOOR)));
}

function positionScore(start: number, original: number): number {
  return Math.exp(-Math.abs(start - original) / POSITION_SCALE);
}

/**
 * Recovers a quote that was lightly edited: the stored context must still bracket a region
 * whose text is very close to the original quote, and that region must be unique.
 */
function fuzzyResolve(anchor: TextAnchor, text: string): Resolution | null {
  const { exact } = anchor;
  const { prefix, suffix } = storedContext(anchor);
  if (exact.length > FUZZY_MAX_LENGTH || prefix.length < 16 || suffix.length < 16) return null;

  const head = prefix.slice(-FUZZY_CONTEXT);
  const tail = suffix.slice(0, FUZZY_CONTEXT);
  const minLength = Math.max(1, Math.floor(exact.length * 0.7));
  const maxLength = Math.ceil(exact.length * 1.3) + 8;
  const found: Array<{ start: number; end: number; score: number }> = [];

  for (let at = text.indexOf(head), tries = 0; at !== -1 && tries < 50; at = text.indexOf(head, at + 1), tries++) {
    const regionStart = at + head.length;
    const tailAt = text.indexOf(tail, regionStart + minLength);
    if (tailAt === -1) break;
    if (tailAt - regionStart > maxLength) continue;
    let start = regionStart;
    let end = tailAt;
    while (start < end && text.charCodeAt(start) === 32) start++;
    while (end > start && text.charCodeAt(end - 1) === 32) end--;
    if (start >= end) continue;
    const score = similarity(exact, text.slice(start, end));
    if (score >= FUZZY_MIN_SIMILARITY) found.push({ start, end, score });
  }

  if (!found.length) return null;
  found.sort((a, b) => b.score - a.score);
  if (found[1] && found[0].score - found[1].score < 0.05) return null;
  const best = found[0];
  // Verbatim quote bracketed by verbatim context: as good as an exact contextual match.
  const status = best.score === 1 ? 'resolved' : 'fuzzy';
  return { status, start: best.start, end: best.end, score: best.score, method: 'fuzzy' };
}
