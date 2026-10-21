"use strict";

/**
 * Settings-window hero orb. Reacts to the mic while recording, orbits a
 * bead while transcribing, and settles to rest otherwise. The render loop
 * stops once the orb is at rest so an idle window costs nothing.
 */
(() => {
  const canvas = document.getElementById("hero-orb");
  const { createBandSmoother, createOrb, setupCanvas } = window.VaperOrb;
  const view = setupCanvas(canvas);
  const orb = createOrb(128);
  const smoother = createBandSmoother();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  // Springs need about this long to come to rest after a state change.
  const SETTLE_MS = 1600;
  // The orb stands on a polished floor this far down its canvas and is
  // mirrored in it, so it sits in the same world as the chrome deck below.
  // The orb is drawn slightly smaller than its canvas so splashing beads
  // keep clear of the edges; the floor sits just under the resting sphere.
  const ORB_SIZE = 120;
  const ORB_X = (view.w - ORB_SIZE) / 2;
  const FLOOR = (ORB_SIZE * 0.83) / view.h;
  const REFLECTION_ALPHA = 0.22;

  // Offscreen layers in device pixels: the orb, and its faded reflection.
  const layer = (() => {
    const c = document.createElement("canvas");
    c.width = canvas.width;
    c.height = canvas.height;
    return c;
  })();
  const layerCtx = layer.getContext("2d");
  const scale = canvas.width / view.w;
  layerCtx.setTransform(scale, 0, 0, scale, 0, 0);
  const mirror = document.createElement("canvas");
  mirror.width = canvas.width;
  mirror.height = canvas.height;
  const mirrorCtx = mirror.getContext("2d");

  /** Composite the orb over its reflection in the floor. */
  function present() {
    const W = canvas.width;
    const H = canvas.height;
    const floor = Math.round(H * FLOOR);
    mirrorCtx.globalCompositeOperation = "source-over";
    mirrorCtx.clearRect(0, 0, W, H);
    mirrorCtx.save();
    mirrorCtx.translate(0, floor * 2);
    mirrorCtx.scale(1, -1);
    mirrorCtx.drawImage(layer, 0, 0, W, floor, 0, 0, W, floor);
    mirrorCtx.restore();
    // Fade the reflection out as it goes deeper into the floor.
    mirrorCtx.globalCompositeOperation = "destination-in";
    const fade = mirrorCtx.createLinearGradient(0, floor, 0, H);
    fade.addColorStop(0, `rgba(0,0,0,${REFLECTION_ALPHA})`);
    fade.addColorStop(1, "rgba(0,0,0,0)");
    mirrorCtx.fillStyle = fade;
    mirrorCtx.fillRect(0, 0, W, H);

    const ctx = view.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(mirror, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  let mood = "idle";
  let bins = null;
  let running = false;
  let lastFrame = 0;
  let settleUntil = 0;

  function frame(ts) {
    const dt = lastFrame ? Math.min(ts - lastFrame, 50) : 16.67;
    lastFrame = ts;
    const { bands, level } = smoother.update(
      mood === "recording" ? bins : null,
      dt,
    );
    layerCtx.clearRect(0, 0, view.w, view.h);
    orb.render(layerCtx, ORB_X, 0, ORB_SIZE, {
      dt,
      bands,
      energy: mood === "recording" ? level : 0,
      mood,
      reduced: reducedMotion.matches,
    });
    present();
    const atRest =
      (mood === "idle" && ts > settleUntil) || reducedMotion.matches;
    if (atRest) {
      running = false;
      lastFrame = 0;
      return;
    }
    requestAnimationFrame(frame);
  }

  function wake() {
    settleUntil = performance.now() + SETTLE_MS;
    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  }

  window.vaperHero = {
    /** mood: "idle" | "recording" | "processing" */
    setMood(next) {
      if (next === mood) return;
      mood = next;
      wake();
    },
    /** Latest analyser bins while recording; null when the mic stops. */
    setFreq(data) {
      bins = data;
    },
  };

  reducedMotion.addEventListener("change", wake);
  wake();
})();
