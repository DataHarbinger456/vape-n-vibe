/**
 * Apple on-device speech engine (macOS 26+ SpeechAnalyzer).
 *
 * Thin wrapper around the vendored `apple-speech` Swift helper
 * (src/native/apple_speech.swift, built by scripts/build-apple-speech.sh).
 * The helper is spawned per recording (stream) or per file — there is no
 * resident model to keep warm or unload: macOS owns the model and its
 * memory, so nothing here needs idle-stop handling.
 */
const { execFile, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { getAppleSpeechPath } = require("../config/paths");

/** macOS 26 (Tahoe) is Darwin 25 — first release with SpeechAnalyzer. */
const MIN_DARWIN_MAJOR = 25;

/** First use may download the locale model from Apple; allow for that. */
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/** A stream that receives no audio for this long is abandoned. */
const STREAM_IDLE_MS = 60 * 1000;

/** Minimum wait for a stream's final result after audio ends. */
const STREAM_FINISH_MIN_MS = 30 * 1000;

/** Language codes Apple supports, once fetched from the helper. */
let languageCache = null;
let languageLoad = null;

/**
 * Whether the Apple engine can run here: macOS 26+ and the helper built.
 * @returns {boolean}
 */
function isAvailable() {
  if (process.platform !== "darwin") return false;
  const darwinMajor = parseInt(os.release().split(".")[0], 10);
  if (!(darwinMajor >= MIN_DARWIN_MAJOR)) return false;
  return getAppleSpeechPath() !== null;
}

/**
 * Run the helper and parse its single-line JSON reply.
 * @param {string[]} args
 * @param {{ timeout: number, signal?: AbortSignal }} options
 * @returns {Promise<Record<string, unknown>>}
 */
function runHelper(args, { timeout, signal }) {
  const bin = getAppleSpeechPath();
  if (!bin) {
    return Promise.reject(new Error("apple-speech helper is not built"));
  }
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout, signal, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        let reply = null;
        try {
          reply = JSON.parse(String(stdout).trim().split("\n").pop() || "");
        } catch {
          // no parseable reply — fall through to the process error
        }
        if (reply && typeof reply.error === "string") {
          reject(new Error(`Apple speech: ${reply.error}`));
          return;
        }
        if (err) {
          reject(err);
          return;
        }
        if (!reply || typeof reply !== "object") {
          reject(new Error("Apple speech: helper returned no result"));
          return;
        }
        resolve(reply);
      },
    );
  });
}

/**
 * Make sure the locale model for `lang` is installed (downloads it from
 * Apple on first use). Safe to call repeatedly — a no-op once installed.
 * @param {string} lang - App language setting ("auto", "en", …).
 */
async function install(lang) {
  const reply = await runHelper(["install", "--lang", lang || "auto"], {
    timeout: INSTALL_TIMEOUT_MS,
  });
  console.log(`[apple-speech] Model ready (${reply.locale})`);
  return reply;
}

/**
 * Transcribe a 16kHz mono PCM16 WAV buffer.
 * @param {Uint8Array} wavData
 * @param {string} lang - App language setting ("auto", "en", …).
 * @param {{ duration?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<string>}
 */
async function transcribeWav(wavData, lang, { duration = 0, signal } = {}) {
  const wavPath = path.join(
    os.tmpdir(),
    `vapenvibe-apple-${Date.now()}-${crypto.randomUUID()}.wav`,
  );
  await fs.writeFile(wavPath, wavData);
  try {
    // Generous budget: first use can include the locale model download.
    const timeout = Math.max(INSTALL_TIMEOUT_MS, duration * 5000);
    const reply = await runHelper(
      ["transcribe", "--lang", lang || "auto", wavPath],
      { timeout, signal },
    );
    return typeof reply.text === "string" ? reply.text : "";
  } finally {
    fs.unlink(wavPath).catch(() => {
      // best-effort cleanup
    });
  }
}

/**
 * Fetch (once) the language codes Apple speech supports. Never rejects:
 * on failure it resolves null and the next call retries.
 * @returns {Promise<Set<string> | null>}
 */
function loadSupportedLanguages() {
  if (languageLoad) return languageLoad;
  languageLoad = runHelper(["languages"], { timeout: 30000 })
    .then((reply) => {
      const list = Array.isArray(reply.languages) ? reply.languages : [];
      languageCache = new Set(list.filter((l) => typeof l === "string"));
      return languageCache;
    })
    .catch((err) => {
      console.warn("[apple-speech] Could not list languages:", err.message);
      languageLoad = null;
      return null;
    });
  return languageLoad;
}

/**
 * Whether Apple speech can transcribe `lang` (an app language code).
 * "auto" follows the Mac's language and always counts as supported.
 * Until the language list has loaded this optimistically answers true
 * (and starts the load) so the first dictation isn't blocked on it.
 * @param {string} [lang]
 * @returns {boolean}
 */
function supportsLanguage(lang) {
  if (!lang || lang === "auto") return true;
  if (!languageCache) {
    loadSupportedLanguages();
    return true;
  }
  return languageCache.has(lang);
}

/**
 * Start a live transcription session for one recording. Feed it raw
 * 16kHz mono PCM16 with write(); call finish() when recording stops to
 * get the final text, or cancel() to discard it.
 *
 * @param {string} lang - App language setting ("auto", "en", …).
 * @param {{ onPartial?: (text: string) => void }} [options]
 * @returns {{
 *   write: (bytes: Uint8Array) => boolean,
 *   finish: (options?: { timeoutMs?: number }) => Promise<string>,
 *   cancel: () => void,
 * }}
 */
function startStream(lang, { onPartial } = {}) {
  const bin = getAppleSpeechPath();
  if (!bin) throw new Error("apple-speech helper is not built");

  const proc = spawn(bin, ["stream", "--lang", lang || "auto"], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let finalText = null;
  let helperError = null;
  let closed = false;
  let lineBuf = "";

  function handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // not one of ours — ignore
    }
    if (!msg || typeof msg !== "object") return;
    if (typeof msg.error === "string") {
      helperError = new Error(`Apple speech: ${msg.error}`);
    } else if (typeof msg.text === "string") {
      finalText = msg.text;
    } else if (typeof msg.partial === "string" && onPartial) {
      try {
        onPartial(msg.partial);
      } catch (err) {
        console.warn("[apple-speech] Partial handler failed:", err.message);
      }
    }
  }

  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    lineBuf += chunk;
    let nl;
    while ((nl = lineBuf.indexOf("\n")) !== -1) {
      const line = lineBuf.slice(0, nl).trim();
      lineBuf = lineBuf.slice(nl + 1);
      if (line) handleLine(line);
    }
  });
  proc.stderr.on("data", (chunk) => {
    process.stderr.write(`[apple-speech] ${chunk.toString()}`);
  });
  // The helper may exit before we stop writing (error, cancel) — that
  // surfaces through the exit path below, not as a pipe error.
  proc.stdin.on("error", () => {});

  const exited = new Promise((resolve) => {
    proc.on("error", (err) => {
      helperError = helperError || err;
      resolve();
    });
    // "close" fires after stdout is fully drained, so the final line
    // has been handled by the time we read finalText.
    proc.on("close", () => resolve());
  });
  const result = exited.then(() => {
    if (finalText !== null) return finalText;
    throw helperError || new Error("Apple speech: stream ended without text");
  });
  // Cancelled sessions are never awaited — don't report that as unhandled.
  result.catch(() => {});

  let idleTimer = null;
  function cancel() {
    closed = true;
    clearTimeout(idleTimer);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill();
  }
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      console.warn("[apple-speech] Stream received no audio — cancelling");
      cancel();
    }, STREAM_IDLE_MS);
  }
  armIdle();

  return {
    write(bytes) {
      if (closed) return false;
      armIdle();
      proc.stdin.write(bytes);
      return true;
    },
    async finish({ timeoutMs = STREAM_FINISH_MIN_MS } = {}) {
      if (!closed) {
        closed = true;
        clearTimeout(idleTimer);
        proc.stdin.end();
      }
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          cancel();
          reject(new Error("Apple speech: stream timed out"));
        }, timeoutMs);
      });
      try {
        return await Promise.race([result, timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel,
  };
}

module.exports = {
  isAvailable,
  install,
  transcribeWav,
  loadSupportedLanguages,
  supportsLanguage,
  startStream,
  STREAM_FINISH_MIN_MS,
};
