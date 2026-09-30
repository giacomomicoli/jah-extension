import { el, type Child } from '../shared/dom';
import { icon, type IconName } from '../shared/icons';
import { parseQuery } from '../shared/fold';
import { request } from '../shared/messages';
import type { HighlightWithPage } from '../shared/types';
import { highlightCard, type CardEnv } from './card';
import { displayUrl, errorMessage, faviconUrl, plural, timeAgo } from './format';

export type Route =
  | { name: 'home' }
  | { name: 'site'; site: string }
  | { name: 'page'; pageId: string }
  | { name: 'group'; groupId: string };

export interface ViewEnv extends CardEnv {
  navigate(route: Route): void;
  back(): void;
}

// ── Home tabs ──────────────────────────────────────────────────────────────

export async function sitesView(env: ViewEnv): Promise<Node> {
  const { sites } = await request('kb:sites', {});
  if (!sites.length) {
    return emptyState(
      'No highlights yet',
      'Select text on any page and pick a color in the toolbar that appears. The sites you highlight will be listed here.',
    );
  }
  const list = el('ul', { class: 'list' });
  for (const site of sites) {
    const row = listRow({
      favicon: faviconUrl(site.sampleUrl),
      icon: 'globe',
      title: site.site,
      subtitle: `${plural(site.pageCount, 'page')} · ${plural(site.highlightCount, 'highlight')}`,
      side: timeAgo(site.updatedAt),
    });
    row.addEventListener('click', () => env.navigate({ name: 'site', site: site.site }));
    list.append(el('li', {}, row));
  }
  return list;
}

export async function groupsView(env: ViewEnv): Promise<Node> {
  const groups = env.groups();
  const input = el('input', { type: 'text', maxlength: 80, placeholder: 'New group name', 'aria-label': 'New group name' });
  const form = el('form', { class: 'inline-form' }, input, el('button', { class: 'button primary', type: 'submit' }, 'Add'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    request('group:create', { name }).then(
      () => (input.value = ''),
      (error: unknown) => env.toast(errorMessage(error), true),
    );
  });

  const fragment = document.createDocumentFragment();
  fragment.append(form);
  if (!groups.length) {
    fragment.append(
      emptyState(
        'No groups yet',
        'Groups collect highlights across pages and sites, independently of their color. Create one here or from a highlight.',
      ),
    );
    return fragment;
  }
  const list = el('ul', { class: 'list' });
  for (const { group, count } of groups) {
    const row = listRow({ icon: 'folder', title: group.name, subtitle: plural(count, 'highlight') });
    row.addEventListener('click', () => env.navigate({ name: 'group', groupId: group.id }));
    list.append(el('li', {}, row));
  }
  fragment.append(list);
  return fragment;
}

export async function recentView(env: ViewEnv): Promise<Node> {
  const { items } = await request('kb:recent', { limit: 50 });
  if (!items.length) return emptyState('No highlights yet', 'Your latest highlights, from every site, will appear here.');
  return cardList(items, env);
}

// ── Drill-down views ───────────────────────────────────────────────────────

export async function siteView(site: string, env: ViewEnv): Promise<Node> {
  const { pages } = await request('kb:pages', { site });
  const fragment = document.createDocumentFragment();
  fragment.append(viewHeader(env, { title: site, subtitle: plural(pages.length, 'page'), favicon: pages[0] && faviconUrl(pages[0].url), icon: 'globe' }));
  if (!pages.length) {
    fragment.append(emptyState('Nothing left here', 'Every highlight of this site was deleted.'));
    return fragment;
  }
  const list = el('ul', { class: 'list' });
  for (const page of pages) {
    const row = listRow({
      title: page.title,
      subtitle: displayUrl(page.url),
      side: `${plural(page.highlightCount, 'highlight')} · ${timeAgo(page.updatedAt)}`,
      clampTitle: true,
    });
    row.addEventListener('click', () => env.navigate({ name: 'page', pageId: page.id }));
    list.append(el('li', {}, row));
  }
  fragment.append(list);
  return fragment;
}

export async function pageView(pageId: string, env: ViewEnv): Promise<Node> {
  const { page, highlights } = await request('kb:page', { pageId });
  const fragment = document.createDocumentFragment();
  if (!page) {
    fragment.append(viewHeader(env, { title: 'Page removed' }), emptyState('Nothing left here', 'This page has no highlights anymore.'));
    return fragment;
  }

  const open = headerAction('external', 'Open page', () =>
    request('nav:open-page', { pageId }).catch((error: unknown) => env.toast(errorMessage(error), true)),
  );
  const remove = armedAction('trash', 'Delete page and its highlights', () =>
    request('page:delete', { pageId }).then(
      () => env.back(),
      (error: unknown) => env.toast(errorMessage(error), true),
    ),
  );
  fragment.append(
    viewHeader(env, {
      title: page.title,
      subtitle: `${displayUrl(page.url)} · ${plural(highlights.length, 'highlight')}`,
      favicon: faviconUrl(page.url),
      icon: 'globe',
      actions: [open, remove],
    }),
  );
  const list = el('div', { class: 'cards' });
  for (const highlight of highlights) list.append(highlightCard(highlight, {}, env));
  fragment.append(list);
  return fragment;
}

export async function groupView(groupId: string, env: ViewEnv): Promise<Node> {
  const { group, items } = await request('kb:group', { groupId });
  const fragment = document.createDocumentFragment();
  if (!group) {
    fragment.append(viewHeader(env, { title: 'Group removed' }), emptyState('Nothing left here', 'This group was deleted.'));
    return fragment;
  }

  let header: HTMLElement | undefined;
  const rename = headerAction('pencil', 'Rename group', () => {
    const title = header?.querySelector('h2');
    if (!title || !title.isConnected) return;
    const input = el('input', { type: 'text', class: 'title-input', maxlength: 80, 'aria-label': 'Group name' });
    input.value = group.name;
    const commit = () => {
      const name = input.value.trim();
      if (!name || name === group.name) {
        input.replaceWith(title);
        return;
      }
      request('group:rename', { id: group.id, name }).catch((error: unknown) => env.toast(errorMessage(error), true));
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') commit();
      if (event.key === 'Escape') input.replaceWith(title);
    });
    input.addEventListener('blur', commit);
    title.replaceWith(input);
    input.focus();
    input.select();
  });
  const remove = armedAction('trash', 'Delete group (highlights are kept)', () =>
    request('group:delete', { id: group.id }).then(
      () => env.back(),
      (error: unknown) => env.toast(errorMessage(error), true),
    ),
  );
  header = viewHeader(env, { title: group.name, subtitle: plural(items.length, 'highlight'), icon: 'folder', actions: [rename, remove] });
  fragment.append(header);
  if (!items.length) {
    fragment.append(emptyState('Empty group', 'Add highlights to this group from their card or from the page.'));
    return fragment;
  }
  fragment.append(cardList(items, env));
  return fragment;
}

export async function searchView(query: string, env: ViewEnv): Promise<Node> {
  const { items, total } = await request('kb:search', { query, limit: 200 });
  const terms = parseQuery(query);
  const fragment = document.createDocumentFragment();
  const summary = total > items.length ? `${items.length} of ${total} results` : plural(total, 'result');
  fragment.append(el('p', { class: 'result-count' }, summary));
  if (!items.length) {
    fragment.append(emptyState('No matches', 'Search looks at highlighted text, notes, page titles, sites and group names.'));
    return fragment;
  }
  fragment.append(cardList(items, env, terms));
  return fragment;
}

// ── Building blocks ────────────────────────────────────────────────────────

function cardList(items: HighlightWithPage[], env: ViewEnv, terms?: string[]): HTMLElement {
  const list = el('div', { class: 'cards' });
  for (const { highlight, page } of items) list.append(highlightCard(highlight, { page, terms }, env));
  return list;
}

/** The site's favicon where the browser offers one, a globe otherwise. */
export function siteIcon(pageUrl: string): HTMLElement {
  const favicon = faviconUrl(pageUrl);
  return favicon
    ? el('img', { class: 'favicon', src: favicon, alt: '', width: 16, height: 16 })
    : el('span', { class: 'row-icon' }, icon('globe'));
}

function listRow(options: {
  title: string;
  subtitle?: string;
  side?: string;
  favicon?: string;
  icon?: IconName;
  clampTitle?: boolean;
}): HTMLButtonElement {
  const leading: Child = options.favicon
    ? el('img', { class: 'favicon', src: options.favicon, alt: '', width: 16, height: 16 })
    : options.icon
      ? el('span', { class: 'row-icon' }, icon(options.icon))
      : null;
  return el(
    'button',
    { class: 'row', type: 'button' },
    leading,
    el(
      'span',
      { class: 'row-main' },
      el('span', { class: options.clampTitle ? 'row-title clamp' : 'row-title' }, options.title),
      options.subtitle ? el('span', { class: 'row-sub' }, options.subtitle) : null,
    ),
    options.side ? el('span', { class: 'row-side' }, options.side) : null,
    el('span', { class: 'row-chevron' }, icon('chevronRight')),
  );
}

function viewHeader(
  env: ViewEnv,
  options: { title: string; subtitle?: string; favicon?: string; icon?: IconName; actions?: HTMLElement[] },
): HTMLElement {
  const back = el('button', { class: 'icon-button', type: 'button', title: 'Back', 'aria-label': 'Back' }, icon('back'));
  back.addEventListener('click', () => env.back());
  const leading: Child = options.favicon
    ? el('img', { class: 'favicon', src: options.favicon, alt: '', width: 16, height: 16 })
    : options.icon
      ? el('span', { class: 'row-icon' }, icon(options.icon))
      : null;
  return el(
    'header',
    { class: 'view-header' },
    back,
    el(
      'div',
      { class: 'view-title' },
      el('div', { class: 'view-title-line' }, leading, el('h2', {}, options.title)),
      options.subtitle ? el('p', {}, options.subtitle) : null,
    ),
    options.actions?.length ? el('div', { class: 'view-actions' }, ...options.actions) : null,
  );
}

function headerAction(name: IconName, label: string, run: () => unknown): HTMLButtonElement {
  const button = el('button', { class: 'icon-button', type: 'button', title: label, 'aria-label': label }, icon(name));
  button.addEventListener('click', () => void run());
  return button;
}

/** Destructive action that needs a second click within three seconds. */
function armedAction(name: IconName, label: string, run: () => unknown): HTMLButtonElement {
  const button = headerAction(name, label, () => undefined);
  let timer: number | undefined;
  button.addEventListener('click', () => {
    if (button.classList.contains('armed')) {
      window.clearTimeout(timer);
      void run();
      return;
    }
    button.classList.add('armed');
    button.title = 'Click again to confirm';
    timer = window.setTimeout(() => {
      button.classList.remove('armed');
      button.title = label;
    }, 3000);
  });
  return button;
}

export function emptyState(title: string, text: string): HTMLElement {
  return el('div', { class: 'empty' }, el('p', { class: 'empty-title' }, title), el('p', {}, text));
}
