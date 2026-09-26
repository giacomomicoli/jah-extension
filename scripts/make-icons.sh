#!/usr/bin/env bash
# Regenerates static/icons/*.png with ImageMagick: a dark tile with one highlighted text line.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p static/icons
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

magick_cmd="magick"
command -v magick >/dev/null 2>&1 || magick_cmd="convert"

"$magick_cmd" -size 512x512 xc:none \
  -fill '#1f1f23' -draw "roundrectangle 16,16 496,496 104,104" \
  -fill '#8e8e96' -draw "roundrectangle 112,120 400,160 20,20" \
  -fill '#ffd43b' -draw "roundrectangle 84,204 428,308 22,22" \
  -fill '#3b3320' -draw "roundrectangle 128,244 372,268 12,12" \
  -fill '#8e8e96' -draw "roundrectangle 112,352 320,392 20,20" \
  "$tmp/icon512.png"

for size in 16 32 48 128; do
  "$magick_cmd" "$tmp/icon512.png" -filter Lanczos -resize "${size}x${size}" "static/icons/icon${size}.png"
done
echo "Icons written to static/icons/"
