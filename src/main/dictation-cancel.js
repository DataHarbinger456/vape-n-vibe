// @ts-check

/**
 * Esc-to-cancel for dictations.
 *
 * Each dictation gets an increasing id when recording starts. Pressing Esc
 * cancels every dictation started so far, so audio or a transcript that
 * turns up later for one of them is dropped instead of pasted.
 */

const CANCEL_ACCELERATOR = "Escape";

/** Electron accelerator names for the modifier names used in Vaper hotkeys. */
/** @type {Readonly<Record<string, string>>} */
const MODIFIER_ACCELERATORS = Object.freeze({
  Ctrl: "Control",
  Cmd: "Command",
  Win: "Super",
  Alt: "Alt",
  Shift: "Shift",
});

/**
 * Shortcuts that cancel a dictation: plain Esc, plus Esc with the hotkey's
 * modifiers. In hold mode those modifiers are still down when Esc is
 * pressed, and Electron shortcuts only fire on an exact modifier match.
 *
 * @param {unknown} hotkey - Vaper hotkey, e.g. "Ctrl+Space", "Alt" or "fn".
 * @returns {string[]}
 */
function cancelAccelerators(hotkey) {
  const accelerators = [CANCEL_ACCELERATOR];
  if (typeof hotkey !== "string") return accelerators;
  const mods = hotkey
    .split("+")
    .filter((part) => Object.hasOwn(MODIFIER_ACCELERATORS, part))
    .map((part) => MODIFIER_ACCELERATORS[part]);
  if (mods.length > 0) {
    accelerators.push([...mods, CANCEL_ACCELERATOR].join("+"));
  }
  return accelerators;
}

/**
 * @typedef {object} CancelWaiter
 * @property {Promise<void>} promise - Resolves once the dictation is cancelled.
 * @property {() => void} dispose - Stop waiting (call when the dictation ends).
 */

/**
 * @typedef {object} DictationTracker
 * @property {() => number} begin - Start a dictation; returns its id.
 * @property {() => void} cancelAll - Cancel every dictation started so far.
 * @property {(id: number) => boolean} isCancelled
 * @property {() => boolean} isLatestCancelled - True when the most recent dictation was cancelled.
 * @property {(id: number) => CancelWaiter} whenCancelled
 */

/** @returns {DictationTracker} */
function createDictationTracker() {
  let latestId = 0;
  let cancelledThrough = 0;
  /** @type {Set<{ id: number, resolve: () => void }>} */
  const waiters = new Set();

  return {
    begin() {
      latestId += 1;
      return latestId;
    },
    cancelAll() {
      cancelledThrough = latestId;
      for (const waiter of [...waiters]) {
        if (waiter.id <= cancelledThrough) {
          waiters.delete(waiter);
          waiter.resolve();
        }
      }
    },
    isCancelled(id) {
      return id <= cancelledThrough;
    },
    isLatestCancelled() {
      return latestId > 0 && latestId <= cancelledThrough;
    },
    whenCancelled(id) {
      /** @type {() => void} */
      let resolve = () => {};
      /** @type {Promise<void>} */
      const promise = new Promise((r) => {
        resolve = r;
      });
      const waiter = { id, resolve };
      if (id <= cancelledThrough) resolve();
      else waiters.add(waiter);
      return { promise, dispose: () => waiters.delete(waiter) };
    },
  };
}

/**
 * @typedef {object} ShortcutApi - The parts of Electron's globalShortcut used here.
 * @property {(accelerator: string, callback: () => void) => boolean} register
 * @property {(accelerator: string) => void} unregister
 */

/**
 * The global Esc shortcuts. They are held only while there is something to
 * cancel: holding them stops the focused app from also getting that Esc,
 * and releasing them straight after means Esc works normally everywhere
 * else.
 *
 * @param {ShortcutApi} shortcuts
 * @param {() => void} onCancel - Called when Esc is pressed while held.
 * @param {() => string[]} getAccelerators - Shortcuts to hold, read each
 *   time they are taken so a hotkey change applies to the next dictation.
 * @returns {{ setHeld: (wanted: boolean) => void, isHeld: () => boolean }}
 */
function createCancelKey(shortcuts, onCancel, getAccelerators) {
  /** @type {string[]} */
  let registered = [];

  return {
    setHeld(wanted) {
      if (wanted === registered.length > 0) return;
      if (!wanted) {
        for (const accelerator of registered) {
          try {
            shortcuts.unregister(accelerator);
          } catch {
            // ignore — app may be quitting
          }
        }
        registered = [];
        return;
      }
      for (const accelerator of getAccelerators()) {
        let ok = false;
        try {
          ok = shortcuts.register(accelerator, onCancel);
        } catch (err) {
          console.warn(
            `[cancel] ${accelerator} registration error:`,
            err instanceof Error ? err.message : err,
          );
        }
        if (ok) registered.push(accelerator);
        else {
          console.warn(
            `[cancel] Could not take ${accelerator} — another app may be using it`,
          );
        }
      }
    },
    isHeld: () => registered.length > 0,
  };
}

module.exports = {
  CANCEL_ACCELERATOR,
  cancelAccelerators,
  createDictationTracker,
  createCancelKey,
};
