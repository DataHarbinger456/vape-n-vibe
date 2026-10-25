#!/usr/bin/env bash
#
# Build a Vaper DMG signed with a local, self-made certificate instead of an
# Apple Developer ID. Signing every build with the same certificate keeps
# macOS permissions (Accessibility, microphone) across updates.
#
# Usage: scripts/build-local.sh [--install]
#   VAPER_SIGN_ID   certificate name (default "Vaper Local Code Signing")
#   --install       also replace /Applications/Vaper.app and relaunch it
#
# Output: release/vape-n-vibe.dmg and release/vape-n-vibe.zip
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT_DIR
readonly SIGN_ID="${VAPER_SIGN_ID:-Vaper Local Code Signing}"
readonly ENTITLEMENTS="${ROOT_DIR}/scripts/entitlements.mac.plist"
readonly APP="${ROOT_DIR}/release/mac-arm64/Vaper.app"
readonly INSTALLED="/Applications/Vaper.app"

sign() {
  codesign --force --options runtime --timestamp=none \
    --entitlements "${ENTITLEMENTS}" --sign "${SIGN_ID}" "$@"
}

# Sign inside-out: loose binaries, then frameworks and helper apps, then the
# app itself. `codesign --deep` alone skips binaries outside bundle folders.
sign_app() {
  local f
  while IFS= read -r -d '' f; do
    if file -b "${f}" | grep -q "Mach-O"; then sign "${f}"; fi
  done < <(find "${APP}/Contents/Resources" \
    "${APP}/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries" \
    "${APP}/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers" \
    "${APP}/Contents/Frameworks/Squirrel.framework/Versions/A/Resources" \
    -type f -print0 | sort -z)
  for f in "${APP}/Contents/Frameworks/"*.framework \
    "${APP}/Contents/Frameworks/"*.app; do
    sign "${f}"
  done
  sign "${APP}"
  codesign --verify --deep --strict "${APP}"
}

install_app() {
  # Only replace a Vaper signed with this certificate, never another copy.
  local leaf
  leaf="$(codesign -d -r- "${APP}" 2>&1 | grep -oE 'certificate leaf = H"[0-9a-f]+"')"
  if [[ -e "${INSTALLED}" ]] &&
    ! codesign -d -r- "${INSTALLED}" 2>&1 | grep -qF "${leaf}"; then
    echo "${INSTALLED} isn't signed with \"${SIGN_ID}\" — not replacing it." >&2
    exit 1
  fi
  if pgrep -x Vaper >/dev/null; then
    osascript -e 'tell application id "com.unstablemind.vapenvibe" to quit'
    local _
    for _ in $(seq 1 20); do
      pgrep -x Vaper >/dev/null || break
      sleep 0.5
    done
    if pgrep -x Vaper >/dev/null; then
      echo "Vaper did not quit" >&2
      exit 1
    fi
  fi
  rm -rf "${INSTALLED}"
  ditto "${APP}" "${INSTALLED}"
  open "${INSTALLED}"
  echo "Installed and relaunched ${INSTALLED}"
}

main() {
  cd "${ROOT_DIR}"
  if ! security find-certificate -c "${SIGN_ID}" >/dev/null 2>&1; then
    echo "No \"${SIGN_ID}\" certificate in the keychain." >&2
    exit 1
  fi

  npm run lint
  npm run format:check
  npm test

  bash scripts/build-apple-speech.sh
  if command -v cmake >/dev/null; then
    bash scripts/build-whisper-server.sh
  else
    echo "cmake not installed — skipping the modern whisper-server" \
      "(Whisper models use whisper-node's bundled server if present)."
  fi

  rm -rf release
  npx electron-builder --mac --dir --publish never \
    -c.mac.identity=null -c.mac.notarize=false
  sign_app
  npx electron-builder --mac --prepackaged "${APP}" --publish never \
    -c.mac.identity=null -c.mac.notarize=false
  echo "Built release/vape-n-vibe.dmg"

  if [[ "${1:-}" == "--install" ]]; then install_app; fi
}

main "$@"
