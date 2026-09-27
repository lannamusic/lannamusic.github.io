import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCell, formatBeats, parseGrid, repeatMeasures } from '../cells.mjs';

const fmt = (t) => {
  const r = parseCell(t);
  return r.error ?? formatBeats(r.beats);
};

test('four notes', () => assert.equal(fmt('ซมซซ'), 'ซมซซ'));
test('rests as _ or -', () => {
  assert.equal(fmt('_ซ_ล'), '_ซ_ล');
  assert.equal(fmt('-ซ-ล'), '_ซ_ล');
});
test('octave up: ํ, the book\'s ่, or an apostrophe', () => {
  assert.equal(fmt('__ดํซ'), '__ดํซ');
  assert.equal(fmt('__ด่ซ'), '__ดํซ');
  assert.equal(fmt("__ด'ซ"), '__ดํซ');
});
test('octave down: ฺ or a comma', () => {
  assert.equal(fmt('ซฺ___'), 'ซฺ___');
  assert.equal(fmt('ซ,___'), 'ซฺ___');
});
test('spaces are ignored', () => assert.equal(fmt(' ซ ม ซ ซ '), 'ซมซซ'));
test('wrong beat count', () => assert.equal(fmt('ซมซ'), 'ห้องนี้มี 3 จังหวะ ต้องมี 4'));
test('unknown character', () => assert.equal(fmt('ซมxซ'), 'ไม่รู้จักตัวอักษร “x”'));
test('mark without a note', () => assert.equal(fmt('ํซมซ'), 'เครื่องหมายเสียงสูง/ต่ำต้องตามหลังโน้ต'));
test('two marks on one note', () => assert.equal(fmt('ซํํมซ'), 'เครื่องหมายเสียงสูง/ต่ำต้องตามหลังโน้ต'));

test('parseGrid: trailing empty cells and blank lines are not measures', () => {
  const { measures, errors } = parseGrid([
    ['ซมซซ', 'ซลซซ', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['รดรม', '', '', '', '', '', '', ''],
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(measures.map(formatBeats), ['ซมซซ', 'ซลซซ', 'รดรม']);
});

test('parseGrid: an empty cell before a filled one is an error', () => {
  const { errors } = parseGrid([['ซมซซ', '', 'ซลซซ', '', '', '', '', '']]);
  assert.deepEqual(errors, [{ line: 0, cell: 1, message: 'ช่องว่างอยู่กลางบรรทัด' }]);
});

test('parseGrid: reports each invalid cell with its position', () => {
  const { errors, measures } = parseGrid([['ซมซ', 'ซลซซ']]);
  assert.deepEqual(errors, [{ line: 0, cell: 0, message: 'ห้องนี้มี 3 จังหวะ ต้องมี 4' }]);
  assert.equal(measures.length, 1);
});

test('parseGrid: an empty grid has no measures and no errors', () => {
  assert.deepEqual(parseGrid([['', '']]), { measures: [], errors: [] });
});

test('repeatMeasures writes the tune out N times', () => {
  const { measures } = parseGrid([['ซมซซ', 'รดรม']]);
  assert.deepEqual(repeatMeasures(measures, 3).map(formatBeats), ['ซมซซ', 'รดรม', 'ซมซซ', 'รดรม', 'ซมซซ', 'รดรม']);
});
