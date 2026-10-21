# Vape 'n' Vibe

Push-to-talk desktop app that records audio via hotkey, transcribes it on-device (Apple speech on macOS 26+, otherwise Whisper or Parakeet), applies the user's dictionary corrections, and pastes the result.

## Tech Stack

Electron (JS, no TypeScript), whisper.cpp server (vendored, with whisper-node as fallback), sherpa-onnx-node (Parakeet), uiohook-napi, electron-store. Native Obj-C module for macOS fn key monitoring. Swift helper for Apple's SpeechAnalyzer (macOS 26+).

## Project Structure

```
main.js                    # Electron entry — IPC handlers, tray, hotkey setup
src/
  config/defaults.js       # Model paths, window size, default settings
  main/
    window.js              # Main window + overlay creation
    hotkey.js              # Global hotkey via uiohook + native fn monitor
    transcribe.js          # Engine routing + fallbacks, hallucination filtering
    pipeline.js            # Recorded audio → transcribe → corrections → paste
    whisper-server.js      # whisper.cpp HTTP server lifecycle
    parakeet/              # Parakeet (sherpa-onnx) utilityProcess worker
    apple-speech.js        # Apple engine: runs the Swift helper (file + live stream)
    corrections.js         # Dictionary find-and-replace rules
    model-default.js       # One-time switch to the Apple engine where available
    engine-idle.js         # Unloads resident engines after 30s idle
    ipc.js                 # IPC handlers (settings, audio, live stream)
    paste.js               # Clipboard write + simulate Cmd/Ctrl+V
    download.js            # Model downloader with progress
    store.js               # Persistent settings (electron-store)
    preload.js             # Main window IPC bridge
    preload-overlay.js     # Overlay window IPC bridge
  renderer/
    index.html + renderer.js + styles.css    # Settings UI
    visualizer.html + visualizer.js + visualizer.css  # Recording overlay
  native/fn_key_monitor.mm # macOS fn key via IOKit
  native/apple_speech.swift # Apple SpeechAnalyzer helper (scripts/build-apple-speech.sh)
models/                    # Local model files (gitignored)
assets/                    # Tray icons
```

## Organization Rules

- Main process code → `src/main/`, one module per concern
- Renderer code → `src/renderer/`, HTML+JS+CSS per window
- Config → `src/config/`
- IPC flows through preload scripts, never expose node directly to renderer
- Keep files single-responsibility

## Code Quality

After editing ANY file, run:

```bash
npm run lint
npm run format:check
```

Fix ALL errors before continuing. Use `npm run lint:fix` and `npm run format` for auto-fixes.

## Architecture Notes

- Main window hides on close (not destroyed) to keep renderer alive for recording
- Overlay window is always-on-top, transparent, mouse-through — used for recording/processing visualizer
- Hotkey system supports both native fn key (macOS) and uiohook for all other keys
- Audio flows: renderer records → WAV buffer → main process → transcribe (selected engine) → corrections → clipboard paste
- Apple engine streams audio live: the renderer sends PCM chunks over `audio-stream-chunk` to a helper started at recording start, so the final text is ready about 0.1s after release (falls back to decoding the WAV file if the stream fails). Other engines show a preview by re-transcribing a 15s window every 2s
- The mic stays open 30s after a dictation; the audio worklet keeps the last 0.3s so the next recording includes audio from just before the key press. Capture continues 250ms after release, with Chromium's echo cancellation, noise suppression and auto gain turned off
- Apple engine needs macOS 26+ and the helper built with the macOS 26 SDK (`npm run build:apple-speech`; CI selects Xcode 26). Unsupported languages fall back to Whisper
