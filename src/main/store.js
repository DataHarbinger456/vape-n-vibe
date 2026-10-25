const electronStore = require("electron-store");

const defaults = require("../config/defaults");

const Store = electronStore.default || electronStore;

const store = new Store({
  projectName: "vape-n-vibe",
  defaults: {
    hotkey: defaults.hotkey,
    hotkeyMode: defaults.hotkeyMode,
    language: "auto",
    selectedModel: defaults.defaultModel,
    dictionaryWords: [],
    // Find-and-replace rules applied to every transcript: [{ from, to }].
    corrections: [],
    // Recent final transcripts, newest first: [{ id, text, timestamp }].
    history: [],
    // Set once the one-time switch to the Apple engine has been applied.
    appleDefaultApplied: false,
  },
});

module.exports = store;
