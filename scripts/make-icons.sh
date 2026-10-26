#!/bin/sh
# Builds every app icon from build/icon.svg. Needs rsvg-convert and ImageMagick (brew install librsvg imagemagick);
# the .icns step needs macOS (iconutil).
#   build/icon.png   1024 px, with the macOS margin (electron-builder, Linux)
#   build/icon.icns  macOS app icon
#   build/icon.ico   Windows app icon, tile only (no margin)
#   src/ui/icon.png  512 px tile only: window icon and the logo on the home screen
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

rsvg-convert -w 1024 -h 1024 build/icon.svg -o build/icon.png

# The tile spans 100..924 on the 1024 grid; crop to it for icons that should fill their space.
magick build/icon.png -crop 824x824+100+100 +repage "$tmp/tile.png"
magick "$tmp/tile.png" -resize 512x512 src/ui/icon.png
magick "$tmp/tile.png" -define icon:auto-resize=256,128,64,48,32,24,16 build/icon.ico

if command -v iconutil >/dev/null; then
  set_dir="$tmp/icon.iconset"
  mkdir "$set_dir"
  for s in 16 32 128 256 512; do
    rsvg-convert -w $s -h $s build/icon.svg -o "$set_dir/icon_${s}x${s}.png"
    rsvg-convert -w $((s * 2)) -h $((s * 2)) build/icon.svg -o "$set_dir/icon_${s}x${s}@2x.png"
  done
  iconutil -c icns "$set_dir" -o build/icon.icns
fi
echo "icons written"
