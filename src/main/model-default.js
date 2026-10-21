/**
 * One-time move to the Apple engine on Macs that can run it.
 *
 * New installs start on the registry default (Whisper); existing users
 * may have Whisper stored. The first time the Apple engine is available,
 * anyone still on that default is switched to Apple. Anyone who picked
 * something else (e.g. Parakeet) is left alone, and the switch never
 * repeats, so choosing Whisper again afterwards sticks.
 */
const defaults = require("../config/defaults");

const APPLE_MODEL_KEY = "apple-speech";

/**
 * @param {{ get: (key: string) => unknown, set: (key: string, value: unknown) => void }} store
 * @param {{ appleAvailable: boolean }} env
 * @returns {boolean} true when the selection was switched to Apple.
 */
function applyAppleDefault(store, { appleAvailable }) {
  if (!appleAvailable) return false;
  if (store.get("appleDefaultApplied")) return false;
  store.set("appleDefaultApplied", true);

  const current = store.get("selectedModel");
  if (current && current !== defaults.defaultModel) return false;

  store.set("selectedModel", APPLE_MODEL_KEY);
  console.log("[model-default] Switched the transcription engine to Apple");
  return true;
}

module.exports = { applyAppleDefault, APPLE_MODEL_KEY };
