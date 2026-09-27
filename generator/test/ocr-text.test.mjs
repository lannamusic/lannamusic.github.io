import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symbolToToken, placeInSlots } from '../ocr-text.mjs';

test('the book typeface: ค reads as ด, ช as ซ', () => {
  assert.equal(symbolToToken('ค'), 'ด');
  assert.equal(symbolToToken('ช'), 'ซ');
});
test('a tone mark or nikhahit on a note is octave up', () => {
  assert.equal(symbolToToken('ด่'), 'ดํ');
  assert.equal(symbolToToken('คํ'), 'ดํ');
});
test('rests, lone marks and noise', () => {
  assert.equal(symbolToToken('_'), '_');
  assert.equal(symbolToToken('-'), '_');
  assert.equal(symbolToToken('่'), 'MARK');
  assert.equal(symbolToToken('x'), null);
});

const s = (text, x0, x1, confidence = 90) => ({ text, x0, x1, confidence });

test('four tokens are read in order', () => {
  assert.deepEqual(placeInSlots([s('ม', 12, 20), s('ซ', 2, 10), s('ซ', 22, 30), s('ช', 32, 40)], 40), { text: 'ซมซซ', unsure: false });
});
test('rests read as characters count as tokens', () => {
  assert.deepEqual(placeInSlots([s('_', 2, 10), s('ซ', 12, 20), s('_', 22, 30), s('ล', 32, 40)], 40), { text: '_ซ_ล', unsure: false });
});
test('a separate mark attaches to the note before it', () => {
  assert.deepEqual(placeInSlots([s('_', 2, 10), s('_', 12, 20), s('ค', 22, 29), s('่', 28, 30), s('ซ', 32, 40)], 40), { text: '__ดํซ', unsure: false });
});
test('missing rests are filled by position, and the cell is marked unsure', () => {
  assert.deepEqual(placeInSlots([s('ซ', 12, 18), s('ล', 32, 38)], 40), { text: '_ซ_ล', unsure: true });
});
test('low confidence marks the cell unsure', () => {
  assert.equal(placeInSlots([s('ซ', 2, 10, 40), s('ม', 12, 20), s('ซ', 22, 30), s('ซ', 32, 40)], 40).unsure, true);
});
test('an empty cell becomes four rests, unsure', () => {
  assert.deepEqual(placeInSlots([], 40), { text: '____', unsure: true });
});
