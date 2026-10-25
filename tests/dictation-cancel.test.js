import { describe, it, expect, vi } from "vitest";
import {
  CANCEL_ACCELERATOR,
  cancelAccelerators,
  createCancelKey,
  createDictationTracker,
} from "../src/main/dictation-cancel";

describe("createDictationTracker", () => {
  it("cancelAll cancels every dictation started so far, not later ones", () => {
    const tracker = createDictationTracker();
    const first = tracker.begin();
    const second = tracker.begin();
    expect(tracker.isCancelled(first)).toBe(false);

    tracker.cancelAll();
    expect(tracker.isCancelled(first)).toBe(true);
    expect(tracker.isCancelled(second)).toBe(true);
    expect(tracker.isLatestCancelled()).toBe(true);

    const third = tracker.begin();
    expect(tracker.isCancelled(third)).toBe(false);
    expect(tracker.isLatestCancelled()).toBe(false);
  });

  it("treats nothing as cancelled before the first dictation", () => {
    const tracker = createDictationTracker();
    tracker.cancelAll();
    expect(tracker.isLatestCancelled()).toBe(false);
    expect(tracker.isCancelled(tracker.begin())).toBe(false);
  });

  it("whenCancelled resolves on cancel, or at once if already cancelled", async () => {
    const tracker = createDictationTracker();
    const id = tracker.begin();
    const onCancel = vi.fn();
    tracker.whenCancelled(id).promise.then(onCancel);

    await Promise.resolve();
    expect(onCancel).not.toHaveBeenCalled();

    tracker.cancelAll();
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled());
    await tracker.whenCancelled(id).promise;
  });

  it("does not resolve a disposed waiter", async () => {
    const tracker = createDictationTracker();
    const waiter = tracker.whenCancelled(tracker.begin());
    const onCancel = vi.fn();
    waiter.promise.then(onCancel);
    waiter.dispose();

    tracker.cancelAll();
    await new Promise((resolve) => setImmediate(resolve));
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("cancelAccelerators", () => {
  it("adds Esc with the hotkey's modifiers", () => {
    expect(cancelAccelerators("Ctrl+Space")).toEqual([
      "Escape",
      "Control+Escape",
    ]);
    expect(cancelAccelerators("Cmd+Shift+K")).toEqual([
      "Escape",
      "Command+Shift+Escape",
    ]);
    expect(cancelAccelerators("Alt")).toEqual(["Escape", "Alt+Escape"]);
    expect(cancelAccelerators("Win+F5")).toEqual(["Escape", "Super+Escape"]);
  });

  it("is plain Esc when the hotkey has no modifiers", () => {
    expect(cancelAccelerators("fn")).toEqual(["Escape"]);
    expect(cancelAccelerators("F9")).toEqual(["Escape"]);
    expect(cancelAccelerators(undefined)).toEqual(["Escape"]);
  });
});

/** A fake globalShortcut that records calls and refuses some shortcuts. */
function fakeShortcuts(refuse = []) {
  const calls = [];
  const callbacks = new Map();
  return {
    calls,
    press: (accel) => callbacks.get(accel)?.(),
    api: {
      register(accel, cb) {
        calls.push(`register ${accel}`);
        if (refuse.includes(accel)) return false;
        callbacks.set(accel, cb);
        return true;
      },
      unregister(accel) {
        calls.push(`unregister ${accel}`);
        callbacks.delete(accel);
      },
    },
  };
}

describe("createCancelKey", () => {
  it("holds the Esc shortcuts only while wanted, without repeat registrations", () => {
    const shortcuts = fakeShortcuts();
    const onCancel = vi.fn();
    const key = createCancelKey(shortcuts.api, onCancel, () =>
      cancelAccelerators("Ctrl+Space"),
    );

    key.setHeld(true);
    key.setHeld(true);
    expect(key.isHeld()).toBe(true);
    shortcuts.press(CANCEL_ACCELERATOR);
    shortcuts.press("Control+Escape"); // Esc with the hold-mode hotkey down
    expect(onCancel).toHaveBeenCalledTimes(2);

    key.setHeld(false);
    key.setHeld(false);
    expect(key.isHeld()).toBe(false);
    expect(shortcuts.calls).toEqual([
      "register Escape",
      "register Control+Escape",
      "unregister Escape",
      "unregister Control+Escape",
    ]);
  });

  it("skips a refused shortcut and keeps the rest", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const shortcuts = fakeShortcuts(["Control+Escape"]);
    const key = createCancelKey(
      shortcuts.api,
      () => {},
      () => cancelAccelerators("Ctrl+Space"),
    );
    key.setHeld(true);
    expect(key.isHeld()).toBe(true);

    key.setHeld(false);
    expect(shortcuts.calls).toEqual([
      "register Escape",
      "register Control+Escape",
      "unregister Escape",
    ]);
  });

  it("is not held when every shortcut is refused", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const shortcuts = fakeShortcuts(["Escape"]);
    const key = createCancelKey(
      shortcuts.api,
      () => {},
      () => cancelAccelerators("fn"),
    );
    key.setHeld(true);
    expect(key.isHeld()).toBe(false);

    key.setHeld(false);
    expect(shortcuts.calls).toEqual(["register Escape"]);
  });
});
