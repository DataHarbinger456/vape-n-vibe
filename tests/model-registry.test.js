/**
 * Tests for multi-model engine dispatch:
 *   - getActiveModel fallback rules (unsupported language / missing files
 *     route parakeet selections back to whisper)
 *   - parakeet-specific parseOutput filtering (no whisper hallucination
 *     exact-match or trailing-phrase stripping)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fake store — controls selectedModel and language per test.
const storeState = { selectedModel: undefined, language: "auto" };
const fakeStore = {
  get: vi.fn((key) => storeState[key]),
  set: vi.fn(),
};

const storePath = require.resolve(
  path.resolve(__dirname, "../src/main/store.js"),
);
require.cache[storePath] = {
  id: storePath,
  filename: storePath,
  loaded: true,
  exports: fakeStore,
};

// Fake download module — controls modelExists per test.
const downloadState = { exists: true };
const downloadPath = require.resolve(
  path.resolve(__dirname, "../src/main/download.js"),
);
require.cache[downloadPath] = {
  id: downloadPath,
  filename: downloadPath,
  loaded: true,
  exports: {
    modelExists: vi.fn(() => downloadState.exists),
    downloadModels: vi.fn(),
    startEngineForModel: vi.fn(),
  },
};

// Fake parakeet engine — controls the raw preview/decode text per test
// without spawning the real sherpa-onnx utilityProcess worker.
const parakeetState = { text: "" };
const parakeetPath = require.resolve(
  path.resolve(__dirname, "../src/main/parakeet/index.js"),
);
require.cache[parakeetPath] = {
  id: parakeetPath,
  filename: parakeetPath,
  loaded: true,
  exports: {
    transcribeWav: vi.fn(async () => parakeetState.text),
    ensureParakeet: vi.fn(),
    stopParakeet: vi.fn(),
    isReady: vi.fn(() => true),
  },
};

// Fake Apple engine — controls language support and decode results
// without spawning the real Swift helper.
const appleState = { unsupported: new Set(), fileText: "from file" };
const appleTranscribeWav = vi.fn(async () => appleState.fileText);
const applePath = require.resolve(
  path.resolve(__dirname, "../src/main/apple-speech.js"),
);
require.cache[applePath] = {
  id: applePath,
  filename: applePath,
  loaded: true,
  exports: {
    supportsLanguage: vi.fn((lang) => !appleState.unsupported.has(lang)),
    transcribeWav: appleTranscribeWav,
    STREAM_FINISH_MIN_MS: 30000,
  },
};

const transcribePath = require.resolve(
  path.resolve(__dirname, "../src/main/transcribe.js"),
);
delete require.cache[transcribePath];
const { getActiveModel, parseOutput, transcribePartial, transcribe } = require(
  transcribePath,
);

const PARAKEET_KEY = "parakeet-tdt-0.6b-v3-int8";
const WHISPER_KEY = "whisper-large-v3-turbo-q5";

describe("getActiveModel", () => {
  beforeEach(() => {
    storeState.selectedModel = undefined;
    storeState.language = "auto";
    downloadState.exists = true;
  });

  it("returns the default whisper model when nothing is selected", () => {
    const { key, model } = getActiveModel();
    expect(key).toBe(WHISPER_KEY);
    expect(model.engine).toBe("whisper");
  });

  it("returns parakeet when selected, downloaded, and language supported", () => {
    storeState.selectedModel = PARAKEET_KEY;
    storeState.language = "en";
    const { key, model } = getActiveModel();
    expect(key).toBe(PARAKEET_KEY);
    expect(model.engine).toBe("parakeet");
  });

  it("keeps parakeet on auto language", () => {
    storeState.selectedModel = PARAKEET_KEY;
    storeState.language = "auto";
    expect(getActiveModel().key).toBe(PARAKEET_KEY);
  });

  it("falls back to whisper for unsupported languages", () => {
    storeState.selectedModel = PARAKEET_KEY;
    storeState.language = "ja";
    const { key, model } = getActiveModel();
    expect(key).toBe(WHISPER_KEY);
    expect(model.engine).toBe("whisper");
  });

  it("honours the explicit lang argument over the stored language", () => {
    storeState.selectedModel = PARAKEET_KEY;
    storeState.language = "en";
    expect(getActiveModel("zh").key).toBe(WHISPER_KEY);
    expect(getActiveModel("fr").key).toBe(PARAKEET_KEY);
  });

  it("falls back to whisper when parakeet files are missing", () => {
    storeState.selectedModel = PARAKEET_KEY;
    storeState.language = "en";
    downloadState.exists = false;
    expect(getActiveModel().key).toBe(WHISPER_KEY);
  });

  it("returns apple when selected and available", () => {
    storeState.selectedModel = "apple-speech";
    const { key, model } = getActiveModel();
    expect(key).toBe("apple-speech");
    expect(model.engine).toBe("apple");
  });

  it("falls back to whisper when apple speech is unavailable", () => {
    storeState.selectedModel = "apple-speech";
    downloadState.exists = false;
    expect(getActiveModel().key).toBe(WHISPER_KEY);
  });

  it("capitalises sentence starts in apple output", () => {
    expect(
      parseOutput("testing it out. but do have a look! and then? yes", {
        engine: "apple",
      }),
    ).toBe("testing it out. But do have a look! And then? Yes");
  });

  it("leaves ellipses and abbreviations alone in apple output", () => {
    expect(
      parseOutput("well... then, e.g. this and the U.S. army", {
        engine: "apple",
      }),
    ).toBe("well... then, e.g. this and the U.S. army");
  });

  it("falls back to whisper for languages apple doesn't support", () => {
    storeState.selectedModel = "apple-speech";
    appleState.unsupported = new Set(["ar"]);
    expect(getActiveModel("ar").key).toBe(WHISPER_KEY);
    expect(getActiveModel("en").key).toBe("apple-speech");
    appleState.unsupported = new Set();
  });

  it("does not strip whisper-style hallucination phrases from apple output", () => {
    expect(parseOutput("Thank you.", { engine: "apple" })).toBe("Thank you.");
    expect(parseOutput("All good now, thanks.", { engine: "apple" })).toBe(
      "All good now, thanks.",
    );
  });

  it("falls back to the default model for unknown keys", () => {
    storeState.selectedModel = "no-such-model";
    expect(getActiveModel().key).toBe(WHISPER_KEY);
  });
});

describe("Apple final transcription", () => {
  // 1s of constant-amplitude tone — clears analyzeWav's hasSpeech check.
  function makeSpeechWav() {
    const wav = Buffer.alloc(44 + 16000 * 2);
    for (let offset = 44; offset < wav.length; offset += 2) {
      wav.writeInt16LE(5000, offset);
    }
    return wav;
  }

  function makeSession(finish) {
    return { finish: vi.fn(finish), cancel: vi.fn() };
  }

  beforeEach(() => {
    storeState.selectedModel = "apple-speech";
    storeState.language = "en";
    downloadState.exists = true;
    appleState.unsupported = new Set();
    appleTranscribeWav.mockClear();
  });

  it("uses the live stream's result without decoding the file", async () => {
    const session = makeSession(async () => "streamed text");
    const text = await transcribe("/unused.wav", "en", {
      rawWav: makeSpeechWav(),
      streamSession: session,
    });
    expect(text).toBe("streamed text");
    expect(session.finish).toHaveBeenCalledTimes(1);
    expect(appleTranscribeWav).not.toHaveBeenCalled();
  });

  it("falls back to a file decode when the stream fails", async () => {
    const session = makeSession(async () => {
      throw new Error("helper crashed");
    });
    const text = await transcribe("/unused.wav", "en", {
      rawWav: makeSpeechWav(),
      streamSession: session,
    });
    expect(text).toBe("from file");
    expect(appleTranscribeWav).toHaveBeenCalledTimes(1);
  });

  it("cancels an unused stream when the audio is silent", async () => {
    const session = makeSession(async () => "never");
    const silent = Buffer.alloc(44 + 16000 * 2);
    const text = await transcribe("/unused.wav", "en", {
      rawWav: silent,
      streamSession: session,
    });
    expect(text).toBe("");
    expect(session.finish).not.toHaveBeenCalled();
    expect(session.cancel).toHaveBeenCalled();
  });
});

describe("Parakeet partial transcription", () => {
  // 1s of constant-amplitude tone — clears analyzeWav's hasSpeech check.
  function makeSpeechWav() {
    const wav = Buffer.alloc(44 + 16000 * 2);
    for (let offset = 44; offset < wav.length; offset += 2) {
      wav.writeInt16LE(5000, offset);
    }
    return wav;
  }

  beforeEach(() => {
    storeState.selectedModel = PARAKEET_KEY;
    storeState.language = "en";
    downloadState.exists = true;
    parakeetState.text = "";
  });

  it("decodes a live preview on the shared worker", async () => {
    parakeetState.text = "hello world";
    await expect(transcribePartial(makeSpeechWav(), "en")).resolves.toBe(
      "hello world",
    );
  });

  it("keeps plausible single-word previews (no exact-match filtering)", async () => {
    parakeetState.text = "okay";
    await expect(transcribePartial(makeSpeechWav(), "en")).resolves.toBe(
      "okay",
    );
  });

  it("still applies structural filtering to previews", async () => {
    parakeetState.text = "[BLANK_AUDIO]";
    await expect(transcribePartial(makeSpeechWav(), "en")).resolves.toBe("");
  });
});

describe("parseOutput parakeet engine", () => {
  it("keeps phrases whisper would reject as exact hallucinations", () => {
    expect(parseOutput("Thank you.", { engine: "parakeet" })).toBe(
      "Thank you.",
    );
    expect(parseOutput("Bye bye!", { engine: "parakeet" })).toBe("Bye bye!");
  });

  it("does not strip trailing hallucination phrases", () => {
    expect(
      parseOutput("Deploy the feature. Thanks.", { engine: "parakeet" }),
    ).toBe("Deploy the feature. Thanks.");
  });

  it("still applies structural filtering", () => {
    expect(parseOutput("[BLANK_AUDIO]", { engine: "parakeet" })).toBe("");
    expect(parseOutput("...", { engine: "parakeet" })).toBe("");
  });

  it("still applies repetitive-loop filtering", () => {
    expect(
      parseOutput("word word word word word word", { engine: "parakeet" }),
    ).toBe("");
  });

  it("whisper engine behavior is unchanged", () => {
    expect(parseOutput("Thank you.")).toBe("");
    expect(parseOutput("Deploy the feature. Thanks.")).toBe(
      "Deploy the feature.",
    );
  });
});
