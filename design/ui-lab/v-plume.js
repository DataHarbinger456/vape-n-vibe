"use strict";

/**
 * 01 Plume: the capsule exhales. Speech becomes a coral ribbon and vapor
 * particles rise off it; processing inhales the plume and condenses it into
 * a vapor-green trace.
 */
window.VaperVariants.plume = (() => {
  const L = window.VaperLab;
  const MAX = 320;
  const px = new Float32Array(MAX);
  const py = new Float32Array(MAX);
  const vx = new Float32Array(MAX);
  const vy = new Float32Array(MAX);
  const life = new Float32Array(MAX).fill(1);
  const ttl = new Float32Array(MAX);
  const size = new Float32Array(MAX);
  const kind = new Uint8Array(MAX);
  const random = L.rng(11);
  const RIBBON = 28;
  const heights = new Float32Array(RIBBON);
  const winHeights = new Float32Array(16);
  const capW = { x: 120, v: 0 };
  const CORAL = [255, 113, 107];
  const LIME = [183, 247, 116];
  let cursor = 0;
  let spawnDebt = 0;
  let colorMix = 0;
  let ov = null;
  let win = null;
  let sprites = null;

  const mix = (a, b, t, alpha = 1) =>
    `rgba(${Math.round(L.lerp(a[0], b[0], t))},${Math.round(L.lerp(a[1], b[1], t))},${Math.round(L.lerp(a[2], b[2], t))},${alpha})`;

  function spawn(x, y, svx, svy, t, s, k) {
    for (let n = 0; n < MAX; n++) {
      const i = (cursor + n) % MAX;
      if (life[i] >= ttl[i]) {
        px[i] = x;
        py[i] = y;
        vx[i] = svx;
        vy[i] = svy;
        life[i] = 0;
        ttl[i] = t;
        size[i] = s;
        kind[i] = k;
        cursor = (i + 1) % MAX;
        return;
      }
    }
  }

  /** Smooth mirrored ribbon through the band heights. */
  function ribbon(ctx, x0, x1, cy, hs, fill) {
    const n = hs.length;
    const dx = (x1 - x0) / (n - 1);
    ctx.beginPath();
    ctx.moveTo(x0, cy);
    for (let i = 0; i < n - 1; i++) {
      const xa = x0 + i * dx;
      ctx.quadraticCurveTo(
        xa,
        cy - hs[i] / 2,
        xa + dx / 2,
        cy - (hs[i] + hs[i + 1]) / 4,
      );
    }
    ctx.lineTo(x1, cy);
    for (let i = n - 1; i > 0; i--) {
      const xa = x0 + i * dx;
      ctx.quadraticCurveTo(
        xa,
        cy + hs[i] / 2,
        xa - dx / 2,
        cy + (hs[i] + hs[i - 1]) / 4,
      );
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function targetHeights(out, f, scale) {
    const n = out.length;
    const src = L.resample(f.bands, n);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const taper = Math.pow(Math.sin(Math.PI * (0.06 + u * 0.88)), 0.6);
      let target = 1.5;
      if (f.reduced) {
        target = f.mode === "recording" ? 1.5 + taper * scale * 0.3 : 1.4;
      } else if (f.mode === "recording") {
        target = 1.5 + src[i] * taper * scale;
      }
      out[i] = f.reduced ? target : L.approach(out[i], target, 0.35, f.dt);
    }
  }

  function updateParticles(f, cx, cy, x0, cw) {
    const dts = f.dt / 1000;
    const rec = f.live === "recording";
    if (rec) {
      spawnDebt += dts * (10 + f.level * 170);
      while (spawnDebt >= 1) {
        spawnDebt -= 1;
        const u = random();
        const b = f.bands[Math.min(31, Math.floor(u * 32))];
        if (random() > b + 0.14) continue;
        spawn(
          x0 + 42 + u * (cw - 64),
          cy - 4 - b * 9,
          (random() - 0.5) * 18,
          -(14 + random() * 24 + b * 78),
          1.1 + random() * 1.6,
          2.4 + random() * 3 + b * 3,
          random() < 0.24 ? 1 : 0,
        );
      }
    }
    const inhale = f.live === "processing";
    for (let i = 0; i < MAX; i++) {
      if (life[i] >= ttl[i]) continue;
      if (inhale) {
        vx[i] += (cx - px[i]) * 3.2 * dts;
        vy[i] += (cy - py[i]) * 3.6 * dts;
        life[i] += dts * 1.4;
      } else {
        vx[i] += Math.sin(py[i] * 0.045 + f.t * 0.9 + i * 0.37) * 28 * dts;
        vy[i] -= 9 * dts;
      }
      const drag = Math.pow(0.985, f.dt / 16.67);
      vx[i] *= drag;
      vy[i] *= drag;
      px[i] += vx[i] * dts;
      py[i] += vy[i] * dts;
      life[i] += dts;
    }
  }

  function drawParticles(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < MAX; i++) {
      if (life[i] >= ttl[i]) continue;
      const p = life[i] / ttl[i];
      const s = size[i] * (1 + p * 2.6);
      const strength = kind[i] === 0 ? 0.2 : kind[i] === 1 ? 0.42 : 0.5;
      ctx.globalAlpha = Math.pow(1 - p, 1.5) * strength;
      ctx.drawImage(sprites[kind[i]], px[i] - s, py[i] - s, s * 2, s * 2);
    }
    ctx.restore();
  }

  function overlay(f) {
    const { ctx, w, h } = ov;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = 92;
    const capH = 40;
    const targetW = f.alpha < 0.02 ? 120 : f.mode === "processing" ? 136 : 200;
    if (f.reduced) {
      capW.x = targetW;
      capW.v = 0;
    } else {
      L.spring(capW, targetW, f.dt, 260, 24);
    }
    const cw = capW.x;
    const x0 = cx - cw / 2;

    if (!f.reduced) updateParticles(f, cx, cy, x0, cw);
    drawParticles(ctx);
    if (f.alpha < 0.005) return;

    ctx.save();
    ctx.globalAlpha = f.alpha;
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.beginPath();
    ctx.roundRect(x0, cy - capH / 2, cw, capH, capH / 2);
    ctx.fillStyle = "rgba(11,13,12,0.95)";
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = f.alpha;
    ctx.beginPath();
    ctx.roundRect(x0 + 0.5, cy - capH / 2 + 0.5, cw - 1, capH - 1, capH / 2);
    ctx.strokeStyle = "rgba(143,153,143,0.24)";
    ctx.lineWidth = 1;
    ctx.stroke();

    colorMix = f.reduced
      ? f.mode === "processing"
        ? 1
        : 0
      : L.approach(colorMix, f.mode === "processing" ? 1 : 0, 0.12, f.dt);

    // Ember: the status mark. Coral while recording, vapor green while processing.
    const ex = x0 + 21;
    const glow = 10 + f.level * 12;
    ctx.globalAlpha = f.alpha * (0.45 + f.level * 0.55);
    ctx.drawImage(
      colorMix < 0.5 ? sprites[1] : sprites[2],
      ex - glow,
      cy - glow,
      glow * 2,
      glow * 2,
    );
    ctx.globalAlpha = f.alpha;
    ctx.beginPath();
    ctx.arc(ex, cy, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = mix(CORAL, LIME, colorMix);
    ctx.fill();

    targetHeights(heights, f, 26);
    const rx0 = x0 + 38;
    const rx1 = x0 + cw - 18;
    if (rx1 > rx0 + 8) {
      const grad = ctx.createLinearGradient(rx0, 0, rx1, 0);
      grad.addColorStop(0, mix(CORAL, LIME, colorMix, 0.9));
      grad.addColorStop(0.5, mix([255, 196, 182], [222, 255, 186], colorMix));
      grad.addColorStop(1, mix(CORAL, LIME, colorMix, 0.9));
      ribbon(ctx, rx0, rx1, cy, heights, grad);

      if (f.mode === "processing") {
        const rail = rx1 - rx0;
        const phase = f.reduced ? 0.62 : ((f.t * 1000) % 1150) / 1150;
        const bx = rx0 + phase * rail;
        ctx.globalAlpha = f.alpha * 0.9;
        ctx.drawImage(sprites[2], bx - 12, cy - 12, 24, 24);
        const trail = ctx.createLinearGradient(bx - 30, 0, bx, 0);
        trail.addColorStop(0, "rgba(183,247,116,0)");
        trail.addColorStop(1, "rgba(206,255,152,1)");
        ctx.beginPath();
        ctx.moveTo(Math.max(rx0, bx - 30), cy);
        ctx.lineTo(bx, cy);
        ctx.strokeStyle = trail;
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.stroke();
        if (!f.reduced && random() < (f.dt / 1000) * 16) {
          spawn(
            bx,
            cy - 3,
            (random() - 0.5) * 8,
            -12 - random() * 16,
            0.9,
            2,
            2,
          );
        }
      }
    }
    ctx.restore();
  }

  function windowViz(f) {
    const { ctx, w, h } = win;
    ctx.clearRect(0, 0, w, h);
    const cy = h / 2;
    const live = f.live;
    const scratch = { ...f, mode: live };
    targetHeights(winHeights, scratch, 30);
    const x0 = 14;
    const x1 = w - 4;
    ctx.beginPath();
    ctx.arc(5, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle =
      live === "recording"
        ? "#ff716b"
        : live === "processing"
          ? "#b7f774"
          : "#465047";
    ctx.fill();
    const col =
      live === "recording"
        ? "rgba(255,150,140,0.95)"
        : live === "processing"
          ? "rgba(183,247,116,0.55)"
          : "rgba(143,153,143,0.45)";
    ribbon(ctx, x0, x1, cy, winHeights, col);
    if (live === "processing") {
      const phase = f.reduced ? 0.6 : ((f.t * 1000) % 1150) / 1150;
      const bx = x0 + phase * (x1 - x0);
      ctx.drawImage(sprites[2], bx - 10, cy - 10, 20, 20);
    }
  }

  return {
    id: "plume",
    index: 1,
    name: "Plume",
    tagline: "Vapor you can see.",
    thesis:
      "The current vapor-green identity, taken all the way. The capsule exhales: your voice becomes a coral ribbon and real vapor rises off it. While Whisper works, the plume is inhaled back and condenses into a green trace.",
    notes: [
      [
        "Window",
        "Same 400 × 340 footprint, header moved up beside the traffic lights. The shortcut becomes a physical keycap that sinks while you talk.",
      ],
      [
        "Overlay",
        "A 320-particle plume driven by 32 speech bands, spawned where your voice is loudest. Processing pulls every particle back in.",
      ],
      [
        "Signature",
        "Vapor escapes past the capsule edge, so the overlay feels alive without taking more screen.",
      ],
    ],
    size: "400 × 340",
    init({ overlayCanvas, windowCanvas }) {
      ov = L.setupCanvas(overlayCanvas);
      win = L.setupCanvas(windowCanvas);
      sprites = [
        L.sprite(236, 242, 232),
        L.sprite(255, 140, 120),
        L.sprite(183, 247, 116),
      ];
      heights.fill(1.5);
      winHeights.fill(1.5);
    },
    overlay,
    windowViz,
  };
})();
