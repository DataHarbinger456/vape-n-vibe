/**
 * Idle-unload manager for resident transcription engines.
 *
 * The whisper.cpp server and the parakeet utilityProcess worker hold
 * their model in memory once started and never free it on their own —
 * by design, so back-to-back transcriptions stay fast. Left alone that
 * means hundreds of MB to ~1GB sit in RAM indefinitely after a single use.
 *
 * This module arms a short timer every time a transcription finishes and
 * cancels it every time one starts. If nothing happens for IDLE_MS, any
 * engine that is running is stopped; it reloads lazily
 * (ensureServer/ensureParakeet) on the next hotkey press.
 *
 * The Apple engine has nothing resident to unload (macOS owns its model),
 * so when it is in use this finds nothing running and stays quiet. It
 * checks what is actually running rather than the selected engine, so a
 * whisper fallback (e.g. a language Apple doesn't support) still gets
 * unloaded.
 */

/** Idle window before resident models are unloaded. */
const IDLE_MS = 30000;

let timer = null;

function stopIdleEngines() {
  const whisper = require("./whisper-server");
  const parakeet = require("./parakeet");
  const running = [];
  if (whisper.isReady()) running.push("whisper");
  if (parakeet.isReady()) running.push("parakeet");
  if (running.length === 0) return;

  console.log(
    `[engine-idle] No activity for ${IDLE_MS / 1000}s — unloading ${running.join(" and ")}`,
  );
  try {
    if (running.includes("whisper")) whisper.stopServer();
    if (running.includes("parakeet")) parakeet.stopParakeet();
  } catch (err) {
    console.error("[engine-idle] Failed to stop idle engine:", err.message);
  }
}

/** Cancel any pending idle-stop — call when a transcription starts. */
function cancelIdleStop() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** (Re)arm the idle-stop timer — call when a transcription finishes. */
function scheduleIdleStop() {
  cancelIdleStop();
  timer = setTimeout(() => {
    timer = null;
    stopIdleEngines();
  }, IDLE_MS);
}

module.exports = { cancelIdleStop, scheduleIdleStop };
