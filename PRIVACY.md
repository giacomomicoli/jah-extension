# Privacy policy

Just Another Highlighter is a browser extension for highlighting text on web pages and finding those highlights again later. This page explains what it stores, where, and who can see it.

Last updated: 26 September 2026.

## What the extension stores

Nothing is recorded for pages you visit without highlighting anything. When you highlight text on a page, the extension stores:

- the highlighted text, and up to 64 characters of text before and after it, used to find the highlight again when the page changes;
- a technical description of where the text was: its position in the page text, a path to the element that contained it, and hashes of the text around it and of the whole page text (hashes are not the text itself);
- the address, title and site of the page, and when you created, changed or last visited a highlighted page;
- the color of each highlight, and the notes and groups you add.

It also remembers the last color you used, and keeps some short-lived bookkeeping (for example which highlight is under the pointer when you right-click) that the browser deletes when it closes.

## Where it is stored

Everything stays in your browser, in storage that belongs to the extension on your device. The extension has no server and sends nothing anywhere: no analytics, no advertising, no data sharing or selling. It does not use Chrome sync, so highlights are not copied to your other devices.

## What websites can see

- A website cannot read the extension's storage: your highlights, notes and groups, and your highlights on other websites, stay out of its reach.
- While one of its pages is open, a website's scripts can see which passages of that page are highlighted, and in which colors. Highlights are drawn with the browser's CSS Custom Highlight API, which shares them with the page. The website does not see your notes or groups.
- Notes and new group names are always typed in the extension's side panel, which websites cannot observe. Text typed on a web page could be read by that page.
- A website can tell that the extension is installed, for example when the color bar or a highlight appears.

## Your choices

- You can delete any highlight, page or group, from the page or from the side panel.
- You can export all your data as a JSON file and import it again.
- Uninstalling the extension deletes all of its data from your browser.

## Permissions

- Access to `http` and `https` sites: to show the color bar on any page and to restore highlights when you come back.
- `scripting`: to load the heavier part of the extension only on pages that have highlights.
- `storage` and `unlimitedStorage`: to keep your highlights and preferences, and to stop the browser from deleting them when the disk is full.
- `sidePanel`, `contextMenus`, `favicon`: for the side panel, the right-click actions and the site icons (taken from the browser's own cache).

## Contact

Questions and reports are welcome as issues at <https://github.com/giacomomicoli/jah-extension/issues>.

Changes to this policy are listed in [CHANGELOG.md](CHANGELOG.md).
