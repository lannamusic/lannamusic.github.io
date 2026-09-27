import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../sync.js', import.meta.url), 'utf8');
const px = (s) => parseFloat(/translateX\((-?[\d.]+)px\)/.exec(s)[1]);

// A fake page: one .lanna-score per entry, each with its YouTube iframe.
function page(blocks, { view = 724.8, previousReady = null, ytLoaded = false } = {}) {
  let frame = null;
  const el = () => ({ style: {}, dataset: {}, children: [], appendChild(c) { this.children.push(c); } });
  const iframes = blocks.map((b) => ({ src: `https://www.youtube.com/embed/${b.id}` }));
  const scores = blocks.map((b) => {
    const svg = { ...el(), getAttribute: (n) => (n === 'width' ? String(b.width) : null) };
    const block = { ...el(), svg, querySelector: () => svg, getBoundingClientRect: () => ({ width: view }) };
    block.dataset = { youtubeId: b.id, sync: JSON.stringify(b.sync), endX: String(b.endX) };
    return block;
  });
  const head = el();
  const time = {};
  const players = [];
  const win = {
    document: {
      querySelectorAll: (sel) => (sel === '.lanna-score' ? scores : sel === 'iframe' ? iframes : []),
      createElement: el,
      head,
    },
    location: { href: 'https://lannamusic.github.io/song/', origin: 'https://lannamusic.github.io' },
    requestAnimationFrame: (f) => { frame = f; },
    console: { error() {} },
    URL,
    onYouTubeIframeAPIReady: previousReady,
  };
  win.window = win;
  const YT = { Player: function (iframe) { players.push(this); this.getCurrentTime = () => time[iframe.src.split('/embed/')[1].split('?')[0]] ?? 0; } };
  if (ytLoaded) win.YT = YT;
  new Function('window', 'document', 'location', 'requestAnimationFrame', 'console', 'URL', code)(win, win.document, win.location, win.requestAnimationFrame, win.console, URL);
  return {
    win, scores, iframes, head, players,
    apiReady() { win.YT = YT; win.onYouTubeIframeAPIReady(); },
    at(id, t) { time[id] = t; frame(); },
    sheet: (i) => px(scores[i].svg.style.transform),
    marker: (i) => px(scores[i].children[0].style.transform),
  };
}

const soi = { id: 'eOlYKeouRKk', sync: [{ time: 2.5, x: 22 }, { time: 233, x: 6880 }], endX: 7044, width: 7057 };

test('loads the IFrame API and enables the JS API on the iframe', () => {
  const p = page([soi]);
  assert.equal(p.head.children[0].src, 'https://www.youtube.com/iframe_api');
  assert.match(p.iframes[0].src, /enablejsapi=1/);
  assert.match(p.iframes[0].src, /origin=https%3A%2F%2Flannamusic.github.io/);
});

test('matches soi-wiang-ping: travel, settle at 33%, stop at the end', () => {
  const p = page([soi]);
  p.apiReady();
  p.at(soi.id, 0);
  assert.equal(p.sheet(0), 0);
  assert.ok(Math.abs(p.marker(0) - -52.37) < 0.05);
  p.at(soi.id, 60);
  assert.ok(Math.abs(p.marker(0) - 724.8 * 0.33) < 0.01);
  p.at(soi.id, 245);
  assert.ok(Math.abs(p.sheet(0) - (724.8 - 7057)) < 0.01);
  assert.ok(Math.abs(p.marker(0) - p.sheet(0) - (7044 - 20)) < 0.01);
});

test('two scores on one page follow their own videos', () => {
  const other = { id: 'ZVKVTwd3LtI', sync: [{ time: 0, x: 20 }, { time: 100, x: 2020 }], endX: 2030, width: 2040 };
  const p = page([soi, other]);
  p.apiReady();
  p.at(other.id, 50);
  assert.equal(p.players.length, 2);
  assert.ok(Math.abs(p.marker(1) - 724.8 * 0.33) < 0.01);
  assert.equal(p.sheet(0), 0);
});

test('keeps an earlier onYouTubeIframeAPIReady working', () => {
  let called = false;
  const p = page([soi], { previousReady: () => { called = true; } });
  p.apiReady();
  assert.equal(called, true);
});

test('starts at once when the API is already loaded', () => {
  const p = page([soi], { ytLoaded: true });
  assert.equal(p.head.children.length, 0);
  assert.equal(p.players.length, 1);
});

test('a score narrower than the view stays at the left edge', () => {
  const short = { id: 'Y5-9IWM8X5o', sync: [{ time: 0, x: 20 }, { time: 10, x: 120 }], endX: 130, width: 140 };
  const p = page([short]);
  p.apiReady();
  p.at(short.id, 5);
  assert.equal(p.sheet(0), 0);
  assert.equal(p.marker(0), 70);
});
