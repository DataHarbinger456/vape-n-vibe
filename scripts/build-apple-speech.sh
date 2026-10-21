#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# Build the Apple on-device speech helper (SpeechAnalyzer, macOS 26+).
#
# Output: vendor/apple-speech/apple-speech (gitignored). Skipped on
# non-macOS hosts — the Apple engine is macOS-only.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT_DIR
readonly SRC_FILE="${ROOT_DIR}/src/native/apple_speech.swift"
readonly OUT_DIR="${ROOT_DIR}/vendor/apple-speech"
readonly OUT_BIN="${OUT_DIR}/apple-speech"

main() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Not macOS — skipping apple-speech helper"
    exit 0
  fi

  # Rebuild only when the source is newer than the binary.
  if [[ -x "${OUT_BIN}" && "${OUT_BIN}" -nt "${SRC_FILE}" ]]; then
    echo "apple-speech helper up to date — skipping"
    exit 0
  fi

  mkdir -p "${OUT_DIR}"
  xcrun swiftc \
    -O \
    -parse-as-library \
    -target arm64-apple-macos26.0 \
    "${SRC_FILE}" \
    -o "${OUT_BIN}"

  echo "Built apple-speech -> ${OUT_BIN}"
}

main "$@"
