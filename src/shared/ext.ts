/**
 * The extension API. Firefox's `browser` namespace returns promises (its `chrome` alias is
 * callback-first); Chrome only has `chrome`, which returns promises in Manifest V3.
 */
export const ext: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;
