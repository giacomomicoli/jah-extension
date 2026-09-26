import { COLORS, colorInfo } from '../shared/colors';
import { el, type Child } from '../shared/dom';
import { icon, type IconName } from '../shared/icons';
import { findMatches } from '../shared/fold';
import { request } from '../shared/messages';
import type { GroupSummary, Highlight, Page, ResolutionStatus } from '../shared/types';
import { errorMessage, fullDate, isoDate, timeAgo } from './format';

export type EditorKind = 'color' | 'note' | 'group';

export interface EditorState {
  kind: EditorKind;
  draft?: string;
}

/** What cards need from the surrounding panel. */
export interface CardEnv {
  groups(): GroupSummary[];
  /** Open inline editors survive re-renders triggered by knowledge-base changes. */
  editors: Map<string, EditorState>;
  toast(message: string, isError?: boolean): void;
  openPage(page: Page): void;
}

export interface CardOptions {
  /** Shown when the card appears outside its page's own view. */
  page?: Page;
  status?: ResolutionStatus | null;
  terms?: string[];
}

const LONG_QUOTE = 420;
const SNIPPET_LENGTH = 600;

export function highlightCard(highlight: Highlight, options: CardOptions, env: CardEnv): HTMLElement {
  const card = el('article', { class: 'card', 'data-id': highlight.id });
  card.style.setProperty('--swatch', colorInfo(highlight.color).swatch);
  const rebuild = () => card.replaceWith(highlightCard(highlight, options, env));

  const quote = el(
    'button',
    { class: 'quote', type: 'button', title: 'Show on the page' },
    ...snippet(highlight.anchor.exact, options.terms ?? []),
  );
  quote.addEventListener('click', () => void jump(highlight.id, env));
  card.append(quote);

  if (highlight.anchor.exact.length > LONG_QUOTE && !options.terms?.length) {
    const more = el('button', { class: 'link more', type: 'button' }, 'Show more');
    more.addEventListener('click', () => {
      const expanded = card.classList.toggle('expanded');
      more.textContent = expanded ? 'Show less' : 'Show more';
    });
    card.append(more);
  }

  if (highlight.note) card.append(el('p', { class: 'note' }, ...marked(highlight.note, options.terms ?? [])));

  if (options.page) {
    const page = options.page;
    const link = el('button', { class: 'page-link', type: 'button', title: page.title }, page.title);
    link.addEventListener('click', () => env.openPage(page));
    card.append(link);
  }

  const meta = el('div', { class: 'meta' });
  if (options.status === 'unresolved') {
    meta.append(el('span', { class: 'badge warn', title: 'The text could not be found on the page as it is now' }, icon('alert'), 'Not found'));
  } else if (options.status === 'fuzzy') {
    meta.append(el('span', { class: 'badge', title: 'Found, but the page text changed slightly' }, 'Text changed'));
  }
  const group = highlight.groupId ? env.groups().find((item) => item.group.id === highlight.groupId)?.group : undefined;
  if (group) meta.append(el('span', { class: 'chip' }, icon('folder'), group.name));
  meta.append(
    el('time', { datetime: isoDate(highlight.createdAt), title: fullDate(highlight.createdAt) }, timeAgo(highlight.createdAt)),
  );

  const actions = el(
    'div',
    { class: 'actions' },
    actionButton('jump', 'external', 'Show on the page'),
    actionButton('color', 'palette', 'Change color'),
    actionButton('note', 'pencil', highlight.note ? 'Edit note' : 'Add note'),
    actionButton('group', 'folder', 'Move to group'),
    actionButton('delete', 'trash', 'Delete highlight'),
  );
  card.append(el('div', { class: 'card-footer' }, meta, actions));

  const editor = env.editors.get(highlight.id);
  if (editor) {
    card.classList.add('editing');
    card.append(renderEditor(highlight, editor, env, rebuild));
  }

  let disarm: number | undefined;
  actions.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-action]');
    const action = button?.dataset.action;
    if (!button || !action) return;
    if (action === 'jump') {
      void jump(highlight.id, env);
    } else if (action === 'delete') {
      if (button.classList.contains('armed')) {
        window.clearTimeout(disarm);
        void mutate(env, request('highlight:delete', { id: highlight.id }));
        return;
      }
      button.classList.add('armed');
      button.title = 'Click again to delete';
      disarm = window.setTimeout(() => {
        button.classList.remove('armed');
        button.title = 'Delete highlight';
      }, 3000);
    } else {
      const kind = action as EditorKind;
      if (env.editors.get(highlight.id)?.kind === kind) env.editors.delete(highlight.id);
      else env.editors.set(highlight.id, { kind, draft: kind === 'note' ? highlight.note ?? '' : undefined });
      rebuild();
    }
  });
  return card;
}

function renderEditor(highlight: Highlight, state: EditorState, env: CardEnv, rebuild: () => void): HTMLElement {
  const close = () => {
    env.editors.delete(highlight.id);
    rebuild();
  };
  const container = el('div', { class: 'editor' });

  if (state.kind === 'color') {
    const row = el('div', { class: 'swatches', role: 'group', 'aria-label': 'Color' });
    for (const color of COLORS) {
      const swatch = el('button', {
        class: 'swatch',
        type: 'button',
        title: color.label,
        'aria-label': color.label,
        'aria-pressed': highlight.color === color.id ? 'true' : 'false',
      });
      swatch.style.setProperty('--swatch', color.swatch);
      swatch.addEventListener('click', () => {
        env.editors.delete(highlight.id);
        void mutate(env, request('highlight:update', { id: highlight.id, patch: { color: color.id } }));
      });
      row.append(swatch);
    }
    container.append(row);
  } else if (state.kind === 'note') {
    const textarea = el('textarea', { rows: 4, maxlength: 5000, placeholder: 'Write a note…', 'aria-label': 'Note' });
    textarea.value = state.draft ?? highlight.note ?? '';
    textarea.addEventListener('input', () => (state.draft = textarea.value));
    const save = () => {
      env.editors.delete(highlight.id);
      void mutate(env, request('highlight:update', { id: highlight.id, patch: { note: textarea.value } }));
    };
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
    const saveButton = el('button', { class: 'button primary', type: 'button' }, 'Save');
    const cancelButton = el('button', { class: 'button', type: 'button' }, 'Cancel');
    saveButton.addEventListener('click', save);
    cancelButton.addEventListener('click', close);
    container.append(textarea, el('div', { class: 'editor-actions' }, el('span', { class: 'hint' }, 'Ctrl+Enter to save'), cancelButton, saveButton));
    requestAnimationFrame(() => textarea.focus());
  } else {
    const list = el('div', { class: 'options', role: 'listbox', 'aria-label': 'Group' });
    const choose = (groupId: string | null) => {
      env.editors.delete(highlight.id);
      void mutate(env, request('highlight:update', { id: highlight.id, patch: { groupId } }));
    };
    const option = (groupId: string | null, label: string) => {
      const selected = (highlight.groupId ?? null) === groupId;
      const button = el(
        'button',
        { class: 'option', type: 'button', role: 'option', 'aria-selected': selected ? 'true' : 'false' },
        el('span', { class: 'tick' }, selected ? icon('check') : null),
        el('span', { class: 'label' }, label),
      );
      button.addEventListener('click', () => choose(groupId));
      list.append(button);
    };
    option(null, 'No group');
    for (const { group } of env.groups()) option(group.id, group.name);
    const input = el('input', { type: 'text', maxlength: 80, placeholder: 'New group…', 'aria-label': 'New group name' });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
      if (event.key !== 'Enter' || !input.value.trim()) return;
      const name = input.value;
      env.editors.delete(highlight.id);
      void mutate(
        env,
        request('group:create', { name }).then(({ group }) =>
          request('highlight:update', { id: highlight.id, patch: { groupId: group.id } }),
        ),
      );
    });
    container.append(list, input);
    requestAnimationFrame(() => input.focus());
  }
  return container;
}

function actionButton(action: string, name: IconName, label: string): HTMLButtonElement {
  return el('button', { class: 'icon-button', type: 'button', title: label, 'aria-label': label, 'data-action': action }, icon(name));
}

async function jump(highlightId: string, env: CardEnv): Promise<void> {
  await mutate(env, request('nav:open-highlight', { highlightId }));
}

async function mutate(env: CardEnv, work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch (error) {
    env.toast(errorMessage(error), true);
  }
}

/** Text with search matches wrapped in <mark>. */
export function marked(text: string, terms: string[]): Child[] {
  const ranges = findMatches(text, terms);
  if (!ranges.length) return [text];
  const parts: Child[] = [];
  let last = 0;
  for (const [start, end] of ranges) {
    if (start > last) parts.push(text.slice(last, start));
    parts.push(el('mark', {}, text.slice(start, end)));
    last = end;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** For search results, a window of a long quote that includes the first match. */
function snippet(text: string, terms: string[]): Child[] {
  if (!terms.length || text.length <= SNIPPET_LENGTH) return marked(text, terms);
  const first = findMatches(text, terms)[0];
  let start = first && first[0] > SNIPPET_LENGTH / 2 ? first[0] - 120 : 0;
  if (start > 0) {
    const space = text.indexOf(' ', start);
    start = space !== -1 && space < first![0] ? space + 1 : start;
  }
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  return [start > 0 ? '… ' : '', ...marked(text.slice(start, end), terms), end < text.length ? ' …' : ''];
}
