import { el } from '../shared/dom';
import { ext } from '../shared/ext';

const WEB_PAGES = ['http://*/*', 'https://*/*'];

/**
 * Firefox lets users withdraw the extension's access to websites, and pages can't be
 * highlighted without it: while any is missing, the panel offers to grant it back.
 */
export function offerSiteAccess(notice: HTMLElement): void {
  const check = () =>
    ext.permissions.contains({ origins: WEB_PAGES }).then(
      (granted) => (notice.hidden = granted),
      () => undefined,
    );
  const allow = el('button', { class: 'button primary', type: 'button' }, 'Allow access');
  // The request must start in the click handler: Firefox only shows it in response to a user action.
  allow.addEventListener('click', () => void ext.permissions.request({ origins: WEB_PAGES }).then(check, check));
  notice.replaceChildren(
    el('p', {}, 'Highlighting needs access to the websites you visit. Without it, pages can’t be highlighted and saved highlights don’t show.'),
    el('div', { class: 'confirm-actions' }, allow),
  );
  ext.permissions.onAdded.addListener(() => void check());
  ext.permissions.onRemoved.addListener(() => void check());
  void check();
}
