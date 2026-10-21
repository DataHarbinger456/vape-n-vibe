"use strict";

/**
 * Shared drawing helpers for the Vaper UI lab.
 *
 * Every visualizer consumes the same input as src/renderer/visualizer.js:
 * a 128-bin Uint8Array from an AnalyserNode (fftSize 256 at 16 kHz),
 * smoothed here into 32 bands. That keeps each direction portable to the
 * real overlay without touching the IPC contract.
 */
window.VaperLab = (() => {
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const easeInOut = (t) => {
    const x = clamp(t);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  };
  /** Frame-rate independent exponential approach. */
  const approach = (current, target, rate, dt) =>
    current + (target - current) * (1 - Math.pow(1 - rate, dt / 16.67));

  /** Size a canvas for the device pixel ratio using its width/height attributes as CSS size. */
  function setupCanvas(canvas) {
    const w = Number(canvas.getAttribute("width"));
    const h = Number(canvas.getAttribute("height"));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { canvas, ctx, w, h, dpr };
  }

  /** Linear resample of a band array to n values. */
  function resample(src, n) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pos = (i / Math.max(1, n - 1)) * (src.length - 1);
      const a = Math.floor(pos);
      const b = Math.min(src.length - 1, a + 1);
      out[i] = lerp(src[a], src[b], pos - a);
    }
    return out;
  }

  /** Pre-rendered soft radial sprite for cheap particle drawing. */
  function sprite(r, g, b, size = 64) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const x = c.getContext("2d");
    const half = size / 2;
    const gr = x.createRadialGradient(half, half, 0, half, half, half);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gr.addColorStop(0.35, `rgba(${r},${g},${b},0.5)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, size, size);
    return c;
  }

  /** Seeded PRNG (mulberry32) so every run of the lab looks the same. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Damped spring step. Mutates and returns s.x. */
  function spring(s, target, dt, k = 170, c = 24) {
    const d = Math.min(dt, 40) / 1000;
    const acc = k * (target - s.x) - c * s.v;
    s.v += acc * d;
    s.x += s.v * d;
    return s.x;
  }

  /** Fixed-length ring buffer; get(0) is oldest. */
  function history(len) {
    const buf = new Float32Array(len);
    let head = 0;
    return {
      len,
      push(v) {
        buf[head] = v;
        head = (head + 1) % len;
      },
      get(i) {
        return buf[(head + i) % len];
      },
      fill(v) {
        buf.fill(v);
      },
    };
  }

  function formatElapsed(ms) {
    const s = Math.max(0, ms) / 1000;
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1).padStart(4, "0");
    return `${String(m).padStart(2, "0")}:${sec}`;
  }

  return {
    clamp,
    lerp,
    easeOut,
    easeInOut,
    approach,
    setupCanvas,
    resample,
    sprite,
    rng,
    spring,
    history,
    formatElapsed,
  };
})();

window.VaperVariants = window.VaperVariants || {};
