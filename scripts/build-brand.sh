#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# Regenerate the app icon, menu-bar glyph and DMG background from
# design/brand/ (rendered in headless Chromium, then packed with
# iconutil and Pillow).
#
# Outputs (all committed):
#   assets/icon.png, assets/icon.icns, assets/icon.ico
#   assets/trayTemplate.png, assets/trayTemplate@2x.png
#   installer/background.png, installer/background@2x.png
#
# Requires macOS (iconutil), python3 with Pillow, and Playwright resolvable
# by Node (set NODE_PATH if it lives in an npx cache).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT_DIR

WORK_DIR=""

cleanup() {
  if [[ -n "${WORK_DIR}" ]]; then
    rm -rf "${WORK_DIR}"
  fi
}

main() {
  WORK_DIR="$(mktemp -d)"
  trap cleanup EXIT
  local work="${WORK_DIR}"

  node "${ROOT_DIR}/design/brand/export.cjs" "${work}/png"

  # macOS icon set: 16 to 512 points at 1x and 2x.
  local iconset="${work}/icon.iconset"
  mkdir -p "${iconset}"
  local size
  for size in 16 32 128 256 512; do
    cp "${work}/png/icon-${size}.png" "${iconset}/icon_${size}x${size}.png"
  done
  cp "${work}/png/icon-32.png" "${iconset}/icon_16x16@2x.png"
  cp "${work}/png/icon-64.png" "${iconset}/icon_32x32@2x.png"
  cp "${work}/png/icon-256.png" "${iconset}/icon_128x128@2x.png"
  cp "${work}/png/icon-512.png" "${iconset}/icon_256x256@2x.png"
  cp "${work}/png/icon.png" "${iconset}/icon_512x512@2x.png"
  iconutil -c icns "${iconset}" -o "${ROOT_DIR}/assets/icon.icns"

  cp "${work}/png/icon.png" "${ROOT_DIR}/assets/icon.png"
  cp "${work}/png/tray.png" "${ROOT_DIR}/assets/trayTemplate.png"
  cp "${work}/png/tray2x.png" "${ROOT_DIR}/assets/trayTemplate@2x.png"

  mkdir -p "${ROOT_DIR}/installer"
  cp "${work}/png/dmg.png" "${ROOT_DIR}/installer/background.png"
  cp "${work}/png/dmg2x.png" "${ROOT_DIR}/installer/background@2x.png"

  # Windows icon: one file with the standard sizes.
  python3 - "${work}/png/icon.png" "${ROOT_DIR}/assets/icon.ico" <<'PY'
import sys
from PIL import Image

src, dest = sys.argv[1], sys.argv[2]
Image.open(src).save(
    dest, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
)
PY

  echo "Brand assets written to assets/ and installer/"
}

main "$@"
