"use strict";

/**
 * 03 Scope: an instrument. Speech is resynthesized from the frequency bands
 * into a phosphor trace with real persistence; transcription folds the same
 * line into a turning Lissajous figure.
 */
window.VaperVariants.scope = (() => {
  const L = window.VaperLab;
  let ov = null;
  let win = null;
  let ovScope = null;
  let winScope = null;

  function makeScope(c, rect) {
    const buf = document.createElement("canvas");
    buf.width = Math.round(rect.w * c.dpr);
    buf.height = Math.round(rect.h * c.dpr);
    const b = buf.getContext("2d");
    b.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
    const K = 12;
    const amps = new Float32Array(K);
    const phases = new Float32Array(K);
    const N = 160;
    const state = { morph: 0 };

    function graticule(ctx) {
      const { x, y, w, h } = rect;
      ctx.save();
      ctx.strokeStyle = "rgba(108,196,255,0.08)";
      ctx.lineWidth = 1;
      const cols = 10;
      const rows = 4;
      for (let i = 1; i < cols; i++) {
        const gx = Math.round(x + (w * i) / cols) + 0.5;
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.lineTo(gx, y + h);
        ctx.stroke();
      }
      for (let j = 1; j < rows; j++) {
        const gy = Math.round(y + (h * j) / rows) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.lineTo(x + w, gy);
        ctx.stroke();
      }
      // Centre-axis minor ticks.
      ctx.strokeStyle = "rgba(108,196,255,0.2)";
      const cy = Math.round(y + h / 2) + 0.5;
      for (let i = 1; i < cols * 5; i++) {
        const tx = Math.round(x + (w * i) / (cols * 5)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(tx, cy - 1.5);
        ctx.lineTo(tx, cy + 1.5);
        ctx.stroke();
      }
      ctx.restore();
    }

    function draw(f, alpha) {
      const { ctx } = c;
      const { x, y, w, h } = rect;
      const dts = f.dt / 1000;
      b.save();
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.globalCompositeOperation = "destination-out";
      b.fillStyle = `rgba(0,0,0,${f.reduced ? 1 : 1 - Math.pow(0.8, f.dt / 16.67)})`;
      b.fillRect(0, 0, buf.width, buf.height);
      b.restore();

      const rec = f.mode === "recording";
      const target = L.resample(f.bands, K);
      for (let k = 0; k < K; k++) {
        const goal = rec ? (f.reduced ? 0.3 / (1 + k) : target[k]) : 0;
        amps[k] = f.reduced ? goal : L.approach(amps[k], goal, 0.3, f.dt);
        if (!f.reduced) phases[k] += dts * (3 + k * 2.3);
      }
      const goalMorph = f.mode === "processing" ? 1 : 0;
      state.morph = f.reduced
        ? goalMorph
        : L.approach(state.morph, goalMorph, 0.07, f.dt);
      const m = L.easeInOut(state.morph);
      let sum = 0.0001;
      for (let k = 0; k < K; k++) sum += amps[k];
      const norm = 1 / Math.max(1, sum * 0.5);
      const cy = h / 2;
      const spin = f.reduced ? 0.6 : f.t * 1.7;

      b.globalCompositeOperation = "lighter";
      b.beginPath();
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        let ty = 0;
        for (let k = 0; k < K; k++) {
          ty +=
            (amps[k] *
              Math.sin(u * Math.PI * 2 * (1.4 + k * 0.95) + phases[k])) /
            (1 + k * 0.12);
        }
        const env = Math.pow(Math.sin(Math.PI * u), 0.3);
        const tx = u * w;
        const yy =
          cy +
          ty * norm * h * 0.44 * env +
          (f.reduced ? 0 : Math.sin(u * 47 + f.t * 3) * 0.35);
        const s = u * Math.PI * 2;
        const lx = w / 2 + Math.sin(3 * s + spin) * Math.min(w * 0.3, h * 0.64);
        const ly = cy + Math.sin(2 * s) * h * 0.3;
        const fx = L.lerp(tx, lx, m);
        const fy = L.lerp(yy, ly, m);
        if (i === 0) b.moveTo(fx, fy);
        else b.lineTo(fx, fy);
      }
      if (m > 0.98) b.closePath();
      b.lineJoin = "round";
      b.lineCap = "round";
      b.strokeStyle = `rgba(108,196,255,${0.22 * alpha})`;
      b.lineWidth = 4.5;
      b.stroke();
      b.strokeStyle = `rgba(226,243,255,${0.95 * alpha})`;
      b.lineWidth = 1.3;
      b.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, rect.r);
      ctx.clip();
      const screen = ctx.createRadialGradient(
        x + w / 2,
        y + h / 2,
        0,
        x + w / 2,
        y + h / 2,
        w * 0.6,
      );
      screen.addColorStop(0, `rgba(16,28,52,${alpha})`);
      screen.addColorStop(1, `rgba(6,10,19,${alpha})`);
      ctx.fillStyle = screen;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = alpha;
      graticule(ctx);
      ctx.drawImage(buf, x, y, w, h);
      const glass = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
      glass.addColorStop(0, "rgba(255,255,255,0.06)");
      glass.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glass;
      ctx.fillRect(x, y, w, h * 0.5);
      ctx.restore();
    }

    return { draw };
  }

  function hud(ctx, f, rect) {
    const { x, y, w, h } = rect;
    ctx.save();
    ctx.globalAlpha = f.alpha;
    ctx.font = "500 9px 'IBM Plex Mono', monospace";
    ctx.textBaseline = "top";
    if (f.mode === "recording") {
      const on = f.reduced || Math.floor(f.t * 2) % 2 === 0;
      ctx.beginPath();
      ctx.arc(x + 10, y + 11, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = on ? "#ff8a3d" : "rgba(255,138,61,0.35)";
      ctx.fill();
      ctx.fillStyle = "#ffb37f";
      ctx.fillText("REC", x + 16, y + 6.5);
    } else {
      ctx.fillStyle = "#9fd8ff";
      ctx.fillText("DECODE", x + 8, y + 6.5);
    }
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(230,237,248,0.85)";
    ctx.fillText(L.formatElapsed(f.elapsed), x + w - 8, y + 6.5);
    ctx.fillStyle = "rgba(139,154,181,0.9)";
    ctx.textBaseline = "bottom";
    ctx.fillText("16 kHz", x + w - 8, y + h - 5);
    ctx.restore();
  }

  function overlay(f) {
    const { ctx, w, h } = ov;
    ctx.clearRect(0, 0, w, h);
    if (f.alpha < 0.005) {
      ovScope.draw(f, 0);
      return;
    }
    const rect = { x: 62, y: 48, w: w - 124, h: 64, r: 10 };
    ctx.save();
    ctx.globalAlpha = f.alpha;
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.beginPath();
    ctx.roundRect(rect.x - 6, rect.y - 6, rect.w + 12, rect.h + 12, 15);
    ctx.fillStyle = "rgba(12,18,31,0.97)";
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = f.alpha;
    ctx.beginPath();
    ctx.roundRect(rect.x - 5.5, rect.y - 5.5, rect.w + 11, rect.h + 11, 15);
    ctx.strokeStyle = "rgba(143,170,220,0.22)";
    ctx.stroke();
    ctx.restore();
    ovScope.draw(f, f.alpha);
    hud(ctx, f, rect);
  }

  function windowViz(f) {
    const { ctx, w, h } = win;
    ctx.clearRect(0, 0, w, h);
    winScope.draw({ ...f, mode: f.live }, 1);
  }

  return {
    id: "scope",
    index: 3,
    name: "Scope",
    tagline: "An instrument, not an app.",
    thesis:
      "Ink-blue oscilloscope. Your speech is resynthesized from the frequency bands into a glowing phosphor trace with real afterglow. When you let go, the same line folds into a turning Lissajous figure while the words decode.",
    notes: [
      [
        "Window",
        "Tabs replace the hamburger menu, so Dictionary and Access are one click away. A live scope screen heads the window; settings read like an instrument panel.",
      ],
      [
        "Overlay",
        "Phosphor trace with persistence, a REC readout and a running clock, so you know how long you have been talking.",
      ],
      [
        "Signature",
        "The trace-to-Lissajous morph: one continuous line, from sound to meaning.",
      ],
    ],
    size: "400 × 380",
    init({ overlayCanvas, windowCanvas }) {
      ov = L.setupCanvas(overlayCanvas);
      win = L.setupCanvas(windowCanvas);
      ovScope = makeScope(ov, { x: 62, y: 48, w: ov.w - 124, h: 64, r: 10 });
      winScope = makeScope(win, { x: 0, y: 0, w: win.w, h: win.h, r: 8 });
    },
    overlay,
    windowViz,
  };
})();
