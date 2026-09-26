# Just Another Highlighter Extension

This is, indeed, just another highlighter extension.

In this day and age, after repeatedly finding myself unhappy with existing highlighter extensions, I could not find a particularly good reason **not** to reinvent the wheel and build something closer to what I would actually like to see on the Chrome Web Store.

Maybe I did not search hard enough. Maybe perfectly valid alternatives already exist.

Either way, I spent some tokens on it and made web highlighting a little better for myself.

## What it does

The goal is intentionally simple:

- select some text;
- highlight it;
- come back later;
- find it still highlighted.

Around that basic interaction, the extension provides persistent highlights, different colors, page and website organization, and optional highlight groups without requiring the user to organize anything before simply highlighting some text.

The UX should remain simple even if the machinery behind it is not.

---

## Using it

The extension is not on the Chrome Web Store yet, so for now it has to be loaded by hand (see [Development](#development)).

**Highlight.** Select some text and a small bar with five colors appears next to it; click a color to highlight the selection. You can also right-click the selection and choose *Highlight ▸ color*, or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> to use the last color you picked (the shortcut can be changed at `chrome://extensions/shortcuts`).

**Edit.** Click a highlight to change its color, add a note, move it to a group or delete it (deleting needs a second click). The same actions are available in the right-click menu of a highlight.

**Come back.** When you open the page again, your highlights are restored, even if the page changed a bit in the meantime. The extension icon shows how many highlights the page has, and turns orange when some of them can't be found anymore.

**Browse and search.** Click the extension icon to open the side panel:

- **This page**: the highlights of the current tab, with a warning next to the ones that couldn't be found;
- **Sites**: the sites you highlighted something on; open one to see its pages, then a page to see its highlights;
- **Groups** and **Recent**;
- **search** over highlighted text, notes, page titles, sites and group names, ignoring case and accents (use `"quotes"` for an exact phrase);
- **export and import** of all your data as a JSON file, from the `⋯` menu.

Clicking a highlight in the panel takes you back to it: the page is opened if needed, scrolled to the highlight, and the highlight flashes briefly.

Highlighting never asks you to organize anything first. Colors are only visual, and groups are optional: a group can contain highlights of any color, from any page.

```text
color = presentation
group = organization
```

---

## How it works

Saving a highlight is simple. The difficult part is finding the same text again on a later visit, when the page may have changed: a new layout, a cookie banner, different ads, a corrected sentence.

The design follows four principles. [AGENTS.md](AGENTS.md) lists them as rules for anyone working on the code; this is what they mean in practice.

### 1. Keep the page DOM read-only

The classic way to highlight is to wrap the selected words in an extra element:

```html
<span class="my-highlight">...</span>
```

That changes the page's DOM: it can interfere with the site's own scripts and styles, and the highlight is lost when a framework re-renders the paragraph.

This extension uses the [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API) instead. For every highlight it keeps a live `Range` over the page's own text, registers the ranges in `CSS.highlights`, and a `::highlight()` rule paints them. The document itself is never modified.

Ranges are grouped by color, with one `Highlight` object per color:

```text
stored highlights          CSS.highlights
h1 → yellow                jah-yellow → Range(h1), Range(h3), Range(h4)
h2 → green         ──▶     jah-green  → Range(h2)
h3 → yellow
h4 → yellow
```

A page with 100 yellow highlights needs 100 `Range` objects, one `Highlight` and one CSS rule, and no extra elements. The color bucket is only a rendering detail: every highlight is still a separate record, created by one action and recolored, annotated, grouped or deleted on its own.

The only things the extension adds to a page are its temporary controls: the color bar, the highlight editor and short notifications. They live in an isolated shadow root that is attached while they are visible and removed afterwards, and they are never used to draw highlights.

### 2. Text-centric first, DOM-assisted second

A DOM `Range` is useful while the page is open, but it can't be saved: node references don't survive a reload. So every highlight is stored as a **text anchor**, which describes *what* was highlighted and *where it was in the text*:

```ts
interface TextAnchor {
  exact: string;             // the highlighted text, normalized
  prefix: string;            // up to 64 characters before it
  suffix: string;            // up to 64 characters after it
  start: number;             // position in the page's normalized text
  end: number;
  domHint?: {                // where it was in the DOM: a hint, never an identity
    startPath: string;       // e.g. "div:1/main:0/article:0/p:3/#text:0"
    startOffset: number;
    endPath: string;
    endOffset: number;
  };
  localFingerprint?: string; // hash of the text around the highlight (±256 characters)
  textFingerprint?: string;  // hash of the whole page text when it was created
}
```

"Normalized text" is the readable text of the page as one string: runs of whitespace become a single space, block boundaries and line breaks count as spaces, invisible characters such as soft hyphens and zero-width spaces disappear, and scripts, styles, form fields and `hidden` sections are left out.

While a page is open, a temporary **text map** records which text node each part of that string comes from:

```text
TextNode A → [0, 84]
TextNode B → [85, 151]
TextNode C → [152, 311]

global offset 174 → TextNode C, local offset 22
```

With the map, a stored position can be turned back into a `Range`, and a selection into positions. The map is built only when needed and is never saved.

### 3. Use contextual, corroborated retrieval

The same words can appear several times on a page: "the result is cached" might be in the introduction, in an example and again in the conclusion. Finding the string is not enough, so every occurrence is only a *candidate*, scored on evidence that doesn't come from the words themselves:

| Signal | Weight | What it checks |
| --- | --- | --- |
| context | 60% | how much the text around the candidate still looks like the stored prefix and suffix |
| position | 15% | how close the candidate is to where the highlight used to be |
| DOM hint | 12.5% | whether the stored DOM path still leads to this spot |
| local fingerprint | 12.5% | whether the surrounding ±256 characters are unchanged |

The text match itself adds nothing to the score. A candidate is accepted only if its score passes a threshold (short highlights are more ambiguous, so they need more evidence) and is clearly higher than the second best. When two places have the same surroundings and only their position is different, the DOM hint has to agree as well. If the highlighted words were slightly edited, for example to fix a typo, the stored context must still surround a single region that is very close to the original text.

No signal is trusted on its own:

```text
DOM path     ≠ identity
exact match  ≠ sufficient proof
text offset  ≠ stable identity
fingerprint  ≠ identity
```

They become useful when they corroborate each other. When there isn't enough evidence, the highlight stays **unresolved**: it is still in your data and the side panel marks it *Not found*, but it is not attached to text that only looks similar. Showing nothing is preferred to highlighting the wrong text.

If the page text hasn't changed at all since the highlight was created (same text fingerprint), the stored positions are used directly.

### 4. Lazy by default

Most pages you visit will never contain one of your highlights, and they should cost almost nothing:

```text
page loaded
    ↓
page identity ──▶ anything stored for it? ── no ──▶ stop (the color bar stays available)
                          │
                         yes
                          ↓
     load the main script → build the text map → resolve anchors → paint
```

Every page gets a small script (about 11 KB) that computes the page identity, asks the extension once whether anything is stored for it, and then only waits for text selections. The text map, the fingerprints, the resolver and the renderer are in a second script, which is injected only into pages that have highlights, or when you create one.

On pages that have highlights, the extension also watches for later changes, such as text loaded after clicking *continue reading*, a collapsed section being opened, or a single-page app replacing its `<body>`. Highlights that are still missing are retried when new text appears; otherwise the retries slow down from once per second to once every 30 seconds. Pages that Chrome prerenders in the background are processed only when you open them.

The result is intentionally built around one idea:

> Persist the meaning and textual location of an annotation; use the DOM only to translate that representation into something the browser can render.

---

## Page identity

The raw `location.href` isn't a good identity. These are all the same article:

```text
https://example.com/article?id=42&utm_source=google
https://example.com/article?id=42&utm_source=twitter
https://example.com/article?id=42#comments
```

A page is identified by:

1. its `<link rel="canonical">`, when it points to the same site (subdomains included) and doesn't point every article to the homepage, which is a common misconfiguration;
2. otherwise the address in the location bar.

In both cases credentials and tracking parameters (`utm_*`, `fbclid`, `gclid` and similar) are removed, the remaining parameters are sorted, and the fragment is dropped unless it looks like an app route (`#/…` or `#!…`). A page also keeps the addresses it was highlighted under, so it is still found if the site later changes its canonical link.

Sites are grouped by hostname without a leading `www.`, so the side panel shows *hwupgrade.it* instead of *www.hwupgrade.it*, and lists *forum.hwupgrade.it* as a separate site.

## Where your data lives

All data stays in your browser. The extension has no server and sends nothing anywhere.

```text
Page        canonical URL, known URLs, site, title, highlight count, dates
 └─ Highlight   text anchor, color, note?, group?, dates
Group       a name, independent of colors and pages
```

- The records live in an IndexedDB database owned by the extension's service worker; content scripts and the side panel only reach it through extension messages. Pages are indexed by canonical URL, by every known URL, by site and by update time; highlights by page, group, creation and update time.
- The `unlimitedStorage` permission keeps Chrome from evicting the database when the disk gets full.
- No page HTML, DOM snapshots or copies of articles are ever stored: only the highlighted words, a little context around them and some page metadata. When the last highlight of a page is deleted, the page record is deleted as well.
- Small preferences, such as the last color you used, are kept in `chrome.storage`.

Web pages are treated as untrusted. The service worker checks that a page only asks about itself (using the address reported by Chrome, not the one claimed by the page), lets a page edit only the highlights of its own site, and sends a tab only the highlights of the page it is showing. Browsing, search, export and import are available only to the extension's own pages. Imported files are validated field by field, with `http(s)` addresses only and size limits.

An export looks like this:

```json
{ "format": "jah-export", "version": 1, "exportedAt": "…", "pages": [], "highlights": [], "groups": [] }
```

Importing either *merges* into what you already have (pages matched by address, groups by name, the most recently edited version of a highlight wins) or *replaces* everything.

### Permissions

| Permission | Why |
| --- | --- |
| access to `http` and `https` sites | the color bar on every page, and restoring highlights |
| `scripting` | injecting the heavier script only where it's needed |
| `storage`, `unlimitedStorage` | preferences, and keeping your highlights safe from eviction |
| `sidePanel` | the knowledge manager |
| `contextMenus` | the right-click actions |
| `favicon` | site icons in the side panel, from Chrome's own cache |

## Why not just store XPath?

Because an XPath describes where something was, not what it was. A redesign that turns

```html
<div>
  <p>Selected text</p>
</div>
```

into

```html
<main>
  <section>
    <div>
      <p>Selected text</p>
    </div>
  </section>
</main>
```

invalidates structural selectors while the text itself hasn't changed at all. Structural information is useful as a fast hint. It is intentionally not authoritative.

## Why not store the whole article?

Because remembering where an annotation belongs doesn't require owning a copy of the page. Storing full HTML would duplicate content, take far more space, tie the data to one particular DOM, make page changes harder to reconcile, and raise privacy and copyright questions. A compact anchor gives the resolver the information it actually needs.

## Known limitations

- Only the page itself: text inside iframes, and inside web components that keep their content in a shadow root, can't be highlighted.
- Pages where Chrome doesn't allow extensions (the Chrome Web Store, `chrome://` pages, the built-in PDF viewer) can't be highlighted either.
- After disabling and re-enabling the extension, reload the tabs that were already open. Installing, updating and reloading it are handled automatically.
- Chrome can't show different right-click entries for different elements, so the extension tells it which highlight is under the pointer as you move over the page. If the highlight actions are ever missing from the right-click menu, click the highlight instead.

---

## Development

Requirements: Chrome 123 or later, and Node 24.15+ (or 22.22+) for the test tools. Building alone works from Node 18.

```bash
npm install
npm run build      # production build into dist/
npm run dev        # readable build with source maps, rebuilt on every change
```

To load it, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `dist/` folder. After a rebuild, press the reload icon on the extension's card: tabs that are already open pick up the new version without being reloaded.

If the repository lives in WSL and Chrome runs on Windows, pick `\\wsl.localhost\<distro>\home\<user>\…\jah-extension\dist` in the folder picker. Alternatively build straight into a Windows folder and load that one, which is handier for daily use because it doesn't need WSL to be running:

```bash
JAH_OUTDIR=/mnt/c/Users/<you>/jah-dist npm run dev
```

### Tests

```bash
npm run typecheck
npm test           # unit tests
npm run test:e2e   # builds dist/ and drives a real Chromium with the extension loaded
```

- **Unit tests** (vitest, jsdom, fake-indexeddb) cover URL normalization, the text map, the resolver against realistic page changes (inserted content, repeated phrases, removed paragraphs, edited or rewritten quotes, identical passages, hostile stored data), the repository, import and export, and the lifecycle of the boot script.
- **End-to-end tests** (Playwright) load `dist/` into Chromium and use local fixture pages served under fake hostnames. They cover the color bar, restoring highlights after the page changed, repeated phrases, the in-page editor, the side panel, export and import, extension updates, late and collapsed content, and the isolation between sites. They need Playwright's Chromium: `npx playwright install chromium`.
- Playwright can't use Chrome's native right-click menu or extension shortcuts, can't open the real side panel and keeps pages from being prerendered, so those paths are tested one level below the UI.

### How the pieces fit

```text
 every web page                                    extension origin
┌───────────────────────────────┐               ┌──────────────────────────────┐
│ content-boot.js               │   messages    │ service worker               │
│   page identity, one lookup,  │ ────────────▶ │   message router and checks, │ ──▶ IndexedDB
│   color bar                   │               │   context menu, shortcut     │
│                               │ ◀──────────── │                              │
│ content-main.js (on demand)   │ injects main  └──────────────▲───────────────┘
│   text map, resolver,         │  and CSS                     │ messages
│   renderer (CSS.highlights),  │               ┌──────────────┴───────────────┐
│   highlight editor            │               │ side panel                   │
└───────────────────────────────┘               │   sites, pages, groups,      │
                                                │   search, export, import     │
                                                └──────────────────────────────┘
```

```text
static/                 manifest, side panel HTML/CSS and icons (copied into dist/)
src/shared/             types, message protocol, limits, URL identity, colors, search folding
src/content/boot.ts     runs on every page: page identity, one lookup, color bar
src/content/main.ts     injected on demand: text map, anchoring, resolver, renderer, editor
src/background/         service worker: IndexedDB, message router, context menu, injection
src/sidepanel/          knowledge manager: sites → pages → highlights, groups, search, export
test/unit/              vitest + jsdom + fake-indexeddb
test/e2e/               Playwright tests against local fixture pages
```
