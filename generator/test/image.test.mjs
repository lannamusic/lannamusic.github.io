import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveHomography, project, warp, inkMask, ruleCentres, findTable } from '../image.mjs';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('homography maps the four corners', () => {
  const src = [[0, 0], [100, 0], [100, 50], [0, 50]];
  const dst = [[10, 20], [210, 30], [200, 130], [0, 120]];
  const H = solveHomography(src, dst);
  src.forEach((p, i) => {
    const [x, y] = project(H, ...p);
    close(x, dst[i][0]);
    close(y, dst[i][1]);
  });
});

const image = (w, h, fill) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fill(x, y);
    data.set([v, v, v, 255], (y * w + x) * 4);
  }
  return { width: w, height: h, data };
};

test('warp samples the quad onto a rectangle', () => {
  const img = image(4, 4, (x) => (x < 2 ? 0 : 255));
  const out = warp(img, [[0, 0], [4, 0], [4, 4], [0, 4]], 2, 2);
  assert.equal(out.width, 2);
  assert.deepEqual([out.data[0], out.data[4]], [0, 255]);
});

test('inkMask separates dark from light', () => {
  const mask = inkMask(image(10, 1, (x) => (x < 3 ? 20 : 230)));
  assert.deepEqual([...mask], [1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
});

test('ruleCentres merges runs and close neighbours', () => {
  assert.deepEqual(ruleCentres([0, 0, 5, 5, 0, 0, 0, 5, 0], 5, 2), [2.5, 7]);
  assert.deepEqual(ruleCentres([5, 0, 5, 0, 0, 0], 5, 3), [1]);
});

// A 200×100 table: rules at y = 2, 50, 97. Row 1 has x rules every 40 px;
// row 2 has a short row (x = 2, 40) followed by handwriting-like text.
function tableMask() {
  const w = 200, h = 100, m = new Uint8Array(w * h);
  const hline = (y, x0, x1) => { for (let x = x0; x <= x1; x++) m[y * w + x] = 1; };
  const vline = (x, y0, y1) => { for (let y = y0; y <= y1; y++) m[y * w + x] = 1; };
  hline(2, 2, 197); hline(50, 2, 197); hline(97, 2, 120);
  for (const x of [2, 40, 80, 120, 160, 197]) vline(x, 2, 50);
  for (const x of [2, 40]) vline(x, 50, 97);
  for (let x = 60; x < 190; x += 3) for (let y = 70; y < 76; y++) m[y * w + x] = 1; // text
  return { m, w, h };
}

test('findTable finds rows and cells, and drops a wide trailing cell', () => {
  const { m, w, h } = tableMask();
  const t = findTable(m, w, h);
  assert.deepEqual(t.rows, [2, 50, 97]);
  assert.deepEqual(t.cells[0], [2, 40, 80, 120, 160, 197]);
  assert.deepEqual(t.cells[1], [2, 40]);
});

test('findTable adds the image edge when a rule is missing', () => {
  const w = 200, h = 100, m = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) m[50 * w + x] = 1;
  const t = findTable(m, w, h);
  assert.deepEqual(t.rows, [0, 50, 100]);
});

test('findTable says whether it found real rules, not just the image edges', () => {
  const { m, w, h } = tableMask();
  assert.equal(findTable(m, w, h).ruled, true);
  assert.equal(findTable(new Uint8Array(300 * 100), 300, 100).ruled, false);
  const onlyLines = new Uint8Array(300 * 100);
  for (let x = 0; x < 300; x++) onlyLines[50 * 300 + x] = 1; // one horizontal rule, no cell walls
  assert.equal(findTable(onlyLines, 300, 100).ruled, false);
});
