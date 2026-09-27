import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTxml, TUNINGS } from '../txml.mjs';
import { parseCell } from '../cells.mjs';

const m = (t) => parseCell(t).beats;

test('writes notes, rests and octave marks', () => {
  const xml = buildTxml({ title: 'เพลงน้อยใจยา', measures: [m('_ซ_ดํ')] });
  assert.match(xml, /<measure number="1"><rest\/><note pitch="ซ"\/><rest\/><note pitch="ดํ"\/><\/measure>/);
  assert.match(xml, /<title>เพลงน้อยใจยา<\/title>/);
  assert.match(xml, /<tuning reference="c-major"\/>/);
  assert.match(xml, /<part id="melody">/);
  assert.match(xml, /<section-ref section="s1">/);
});

test('one line by default, numbering from 1', () => {
  const xml = buildTxml({ title: 't', measures: Array(10).fill(m('ซมซซ')) });
  assert.equal(xml.match(/<line /g).length, 1);
  assert.match(xml, /<measure number="10">/);
});

test('perLine 8 splits lines and restarts measure numbers', () => {
  const xml = buildTxml({ title: 't', measures: Array(10).fill(m('ซมซซ')), perLine: 8 });
  assert.equal(xml.match(/<line /g).length, 2);
  assert.match(xml, /<line number="2">\s*<measure number="1">/);
  assert.doesNotMatch(xml, /<measure number="9">/);
});

test('escapes the title and passes the tuning through', () => {
  const xml = buildTxml({ title: 'a<b & "c"', tuning: 'bb-major', measures: [m('ซมซซ')] });
  assert.match(xml, /<title>a&lt;b &amp; &quot;c&quot;<\/title>/);
  assert.match(xml, /<tuning reference="bb-major"\/>/);
});

test('offers the four spec tunings', () => {
  assert.deepEqual(TUNINGS.map((t) => t.value), ['c-major', 'bb-major', 'khrueang-sai', 'pi-phat-mai-khaeng']);
});
