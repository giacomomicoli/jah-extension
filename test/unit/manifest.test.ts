import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GECKO_ID, manifestFor } from '../../scripts/manifest';

const source = JSON.parse(readFileSync('static/manifest.json', 'utf8')) as Record<string, unknown>;

describe('per-browser manifest', () => {
  it('leaves the Chrome manifest untouched', () => {
    expect(manifestFor('chrome', source)).toEqual(source);
  });

  it('gives Firefox an event page, a sidebar and an add-on ID', () => {
    const firefox = manifestFor('firefox', source) as Record<string, any>;
    expect(firefox.background).toEqual({ scripts: ['background.js'], type: 'module' });
    expect(firefox.sidebar_action.default_panel).toBe('sidepanel.html');
    expect(firefox.sidebar_action.open_at_install).toBe(false);
    expect(firefox.browser_specific_settings.gecko).toMatchObject({
      id: GECKO_ID,
      strict_min_version: '140.0',
      data_collection_permissions: { required: ['none'] },
    });
    expect(firefox.commands._execute_sidebar_action).toBeDefined();
    expect(firefox.commands._execute_action).toBeUndefined();
    expect(firefox.commands['highlight-selection']).toEqual((source.commands as Record<string, unknown>)['highlight-selection']);
  });

  it('drops what Firefox does not support, and nothing else', () => {
    const firefox = manifestFor('firefox', source) as Record<string, any>;
    expect(firefox).not.toHaveProperty('side_panel');
    expect(firefox).not.toHaveProperty('minimum_chrome_version');
    expect(firefox.permissions).toEqual(['storage', 'unlimitedStorage', 'contextMenus', 'scripting']);
    expect(firefox.host_permissions).toEqual(source.host_permissions);
    expect(firefox.content_scripts).toEqual(source.content_scripts);
    expect(firefox.version).toBe(source.version);
    expect(firefox).not.toHaveProperty('incognito'); // private windows stay the user's choice
  });
});
