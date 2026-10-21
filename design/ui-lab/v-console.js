"use strict";

/**
 * 02 Console: a studio channel strip. A VU needle with real ballistics and a
 * tape strip that records level history; transcription rewinds the tape.
 */
window.VaperVariants.console = (() => {
  const L = window.VaperLab;
  const needle = { x: 0, v: 0 };
  const needleWin = { x: 0, v: 0 };
  const tape = L.history(64);
  let tapeClock = 0;
  let peakHold = 0;
  let reel = 0;
  let wasRecording = false;
  let ov = null;
  let win = null;
  let glow = null;

  function drawVU(ctx, x, y, w, h, value, lit, peakOn) {
    const k = h / 44;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 5 * k);
    const face = ctx.createLinearGradient(0, y, 0, y + h);
    face.addColorStop(0, "#f4ead3");
    face.addColorStop(1, "#e2d4b4");
    ctx.fillStyle = face;
    ctx.fill();
    ctx.clip();
    if (lit > 0) {
      const back = ctx.createRadialGradient(
        x + w / 2,
        y + h,
        0,
        x + w / 2,
        y + h,
        h * 1.3,
      );
      back.addColorStop(0, `rgba(255,181,71,${0.34 * lit})`);
      back.addColorStop(1, "rgba(255,181,71,0)");
      ctx.fillStyle = back;
      ctx.fillRect(x, y, w, h);
    }
    const pvx = x + w / 2;
    const pvy = y + h * 1.18;
    const R = h * 0.98;
    const a0 = -0.8;
    const a1 = 0.8;
    const at = (a, r) => [pvx + Math.sin(a) * r, pvy - Math.cos(a) * r];
    // Scale arc: ink to 0 VU, red above it.
    const split = a0 + (a1 - a0) * 0.7;
    ctx.lineWidth = 1 * k;
    ctx.strokeStyle = "rgba(28,23,18,0.8)";
    ctx.beginPath();
    ctx.arc(pvx, pvy, R * 0.8, -Math.PI / 2 + a0, -Math.PI / 2 + split);
    ctx.stroke();
    ctx.strokeStyle = "#c2321f";
    ctx.lineWidth = 2.2 * k;
    ctx.beginPath();
    ctx.arc(pvx, pvy, R * 0.8, -Math.PI / 2 + split, -Math.PI / 2 + a1);
    ctx.stroke();
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (a1 - a0) * (i / 10);
      const len = (i % 5 === 0 ? 5 : 3) * k;
      const [ax, ay] = at(a, R * 0.8);
      const [bx, by] = at(a, R * 0.8 + len);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = i >= 7 ? "#c2321f" : "rgba(28,23,18,0.8)";
      ctx.lineWidth = (i % 5 === 0 ? 1.2 : 0.8) * k;
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(28,23,18,0.78)";
    ctx.font = `700 ${7.5 * k}px Archivo, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("VU", pvx, y + h * 0.66);
    // Needle with a soft cast shadow on the face.
    const a = a0 + (a1 - a0) * L.clamp(value, -0.04, 1.06);
    const [nx, ny] = at(a, R * 0.99);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pvx + 1.5 * k, pvy + 1 * k);
    ctx.lineTo(nx + 1.5 * k, ny + 1 * k);
    ctx.strokeStyle = "rgba(28,23,18,0.18)";
    ctx.lineWidth = 1.6 * k;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pvx, pvy);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = "#16120d";
    ctx.lineWidth = 1.1 * k;
    ctx.stroke();
    // Pivot housing.
    const house = ctx.createLinearGradient(0, y + h * 0.8, 0, y + h);
    house.addColorStop(0, "#2e271e");
    house.addColorStop(1, "#1a1611");
    ctx.fillStyle = house;
    ctx.fillRect(x, y + h * 0.82, w, h * 0.18);
    ctx.restore();
    // Glass gloss and bezel.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h * 0.46, [5 * k, 5 * k, 0, 0]);
    const gloss = ctx.createLinearGradient(0, y, 0, y + h * 0.46);
    gloss.addColorStop(0, "rgba(255,255,255,0.32)");
    gloss.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gloss;
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 5 * k);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // Peak LED.
    const lx = x + w - 7 * k;
    const ly = y + 7 * k;
    if (peakOn) ctx.drawImage(glow, lx - 9 * k, ly - 9 * k, 18 * k, 18 * k);
    ctx.beginPath();
    ctx.arc(lx, ly, 2.4 * k, 0, Math.PI * 2);
    ctx.fillStyle = peakOn ? "#ff5a4a" : "#6b3a30";
    ctx.fill();
    ctx.restore();
  }

  function drawReel(ctx, cx, cy, r, angle, alpha) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = "rgba(226,213,184,0.75)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const a = angle + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.32, cy + Math.sin(a) * r * 0.32);
      ctx.lineTo(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTape(ctx, x, y, w, h, f) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 5);
    ctx.fillStyle = "#0d0b08";
    ctx.fill();
    ctx.clip();
    const inner = ctx.createLinearGradient(0, y, 0, y + h);
    inner.addColorStop(0, "rgba(0,0,0,0.6)");
    inner.addColorStop(0.2, "rgba(0,0,0,0)");
    ctx.fillStyle = inner;
    ctx.fillRect(x, y, w, h);
    const cy = y + h / 2;
    const head = x + w * 0.8;
    const processing = f.mode === "processing";
    const rewind = processing && !f.reduced ? L.easeInOut(f.since / 900) : 0;
    const fade = processing ? 1 - L.easeOut(f.since / 700) : 1;
    // Future side of the head.
    ctx.fillStyle = "rgba(255,181,71,0.16)";
    for (let fx = head + 6; fx < x + w; fx += 4)
      ctx.fillRect(fx, cy - 0.5, 1.5, 1);
    if (fade > 0.01) {
      for (let i = tape.len - 1; i >= 0; i--) {
        const age = tape.len - 1 - i;
        const bx = head - 3 - age * 3 + rewind * w * 0.85;
        if (bx < x + 3) break;
        if (bx > x + w) continue;
        const v = tape.get(i);
        const bh = 1.5 + v * (h - 10);
        ctx.fillStyle = `rgba(255,181,71,${(0.22 + 0.78 * (i / tape.len)) * fade})`;
        ctx.fillRect(bx, cy - bh / 2, 2, bh);
      }
    }
    if (processing) {
      const show = f.reduced ? 1 : L.easeOut(f.since / 350);
      drawReel(ctx, x + w * 0.3, cy, h * 0.36, reel, show);
      drawReel(ctx, x + w * 0.7, cy, h * 0.36, reel * 1.3, show);
    }
    // Record head.
    ctx.fillStyle = processing ? "rgba(255,181,71,0.35)" : "#ffb547";
    ctx.fillRect(head, y + 4, 1, h - 8);
    if (!processing) {
      ctx.globalAlpha *= 0.5 + f.level * 0.5;
      ctx.drawImage(glow, head - 8, cy - 8, 16, 16);
    }
    ctx.restore();
  }

  function stepMeters(f) {
    const rec = f.live === "recording";
    if (rec && !wasRecording) tape.fill(0);
    wasRecording = rec;
    const target = rec ? L.clamp(f.level * 1.45 + f.peak * 0.28) : 0;
    if (f.reduced) {
      needle.x = rec ? 0.55 : 0;
      needleWin.x = needle.x;
    } else {
      L.spring(needle, target, f.dt, 150, 15);
      L.spring(needleWin, target, f.dt, 150, 15);
      reel += (f.dt / 1000) * 9;
    }
    if (target > 0.82) peakHold = 380;
    peakHold = Math.max(0, peakHold - f.dt);
    if (rec) {
      tapeClock += f.dt;
      while (tapeClock >= 45) {
        tapeClock -= 45;
        tape.push(f.reduced ? 0.35 : L.clamp(f.level * 0.9 + f.peak * 0.4));
      }
    }
  }

  function overlay(f) {
    stepMeters(f);
    const { ctx, w, h } = ov;
    ctx.clearRect(0, 0, w, h);
    if (f.alpha < 0.005) return;
    ctx.save();
    ctx.globalAlpha = f.alpha;
    const px = 46;
    const py = 50;
    const pw = w - 92;
    const ph = 60;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 10);
    const panel = ctx.createLinearGradient(0, py, 0, py + ph);
    panel.addColorStop(0, "#2a241c");
    panel.addColorStop(1, "#15120e");
    ctx.fillStyle = panel;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.roundRect(px + 0.5, py + 0.5, pw - 1, ph - 1, 10);
    ctx.strokeStyle = "rgba(255,236,200,0.1)";
    ctx.stroke();
    // Four panel screws, slots at fixed angles.
    [
      [px + 6, py + 6, 0.4],
      [px + pw - 6, py + 6, 1.2],
      [px + 6, py + ph - 6, 2.1],
      [px + pw - 6, py + ph - 6, 0.9],
    ].forEach(([sx, sy, a]) => {
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#3b3329";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx - Math.cos(a) * 1.6, sy - Math.sin(a) * 1.6);
      ctx.lineTo(sx + Math.cos(a) * 1.6, sy + Math.sin(a) * 1.6);
      ctx.strokeStyle = "#120f0b";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });
    const lit = f.mode === "recording" ? 0.6 + f.level * 0.4 : 0.25;
    drawVU(ctx, px + 12, py + 8, 74, 44, needle.x, lit, peakHold > 0);
    drawTape(ctx, px + 94, py + 8, pw - 106, 44, f);
    ctx.restore();
  }

  function windowViz(f) {
    const { ctx, w, h } = win;
    ctx.clearRect(0, 0, w, h);
    const lit =
      f.live === "recording"
        ? 0.6 + f.level * 0.4
        : f.live === "processing"
          ? 0.35
          : 0.12;
    drawVU(ctx, 1, 1, w - 2, h - 2, needleWin.x, lit, peakHold > 0);
  }

  return {
    id: "console",
    index: 2,
    name: "Console",
    tagline: "A studio channel strip for your voice.",
    thesis:
      "Warm analog hardware. An illuminated talk key, a VU needle with real spring ballistics, and a tape strip that records your level history. When you let go, the tape rewinds and the reels spin while the model transcribes.",
    notes: [
      [
        "Window",
        "Brushed faceplate with engraved labels, recessed selects, a backlit talk key and a large VU meter that tracks your voice live.",
      ],
      [
        "Overlay",
        "VU meter plus a tape recorder strip with a record head. Processing rewinds the tape and spins two reels.",
      ],
      [
        "Signature",
        "Needle physics: it lags, overshoots and settles like a real 300 ms VU movement, with a peak LED that holds.",
      ],
    ],
    size: "400 × 396",
    init({ overlayCanvas, windowCanvas }) {
      ov = L.setupCanvas(overlayCanvas);
      win = L.setupCanvas(windowCanvas);
      glow = L.sprite(255, 120, 80);
    },
    overlay,
    windowViz,
  };
})();
