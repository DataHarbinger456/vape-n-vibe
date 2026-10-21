import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  applyCorrections,
  correctTranscript,
  sanitizeCorrections,
  MAX_RULES,
} = require("../src/main/corrections");
const { BUILT_IN_CORRECTIONS } = require("../src/config/terminology");

describe("applyCorrections", () => {
  it("replaces a mis-heard phrase case-insensitively", () => {
    const rules = [{ from: "whispering parakeet", to: "Whisper and Parakeet" }];
    expect(
      applyCorrections("Compare it to Whispering Parakeet, please.", rules),
    ).toBe("Compare it to Whisper and Parakeet, please.");
  });

  it("only matches whole words", () => {
    const rules = [{ from: "cloud", to: "Claude" }];
    expect(applyCorrections("cloudy cloud clouds", rules)).toBe(
      "cloudy Claude clouds",
    );
  });

  it("tolerates different whitespace between words", () => {
    const rules = [{ from: "cloud code", to: "Claude Code" }];
    expect(applyCorrections("open cloud\n  code now", rules)).toBe(
      "open Claude Code now",
    );
  });

  it("prefers the longer phrase when rules overlap", () => {
    const rules = [
      { from: "cloud", to: "Claude" },
      { from: "cloud code", to: "Claude Code" },
    ];
    expect(applyCorrections("cloud code and cloud", rules)).toBe(
      "Claude Code and Claude",
    );
  });

  it("never re-matches the output of another rule", () => {
    const rules = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    expect(applyCorrections("a b", rules)).toBe("b c");
  });

  it("keeps a capital at the start of a sentence", () => {
    const rules = [{ from: "sofa", to: "so far" }];
    expect(applyCorrections("Sofa feels nice. A sofa too.", rules)).toBe(
      "So far feels nice. A so far too.",
    );
  });

  it("keeps deliberate casing in the replacement", () => {
    const rules = [
      { from: "ios", to: "iOS" },
      { from: "mac os", to: "macOS" },
    ];
    expect(applyCorrections("Ios and Mac OS", rules)).toBe("iOS and macOS");
  });

  it("treats regex characters literally", () => {
    const rules = [{ from: "node.js", to: "Node.js" }];
    expect(applyCorrections("I like node.js and nodexjs", rules)).toBe(
      "I like Node.js and nodexjs",
    );
  });

  it("leaves text alone with no or malformed rules", () => {
    expect(applyCorrections("hello", [])).toBe("hello");
    expect(applyCorrections("hello", "auto")).toBe("hello");
    expect(applyCorrections("hello", undefined)).toBe("hello");
    expect(applyCorrections("", [{ from: "a", to: "b" }])).toBe("");
  });
});

describe("sanitizeCorrections", () => {
  it("drops malformed, empty and over-long rules", () => {
    const out = sanitizeCorrections([
      null,
      "x",
      { from: 1, to: "y" },
      { from: "  ", to: "y" },
      { from: "a", to: " " },
      { from: "a".repeat(61), to: "y" },
      { from: "ok", to: "b".repeat(101) },
      { from: "  heard   as ", to: " Written " },
    ]);
    expect(out).toEqual([{ from: "heard as", to: "Written" }]);
  });

  it("keeps the first rule for a duplicate phrase", () => {
    expect(
      sanitizeCorrections([
        { from: "Cloud", to: "Claude" },
        { from: "cloud", to: "Crowd" },
      ]),
    ).toEqual([{ from: "Cloud", to: "Claude" }]);
  });

  it(`caps the list at ${MAX_RULES} rules`, () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      from: `w${i}`,
      to: `W${i}`,
    }));
    expect(sanitizeCorrections(many)).toHaveLength(MAX_RULES);
  });

  it("returns [] for non-arrays", () => {
    expect(sanitizeCorrections({ from: "a", to: "b" })).toEqual([]);
  });
});

describe("correctTranscript (built-in terminology)", () => {
  it("fixes the AI and developer terms from real dictations", () => {
    expect(
      correctTranscript(
        "And then I was using Codex with open AI as well as anthropic.",
        [],
      ),
    ).toBe("And then I was using Codex with OpenAI as well as Anthropic.");
    expect(
      correctTranscript(
        "Running docker and an mcp server with Claude code.",
        [],
      ),
    ).toBe("Running Docker and an MCP server with Claude Code.");
  });

  it("handles hyphens, possessives and multi-word names", () => {
    expect(
      correctTranscript("open-ai's api and chat gpt on wi-fi via vs code", []),
    ).toBe("OpenAI's API and ChatGPT on Wi-Fi via VS Code");
  });

  it("leaves ordinary words, domains and paths alone", () => {
    const text =
      "the cursor is on a llama with a tailwind. see claude.ai, docker.com and src/ui/app";
    expect(correctTranscript(text, [])).toBe(text);
  });

  it("lets the user's rule win over a built-in one", () => {
    expect(
      correctTranscript("using open ai", [{ from: "open ai", to: "Open AI" }]),
    ).toBe("using Open AI");
  });

  it("built-in rules are well formed and unique", () => {
    const seen = new Set();
    for (const rule of BUILT_IN_CORRECTIONS) {
      expect(rule.from).toBe(rule.from.trim().toLowerCase());
      expect(rule.to.trim()).toBe(rule.to);
      expect(seen.has(rule.from)).toBe(false);
      seen.add(rule.from);
    }
  });
});
