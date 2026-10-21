const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app, ipcMain, BrowserWindow, systemPreferences } = require("electron");
const defaults = require("../config/defaults");
const store = require("./store");
const { downloadModels, modelExists } = require("./download");
const {
  updateHotkey,
  checkAccessibility,
  requestAccessibility,
} = require("./hotkey");
const { runPipeline } = require("./pipeline");
const { restartServer, isReady, stopServer } = require("./whisper-server");
const { stopParakeet } = require("./parakeet");
const { transcribePartial, cancelActivePartial } = require("./transcribe");
const {
  correctTranscript,
  sanitizeCorrections,
  BUILT_IN_COUNT,
} = require("./corrections");

/** Largest audio chunk accepted from the renderer (~16s of PCM16). */
const MAX_STREAM_CHUNK_BYTES = 512 * 1024;

const execFileAsync = promisify(execFile);

let _windows = null;

// Live Apple speech session for the recording in progress, if any.
let streamSession = null;

// Fires when a recording stopped but the window never sent its audio.
let audioWatchdog = null;

/** How long after the hotkey is released the window's audio may take. */
const AUDIO_WATCHDOG_MS = 5000;

/** Close the live speech session, if one is open. */
function cancelLiveStream() {
  if (streamSession) {
    streamSession.cancel();
    streamSession = null;
  }
}

/**
 * Call when the hotkey is released. If the window sends neither the
 * recording nor an error soon after, log it (otherwise the dictation
 * would vanish without a trace) and close any live session.
 */
function expectRecordedAudio() {
  clearTimeout(audioWatchdog);
  audioWatchdog = setTimeout(() => {
    audioWatchdog = null;
    console.warn(
      "[ipc] Recording stopped but no audio arrived from the window — it may not have been ready",
    );
    cancelLiveStream();
  }, AUDIO_WATCHDOG_MS);
}

/** Call when the window reports a recording error (audio won't come). */
function recordingFailed() {
  clearTimeout(audioWatchdog);
  audioWatchdog = null;
  cancelLiveStream();
}

function validateSender(frame) {
  if (!frame || !frame.url) return false;
  try {
    const parsed = new URL(frame.url);
    if (parsed.protocol !== "file:") return false;
    return parsed.pathname.includes("/src/renderer/");
  } catch {
    return false;
  }
}

function getWin() {
  if (_windows.main && !_windows.main.isDestroyed()) return _windows.main;
  const wins = BrowserWindow.getAllWindows().filter(
    (w) => !w.isDestroyed() && w !== _windows.overlay,
  );
  return wins[0] || null;
}

function sendToOverlay(channel, data) {
  if (_windows.overlay && !_windows.overlay.isDestroyed()) {
    _windows.overlay.webContents.send(channel, data);
  }
}

function registerIpcHandlers(windows) {
  _windows = windows;

  ipcMain.handle("get-config", (event) => {
    if (!validateSender(event.senderFrame)) return null;
    const selectedModel = store.get("selectedModel") || defaults.defaultModel;
    return {
      model: selectedModel,
      models: Object.entries(defaults.models)
        // Apple engine only appears where it can run (macOS 26+).
        .filter(([key, m]) => m.engine !== "apple" || modelExists(key))
        .map(([key, m]) => ({
          key,
          label: m.label,
          engine: m.engine,
          downloaded: modelExists(key),
        })),
      selectedModel,
      hotkey: store.get("hotkey"),
      modelExists: modelExists(selectedModel),
      accessibilityGranted: checkAccessibility(),
      microphoneGranted:
        process.platform !== "darwin" ||
        systemPreferences.getMediaAccessStatus("microphone") === "granted",
      micResetCommand: `tccutil reset Microphone ${app.isPackaged ? "com.unstablemind.vapenvibe" : "com.github.Electron"}`,
      platform: process.platform,
      language: store.get("language"),
      builtInCorrections: BUILT_IN_COUNT,
      version: app.getVersion(),
    };
  });

  ipcMain.handle("set-hotkey", (event, hotkey) => {
    if (!validateSender(event.senderFrame)) return false;
    store.set("hotkey", hotkey);
    updateHotkey(hotkey);
    return true;
  });

  ipcMain.handle("set-language", async (event, lang) => {
    if (!validateSender(event.senderFrame)) return false;
    store.set("language", lang);

    // Restart whisper server with new language if it's running
    if (isReady()) {
      restartServer(lang).catch((err) => {
        console.error("[ipc] Whisper server restart failed:", err.message);
      });
    }

    // Tell the renderer when the selected parakeet model can't serve
    // this language — transcription silently falls back to whisper.
    const selectedKey = store.get("selectedModel") || defaults.defaultModel;
    const selected = defaults.getModel(selectedKey);
    const parakeetUnsupported =
      selected.engine === "parakeet" &&
      lang !== "auto" &&
      !selected.languages.includes(lang);

    // Apple: fetch the new language's model now so the next dictation
    // doesn't wait on the download (or report it unsupported).
    let appleUnsupported = false;
    if (selected.engine === "apple" && modelExists(selectedKey)) {
      const appleSpeech = require("./apple-speech");
      appleUnsupported = !appleSpeech.supportsLanguage(lang);
      if (!appleUnsupported) {
        appleSpeech.install(lang).catch((err) => {
          console.error(
            "[ipc] Apple speech model install failed:",
            err.message,
          );
        });
      }
    }

    return { ok: true, parakeetUnsupported, appleUnsupported };
  });

  ipcMain.handle("set-model", (event, key) => {
    if (!validateSender(event.senderFrame)) return false;
    if (typeof key !== "string" || !defaults.models[key]) return false;

    const previous = store.get("selectedModel") || defaults.defaultModel;
    if (key === previous) return { ok: true, downloaded: modelExists(key) };

    store.set("selectedModel", key);

    // Stop the now-inactive engine to reclaim its memory; the new one
    // is started lazily on next use (ensureServer/ensureParakeet) or
    // eagerly here when its files are already on disk.
    const newEngine = defaults.models[key].engine;
    if (newEngine !== "whisper") stopServer();
    if (newEngine !== "parakeet") stopParakeet();

    const downloaded = modelExists(key);
    if (downloaded) {
      const { startEngineForModel } = require("./download");
      startEngineForModel(key);
    }

    return { ok: true, downloaded };
  });

  ipcMain.handle("start-downloads", async (event, modelKey) => {
    if (!validateSender(event.senderFrame)) return false;
    if (modelKey !== undefined && typeof modelKey !== "string") return false;
    const win = BrowserWindow.fromWebContents(event.sender);
    await downloadModels(win, modelKey);
    return true;
  });

  ipcMain.handle("request-accessibility", (event) => {
    if (!validateSender(event.senderFrame)) return false;
    requestAccessibility();
    return true;
  });

  ipcMain.handle("check-accessibility", (event) => {
    if (!validateSender(event.senderFrame)) return false;
    return checkAccessibility();
  });

  ipcMain.handle("check-system-events", async (event) => {
    if (!validateSender(event.senderFrame)) return false;
    if (process.platform !== "darwin") return true;
    try {
      await execFileAsync("osascript", [
        "-e",
        'tell application "System Events" to return ""',
      ]);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("request-system-events", async (event) => {
    if (!validateSender(event.senderFrame)) return false;
    if (process.platform !== "darwin") return true;
    try {
      await execFileAsync("osascript", [
        "-e",
        'tell application "System Events" to return ""',
      ]);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("check-microphone", (event) => {
    if (!validateSender(event.senderFrame)) return false;
    if (process.platform !== "darwin") return true;
    return systemPreferences.getMediaAccessStatus("microphone") === "granted";
  });

  ipcMain.handle("request-microphone", async (event) => {
    if (!validateSender(event.senderFrame)) return false;
    if (process.platform !== "darwin") return true;
    try {
      const before = systemPreferences.getMediaAccessStatus("microphone");
      console.log("[main] Microphone status before request:", before);
      const granted = await systemPreferences.askForMediaAccess("microphone");
      const after = systemPreferences.getMediaAccessStatus("microphone");
      console.log(
        "[main] Microphone status after request:",
        after,
        "granted:",
        granted,
      );
      return granted;
    } catch (err) {
      console.error("[main] Microphone access request failed:", err.message);
      return false;
    }
  });

  ipcMain.handle("check-for-updates", (event) => {
    if (!validateSender(event.senderFrame)) return false;
    const { checkForUpdates } = require("./updater");
    checkForUpdates();
    return true;
  });

  ipcMain.handle("download-update", (event) => {
    if (!validateSender(event.senderFrame)) return false;
    const { downloadUpdate } = require("./updater");
    downloadUpdate();
    return true;
  });

  ipcMain.handle("install-update", (event) => {
    if (!validateSender(event.senderFrame)) return false;
    const { installUpdate } = require("./updater");
    installUpdate();
    return true;
  });

  ipcMain.handle("get-dictionary", (event) => {
    if (!validateSender(event.senderFrame)) return [];
    return store.get("dictionaryWords");
  });

  ipcMain.handle("set-dictionary", (event, words) => {
    if (!validateSender(event.senderFrame)) return false;
    if (!Array.isArray(words)) return false;
    const clean = words
      .filter((w) => typeof w === "string" && w.trim() && !/[\s,]/.test(w))
      .filter((w) => w.length <= 50)
      .slice(0, 200);
    store.set("dictionaryWords", clean);
    return true;
  });

  ipcMain.handle("get-corrections", (event) => {
    if (!validateSender(event.senderFrame)) return [];
    return sanitizeCorrections(store.get("corrections"));
  });

  ipcMain.handle("set-corrections", (event, rules) => {
    if (!validateSender(event.senderFrame)) return false;
    if (!Array.isArray(rules)) return false;
    store.set("corrections", sanitizeCorrections(rules));
    return true;
  });

  ipcMain.handle("restart-app", (event) => {
    if (!validateSender(event.senderFrame)) return false;
    BrowserWindow.getAllWindows().forEach((w) => {
      w.forceClose = true;
    });
    app.relaunch();
    app.exit(0);
    return true;
  });

  // Forward frequency data from renderer to overlay
  ipcMain.on("viz-freq", (event, data) => {
    if (!validateSender(event.senderFrame)) return;
    sendToOverlay("viz-freq", data);
  });

  // Partial transcription — display-only preview in the overlay.
  // The full accumulated audio buffer is re-transcribed each time so
  // whisper has enough context.  We track the latest result and paste
  // it once on recording stop (avoiding a second full-pipeline pass).
  //
  // Session ID pattern: each recording session gets a unique integer ID.
  // Partials capture the ID at dispatch time and discard their result if
  // the ID has changed by the time transcribePartial() resolves — this
  // prevents a partial that was in-flight when audio-recorded fired from
  // updating the overlay after the session has already ended.
  let partialInFlight = false;
  let recordingSessionId = 0;

  function sendPartialText(text) {
    sendToOverlay("partial-text", text);
    const win = getWin();
    if (win) win.webContents.send("partial-text", text);
  }

  // Recording started: if the Apple engine will handle it, open a live
  // session the renderer streams audio into. Otherwise the renderer falls
  // back to periodic audio-partial previews.
  ipcMain.handle("audio-stream-start", (event) => {
    if (!validateSender(event.senderFrame)) return { streaming: false };
    cancelLiveStream();

    const lang = store.get("language");
    const { getActiveModel, parseOutput } = require("./transcribe");
    if (getActiveModel(lang).model.engine !== "apple") {
      return { streaming: false };
    }

    const sessionId = recordingSessionId;
    try {
      streamSession = require("./apple-speech").startStream(lang, {
        onPartial: (raw) => {
          if (sessionId !== recordingSessionId) return;
          const text = parseOutput(raw, { engine: "apple", exact: false });
          if (text) {
            sendPartialText(correctTranscript(text, store.get("corrections")));
          }
        },
      });
    } catch (err) {
      console.error("[ipc] Apple speech stream failed to start:", err.message);
      streamSession = null;
      return { streaming: false };
    }
    return { streaming: true };
  });

  ipcMain.on("audio-stream-chunk", (event, chunk) => {
    if (!validateSender(event.senderFrame)) return;
    if (!streamSession) return;
    if (!(chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk))) return;
    const bytes = ArrayBuffer.isView(chunk)
      ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      : Buffer.from(chunk);
    if (bytes.length === 0 || bytes.length > MAX_STREAM_CHUNK_BYTES) return;
    if (bytes.length % 2 !== 0) return; // PCM16 — whole samples only
    streamSession.write(bytes);
  });

  ipcMain.handle("audio-partial", async (event, wavBuffer) => {
    if (!validateSender(event.senderFrame)) return "";
    if (partialInFlight) return "";

    const sessionId = recordingSessionId;
    partialInFlight = true;
    try {
      const lang = store.get("language");
      const text = await transcribePartial(wavBuffer, lang);

      // Only update overlay if the recording session is still active.
      // If audio-recorded fired while we were awaiting, sessionId will
      // differ from recordingSessionId and we silently discard the result.
      if (text && sessionId === recordingSessionId) {
        sendPartialText(correctTranscript(text, store.get("corrections")));
      }

      return text;
    } catch (err) {
      console.error("[ipc] partial transcription error:", err.message);
      return "";
    } finally {
      partialInFlight = false;
    }
  });

  // Receive recorded audio from renderer
  ipcMain.handle("audio-recorded", async (event, wavBuffer) => {
    if (!validateSender(event.senderFrame)) return false;

    // Advance the session ID so any in-flight partial discards its result,
    // and abort it — the whisper server is single-threaded, so an active
    // partial would otherwise delay the final transcription by its full
    // inference time.
    clearTimeout(audioWatchdog);
    audioWatchdog = null;
    recordingSessionId++;
    cancelActivePartial();
    const session = streamSession;
    streamSession = null;

    // Clear overlay text (visualizer mode handled by pipeline)
    sendToOverlay("partial-text", "");

    // Always run the full pipeline with the complete audio buffer.
    // Partials were display-only previews — the final transcription
    // needs the entire recording to capture every word.
    await runPipeline(wavBuffer, {
      sendStatus: (status) => {
        const win = getWin();
        if (win) win.webContents.send("transcription-status", status);
      },
      sendOverlay: (mode) => sendToOverlay("viz-mode", mode),
      streamSession: session,
    });

    return true;
  });
}

module.exports = {
  registerIpcHandlers,
  getWin,
  sendToOverlay,
  validateSender,
  expectRecordedAudio,
  recordingFailed,
};
