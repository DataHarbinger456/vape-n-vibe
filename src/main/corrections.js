/**
 * Dictionary corrections — user-defined find-and-replace rules applied to
 * every transcript, whatever the engine ("whispering parakeet" →
 * "Whisper and Parakeet"). Matching is case-insensitive, whole-word, and
 * tolerant of any whitespace between words.
 */

const { BUILT_IN_CORRECTIONS } = require("../config/terminology");

const MAX_RULES = 100;
const MAX_FROM_LENGTH = 60;
const MAX_TO_LENGTH = 100;

/**
 * Validate untrusted rules: keep well-formed {from, to} string pairs,
 * trimmed and length-capped, first occurrence wins per `from`
 * (case-insensitive).
 * @param {unknown} input
 * @returns {{ from: string, to: string }[]}
 */
function sanitizeCorrections(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const rule of input) {
    if (!rule || typeof rule !== "object") continue;
    if (typeof rule.from !== "string" || typeof rule.to !== "string") continue;
    const from = rule.from.trim().replace(/\s+/g, " ");
    const to = rule.to.trim();
    if (!from || !to) continue;
    if (from.length > MAX_FROM_LENGTH || to.length > MAX_TO_LENGTH) continue;
    const key = from.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Keep sentence-start capitalisation: when the matched text starts with a
 * capital and the replacement's first word is all lowercase ("so far"),
 * capitalise it ("So far"). Replacements with deliberate casing in their
 * first word ("iOS", "macOS") are left exactly as written.
 */
function matchCase(matched, replacement) {
  const first = matched.charAt(0);
  if (first === first.toLowerCase()) return replacement;
  const firstWord = replacement.split(/\s/, 1)[0];
  if (firstWord !== firstWord.toLowerCase()) return replacement;
  return replacement.charAt(0).toUpperCase() + replacement.slice(1);
}

/**
 * Word boundaries for a match. Besides letters/digits, a match may not
 * touch a dot, @ or slash that joins it to another word, so domains,
 * emails and paths ("claude.ai", "docker.com", "src/ui") are left alone.
 */
const BEFORE = "(?<![\\p{L}\\p{N}])(?<![\\p{L}\\p{N}][.@/])";
const AFTER = "(?![\\p{L}\\p{N}])(?![.@/][\\p{L}\\p{N}])";

/**
 * Apply correction rules to a transcript in a single pass, so one rule's
 * output is never re-matched by another. Longer phrases win over shorter
 * ones that overlap them. A space in a phrase matches any run of
 * whitespace or hyphens ("wi fi" matches "wi-fi").
 *
 * @param {string} text
 * @param {unknown} rules - User rules (validated here); these win over
 *   built-in rules for the same phrase.
 * @param {{ from: string, to: string }[]} [builtIn] - Trusted built-in
 *   rules, applied alongside the user's.
 * @returns {string}
 */
function applyCorrections(text, rules, builtIn = []) {
  if (typeof text !== "string" || !text) return text;
  const user = sanitizeCorrections(rules);
  const taken = new Set(user.map((r) => r.from.toLowerCase()));
  const clean = [
    ...user,
    ...builtIn.filter((r) => !taken.has(r.from.toLowerCase())),
  ].sort((a, b) => b.from.length - a.from.length);
  if (clean.length === 0) return text;

  const alternatives = clean.map(
    (r) => `(${r.from.split(" ").map(escapeRegExp).join("[\\s-]+")})`,
  );
  const re = new RegExp(
    `${BEFORE}(?:${alternatives.join("|")})${AFTER}`,
    "giu",
  );
  return text.replace(re, (...args) => {
    const groups = args.slice(1, 1 + clean.length);
    const index = groups.findIndex((g) => g !== undefined);
    return index === -1 ? args[0] : matchCase(args[0], clean[index].to);
  });
}

/**
 * Correct a finished transcript: the user's rules plus the built-in AI
 * and developer terminology (src/config/terminology.js).
 * @param {string} text
 * @param {unknown} userRules
 * @returns {string}
 */
function correctTranscript(text, userRules) {
  return applyCorrections(text, userRules, BUILT_IN_CORRECTIONS);
}

module.exports = {
  applyCorrections,
  correctTranscript,
  BUILT_IN_COUNT: BUILT_IN_CORRECTIONS.length,
  sanitizeCorrections,
  MAX_RULES,
  MAX_FROM_LENGTH,
  MAX_TO_LENGTH,
};
