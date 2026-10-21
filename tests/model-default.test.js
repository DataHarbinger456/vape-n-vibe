import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { applyAppleDefault } = require("../src/main/model-default");
const defaults = require("../src/config/defaults");

const WHISPER_KEY = defaults.defaultModel;
const PARAKEET_KEY = defaults.getModelByEngine("parakeet").key;

function makeStore(initial) {
  const state = { ...initial };
  return {
    state,
    get: (key) => state[key],
    set: (key, value) => {
      state[key] = value;
    },
  };
}

describe("applyAppleDefault", () => {
  it("switches a Whisper user to Apple once Apple is available", () => {
    const store = makeStore({ selectedModel: WHISPER_KEY });
    expect(applyAppleDefault(store, { appleAvailable: true })).toBe(true);
    expect(store.state.selectedModel).toBe("apple-speech");
    expect(store.state.appleDefaultApplied).toBe(true);
  });

  it("switches when nothing is selected yet", () => {
    const store = makeStore({});
    expect(applyAppleDefault(store, { appleAvailable: true })).toBe(true);
    expect(store.state.selectedModel).toBe("apple-speech");
  });

  it("leaves a Parakeet user alone but marks the switch as done", () => {
    const store = makeStore({ selectedModel: PARAKEET_KEY });
    expect(applyAppleDefault(store, { appleAvailable: true })).toBe(false);
    expect(store.state.selectedModel).toBe(PARAKEET_KEY);
    expect(store.state.appleDefaultApplied).toBe(true);
  });

  it("only happens once, so going back to Whisper sticks", () => {
    const store = makeStore({ selectedModel: WHISPER_KEY });
    applyAppleDefault(store, { appleAvailable: true });
    store.set("selectedModel", WHISPER_KEY);
    expect(applyAppleDefault(store, { appleAvailable: true })).toBe(false);
    expect(store.state.selectedModel).toBe(WHISPER_KEY);
  });

  it("does nothing (and waits) while Apple is unavailable", () => {
    const store = makeStore({ selectedModel: WHISPER_KEY });
    expect(applyAppleDefault(store, { appleAvailable: false })).toBe(false);
    expect(store.state.selectedModel).toBe(WHISPER_KEY);
    expect(store.state.appleDefaultApplied).toBeUndefined();
  });
});
