# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-09-26

First release.

### Added

- Highlighting in five colors from a small bar that appears next to the selected text, from the right-click menu, or with Alt+Shift+H (uses the last color).
- Editing a highlight by clicking it or from its right-click menu: change the color, add a note, move it to a group or delete it.
- Rendering with the CSS Custom Highlight API: the page DOM is never modified.
- Highlights restored on later visits, also after the page changed. Each one is stored as a text anchor: the highlighted text, the text around it, its position, a DOM hint and two fingerprints. If the evidence is not strong enough, the highlight stays unresolved instead of being attached to the wrong text.
- Highlights whose text was slightly edited are still found, and so is content that appears later: collapsed sections, text loaded on demand, single-page apps that replace their body, prerendered pages.
- Page identity based on a valid canonical link or on the normalized address, without tracking parameters.
- Side panel with the highlights of the current page, browsing by site and page, groups, recent highlights and a search over text, notes, titles, sites and group names that ignores case and accents.
- Jump from a highlight in the side panel to its place on the page.
- Export and import of all data as JSON, merging with or replacing the existing data.
- Badge on the extension icon with the number of highlights on the page, orange when some of them can't be found.

### Security

- All data stays in the browser, in an IndexedDB database owned by the extension's service worker.
- A web page only receives the highlights of the page it shows, and can only change highlights of its own site. The service worker checks page addresses against the ones reported by Chrome.
- Imported files are validated field by field, with size limits and `http(s)` addresses only.

[1.0.0]: https://github.com/giacomomicoli/jah-extension/releases/tag/v1.0.0
