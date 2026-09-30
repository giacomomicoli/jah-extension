#!/usr/bin/env bash
# Builds both browsers and writes, into release/:
#   just-another-highlighter-<version>-chrome.zip   for the Chrome Web Store
#   just-another-highlighter-<version>-firefox.zip  for addons.mozilla.org
#   just-another-highlighter-<version>-source.zip   the source AMO reviewers rebuild the Firefox zip from
# Each extension archive has manifest.json at its root, as both stores expect.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./static/manifest.json').version")
package_version=$(node -p "require('./package.json').version")
if [ "$version" != "$package_version" ]; then
  echo "Version mismatch: manifest.json has $version, package.json has $package_version" >&2
  exit 1
fi
# The source archive is the committed tree, so the packages must be built from it too.
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit your changes first: the source archive must match the packages" >&2
  exit 1
fi

node build.mjs
node build.mjs --browser=firefox
mkdir -p release
for browser in chrome firefox; do
  dir=$([ "$browser" = chrome ] && echo dist || echo "dist-$browser")
  archive="release/just-another-highlighter-$version-$browser.zip"
  rm -f "$archive"
  (cd "$dir" && zip -qrX "../$archive" .)
  echo "$archive"
done
source_archive="release/just-another-highlighter-$version-source.zip"
rm -f "$source_archive"
git archive --format=zip --output="$source_archive" HEAD
echo "$source_archive"
