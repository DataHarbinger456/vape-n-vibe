"use strict";

/**
 * 04 Transcript: the words are the hero. A paper caption card with a
 * calligraphic ink line drawn from your voice (thickness is loudness);
 * processing dries the ink and runs a proofreading highlight.
 */
window.VaperVariants.transcript = (() => {
  const L = window.VaperLab;
  const inkOv = L.history(84);
  const inkWin = L.history(110);
  let clock = 0;
  let dry = 1;
  let wasRecording = false;
  let ov = null;
  let win = null;

  function drawInk(ctx, hist, x0, x1, baseY, f, maxTh, dryness) {
    const n = hist.len;
    const dx = (x1 - x0) / (n - 1);
    const top = [];
    const bot = [];
    for (let i = 0; i < n; i++) {
      const v = hist.get(i);
      const th = L.lerp(0.9 + v * maxTh, 0.9 + v * maxTh * 0.55, dryness);
      const wob = Math.sin(i * 0.42) * v * 2.2 * (1 - dryness);
      const slant = th * 0.22;
      const xx = x0 + i * dx;
      top.push(xx - slant, baseY + wob - th / 2);
      bot.push(xx + slant, baseY + wob + th / 2);
    }
    ctx.beginPath();
    ctx.moveTo(top[0], top[1]);
    for (let i = 2; i < top.length; i += 2) ctx.lineTo(top[i], top[i + 1]);
    for (let i = bot.length - 2; i >= 0; i -= 2) ctx.lineTo(bot[i], bot[i + 1]);
    ctx.closePath();
    const r = Math.round(L.lerp(31, 120, dryness));
    const g = Math.round(L.lerp(27, 110, dryness));
    const b = Math.round(L.lerp(22, 97, dryness));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();
    if (dryness < 0.9) {
      // Wet sheen on the freshest ink.
      ctx.beginPath();
      const start = Math.max(0, top.length - 48);
      ctx.moveTo(top[start] + 0.6, top[start + 1] + 0.7);
      for (let i = start + 2; i < top.length; i += 2)
        ctx.lineTo(top[i] + 0.6, top[i + 1] + 0.7);
      ctx.strokeStyle = `rgba(255,255,255,${0.4 * (1 - dryness)})`;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }

  function nib(ctx, x, y, f, scale) {
    const r = (2.6 + f.level * 2.4) * scale;
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(184,50,26,${0.12 + f.level * 0.18})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#b8321a";
    ctx.fill();
  }

  function step(f) {
    const rec = f.live === "recording";
    if (rec && !wasRecording) {
      inkOv.fill(0);
      inkWin.fill(0);
    }
    wasRecording = rec;
    const goal = f.live === "processing" || f.live === "idle" ? 1 : 0;
    dry = f.reduced ? goal : L.approach(dry, goal, rec ? 0.3 : 0.05, f.dt);
    if (rec) {
      clock += f.dt;
      while (clock >= 34) {
        clock -= 34;
        const v = f.reduced ? 0.25 : L.clamp(f.level * 0.85 + f.peak * 0.35);
        inkOv.push(v);
        inkWin.push(v);
      }
    }
  }

  function overlay(f) {
    step(f);
    const { ctx, w, h } = ov;
    ctx.clearRect(0, 0, w, h);
    if (f.alpha < 0.005) return;
    const card = { x: 18, y: 32, w: w - 36, h: 88 };
    ctx.save();
    ctx.globalAlpha = f.alpha;
    ctx.save();
    ctx.shadowColor = "rgba(20,14,8,0.32)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    ctx.beginPath();
    ctx.roundRect(card.x, card.y, card.w, card.h, 12);
    ctx.fillStyle = "#f7f2e7";
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.roundRect(card.x + 0.5, card.y + 0.5, card.w - 1, card.h - 1, 12);
    ctx.strokeStyle = "rgba(31,27,22,0.14)";
    ctx.stroke();
    // Notebook margin rule.
    ctx.fillStyle = "rgba(184,50,26,0.35)";
    ctx.fillRect(card.x + 22, card.y + 10, 1, card.h - 20);
    // Proofreading highlight sits behind the DOM caption.
    if (f.mode === "processing") {
      const p = f.reduced ? 1 : L.easeInOut((f.since % 1300) / 1050);
      ctx.fillStyle = "rgba(184,50,26,0.14)";
      ctx.beginPath();
      ctx.roundRect(card.x + 32, card.y + 13, (card.w - 46) * p, 26, 4);
      ctx.fill();
    }
    const baseY = card.y + 62;
    ctx.fillStyle = "rgba(31,27,22,0.08)";
    ctx.fillRect(card.x + 32, baseY + 9, card.w - 46, 1);
    drawInk(ctx, inkOv, card.x + 32, card.x + card.w - 24, baseY, f, 10, dry);
    if (f.mode === "recording") nib(ctx, card.x + card.w - 16, baseY, f, 1);
    ctx.restore();
  }

  function windowViz(f) {
    const { ctx, w, h } = win;
    ctx.clearRect(0, 0, w, h);
    const baseY = h / 2;
    drawInk(ctx, inkWin, 0, w - 16, baseY, f, 11, dry);
    if (f.live === "recording") nib(ctx, w - 7, baseY, f, 1);
    else {
      ctx.beginPath();
      ctx.arc(w - 7, baseY, 2.5, 0, Math.PI * 2);
      ctx.fillStyle =
        f.live === "processing" ? "#b8321a" : "rgba(31,27,22,0.4)";
      ctx.fill();
    }
  }

  return {
    id: "transcript",
    index: 4,
    name: "Transcript",
    tagline: "Settings you can read aloud.",
    thesis:
      "A light, editorial direction where the words are the hero. Your settings become one sentence you edit in place, and the overlay is a paper card where speech lands as ink before it is pasted.",
    notes: [
      [
        "Window",
        "Sentence form: every select sits inside the sentence it configures, so the whole setup reads in one glance. Permissions read the same way.",
      ],
      [
        "Overlay",
        "Live caption set in a serif, over a calligraphic ink line drawn from your voice. Processing dries the ink and runs a proofreading highlight across the words.",
      ],
      [
        "Signature",
        "Pen-pressure waveform: the stroke gets heavier as you get louder, with a vermilion nib at the tip.",
      ],
    ],
    size: "400 × 356",
    init({ overlayCanvas, windowCanvas }) {
      ov = L.setupCanvas(overlayCanvas);
      win = L.setupCanvas(windowCanvas);
    },
    overlay,
    windowViz,
  };
})();
