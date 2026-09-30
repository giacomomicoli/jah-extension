# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-09-30

### Added

- Firefox support (Firefox 140 or later, desktop). The knowledge manager opens in Firefox's sidebar, from the toolbar button or its own keyboard shortcut. In the sidebar, sites show a globe instead of their icon, because Firefox offers extensions no favicon service. If you withdraw the extension's access to websites, the sidebar offers to allow it again.
- MIT license.

### Changed

- The privacy policy covers Firefox: private windows, withdrawing access to websites, and which permissions each browser uses.
- `npm run package` builds both browsers and writes a Chrome zip, a Firefox zip and a source zip for addons.mozilla.org, and refuses to run with uncommitted changes.

## [1.0.2] - 2026-09-26

### Security

- A page served over plain `http` can no longer claim the address of an `https` page on the same site through its canonical link. Anyone on the network can forge an `http` page, so it must not receive the highlights and notes of the `https` one.
- The side panel ignores focus requests that don't come from the extension's service worker.

### Fixed

- With the side panel open in more than one window, the note or group editor now opens in the window where you clicked.

### Changed

- The privacy policy now says that a page can also see the colors of its highlights.

## [1.0.1] - 2026-09-26

### Security

- Notes and new group names are now typed in the side panel. Typed in the page, they could be read by the website's scripts. The pencil button on a highlight or in the color bar, and "Edit highlight note…" in the right-click menu, open the side panel with the editor ready.
- A page on another subdomain (for example `evil.example.com`) can no longer claim the address of a page on `www.example.com` through its canonical link and receive that page's highlights. Two addresses count as the same site only when they differ by a `www.`, `m.`, `amp.` or `mobile.` prefix.
- Pages can no longer detect the extension through the event it fires when it replaces an older copy of itself after an update.

### Added

- Privacy policy in [PRIVACY.md](PRIVACY.md).

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

[1.1.0]: https://github.com/giacomomicoli/jah-extension/releases/tag/v1.1.0
[1.0.2]: https://github.com/giacomomicoli/jah-extension/releases/tag/v1.0.2
[1.0.1]: https://github.com/giacomomicoli/jah-extension/releases/tag/v1.0.1
[1.0.0]: https://github.com/giacomomicoli/jah-extension/releases/tag/v1.0.0
