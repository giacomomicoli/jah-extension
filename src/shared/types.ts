import type { ColorId } from './colors';

/** Structural hint only: it may speed up retrieval but never identifies a highlight. */
export interface DomHint {
  startPath: string;
  startOffset: number;
  endPath: string;
  endOffset: number;
}

/** Persistent, text-centric description of where a highlight lives. */
export interface TextAnchor {
  /** Normalized selected text. */
  exact: string;
  /** Normalized text immediately before `exact` (bounded). */
  prefix: string;
  /** Normalized text immediately after `exact` (bounded). */
  suffix: string;
  /** Offsets inside the normalized page text at creation time. */
  start: number;
  end: number;
  domHint?: DomHint;
  /** Hash of a wider normalized window around the highlight. */
  localFingerprint?: string;
  /** Hash of the whole normalized page text the offsets were computed against. */
  textFingerprint?: string;
}

export interface Page {
  id: string;
  canonicalUrl: string;
  /** Every normalized URL known to identify this page (canonical first). */
  urls: string[];
  /** URL used to reopen the page. */
  url: string;
  hostname: string;
  /** Grouping key shown in the UI: the hostname without a leading "www.". */
  site: string;
  title: string;
  contentFingerprint?: string;
  highlightCount: number;
  createdAt: number;
  updatedAt: number;
  lastVisitedAt: number;
}

export interface Highlight {
  id: string;
  pageId: string;
  anchor: TextAnchor;
  color: ColorId;
  groupId?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Group {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** What a content script knows about the page it runs in. */
export interface PageIdentity {
  canonicalUrl: string;
  locationUrl: string;
  hostname: string;
  site: string;
  title: string;
}

export interface HighlightPatch {
  color?: ColorId;
  /** Empty string removes the note. */
  note?: string;
  /** `null` removes the highlight from its group. */
  groupId?: string | null;
}

export type ResolutionStatus = 'resolved' | 'fuzzy' | 'unresolved';

export interface SiteSummary {
  site: string;
  pageCount: number;
  highlightCount: number;
  updatedAt: number;
  sampleUrl: string;
}

export interface GroupSummary {
  group: Group;
  count: number;
}

export interface HighlightWithPage {
  highlight: Highlight;
  page: Page;
}

export interface ExportFile {
  format: 'jah-export';
  version: 1;
  exportedAt: string;
  pages: Page[];
  highlights: Highlight[];
  groups: Group[];
}

export interface ImportStats {
  pages: number;
  highlights: number;
  groups: number;
  skipped: number;
}
