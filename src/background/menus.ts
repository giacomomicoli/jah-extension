import { COLORS, isColorId, type ColorId } from '../shared/colors';

export const MENU = {
  highlight: 'jah-highlight',
  recolor: 'jah-recolor',
  note: 'jah-note',
  group: 'jah-group',
  remove: 'jah-delete',
} as const;

/** Items that only make sense when the pointer is over an existing highlight. */
const HIGHLIGHT_ITEMS = [MENU.recolor, MENU.note, MENU.group, MENU.remove];

export type MenuCommand =
  | { kind: 'highlight'; color: ColorId }
  | { kind: 'recolor'; color: ColorId }
  | { kind: 'note' }
  | { kind: 'group' }
  | { kind: 'delete' };

export function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    const create = (properties: chrome.contextMenus.CreateProperties) =>
      chrome.contextMenus.create(properties, () => void chrome.runtime.lastError);

    create({ id: MENU.highlight, title: 'Highlight', contexts: ['selection'] });
    for (const color of COLORS) {
      create({ id: `${MENU.highlight}:${color.id}`, parentId: MENU.highlight, title: color.label, contexts: ['selection'] });
    }
    create({ id: MENU.recolor, title: 'Change highlight color', contexts: ['all'], visible: false });
    for (const color of COLORS) {
      create({ id: `${MENU.recolor}:${color.id}`, parentId: MENU.recolor, title: color.label, contexts: ['all'] });
    }
    create({ id: MENU.note, title: 'Edit highlight note…', contexts: ['all'], visible: false });
    create({ id: MENU.group, title: 'Move highlight to group…', contexts: ['all'], visible: false });
    create({ id: MENU.remove, title: 'Delete highlight', contexts: ['all'], visible: false });
  });
}

export function setHighlightItemsVisible(visible: boolean): Promise<void> {
  return Promise.all(
    HIGHLIGHT_ITEMS.map(
      (id) =>
        new Promise<void>((resolve) => {
          chrome.contextMenus.update(id, { visible }, () => {
            void chrome.runtime.lastError;
            resolve();
          });
        }),
    ),
  ).then(() => undefined);
}

export function parseMenuCommand(menuItemId: string | number): MenuCommand | null {
  const id = String(menuItemId);
  const [base, argument] = id.split(':');
  if (base === MENU.highlight && isColorId(argument)) return { kind: 'highlight', color: argument };
  if (base === MENU.recolor && isColorId(argument)) return { kind: 'recolor', color: argument };
  if (id === MENU.note) return { kind: 'note' };
  if (id === MENU.group) return { kind: 'group' };
  if (id === MENU.remove) return { kind: 'delete' };
  return null;
}
