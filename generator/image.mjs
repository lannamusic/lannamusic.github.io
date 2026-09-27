// Pure image helpers. Images are { width, height, data } like ImageData
// (RGBA); masks are Uint8Array with 1 = ink.

/** 3×3 homography (row-major) mapping each src[i] to dst[i]. */
export function solveHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return [...b.map((v, i) => v / A[i][i]), 1];
}

export function project(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** Warp the quad [tl, tr, br, bl] of img onto an outW × outH rectangle (nearest neighbour). */
export function warp(img, quad, outW, outH) {
  const H = solveHomography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quad);
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [sx, sy] = project(H, x + 0.5, y + 0.5);
      const ix = Math.min(img.width - 1, Math.max(0, Math.floor(sx)));
      const iy = Math.min(img.height - 1, Math.max(0, Math.floor(sy)));
      const s = (iy * img.width + ix) * 4;
      const d = (y * outW + x) * 4;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = 255;
    }
  }
  return { width: outW, height: outH, data: out };
}

/** Ink mask using Otsu's threshold on luminance. */
export function inkMask(img) {
  const n = img.width * img.height;
  const gray = new Uint8Array(n);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    const g = Math.round(0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2]);
    gray[i] = g;
    hist[g]++;
  }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = -1, level = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; level = t; }
  }
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = gray[i] <= level ? 1 : 0;
  return mask;
}

/** Centres of runs where profile[i] >= min; centres closer than gap are merged. */
export function ruleCentres(profile, min, gap) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= profile.length; i++) {
    const on = i < profile.length && profile[i] >= min;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const c = (start + i - 1) / 2;
      if (out.length && c - out.at(-1) < gap) out[out.length - 1] = (out.at(-1) + c) / 2;
      else out.push(c);
      start = -1;
    }
  }
  return out;
}

// The image edge stands in for a rule the photo lost (tilt, shadow), unless a
// rule was found near that edge.
function withEdges(centres, size) {
  const r = [...centres];
  if (!r.length || r[0] > size * 0.06) r.unshift(0);
  if (r.at(-1) < size * 0.94) r.push(size);
  return r;
}

/** Table rules in a rectified ink mask. */
export function findTable(mask, w, h) {
  const rowProfile = Array.from({ length: h }, (_, y) => {
    let s = 0;
    for (let x = 0; x < w; x++) s += mask[y * w + x];
    return s;
  });
  const rows = withEdges(ruleCentres(rowProfile, w * 0.45, h / 20), h);
  const cells = [];
  for (let r = 0; r < rows.length - 1; r++) {
    const y0 = Math.round(rows[r]);
    const y1 = Math.round(rows[r + 1]);
    const colProfile = Array.from({ length: w }, (_, x) => {
      let s = 0;
      for (let y = y0; y < y1; y++) s += mask[y * w + x];
      return s;
    });
    cells.push(withEdges(ruleCentres(colProfile, (y1 - y0) * 0.6, w / 40), w));
  }
  // A short last row is often followed by a note in the margin: drop trailing
  // "cells" much wider than a normal measure.
  const widths = cells.flatMap((xs) => xs.slice(1).map((x, i) => x - xs[i])).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)];
  for (const xs of cells) while (xs.length > 2 && xs.at(-1) - xs.at(-2) > 1.6 * median) xs.pop();
  return { rows, cells };
}
