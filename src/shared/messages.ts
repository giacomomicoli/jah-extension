import type { ColorId } from './colors';
import type {
  ExportFile,
  Group,
  GroupSummary,
  Highlight,
  HighlightPatch,
  HighlightWithPage,
  ImportStats,
  Page,
  PageIdentity,
  ResolutionStatus,
  SiteSummary,
  TextAnchor,
} from './types';

export interface TabPage {
  identity: PageIdentity | null;
  page: Page | null;
  highlights: Highlight[];
  statuses: Record<string, ResolutionStatus> | null;
}

/** Requests handled by the service worker, keyed by message type. */
export interface RequestMap {
  // From content scripts.
  'page:lookup': {
    req: { identity: PageIdentity };
    res: { page: Page | null; highlights: Highlight[]; focusId?: string };
  };
  'content:ensure-main': { req: {}; res: { ready: boolean } };
  'content:report': { req: { total: number; unresolved: number }; res: null };
  'ctx:target': { req: { highlightId: string | null }; res: null };
  'highlight:create': {
    req: { identity: PageIdentity; fingerprint: string; anchor: TextAnchor; color?: ColorId };
    res: { highlight: Highlight; page: Page };
  };
  'highlight:update': { req: { id: string; patch: HighlightPatch }; res: { highlight: Highlight } };
  'highlight:delete': { req: { id: string }; res: null };
  'groups:list': { req: {}; res: { groups: GroupSummary[] } };
  'group:create': { req: { name: string }; res: { group: Group } };
  'group:rename': { req: { id: string; name: string }; res: { group: Group } };
  'group:delete': { req: { id: string }; res: null };

  // From the side panel.
  'kb:sites': { req: {}; res: { sites: SiteSummary[] } };
  'kb:pages': { req: { site: string }; res: { pages: Page[] } };
  'kb:page': { req: { pageId: string }; res: { page: Page | null; highlights: Highlight[] } };
  'kb:recent': { req: { limit?: number }; res: { items: HighlightWithPage[] } };
  'kb:group': { req: { groupId: string }; res: { group: Group | null; items: HighlightWithPage[] } };
  'kb:search': { req: { query: string; limit?: number }; res: { items: HighlightWithPage[]; total: number } };
  'kb:tab-page': { req: { tabId: number }; res: TabPage };
  'kb:export': { req: {}; res: { data: ExportFile } };
  'kb:import': { req: { data: unknown; mode: 'merge' | 'replace' }; res: ImportStats };
  'page:delete': { req: { pageId: string }; res: null };
  'nav:open-highlight': { req: { highlightId: string }; res: null };
  'nav:open-page': { req: { pageId: string }; res: null };
}

export type RequestType = keyof RequestMap;
export type RequestOf<T extends RequestType> = { type: T } & RequestMap[T]['req'];
export type ResponseOf<T extends RequestType> = RequestMap[T]['res'];
export type AnyRequest = { [T in RequestType]: RequestOf<T> }[RequestType];

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

/** Sends a request to the service worker and unwraps its envelope. */
export async function request<T extends RequestType>(
  type: T,
  payload: RequestMap[T]['req'],
): Promise<ResponseOf<T>> {
  const response = (await chrome.runtime.sendMessage({ ...payload, type })) as
    | Envelope<ResponseOf<T>>
    | undefined;
  if (!response) throw new Error(`No response to ${type}`);
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

export type EditorPanel = 'main' | 'note' | 'group';

/** A change to the knowledge base, broadcast to tabs and to the side panel. */
export type KbChange =
  | { kind: 'highlight-upsert'; highlight: Highlight; page: Page }
  | { kind: 'highlight-delete'; highlightId: string; pageId: string }
  | { kind: 'page-delete'; pageId: string }
  | { kind: 'groups' }
  | { kind: 'reset' };

/** Messages the service worker sends to content scripts. */
export type TabMessage =
  | { type: 'content:identity' }
  | { type: 'content:status' }
  | { type: 'content:create-from-selection'; color: ColorId }
  | { type: 'content:focus'; highlightId: string }
  | { type: 'content:open-editor'; highlightId: string; panel: EditorPanel }
  | { type: 'content:kb-changed'; change: KbChange };

export interface TabStatus {
  pageId: string | null;
  statuses: Record<string, ResolutionStatus>;
}

/** Events the service worker broadcasts to extension pages (the side panel). */
export interface KbChangedEvent {
  type: 'kb:changed';
  change: KbChange;
}

/** A tab finished (re)resolving its highlights; resolution statuses may have changed. */
export interface TabStatusEvent {
  type: 'tab:status';
  tabId: number;
}
