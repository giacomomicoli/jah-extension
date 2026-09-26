# Four Essential Core Principles

1. **Keep the page DOM read-only.**  
   Never rewrite, wrap, replace, or inject elements into the page DOM to represent highlights. Highlight rendering must be performed through reconstructed `Range` objects and the CSS Custom Highlight API (`CSS.highlights` / `::highlight()`).

2. **Text-centric first, DOM-assisted second.**  
   Treat normalized text and textual anchors as the primary source of truth. Use the DOM only to capture selections, derive structural hints, map textual positions back to nodes, reconstruct `Range` objects, and render highlights.

3. **Use contextual, corroborated retrieval.**  
   Never resolve a stored highlight from a single exact-text match alone. Retrieval must combine multiple available signals such as exact text, prefix/suffix context, textual offsets, fingerprints, and DOM hints. DOM paths are hints, never identity.

4. **Be lazy by default.**  
   Do not build a text map, traverse relevant text nodes, compute fingerprints, or run highlight-resolution logic unless the current page has stored records that require it. Pages with no persisted annotations should incur the minimum possible runtime cost.

# Working in this repository

The README explains the design; this section lists what is easy to get wrong when changing the code.

## Map

- `src/content/boot.ts` is injected into every http(s) page. It computes the page identity, sends one `page:lookup` and shows the selection toolbar. Keep it small (about 11 KB minified; the build prints the size) and free of text-map, fingerprint and resolver code.
- `src/content/main.ts` is injected by the service worker (`ensureMain` in `src/background/tabs.ts`) only into pages that have highlights, or when the user creates one. It owns the text map, anchoring, the resolver, the renderer and the highlight editor.
- `src/background/` is the service worker: the only owner of IndexedDB and the only message router (`index.ts`).
- `src/sidepanel/` is the knowledge manager UI. `src/shared/` holds the types, the typed message protocol (`messages.ts`), size limits (`limits.ts`) and URL identity (`url.ts`).

## Commands

- `npm run build`, or `npm run dev` to rebuild on every change, then load `dist/` as an unpacked extension. `JAH_OUTDIR=<dir>` builds somewhere else, e.g. a Windows folder when working in WSL.
- A change is done when `npm run typecheck`, `npm test` and `npm run test:e2e` all pass.

## In-page code

- Transient UI (selection toolbar, highlight editor, toasts) lives in the closed Shadow DOM host from `src/content/ui/host.ts`, attached to `<html>` only while visible. It is never used to render or mark highlights. This is the agreed reading of principle 1: do not treat the toolbar as a violation, and do not use it as a precedent for injecting anything else.
- `CSS.highlights` is shared with every other script in the page, including copies of this extension orphaned by an update. Only remove highlight objects you created (see `release()` in `renderer.ts`).
- The in-page UI never contains text inputs: a page's scripts see keystrokes and input events even from a closed shadow root. Notes and new group names are typed in the side panel (`panel:open`). Chrome only opens the panel in response to a user gesture, so the service worker calls `chrome.sidePanel.open()` synchronously, before any `await`.
- Register content-script listeners through the local `on()` helper in `boot.ts` and `main.ts`: it disposes instances whose extension context is gone. A new boot disposes a previous instance in the same world, and `injectBoot` fires `jah:takeover` before re-injecting so orphans in another isolated world stop. Boot never fires it on a normal load, or pages could use it to detect the extension.
- Do nothing in a prerendered document until it is activated, and inject into the document that asked (`sender.documentId`), not just into the tab.
- While a page has highlights, a single MutationObserver on `document.documentElement` marks the text map dirty and re-resolves missing highlights with backoff (`retry.ts`). Don't add fixed retry budgets or more observers.

## Resolver

- Matching the quote earns a candidate nothing. Acceptance needs independent evidence (context, position, DOM hint, local fingerprint), a length-dependent threshold and a clear margin over the runner-up; position alone may not choose between look-alike candidates. When in doubt, leave the highlight unresolved.
- Resolving never writes back to the database: stored anchors are the user's original evidence.
- New heuristics or changed weights come with a scenario in `test/unit/resolver.test.ts`.

## Service worker and data

- Content scripts are untrusted input:
  - check claimed page identities against `sender.url` (`requireIdentity`);
  - two hostnames are the same site only when they differ by a `www.`, `m.`, `amp.` or `mobile.` prefix (`isSameSite`); never widen this to any subdomain;
  - let them edit only highlights of their own site (`assertMayEdit`);
  - accept knowledge-base requests only from extension pages (`isAllowed`, `CONTENT_REQUESTS`);
  - send a page's data only to tabs showing that page (`tabsShowing`); only data-less changes may go to every tab.
- Validate everything that crosses a trust boundary (messages, import files) and keep sizes within `src/shared/limits.ts`.
- Text coming from web pages (quotes, titles, notes) is rendered with `textContent`, never `innerHTML`.
- Schema changes bump `DB_VERSION` and add a step to `upgrade()` in `src/background/db.ts`. Keep existing export files (`jah-export`, version 1) importable, or introduce a new version.
- Keep `PRIVACY.md` accurate whenever what is stored, or what a page can observe, changes. It is the privacy policy published on the Chrome Web Store.

## Dependencies

- No runtime dependencies and no UI framework: TypeScript, esbuild and the DOM. Ask before adding either.
- Chrome 123 is the minimum version (`static/manifest.json`).

## Releases

- Bump the version with `npm version <x.y.z> --no-git-tag-version` and set the same version in `static/manifest.json`; `npm run package` refuses to build when they differ.
- Add a section to `CHANGELOG.md` (Keep a Changelog format), commit, and tag the commit `v<x.y.z>`.
- `npm run package` writes `release/just-another-highlighter-<x.y.z>.zip`; attach it to the GitHub release, using the changelog section as release notes.

## Tests

- Unit tests run on vitest with jsdom (text map, resolver, boot lifecycle) and fake-indexeddb (repository, import/export).
- End-to-end tests run Playwright's Chromium with `dist/` loaded. Fixture sites under fake hostnames (`www.hwupgrade.it`, `multiplayer.it`, `plain.example`) are mapped to localhost in `test/e2e/fixtures.ts`. The in-page UI sits in a closed shadow root, so tests read it through `globalThis.__jah.debug` in the extension's isolated world.
- Playwright can't click native context menus, press extension shortcuts, open the real side panel or let pages be prerendered: test the code underneath instead. Reloading the extension inside a test needs developer mode first (see `test/e2e/robustness.spec.ts`).
- `@playwright/test` is pinned to 1.61.1 because its Chromium is cached locally; after upgrading, run `npx playwright install chromium`.
- For a bug fix, make sure the new test fails without the fix.
