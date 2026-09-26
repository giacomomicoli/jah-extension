#!/usr/bin/env bash
# Builds dist/ and packs it into release/just-another-highlighter-<version>.zip,
# with manifest.json at the root of the archive (as the Chrome Web Store expects).
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./static/manifest.json').version")
package_version=$(node -p "require('./package.json').version")
if [ "$version" != "$package_version" ]; then
  echo "Version mismatch: manifest.json has $version, package.json has $package_version" >&2
  exit 1
fi

node build.mjs
mkdir -p release
archive="release/just-another-highlighter-$version.zip"
rm -f "$archive"
(cd dist && zip -qrX "../$archive" .)
echo "$archive"
