"use strict";

/**
 * Static liquid-metal renderer for brand art (app icon, tray glyph, DMG
 * background). Same shading model as src/renderer/orb.js, but evaluated at
 * full output resolution with explicit ball positions instead of springs.
 */
window.VaperMetal = (() => {
  const LIGHT = (() => {
    const v = [-0.45, -0.7, 0.55];
    const m = Math.hypot(v[0], v[1], v[2]);
    return v.map((c) => c / m);
  })();
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

  /**
   * Evaluate the metaball field for a pixel grid.
   * balls: [x, y, r] in px; returns Float32Array of field values.
   */
  function field(w, h, ox, oy, unit, balls) {
    const out = new Float32Array(w * h);
    const nb = balls.map(([x, y, r]) => [x / unit, y / unit, r / unit]);
    for (let py = 0; py < h; py++) {
      const ny = (oy + py + 0.5) / unit;
      for (let px = 0; px < w; px++) {
        const nx = (ox + px + 0.5) / unit;
        let s = 0;
        for (let b = 0; b < nb.length; b++) {
          const ex = nx - nb[b][0];
          const ey = ny - nb[b][1];
          s += (nb[b][2] * nb[b][2]) / (ex * ex + ey * ey + 1e-7);
        }
        out[py * w + px] = s;
      }
    }
    return out;
  }

  /**
   * Draw chrome blobs into ctx (device pixels, no transform).
   * box: {x, y, w, h} device-pixel region to evaluate.
   * unit: device px per normalized unit (sets surface curvature scale).
   * tint: [r, g, b] colour reflected from the floor.
   */
  function drawChrome(
    ctx,
    box,
    balls,
    { unit, tint = [110, 110, 118], floor = 0.26, bulge = 0.2, crisp = 0 } = {},
  ) {
    const w = Math.round(box.w);
    const h = Math.round(box.h);
    const f = field(w, h, box.x, box.y, unit, balls);
    const img = ctx.createImageData(w, h);
    const data = img.data;
    const spacing = 2 / unit;
    const z = (v) => Math.sqrt(Math.max(0, 1 - 1 / v));
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = py * w + px;
        const fv = f[i];
        const o = i * 4;
        if (fv < 0.7) continue;
        const zl = z(f[py * w + Math.max(0, px - 1)]);
        const zr = z(f[py * w + Math.min(w - 1, px + 1)]);
        const zu = z(f[Math.max(0, py - 1) * w + px]);
        const zd = z(f[Math.min(h - 1, py + 1) * w + px]);
        let nx = (-(zr - zl) / spacing) * bulge;
        let ny = (-(zd - zu) / spacing) * bulge;
        let nz = 1;
        const m = Math.hypot(nx, ny, nz);
        nx /= m;
        ny /= m;
        nz /= m;
        const rx = 2 * nz * nx;
        const ry = 2 * nz * ny;
        const rz = 2 * nz * nz - 1;
        // Studio environment: overhead light, soft-box stripe, tinted floor.
        // `crisp` narrows the horizon so large renders read as polished metal.
        const span = 1.4 - crisp * 1.0;
        const t = clamp((ry + 0.65 - crisp * 0.55) / span);
        const sm = t * t * (3 - 2 * t);
        const sky = 238 - 210 * sm;
        const box2 =
          Math.exp(-(((ry + 0.42) / 0.09) ** 2)) * 40 * (1 - Math.abs(rx));
        const horizon =
          1 - crisp * 0.55 * Math.exp(-(((ry - 0.08) / 0.06) ** 2));
        const k = floor * sm;
        const side = 1 + 0.1 * rx;
        const spec =
          Math.pow(
            Math.max(0, rx * LIGHT[0] + ry * LIGHT[1] + rz * LIGHT[2]),
            28,
          ) * 300;
        const rim = Math.pow(1 - nz, 3) * 50;
        data[o] = Math.min(
          255,
          (sky + box2 + tint[0] * k) * side * horizon + spec + rim,
        );
        data[o + 1] = Math.min(
          255,
          (sky + box2 + tint[1] * k) * side * horizon + spec + rim,
        );
        data[o + 2] = Math.min(
          255,
          (sky + 6 + box2 + tint[2] * k) * side * horizon + spec + rim,
        );
        data[o + 3] = Math.round(coverage(f, w, h, px, py) * 255);
      }
    }
    // Composite over existing pixels.
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    tmp.getContext("2d").putImageData(img, 0, 0);
    ctx.drawImage(tmp, Math.round(box.x), Math.round(box.y));
  }

  /**
   * Pixel coverage of the f = 1 surface: distance to the edge estimated from
   * the local field gradient, so edges are one pixel wide at any scale.
   */
  function coverage(f, w, h, px, py) {
    const i = py * w + px;
    // Well inside a ball the field spikes; that is not an edge.
    if (f[i] > 1.5) return 1;
    const gx =
      (f[py * w + Math.min(w - 1, px + 1)] - f[py * w + Math.max(0, px - 1)]) /
      2;
    const gy =
      (f[Math.min(h - 1, py + 1) * w + px] - f[Math.max(0, py - 1) * w + px]) /
      2;
    const g = Math.hypot(gx, gy) || 1e-6;
    return clamp((f[i] - 1) / g + 0.5);
  }

  /** Solid silhouette (alpha only) of the metaball field, for template icons. */
  function drawSilhouette(ctx, size, balls, unit, colour = "#000") {
    const f = field(size, size, 0, 0, unit, balls);
    const img = ctx.createImageData(size, size);
    const rgb = colour === "#000" ? [0, 0, 0] : [255, 255, 255];
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const o = (py * size + px) * 4;
        img.data[o] = rgb[0];
        img.data[o + 1] = rgb[1];
        img.data[o + 2] = rgb[2];
        img.data[o + 3] = Math.round(coverage(f, size, size, px, py) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Seeded PRNG so grain and spatter are identical on every export. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Film grain over a region, for depth on large flat darks. */
  function grain(ctx, w, h, amount, seed) {
    const r = rng(seed);
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] === 0) continue;
      const n = (r() - 0.5) * amount;
      img.data[i] = clamp(img.data[i] + n, 0, 255);
      img.data[i + 1] = clamp(img.data[i + 1] + n, 0, 255);
      img.data[i + 2] = clamp(img.data[i + 2] + n, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Apple-style continuous-corner rounded square (superellipse approximation). */
  function squircle(ctx, x, y, s, n = 5) {
    const a = s / 2;
    const cx = x + a;
    const cy = y + a;
    ctx.beginPath();
    for (let i = 0; i <= 360; i++) {
      const t = (i / 360) * Math.PI * 2;
      const c = Math.cos(t);
      const si = Math.sin(t);
      const px = cx + a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const py = cy + a * Math.sign(si) * Math.pow(Math.abs(si), 2 / n);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  return { drawChrome, drawSilhouette, grain, squircle, rng };
})();
