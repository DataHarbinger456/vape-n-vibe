const crypto = require("node:crypto");
const store = require("./store");

/** Newest transcripts kept; older ones drop off the end. */
const MAX_ENTRIES = 50;
/** Longest transcript stored, so one runaway dictation can't bloat the file. */
const MAX_TEXT_LENGTH = 20000;

const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      console.error("[history] Listener failed:", err.message);
    }
  }
}

/** All entries, newest first: [{ id, text, timestamp }]. */
function list() {
  const entries = store.get("history");
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (e) =>
      e &&
      typeof e.id === "string" &&
      typeof e.text === "string" &&
      Number.isFinite(e.timestamp),
  );
}

/** Record a final transcript. Blank text is ignored. */
function add(text) {
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean) return null;
  const entry = {
    id: crypto.randomUUID(),
    text: clean.slice(0, MAX_TEXT_LENGTH),
    timestamp: Date.now(),
  };
  store.set("history", [entry, ...list()].slice(0, MAX_ENTRIES));
  notify();
  return entry;
}

function latest() {
  return list()[0] || null;
}

function find(id) {
  return list().find((e) => e.id === id) || null;
}

function remove(id) {
  const entries = list();
  const kept = entries.filter((e) => e.id !== id);
  if (kept.length === entries.length) return false;
  store.set("history", kept);
  notify();
  return true;
}

function clear() {
  store.set("history", []);
  notify();
}

/** Run fn whenever history changes. Returns an unsubscribe function. */
function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = {
  MAX_ENTRIES,
  MAX_TEXT_LENGTH,
  list,
  add,
  latest,
  find,
  remove,
  clear,
  onChange,
};
