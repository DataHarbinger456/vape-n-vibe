/**
 * Tests for src/main/apple-speech.js against fake helper scripts that
 * speak the same JSON protocol as src/native/apple_speech.swift.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The helper path is read through config/paths on every call, so the
// stub's target can change per test.
const helper = { path: null };
const pathsPath = require.resolve(
  path.resolve(__dirname, "../src/config/paths.js"),
);
require.cache[pathsPath] = {
  id: pathsPath,
  filename: pathsPath,
  loaded: true,
  exports: { getAppleSpeechPath: () => helper.path },
};

function loadModule() {
  const modPath = require.resolve(
    path.resolve(__dirname, "../src/main/apple-speech.js"),
  );
  delete require.cache[modPath];
  return require(modPath);
}

// Fake helper: same commands and JSON lines as the real one.
const FAKE_HELPER = `#!/bin/bash
case "$1" in
  languages) echo '{"languages":["en","fr"]}' ;;
  transcribe)
    if [[ -f "$4" ]]; then
      echo "{\\"text\\":\\"heard $(basename "$4")\\",\\"locale\\":\\"en-AU\\"}"
    else
      echo '{"error":"missing file"}'; exit 1
    fi ;;
  stream)
    echo '{"ready":true}'
    bytes=$(wc -c | tr -d ' ')
    echo '{"partial":"hel"}'
    echo "{\\"text\\":\\"got $bytes bytes\\",\\"locale\\":\\"en-AU\\"}" ;;
esac
`;

const FAILING_HELPER = `#!/bin/bash
# Streams read stdin until the app closes it; other commands don't.
if [[ "$1" == "stream" ]]; then cat >/dev/null; fi
echo '{"error":"Language xx is not supported by Apple speech"}'
exit 1
`;

describe.skipIf(process.platform === "win32")("apple-speech", () => {
  let dir;

  function writeHelper(script) {
    const p = path.join(dir, `helper-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(p, script, { mode: 0o755 });
    helper.path = p;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "apple-speech-test-"));
    writeHelper(FAKE_HELPER);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    helper.path = null;
  });

  it("transcribeWav returns the helper's text and removes its temp file", async () => {
    const { transcribeWav } = loadModule();
    const text = await transcribeWav(Buffer.alloc(100), "en");
    expect(text).toMatch(/^heard vapenvibe-apple-.*\.wav$/);
    const tmpFile = path.join(os.tmpdir(), text.replace("heard ", ""));
    // Cleanup is fire-and-forget — give it a tick.
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(tmpFile)).toBe(false);
  });

  it("surfaces the helper's error message", async () => {
    writeHelper(FAILING_HELPER);
    const { transcribeWav } = loadModule();
    await expect(transcribeWav(Buffer.alloc(100), "xx")).rejects.toThrow(
      "Apple speech: Language xx is not supported",
    );
  });

  it("rejects clearly when the helper isn't built", async () => {
    helper.path = null;
    const { transcribeWav, startStream } = loadModule();
    await expect(transcribeWav(Buffer.alloc(100), "en")).rejects.toThrow(
      "not built",
    );
    expect(() => startStream("en")).toThrow("not built");
  });

  it("streams audio and returns the final text plus partials", async () => {
    const { startStream } = loadModule();
    const partials = [];
    const session = startStream("en", { onPartial: (t) => partials.push(t) });
    expect(session.write(Buffer.alloc(3200))).toBe(true);
    session.write(Buffer.alloc(1600));
    await expect(session.finish()).resolves.toBe("got 4800 bytes");
    expect(partials).toEqual(["hel"]);
    // Writes after finish are refused.
    expect(session.write(Buffer.alloc(2))).toBe(false);
  });

  it("rejects finish when the stream fails", async () => {
    writeHelper(FAILING_HELPER);
    const { startStream } = loadModule();
    const session = startStream("xx");
    await expect(session.finish()).rejects.toThrow("not supported");
  });

  it("cancel stops a session without a result", async () => {
    // Blocks reading stdin until killed.
    writeHelper('#!/bin/bash\ncat >/dev/null\necho \'{"text":"late"}\'\n');
    const { startStream } = loadModule();
    const session = startStream("en");
    session.write(Buffer.alloc(320));
    session.cancel();
    await expect(session.finish({ timeoutMs: 5000 })).rejects.toThrow(
      "without text",
    );
  });

  it("supportsLanguage is optimistic until the list loads, then exact", async () => {
    const { supportsLanguage, loadSupportedLanguages } = loadModule();
    expect(supportsLanguage("ja")).toBe(true); // not loaded yet
    await loadSupportedLanguages();
    expect(supportsLanguage("en")).toBe(true);
    expect(supportsLanguage("fr")).toBe(true);
    expect(supportsLanguage("ja")).toBe(false);
    expect(supportsLanguage("auto")).toBe(true);
  });
});
