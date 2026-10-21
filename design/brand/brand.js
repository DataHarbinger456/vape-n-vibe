"use strict";

/**
 * Vaper brand art, rendered from code so it stays in step with the app's
 * Mercury orb. Open index.html to preview; export.cjs writes the files.
 *
 * - App icon: a chrome droplet mid-splash, the way the orb looks while you
 *   talk, lit red from below by the "on air" light.
 * - Menu-bar glyph: the same splash as a template silhouette.
 * - DMG background: mercury beads hop from the app to Applications.
 */
window.VaperBrand = (() => {
  const { drawChrome, drawSilhouette, grain, squircle } = window.VaperMetal;
  const ON_AIR = [255, 69, 58];

  // Splash pose in normalized units (core at 0.5, 0.5).
  const SPLASH = [
    [0.46, 0.57, 0.25], // core
    [0.73, 0.29, 0.08], // drop pulling away on a neck
    [0.84, 0.15, 0.035], // bead just breaking off it
    [0.93, 0.29, 0.02], // spray
    [0.16, 0.33, 0.03], // bead flung left
    [0.86, 0.62, 0.026], // bead flung right
  ];
  // Large renders need a sharper horizon and rounder normals to read as chrome.
  const CHROME = { crisp: 0.6, bulge: 0.36 };

  function place(pose, cx, cy, unit) {
    return pose.map(([x, y, r]) => [
      cx + (x - 0.5) * unit,
      cy + (y - 0.5) * unit,
      r * unit,
    ]);
  }

  // ------------------------------------------------------------------ icon
  /** Full macOS icon on a transparent canvas of size S (Apple's 1024 grid). */
  function renderIcon(canvas, S) {
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext("2d");
    const k = S / 1024;
    const body = 824 * k;
    const bx = 100 * k;
    const by = 100 * k;

    // Drop shadow per Apple's template.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.38)";
    ctx.shadowBlur = 24 * k;
    ctx.shadowOffsetY = 12 * k;
    squircle(ctx, bx, by, body);
    ctx.fillStyle = "#0b0b0c";
    ctx.fill();
    ctx.restore();

    ctx.save();
    squircle(ctx, bx, by, body);
    ctx.clip();
    // Studio: lit from above, dark floor.
    const bg = ctx.createLinearGradient(0, by, 0, by + body);
    bg.addColorStop(0, "#2b2b31");
    bg.addColorStop(0.55, "#121214");
    bg.addColorStop(1, "#08080a");
    ctx.fillStyle = bg;
    ctx.fillRect(bx, by, body, body);
    const top = ctx.createRadialGradient(S / 2, by, 0, S / 2, by, body * 0.8);
    top.addColorStop(0, "rgba(255,255,255,0.10)");
    top.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = top;
    ctx.fillRect(bx, by, body, body);

    const cx = S / 2;
    const cy = by + body * 0.47;
    const unit = body * 0.8;

    // On-air light spilling across the floor under the droplet.
    ctx.save();
    ctx.translate(cx - body * 0.03, by + body * 0.8);
    ctx.scale(1, 0.18);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, body * 0.34);
    glow.addColorStop(0, "rgba(255,69,58,0.66)");
    glow.addColorStop(0.45, "rgba(255,69,58,0.24)");
    glow.addColorStop(1, "rgba(255,69,58,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-body, -body, body * 2, body * 2);
    ctx.restore();
    // Contact shadow.
    ctx.save();
    ctx.translate(cx - body * 0.03, by + body * 0.79);
    ctx.scale(1, 0.14);
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, body * 0.18);
    shadow.addColorStop(0, "rgba(0,0,0,0.55)");
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shadow;
    ctx.fillRect(-body, -body, body * 2, body * 2);
    ctx.restore();

    drawChrome(
      ctx,
      { x: bx, y: by, w: body, h: body },
      place(SPLASH, cx, cy, unit),
      {
        unit,
        tint: ON_AIR,
        floor: 0.34,
        ...CHROME,
      },
    );
    grain(ctx, S, S, 5, 3);
    ctx.restore();

    // Hairline rim so the edge reads on dark docks.
    ctx.save();
    squircle(ctx, bx + 0.75 * k, by + 0.75 * k, body - 1.5 * k);
    const rim = ctx.createLinearGradient(0, by, 0, by + body);
    rim.addColorStop(0, "rgba(255,255,255,0.22)");
    rim.addColorStop(0.5, "rgba(255,255,255,0.05)");
    rim.addColorStop(1, "rgba(255,255,255,0.08)");
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.5 * k;
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ tray
  /** Menu-bar template image: black splash silhouette, size px square. */
  function renderTray(canvas, size) {
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const unit = size * 1.04;
    // The icon's splash, simplified to read at 16 to 22 points.
    const pose = [
      [0.42, 0.6, 0.26],
      [0.71, 0.32, 0.1],
      [0.86, 0.14, 0.06],
      [0.13, 0.27, 0.055],
    ];
    drawSilhouette(ctx, size, place(pose, size / 2, size / 2, unit), unit);
  }

  // ------------------------------------------------------------------ dmg
  // Layout in points; electron-builder places icon centres at these.
  const DMG = {
    width: 660,
    height: 420,
    app: { x: 170, y: 206 },
    apps: { x: 490, y: 206 },
    iconSize: 128,
    labelY: 291, // centre of the Finder label under each icon
  };

  function keycap(ctx, x, y, s, label) {
    const w = 30 * s;
    const h = 22 * s;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y - h / 2 + 1 * s, w, h, 6 * s);
    ctx.fillStyle = "#050505";
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x, y - h / 2 - 1 * s, w, h, 6 * s);
    const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, "#2a2a2f");
    g.addColorStop(1, "#18181b");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "#ff453a";
    ctx.lineWidth = 1 * s;
    ctx.stroke();
    ctx.fillStyle = "#f2f2f3";
    ctx.font = `500 ${12.5 * s}px "Geist Mono"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + w / 2, y - 0.5 * s);
    ctx.restore();
    return w;
  }

  /** Engraved metal plate behind each Finder label. Mid-grey so both light- and dark-mode label ink stay readable. */
  function nameplate(ctx, cx, cy, s) {
    const w = 118 * s;
    const h = 22 * s;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
    const g = ctx.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
    g.addColorStop(0, "#7a7a7e");
    g.addColorStop(1, "#727276");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1 * s;
    ctx.stroke();
    ctx.restore();
  }

  function renderDmg(canvas, s, { showGuides = false } = {}) {
    const W = DMG.width * s;
    const H = DMG.height * s;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#0b0b0c";
    ctx.fillRect(0, 0, W, H);
    const top = ctx.createRadialGradient(
      W / 2,
      -40 * s,
      0,
      W / 2,
      -40 * s,
      W * 0.75,
    );
    top.addColorStop(0, "rgba(255,255,255,0.11)");
    top.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, H);
    // Studio floor the icons stand on.
    const floor = ctx.createLinearGradient(0, 250 * s, 0, H);
    floor.addColorStop(0, "rgba(255,255,255,0)");
    floor.addColorStop(0.08, "rgba(255,255,255,0.025)");
    floor.addColorStop(1, "rgba(255,255,255,0.0)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, 250 * s, W, H);
    // Faint on-air spill where the app icon meets the floor.
    ctx.save();
    ctx.translate(DMG.app.x * s, 258 * s);
    ctx.scale(1, 0.2);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 84 * s);
    glow.addColorStop(0, "rgba(255,69,58,0.16)");
    glow.addColorStop(1, "rgba(255,69,58,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-200 * s, -800 * s, 400 * s, 1600 * s);
    ctx.restore();

    // Wordmark and line.
    ctx.textAlign = "center";
    ctx.fillStyle = "#f2f2f3";
    ctx.font = `${30 * s}px Slackey`;
    ctx.fillText("Vaper", W / 2, 62 * s);
    ctx.fillStyle = "#98989f";
    ctx.font = `450 ${13.5 * s}px Geist`;
    ctx.fillText("Talk anywhere. It types for you.", W / 2, 88 * s);

    // Mercury beads hopping from the app to Applications.
    const beads = [];
    const n = 7;
    const x0 = 250;
    const x1 = 410;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = x0 + (x1 - x0) * t;
      const y = 206 - Math.sin(Math.PI * t) * 30;
      const r = 3.2 + t * 5.6;
      beads.push([x * s, y * s, r * s]);
      // A small trailing drop on every other bead so pairs read as liquid.
      if (i % 2 === 1) beads.push([(x - 7) * s, (y + 2.5) * s, r * 0.45 * s]);
    }
    beads.forEach(([bx, , br]) => {
      ctx.save();
      ctx.translate(bx, 252 * s);
      ctx.scale(1, 0.25);
      const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, br * 2.2);
      sh.addColorStop(0, "rgba(0,0,0,0.45)");
      sh.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sh;
      ctx.fillRect(-br * 3, -br * 12, br * 6, br * 24);
      ctx.restore();
    });
    drawChrome(ctx, { x: 236 * s, y: 160 * s, w: 190 * s, h: 70 * s }, beads, {
      unit: 70 * s,
      tint: ON_AIR,
      floor: 0.3,
      ...CHROME,
    });

    nameplate(ctx, DMG.app.x * s, DMG.labelY * s, s);
    nameplate(ctx, DMG.apps.x * s, DMG.labelY * s, s);

    // Next step, with an inline fn keycap.
    const y = 366 * s;
    ctx.font = `450 ${14 * s}px Geist`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const a = "Drag Vaper into Applications, then hold ";
    const b = " and talk.";
    const wa = ctx.measureText(a).width;
    const wb = ctx.measureText(b).width;
    const kw = 30 * s;
    let x = (W - (wa + kw + wb)) / 2;
    ctx.fillStyle = "#c7c7cc";
    ctx.fillText(a, x, y);
    x += wa;
    keycap(ctx, x, y, s, "fn");
    x += kw;
    ctx.fillStyle = "#c7c7cc";
    ctx.fillText(b, x, y);
    ctx.textBaseline = "alphabetic";

    grain(ctx, W, H, 4, 5);

    if (showGuides) {
      ctx.strokeStyle = "rgba(0,200,255,0.6)";
      ctx.lineWidth = 1;
      [DMG.app, DMG.apps].forEach((p) => {
        const h = (DMG.iconSize / 2) * s;
        ctx.strokeRect(p.x * s - h, p.y * s - h, h * 2, h * 2);
      });
    }
  }

  return { renderIcon, renderTray, renderDmg, DMG };
})();
