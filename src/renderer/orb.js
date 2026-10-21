"use strict";

/**
 * Mercury orb: per-pixel metaballs with an environment-mapped chrome finish.
 *
 * Shared by the settings-window hero (hero.js) and the recording overlay
 * (visualizer.js). Input is the AnalyserNode byte spectrum renderer.js
 * already produces (fftSize 256 at 16 kHz, so 128 bins), reduced here to
 * 32 smoothed bands.
 */
window.VaperOrb = (() => {
  const BANDS = 32;
  const SATELLITES = 5;
  const LIGHT = (() => {
    const v = [-0.45, -0.7, 0.55];
    const m = Math.hypot(v[0], v[1], v[2]);
    return v.map((c) => c / m);
  })();
  // Reflected floor tint per state. Red only means "on air".
  const TINTS = {
    recording: [255, 69, 58],
    processing: [200, 212, 230],
    idle: [110, 110, 118],
  };

  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

  /** Frame-rate independent exponential approach. */
  const approach = (current, target, rate, dt) =>
    current + (target - current) * (1 - Math.pow(1 - rate, dt / 16.67));

  /** Damped spring step on { x, v }. */
  function spring(s, target, dt, k, c) {
    const d = Math.min(dt, 40) / 1000;
    s.v += (k * (target - s.x) - c * s.v) * d;
    s.x += s.v * d;
  }

  function resample(src, n) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pos = (i / Math.max(1, n - 1)) * (src.length - 1);
      const a = Math.floor(pos);
      const b = Math.min(src.length - 1, a + 1);
      out[i] = src[a] + (src[b] - src[a]) * (pos - a);
    }
    return out;
  }

  /**
   * One band level in 0..1. Same speech-range normalisation the previous
   * overlay used, then a perceptual lift so normal speaking volume moves
   * the orb visibly.
   */
  function readBand(bins, i) {
    const usable = Math.max(1, Math.floor(bins.length * 0.45));
    const start = Math.floor((i / BANDS) * usable);
    const end = Math.max(start + 1, Math.floor(((i + 1) / BANDS) * usable));
    let total = 0;
    for (let b = start; b < end; b++) total += bins[b];
    const norm = clamp((total / (end - start) / 255 - 0.06) / 0.64);
    return clamp(Math.pow(norm, 0.62) * 1.15);
  }

  /** Fast attack, slow release smoothing of the 32 bands. */
  function createBandSmoother() {
    const bands = new Float32Array(BANDS);
    return {
      update(bins, dt) {
        let sum = 0;
        for (let i = 0; i < BANDS; i++) {
          const raw = bins && bins.length ? readBand(bins, i) : 0;
          bands[i] = approach(bands[i], raw, raw > bands[i] ? 0.38 : 0.14, dt);
          sum += bands[i];
        }
        return { bands, level: sum / BANDS };
      },
    };
  }

  /** Size a canvas for the device pixel ratio, keeping its attribute size as CSS size. */
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
    return { ctx, w, h };
  }

  /**
   * A metaball orb rendered at N×N field resolution and scaled up when
   * drawn. Keep N small (72 to 128); the field is evaluated per pixel.
   */
  function createOrb(N) {
    const buffer = document.createElement("canvas");
    buffer.width = N;
    buffer.height = N;
    const bctx = buffer.getContext("2d");
    const img = bctx.createImageData(N, N);
    const field = new Float32Array(N * N);
    const sats = Array.from({ length: SATELLITES }, () => ({
      d: { x: 0, v: 0 },
      r: { x: 0.1, v: 0 },
    }));
    const core = { x: 0.18, v: 0 };
    const tint = TINTS.idle.slice();
    const col = [0, 0, 0];
    let angle = 0;

    // Studio environment: bright overhead light fading to a dark floor that
    // carries a faint reflection of the state colour, plus one soft-box
    // stripe for the chrome glint.
    function env(rx, ry) {
      const t = clamp((ry + 0.65) / 1.4);
      const sm = t * t * (3 - 2 * t);
      const sky = 238 - 210 * sm;
      const box =
        Math.exp(-(((ry + 0.42) / 0.09) ** 2)) * 40 * (1 - Math.abs(rx));
      const k = 0.26 * sm;
      const side = 1 + 0.1 * rx;
      col[0] = (sky + box + tint[0] * k) * side;
      col[1] = (sky + box + tint[1] * k) * side;
      col[2] = (sky + 6 + box + tint[2] * k) * side;
    }

    function step(f) {
      const goalTint = TINTS[f.mood] || TINTS.idle;
      for (let i = 0; i < 3; i++) {
        tint[i] = f.reduced
          ? goalTint[i]
          : approach(tint[i], goalTint[i], 0.08, f.dt);
      }
      const bands = resample(f.bands, SATELLITES);
      if (!f.reduced) {
        const spin =
          f.mood === "processing"
            ? 2.6
            : f.mood === "recording"
              ? 0.7 + f.energy * 1.4
              : 0;
        angle += (Math.min(f.dt, 40) / 1000) * spin;
      }
      const coreGoal =
        (f.mood === "processing" ? 0.16 : 0.18) + f.energy * 0.03;
      if (f.reduced) core.x = coreGoal;
      else spring(core, coreGoal, f.dt, 160, 10);

      const balls = [[0.5, 0.5, core.x]];
      for (let k = 0; k < SATELLITES; k++) {
        // At rest every satellite sits on the core: one clean sphere.
        let dGoal = 0;
        let rGoal = 0.1;
        if (f.mood === "recording") {
          dGoal = 0.24 + bands[k] * 0.15;
          rGoal = 0.055 + bands[k] * 0.05;
        } else if (f.mood === "processing") {
          // One bead orbits; the rest melt back into the core.
          dGoal = k === 0 ? 0.27 : 0;
          rGoal = k === 0 ? 0.085 : 0.07;
        }
        if (f.reduced) {
          sats[k].d.x = dGoal;
          sats[k].r.x = rGoal;
        } else {
          spring(sats[k].d, dGoal, f.dt, 120, 9);
          spring(sats[k].r, rGoal, f.dt, 120, 9);
        }
        const a = angle + (k * Math.PI * 2) / SATELLITES;
        balls.push([
          0.5 + Math.cos(a) * sats[k].d.x,
          0.5 + Math.sin(a) * sats[k].d.x,
          Math.max(0.02, sats[k].r.x),
        ]);
      }
      return balls;
    }

    function shade() {
      const data = img.data;
      const stepSize = 2 / N;
      const edge = 0.16 * (64 / N);
      const z = (v) => Math.sqrt(Math.max(0, 1 - 1 / v));
      for (let py = 0; py < N; py++) {
        for (let px = 0; px < N; px++) {
          const i = py * N + px;
          const fv = field[i];
          const o = i * 4;
          if (fv < 0.8) {
            data[o + 3] = 0;
            continue;
          }
          const zl = z(field[py * N + Math.max(0, px - 1)]);
          const zr = z(field[py * N + Math.min(N - 1, px + 1)]);
          const zu = z(field[Math.max(0, py - 1) * N + px]);
          const zd = z(field[Math.min(N - 1, py + 1) * N + px]);
          let nx = (-(zr - zl) / stepSize) * 0.2;
          let ny = (-(zd - zu) / stepSize) * 0.2;
          let nz = 1;
          const m = Math.hypot(nx, ny, nz);
          nx /= m;
          ny /= m;
          nz /= m;
          const rx = 2 * nz * nx;
          const ry = 2 * nz * ny;
          const rz = 2 * nz * nz - 1;
          env(rx, ry);
          const spec =
            Math.pow(
              Math.max(0, rx * LIGHT[0] + ry * LIGHT[1] + rz * LIGHT[2]),
              28,
            ) * 300;
          const rim = Math.pow(1 - nz, 3) * 50;
          data[o] = Math.min(255, col[0] + spec + rim);
          data[o + 1] = Math.min(255, col[1] + spec + rim);
          data[o + 2] = Math.min(255, col[2] + spec + rim);
          data[o + 3] = Math.round(clamp((fv - 1) / edge + 0.5) * 255);
        }
      }
    }

    /**
     * Advance and draw one frame.
     * f: { dt, bands, energy, mood: "idle"|"recording"|"processing", reduced }
     */
    function render(target, x, y, size, f) {
      const balls = step(f);
      for (let py = 0; py < N; py++) {
        const ny = (py + 0.5) / N;
        for (let px = 0; px < N; px++) {
          const nx = (px + 0.5) / N;
          let s = 0;
          for (let b = 0; b < balls.length; b++) {
            const ex = nx - balls[b][0];
            const ey = ny - balls[b][1];
            s += (balls[b][2] * balls[b][2]) / (ex * ex + ey * ey + 1e-5);
          }
          field[py * N + px] = s;
        }
      }
      shade();
      bctx.putImageData(img, 0, 0);
      target.imageSmoothingEnabled = true;
      target.imageSmoothingQuality = "high";
      target.drawImage(buffer, x, y, size, size);
    }

    return { render };
  }

  return { createBandSmoother, createOrb, setupCanvas };
})();
