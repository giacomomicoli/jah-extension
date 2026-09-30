// Per-browser manifest, derived from static/manifest.json (which is the Chrome manifest).
// Imported by build.mjs (Node strips the types) and by test/unit/manifest.test.ts.

export type Browser = 'chrome' | 'firefox';

type Manifest = Record<string, unknown>;

/** Permanent add-on ID on addons.mozilla.org: never change it once published. */
export const GECKO_ID = 'just-another-highlighter@jah-extension';
export const FIREFOX_MIN_VERSION = '140.0';

/** Chrome-only permissions: Firefox has a sidebar instead of the side panel, and no favicon API. */
const CHROME_ONLY_PERMISSIONS = new Set(['sidePanel', 'favicon']);

export function manifestFor(browser: Browser, source: Manifest): Manifest {
  const manifest = structuredClone(source);
  if (browser === 'chrome') return manifest;

  const action = manifest.action as { default_title: string; default_icon: Record<string, string> };
  const commands = { ...(manifest.commands as Record<string, unknown>) };
  delete commands._execute_action;
  commands._execute_sidebar_action = { description: 'Show or hide the highlights sidebar' };

  const { minimum_chrome_version: _chrome, side_panel: _panel, ...rest } = manifest;
  return {
    ...rest,
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: FIREFOX_MIN_VERSION,
        // Everything stays in the browser: nothing is sent anywhere.
        data_collection_permissions: { required: ['none'] },
      },
    },
    sidebar_action: {
      default_panel: 'sidepanel.html',
      default_title: action.default_title,
      default_icon: action.default_icon,
      open_at_install: false,
    },
    // Firefox runs extension background scripts as event pages, not service workers.
    background: { scripts: ['background.js'], type: 'module' },
    permissions: (manifest.permissions as string[]).filter((permission) => !CHROME_ONLY_PERMISSIONS.has(permission)),
    commands,
  };
}
