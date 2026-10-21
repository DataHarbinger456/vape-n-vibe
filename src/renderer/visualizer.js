"use strict";

/**
 * Recording overlay: a black pill with a chrome orb. It grows to show your
 * words and a timer while you talk, then contracts to a single orbiting
 * bead while the transcript is produced.
 */
(() => {
  const { createBandSmoother, createOrb, setupCanvas } = window.VaperOrb;
  const pill = document.getElementById("pill");
  const partialTextEl = document.getElementById("partial-text");
  const elapsedEl = document.getElementById("elapsed");
  const view = setupCanvas(document.getElementById("pill-orb"));
  const orb = createOrb(72);
  const smoother = createBandSmoother();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Main sends "idle" on key release and "processing" only once the audio
  // reaches the pipeline (after the renderer's stop tail). Show the bead
  // straight away instead of collapsing in between; if the pipeline never
  // confirms, give up after this long.
  const CONFIRM_TIMEOUT_MS = 3000;
  // Keep drawing while the pill fades out.
  const FADE_MS = 450;

  let mode = "idle"; // what the pill shows: idle | recording | processing
  let awaitingPipeline = false;
  let confirmTimer = null;
  let bins = null;
  let recordStart = 0;
  let recordEnd = 0;
  let running = false;
  let lastFrame = 0;
  let stopAt = 0;
  let shownElapsed = "";

  function formatElapsed(ms) {
    const s = Math.max(0, ms) / 1000;
    const m = Math.floor(s / 60);
    const rest = (s % 60).toFixed(1).padStart(4, "0");
    return `${m}:${rest}`;
  }

  // --- Live caption ---
  // Partials arrive as the whole running transcript. Only words that are new
  // (or revised) are added, each fading up out of a soft blur, and the line
  // glides left to make room instead of jumping.
  const MAX_WORDS = 40; // older words are masked off the left edge anyway
  const GLIDE_MS = 420;
  const STAGGER_MS = 45;
  const track = document.createElement("span");
  track.className = "pill-track";
  track.dir = "auto"; // isolate RTL captions without parsing them as HTML
  partialTextEl.appendChild(track);
  let shownWords = [];

  function wordSpan(word, delay) {
    const span = document.createElement("span");
    span.className = "w";
    span.textContent = word;
    if (delay) span.style.animationDelay = `${delay}ms`;
    return span;
  }

  /** Same word still being recognised ("thir" -> "thirty"): grow in place. */
  function isRefinement(before, after) {
    return before.startsWith(after) || after.startsWith(before);
  }

  /**
   * Slide the line from where the anchor word was drawn to where it now
   * rests (FLIP). Measured with the transform cleared, so a glide already
   * in flight continues smoothly from its current position.
   */
  function glide(anchor, beforeRight) {
    if (reducedMotion.matches || beforeRight === null) return;
    track.style.transition = "none";
    track.style.transform = "none";
    const delta = beforeRight - anchor.getBoundingClientRect().right;
    if (Math.abs(delta) < 0.5) return;
    track.style.transform = `translateX(${delta}px)`;
    void track.offsetWidth;
    track.style.transition = `transform ${GLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    track.style.transform = "none";
  }

  function setPartialText(text) {
    const words = text ? text.split(/\s+/).filter(Boolean) : [];
    if (words.length === 0) {
      track.textContent = "";
      track.style.transform = "none";
      shownWords = [];
      partialTextEl.classList.add("is-empty");
      return;
    }
    partialTextEl.classList.remove("is-empty");

    // First word that differs from what is already on screen.
    let k = 0;
    while (
      k < shownWords.length &&
      k < words.length &&
      shownWords[k] === words[k]
    ) {
      k++;
    }
    if (k === shownWords.length && k === words.length) return;

    // Where the last persistent word sits now, to glide from it.
    const spans = track.querySelectorAll(".w");
    const anchor = spans[k - 1] || null;
    const beforeRight = anchor ? anchor.getBoundingClientRect().right : null;

    let keep = k;
    if (
      k < shownWords.length &&
      k < words.length &&
      isRefinement(shownWords[k], words[k])
    ) {
      spans[k].textContent = words[k];
      keep = k + 1;
    }
    for (let i = spans.length - 1; i >= keep; i--) {
      const prev = spans[i].previousSibling;
      if (prev && prev.nodeType === Node.TEXT_NODE) prev.remove();
      spans[i].remove();
    }
    words.slice(keep).forEach((word, i) => {
      if (track.childNodes.length) track.append(" ");
      track.append(wordSpan(word, Math.min(i, 6) * STAGGER_MS));
    });

    // Drop words long since scrolled off the left.
    let extra = track.querySelectorAll(".w").length - MAX_WORDS;
    while (extra-- > 0 && track.firstChild) {
      track.firstChild.remove();
      if (track.firstChild && track.firstChild.nodeType === Node.TEXT_NODE) {
        track.firstChild.remove();
      }
    }
    shownWords = words;
    // Right-to-left captions grow leftward, so pin and fade the other edge.
    partialTextEl.classList.toggle("rtl", track.matches(":dir(rtl)"));

    if (anchor && anchor.isConnected) glide(anchor, beforeRight);
  }

  function show(next) {
    mode = next;
    pill.dataset.mode = next;
    if (next === "idle") {
      setPartialText("");
      stopAt = performance.now() + FADE_MS;
    }
    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  }

  function frame(ts) {
    const dt = lastFrame ? Math.min(ts - lastFrame, 50) : 16.67;
    lastFrame = ts;
    const live = mode === "recording" && !recordEnd;
    const { bands, level } = smoother.update(live ? bins : null, dt);
    view.ctx.clearRect(0, 0, view.w, view.h);
    orb.render(view.ctx, 0, 0, view.w, {
      dt,
      bands,
      energy: live ? level : 0,
      mood: mode,
      reduced: reducedMotion.matches,
    });

    const elapsed = formatElapsed((recordEnd || ts) - recordStart);
    if (elapsed !== shownElapsed) {
      elapsedEl.textContent = elapsed;
      shownElapsed = elapsed;
    }

    if (mode === "idle" && ts > stopAt) {
      running = false;
      lastFrame = 0;
      return;
    }
    requestAnimationFrame(frame);
  }

  function clearConfirm() {
    awaitingPipeline = false;
    clearTimeout(confirmTimer);
    confirmTimer = null;
  }

  window.vizBridge.onVizMode((newMode) => {
    if (newMode === "recording") {
      clearConfirm();
      recordStart = performance.now();
      recordEnd = 0;
      bins = null;
      setPartialText("");
      show("recording");
    } else if (newMode === "processing") {
      clearConfirm();
      if (!recordEnd) recordEnd = performance.now();
      show("processing");
    } else if (mode === "recording") {
      // Key released: assume the pipeline will pick this up.
      recordEnd = performance.now();
      awaitingPipeline = true;
      confirmTimer = setTimeout(() => {
        if (awaitingPipeline) {
          clearConfirm();
          show("idle");
        }
      }, CONFIRM_TIMEOUT_MS);
      show("processing");
    } else {
      // Silent clip, finished transcript, or an error: close the pill.
      clearConfirm();
      show("idle");
    }
  });

  window.vizBridge.onVizFreq((data) => {
    bins = data;
  });

  window.vizBridge.onPartialText((text) => {
    setPartialText(mode === "idle" ? "" : text);
  });
})();
