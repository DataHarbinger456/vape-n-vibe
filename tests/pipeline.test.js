import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock paste so nothing actually gets dispatched to the OS keyboard.
vi.mock("../src/main/paste", () => ({
  pasteText: vi.fn(() => Promise.resolve()),
}));

vi.mock("../src/main/store", () => ({
  default: { get: vi.fn(() => "auto"), set: vi.fn() },
  get: vi.fn(() => "auto"),
  set: vi.fn(),
}));

import { runPipeline } from "../src/main/pipeline";
import { createRequire } from "node:module";

// Pipeline imports `transcribe` as a module object (not destructured)
// specifically so tests can monkey-patch individual exports here.
// We use createRequire to grab the same CJS module instance pipeline
// uses (the ESM `import * as` namespace is read-only).
const nodeRequire = createRequire(import.meta.url);
const transcribeMod = nodeRequire("../src/main/transcribe");

let transcribeSpy;
let originalTranscribe;
beforeEach(() => {
  originalTranscribe = transcribeMod.transcribe;
  transcribeSpy = vi.fn(() => Promise.reject(new Error("no model")));
  transcribeMod.transcribe = transcribeSpy;
});
afterEach(() => {
  transcribeMod.transcribe = originalTranscribe;
});

// ---------------------------------------------------------------------------
// WAV helpers (mirrors tests/audio.test.js)
// ---------------------------------------------------------------------------
const WAV_HEADER = 44;
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SEC = SAMPLE_RATE * BYTES_PER_SAMPLE; // 32000
const SEGMENT_SAMPLES = Math.floor(SAMPLE_RATE * 0.05); // 800
const SEGMENT_BYTES = SEGMENT_SAMPLES * BYTES_PER_SAMPLE; // 1600

function makeWav(pcmData) {
  const buf = Buffer.alloc(WAV_HEADER + pcmData.length);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + pcmData.length, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(BYTES_PER_SEC, 28);
  buf.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(pcmData.length, 40);
  pcmData.copy(buf, WAV_HEADER);
  return buf;
}

function makePcmSegments(numSegments, sample) {
  const buf = Buffer.alloc(numSegments * SEGMENT_BYTES, 0);
  for (let s = 0; s < numSegments; s++) {
    for (let i = 0; i < SEGMENT_SAMPLES; i++) {
      buf.writeInt16LE(sample, s * SEGMENT_BYTES + i * BYTES_PER_SAMPLE);
    }
  }
  return buf;
}

const LOUD = 5000; // > silence threshold (150)
const QUIET = 10; // < silence threshold

// 1s of speech-level audio — passes both duration (>= 0.5s) and RMS gate.
const SPEECH_WAV = makeWav(makePcmSegments(20, LOUD));

// 0.4s of speech-level audio — fails the 0.5s duration gate.
const TOO_SHORT_WAV = makeWav(makePcmSegments(8, LOUD));

// 1s of silent audio — passes duration but fails the RMS gate.
const SILENT_WAV = makeWav(makePcmSegments(20, QUIET));

describe("runPipeline — silence short-circuit", () => {
  it("skips transcription for too-short clips (< 0.5s)", async () => {
    const sendStatus = vi.fn();
    const sendOverlay = vi.fn();

    await runPipeline(TOO_SHORT_WAV, { sendStatus, sendOverlay });

    expect(sendOverlay).not.toHaveBeenCalledWith("processing");
    expect(sendStatus).not.toHaveBeenCalledWith("transcribing");
    expect(transcribeSpy).not.toHaveBeenCalled();
    expect(sendStatus).toHaveBeenLastCalledWith("idle");
    expect(sendOverlay).toHaveBeenLastCalledWith("idle");
  });

  it("skips transcription for fully silent clips", async () => {
    const sendStatus = vi.fn();
    const sendOverlay = vi.fn();

    await runPipeline(SILENT_WAV, { sendStatus, sendOverlay });

    expect(sendOverlay).not.toHaveBeenCalledWith("processing");
    expect(sendStatus).not.toHaveBeenCalledWith("transcribing");
    expect(transcribeSpy).not.toHaveBeenCalled();
    expect(sendStatus).toHaveBeenLastCalledWith("idle");
    expect(sendOverlay).toHaveBeenLastCalledWith("idle");
  });

  it("skips transcription for buffers smaller than the WAV header", async () => {
    const sendStatus = vi.fn();
    const sendOverlay = vi.fn();

    await runPipeline(Buffer.alloc(20), { sendStatus, sendOverlay });

    expect(transcribeSpy).not.toHaveBeenCalled();
    expect(sendStatus).toHaveBeenLastCalledWith("idle");
    expect(sendOverlay).toHaveBeenLastCalledWith("idle");
  });
});

describe("runPipeline — normal speech clip", () => {
  it("sends processing and transcribing status", async () => {
    const sendStatus = vi.fn();
    const sendOverlay = vi.fn();

    await runPipeline(SPEECH_WAV, { sendStatus, sendOverlay });

    expect(sendOverlay).toHaveBeenCalledWith("processing");
    expect(sendStatus).toHaveBeenCalledWith("transcribing");
  });

  it("invokes transcribe with the buffer + analysis (no double-read)", async () => {
    const sendStatus = vi.fn();
    const sendOverlay = vi.fn();

    await runPipeline(SPEECH_WAV, { sendStatus, sendOverlay });

    expect(transcribeSpy).toHaveBeenCalledTimes(1);
    const [wavPath, lang, opts] = transcribeSpy.mock.calls[0];
    expect(typeof wavPath).toBe("string");
    expect(wavPath).toMatch(/vapenvibe-.*\.wav$/);
    expect(lang).toBe("auto");
    // The whole point of the refactor: the pre-read buffer + analysis
    // must be threaded through so transcribe() doesn't re-read from disk.
    expect(opts).toBeDefined();
    expect(Buffer.isBuffer(opts.rawWav)).toBe(true);
    expect(opts.rawWav.length).toBe(SPEECH_WAV.length);
    expect(opts.analysis.hasSpeech).toBe(true);
    expect(opts.analysis.duration).toBeCloseTo(1.0, 2);
  });

  it("resets to idle after transcription error", async () => {
    const sendStatus = vi.fn();
    const sendOverlay = vi.fn();

    await runPipeline(SPEECH_WAV, { sendStatus, sendOverlay });

    expect(sendStatus).toHaveBeenCalledWith("idle");
    expect(sendOverlay).toHaveBeenCalledWith("idle");
  });

  it("does not throw on transcription error", async () => {
    const sendStatus = vi.fn();
    const sendOverlay = vi.fn();

    await expect(
      runPipeline(SPEECH_WAV, { sendStatus, sendOverlay }),
    ).resolves.toBeUndefined();
  });

  it("calls sendOverlay before sendStatus on start", async () => {
    const calls = [];
    const sendStatus = vi.fn((s) => calls.push(["status", s]));
    const sendOverlay = vi.fn((m) => calls.push(["overlay", m]));

    await runPipeline(SPEECH_WAV, { sendStatus, sendOverlay });

    expect(calls[0]).toEqual(["overlay", "processing"]);
    expect(calls[1]).toEqual(["status", "transcribing"]);
  });

  it("always ends with idle status regardless of error", async () => {
    const sendStatus = vi.fn();
    const sendOverlay = vi.fn();

    await runPipeline(SPEECH_WAV, { sendStatus, sendOverlay });

    const statusCalls = sendStatus.mock.calls.map((c) => c[0]);
    const overlayCalls = sendOverlay.mock.calls.map((c) => c[0]);
    expect(statusCalls[statusCalls.length - 1]).toBe("idle");
    expect(overlayCalls[overlayCalls.length - 1]).toBe("idle");
  });
});

describe("runPipeline — corrections and live stream", () => {
  it("applies dictionary corrections before pasting", async () => {
    const storeMod = nodeRequire("../src/main/store");
    const pasteMod = nodeRequire("../src/main/paste");
    const originalGet = storeMod.get;
    const originalPaste = pasteMod.pasteText;
    const pasteText = vi.fn(() => Promise.resolve());
    pasteMod.pasteText = pasteText;
    storeMod.get = (key) =>
      key === "corrections"
        ? [{ from: "whispering parakeet", to: "Whisper and Parakeet" }]
        : "auto";
    transcribeMod.transcribe = vi.fn(() =>
      Promise.resolve("compare whispering parakeet"),
    );
    try {
      await runPipeline(SPEECH_WAV, {
        sendStatus: vi.fn(),
        sendOverlay: vi.fn(),
      });
      expect(pasteText).toHaveBeenCalledWith("compare Whisper and Parakeet");
    } finally {
      storeMod.get = originalGet;
      pasteMod.pasteText = originalPaste;
    }
  });

  it("passes the live stream session through to transcribe", async () => {
    const session = { finish: vi.fn(), cancel: vi.fn() };
    await runPipeline(SPEECH_WAV, {
      sendStatus: vi.fn(),
      sendOverlay: vi.fn(),
      streamSession: session,
    });
    expect(transcribeSpy.mock.calls[0][2].streamSession).toBe(session);
  });

  it("cancels the live stream when the clip is silent", async () => {
    const session = { finish: vi.fn(), cancel: vi.fn() };
    await runPipeline(SILENT_WAV, {
      sendStatus: vi.fn(),
      sendOverlay: vi.fn(),
      streamSession: session,
    });
    expect(session.cancel).toHaveBeenCalled();
    expect(transcribeSpy).not.toHaveBeenCalled();
  });
});

describe("runPipeline — Esc cancel", () => {
  it("neither pastes nor saves history once the dictation is cancelled", async () => {
    const pasteMod = nodeRequire("../src/main/paste");
    const historyMod = nodeRequire("../src/main/history");
    const originalPaste = pasteMod.pasteText;
    const originalAdd = historyMod.add;
    const pasteText = vi.fn(() => Promise.resolve());
    const addHistory = vi.fn();
    pasteMod.pasteText = pasteText;
    historyMod.add = addHistory;
    let cancelled = false;
    transcribeMod.transcribe = vi.fn(async () => {
      cancelled = true; // Esc pressed while transcribing
      return "never pasted";
    });
    const sendStatus = vi.fn();
    try {
      await runPipeline(SPEECH_WAV, {
        sendStatus,
        sendOverlay: vi.fn(),
        isCancelled: () => cancelled,
      });
      expect(pasteText).not.toHaveBeenCalled();
      expect(addHistory).not.toHaveBeenCalled();
      expect(sendStatus).not.toHaveBeenCalledWith("idle");
    } finally {
      pasteMod.pasteText = originalPaste;
      historyMod.add = originalAdd;
    }
  });
});
