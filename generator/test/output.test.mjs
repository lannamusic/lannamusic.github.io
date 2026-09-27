import { test } from 'node:test';
import assert from 'node:assert/strict';
import { youtubeId, parseTime, snippet } from '../output.mjs';

test('youtubeId accepts the usual link shapes and a bare ID', () => {
  for (const s of [
    'https://www.youtube.com/watch?v=eOlYKeouRKk',
    'https://www.youtube.com/watch?feature=share&v=eOlYKeouRKk&t=10',
    'https://youtu.be/eOlYKeouRKk?si=abc',
    'https://www.youtube.com/embed/eOlYKeouRKk',
    'https://www.youtube.com/shorts/eOlYKeouRKk',
    ' eOlYKeouRKk ',
  ]) assert.equal(youtubeId(s), 'eOlYKeouRKk', s);
  assert.equal(youtubeId('https://example.com/watch?v=eOlYKeouRKk'), null);
  assert.equal(youtubeId('nope'), null);
});

test('parseTime reads m:ss(.s) and plain seconds', () => {
  assert.equal(parseTime('0:02.5'), 2.5);
  assert.equal(parseTime('3:53'), 233);
  assert.equal(parseTime('233'), 233);
  assert.equal(parseTime('1:75'), null);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('abc'), null);
});

test('snippet: wrapper with data attributes, the SVG, and the script', () => {
  const out = snippet({ svg: '<svg width="10"></svg>', videoId: 'eOlYKeouRKk', sync: [{ time: 2.5, x: 22 }, { time: 233, x: 6880 }], endX: 7044.04, script: '/*sync*/' });
  assert.match(out, /^<div class="lanna-score" data-youtube-id="eOlYKeouRKk" data-sync="\[\{&quot;time&quot;:2.5,&quot;x&quot;:22\},\{&quot;time&quot;:233,&quot;x&quot;:6880\}\]" data-end-x="7044.0">/);
  assert.match(out, /<svg width="10"><\/svg>\n<\/div>\n<script>\n\/\*sync\*\/\n<\/script>\n$/);
});
