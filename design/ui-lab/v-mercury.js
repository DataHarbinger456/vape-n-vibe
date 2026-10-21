"use strict";

/**
 * 05 Mercury: liquid metal that listens. Real metaballs with an
 * environment-mapped chrome finish; satellites swell and split with each
 * frequency band and reflect the red record light.
 */
window.VaperVariants.mercury = (() => {
  const L = window.VaperLab;
  const LIGHT = (() => {
    const v = [-0.45, -0.7, 0.55];
    const m = Math.hypot(v[0], v[1], v[2]);
    return v.map((c) => c / m);
  })();
  let ovOrb = null;
  let winOrb = null;
  let ov = null;
  let win = null;
  let timeEl = null;
  let lastTime = "";

  function makeOrb(N) {
    const c = document.createElement("canvas");
    c.width = N;
    c.height = N;
    const x = c.getContext("2d");
    const img = x.createImageData(N, N);
    const field = new Float32Array(N * N);
    const SAT = 5;
    const sat = Array.from({ length: SAT }, () => ({
      d: { x: 0.06, v: 0 },
      r: { x: 0.1, v: 0 },
    }));
    const core = { x: 0.2, v: 0 };
    const tint = [120, 120, 128];
    let angle = 0;

    function env(rx, ry, out) {
      // Smooth studio environment: bright overhead light fading to a dark
      // floor that carries a faint reflection of the state colour, plus one
      // soft-box stripe for the chrome glint.
      const t = L.clamp((ry + 0.65) / 1.4);
      const sm = t * t * (3 - 2 * t);
      const sky = 238 - 210 * sm;
      const box =
        Math.exp(-(((ry + 0.42) / 0.09) ** 2)) * 40 * (1 - Math.abs(rx));
      const k = 0.26 * sm;
      const side = 1 + 0.1 * rx;
      out[0] = (sky + box + tint[0] * k) * side;
      out[1] = (sky + box + tint[1] * k) * side;
      out[2] = (sky + 6 + box + tint[2] * k) * side;
    }

    function render(target, dx, dy, ds, f, mood, energy) {
      const dts = Math.min(f.dt, 40) / 1000;
      const goalTint =
        mood === "rec"
          ? [255, 69, 58]
          : mood === "proc"
            ? [200, 212, 230]
            : [110, 110, 118];
      for (let i = 0; i < 3; i++)
        tint[i] = f.reduced
          ? goalTint[i]
          : L.approach(tint[i], goalTint[i], 0.08, f.dt);
      const bands = L.resample(f.bands, SAT);
      if (!f.reduced)
        angle +=
          dts *
          (mood === "proc" ? 2.6 : mood === "rec" ? 0.7 + energy * 1.4 : 0);
      L.spring(
        core,
        (mood === "proc" ? 0.16 : 0.18) + energy * 0.03,
        f.dt,
        160,
        10,
      );
      const balls = [[0.5, 0.5, core.x]];
      for (let k = 0; k < SAT; k++) {
        let dGoal = 0.06;
        let rGoal = 0.1;
        if (mood === "rec") {
          dGoal = 0.24 + bands[k] * 0.15;
          rGoal = 0.055 + bands[k] * 0.05;
        } else if (mood === "proc") {
          // One bead orbits; the rest melt back into the core.
          dGoal = k === 0 ? 0.27 : 0.02;
          rGoal = k === 0 ? 0.085 : 0.07;
        }
        if (f.reduced) {
          sat[k].d.x = dGoal;
          sat[k].r.x = rGoal;
        } else {
          L.spring(sat[k].d, dGoal, f.dt, 120, 9);
          L.spring(sat[k].r, rGoal, f.dt, 120, 9);
        }
        const a = angle + (k * Math.PI * 2) / SAT;
        balls.push([
          0.5 + Math.cos(a) * sat[k].d.x,
          0.5 + Math.sin(a) * sat[k].d.x,
          Math.max(0.02, sat[k].r.x),
        ]);
      }
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
      const data = img.data;
      const col = [0, 0, 0];
      const step = 2 / N;
      const edge = 0.16 * (64 / N);
      for (let py = 0; py < N; py++) {
        for (let px = 0; px < N; px++) {
          const i = py * N + px;
          const fv = field[i];
          const o = i * 4;
          if (fv < 0.8) {
            data[o + 3] = 0;
            continue;
          }
          const z = (v) => Math.sqrt(Math.max(0, 1 - 1 / v));
          const zl = z(field[py * N + Math.max(0, px - 1)]);
          const zr = z(field[py * N + Math.min(N - 1, px + 1)]);
          const zu = z(field[Math.max(0, py - 1) * N + px]);
          const zd = z(field[Math.min(N - 1, py + 1) * N + px]);
          let nx = (-(zr - zl) / step) * 0.2;
          let ny = (-(zd - zu) / step) * 0.2;
          let nz = 1;
          const m = Math.hypot(nx, ny, nz);
          nx = nx / m;
          ny = ny / m;
          nz = nz / m;
          const rx = 2 * nz * nx;
          const ry = 2 * nz * ny;
          const rz = 2 * nz * nz - 1;
          env(rx, ry, col);
          const spec =
            Math.pow(
              Math.max(0, rx * LIGHT[0] + ry * LIGHT[1] + rz * LIGHT[2]),
              28,
            ) * 300;
          const rim = Math.pow(1 - nz, 3) * 50;
          data[o] = Math.min(255, col[0] + spec + rim);
          data[o + 1] = Math.min(255, col[1] + spec + rim);
          data[o + 2] = Math.min(255, col[2] + spec + rim);
          data[o + 3] = Math.round(L.clamp((fv - 1) / edge + 0.5) * 255);
        }
      }
      x.putImageData(img, 0, 0);
      target.imageSmoothingEnabled = true;
      target.imageSmoothingQuality = "high";
      target.drawImage(c, dx, dy, ds, ds);
    }

    return { render };
  }

  const moodOf = (mode) =>
    mode === "recording" ? "rec" : mode === "processing" ? "proc" : "idle";

  function overlay(f) {
    const { ctx, w, h } = ov;
    ctx.clearRect(0, 0, w, h);
    if (f.alpha < 0.005) return;
    ovOrb.render(ctx, 2, 2, w - 4, f, moodOf(f.mode), f.level);
    const t = L.formatElapsed(f.elapsed).slice(1, 7);
    if (t !== lastTime && timeEl) {
      timeEl.textContent = t;
      lastTime = t;
    }
  }

  function windowViz(f) {
    const { ctx, w, h } = win;
    ctx.clearRect(0, 0, w, h);
    winOrb.render(
      ctx,
      0,
      0,
      Math.min(w, h),
      f,
      moodOf(f.live),
      f.live === "recording" ? f.level : 0,
    );
  }

  return {
    id: "mercury",
    index: 5,
    name: "Mercury",
    tagline: "Liquid metal that listens.",
    thesis:
      "Monochrome and object-first. A chrome droplet built from real metaballs swells and splits with each frequency band, inside a pill that grows with your words and shrinks to a spinning bead while it thinks.",
    notes: [
      [
        "Window",
        "The orb is the hero and reacts to your mic live. The four settings sit in equal tiles below it because they are true peers.",
      ],
      [
        "Overlay",
        "A pill that expands with your words and a running timer, then contracts to a single droplet that orbits while transcribing.",
      ],
      [
        "Signature",
        "Per-pixel metaballs with an environment-mapped chrome finish that picks up the red record light.",
      ],
    ],
    size: "400 × 470",
    init({ overlayCanvas, windowCanvas, overlayRoot }) {
      ov = L.setupCanvas(overlayCanvas);
      win = L.setupCanvas(windowCanvas);
      ovOrb = makeOrb(72);
      winOrb = makeOrb(128);
      timeEl = overlayRoot.querySelector("[data-role='elapsed']");
    },
    overlay,
    windowViz,
  };
})();
