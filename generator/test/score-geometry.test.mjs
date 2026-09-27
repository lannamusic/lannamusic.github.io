import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thaiOptions, withoutTitle, anchors, verovioBarlines, verovioSize, measureSpread, placeScore, scoreSvg } from '../score-geometry.mjs';

test('thaiOptions: one row, 50 px per measure, infinite page', () => {
  const o = thaiOptions(36);
  assert.equal(o.measuresPerRow, 36);
  assert.equal(o.page.width, 1820);
  assert.equal(o.page.infinite, true);
});

test('withoutTitle drops the title band and moves the grid up to the margin', () => {
  const res = { width: 100, height: 89, pages: [{ elements: [
    { kind: 'text', x: 50, y: 31, text: 'เพลง', role: 'title' },
    { kind: 'text', x: 90, y: 31, text: 'ทำนอง', role: 'instrument-name' },
    { kind: 'line', x1: 10, y1: 57, x2: 90, y2: 57 },
    { kind: 'line', x1: 10, y1: 57, x2: 10, y2: 79 },
    { kind: 'text', x: 21.875, y: 72, text: 'ซ', role: 'symbol' },
    { kind: 'dot', x: 21.875, y: 61.8, r: 0.96, role: 'octave-dot' },
  ] }] };
  const out = withoutTitle(res);
  assert.equal(out.height, 42);
  assert.equal(out.elements.length, 4);
  assert.deepEqual(out.elements[0], { kind: 'line', x1: 10, y1: 10, x2: 90, y2: 10 });
  assert.equal(out.elements[2].y, 25);
  assert.ok(Math.abs(out.elements[3].y - 14.8) < 1e-9);
});

test('anchors: first/last pitched beat and every 4th beat', () => {
  const sym = (x, text) => ({ kind: 'text', role: 'symbol', x, y: 25, text });
  const els = [sym(30.625, 'ซ'), sym(21.875, '-'), sym(39.375, '-'), sym(48.125, 'ด'),
    sym(71.875, 'ร'), sym(80.625, 'ม'), sym(89.375, '-'), sym(98.125, '-'), { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 0 }];
  assert.deepEqual(anchors(els), { firstNoteX: 30.625, lastNoteX: 80.625, lastBeatXs: [48.125, 98.125] });
});

const VEROVIO = `<svg width="1000px" height="112px" version="1.1"><desc>Engraved by Verovio</desc>
<svg class="definition-scale" color="black" viewBox="0 0 10000 1120">
<g data-id="a" data-class="barLine" class="barLine">
   <path d="M1000 540 L1000 1260" stroke-width="27" />
</g><g data-id="b" data-class="barLine" class="barLine">
   <path d="M2500.5 540 L2500.5 1260" />
</g></svg></svg>`;

test('verovioBarlines converts definition-scale units to px', () => {
  assert.deepEqual(verovioBarlines(VEROVIO), [100, 250.05]);
  assert.deepEqual(verovioSize(VEROVIO), { width: 1000, height: 112 });
});

test('measureSpread ignores the first and last measure', () => {
  assert.ok(Math.abs(measureSpread([0, 100, 150, 200, 260, 400]) - 10 / 60) < 1e-9);
  assert.equal(measureSpread([0, 100]), 0);
});

const beats = { firstNoteX: 21.875, lastNoteX: 1798.125, lastBeatXs: [48.125, 98.125] };
const thai = { width: 1820, height: 42 };
const west = { width: 2000, height: 112 };

test('placeScore shifts the Thai strip right when the clef needs room', () => {
  const p = placeScore({ thai, west, bars: [100, 150, 200, 250], beats });
  assert.equal(p.scale, 1);
  assert.equal(p.thaiX, 56.25);
  assert.equal(p.westX, 0);
  assert.equal(p.westY, 50);
  assert.equal(p.width, 2000);
  assert.equal(p.height, 162);
  assert.equal(p.firstNoteX, 78.125);
  assert.equal(p.lastNoteX, 1854.375);
  assert.equal(p.endX, 1866.25);
});

test('placeScore shifts the staff right when the Thai strip starts later', () => {
  const p = placeScore({ thai, west, bars: [20, 70, 120, 170], beats });
  assert.equal(p.thaiX, 0);
  assert.equal(p.westX, 23.75);
  assert.equal(p.endX, 1810);
});

test('placeScore scales the staff to 50 px per measure', () => {
  const p = placeScore({ thai, west, bars: [0, 100, 200, 300], beats });
  assert.equal(p.scale, 0.5);
  assert.equal(p.westX, 43.75);
});

test('scoreSvg nests both SVGs without XML declarations', () => {
  const p = { thaiX: 5, westX: 0, westY: 50, scale: 0.5, width: 100, height: 60 };
  const svg = scoreSvg('<?xml version="1.0"?>\n<svg id="t"></svg>', '<svg id="w"></svg>', p);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="100" height="60" viewBox="0 0 100 60">/);
  assert.match(svg, /<g transform="translate\(5.00 0\)"><svg id="t"><\/svg><\/g>/);
  assert.match(svg, /<g transform="translate\(0.00 50\) scale\(0.50000\)"><svg id="w"><\/svg><\/g>/);
  assert.doesNotMatch(svg, /<\?xml/);
});
