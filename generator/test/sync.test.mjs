import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../sync.js', import.meta.url), 'utf8');
const px = (s) => parseFloat(/translateX\((-?[\d.]+)px\)/.exec(s)[1]);

// A fake page. Each run() is one pasted <script> executing; add() is one
// pasted .lanna-score block (with its YouTube iframe) appearing in the page.
function page({ view = 724.8, previousReady = null, ytLoaded = false } = {}) {
  let frames = [];
  const el = () => ({ style: {}, dataset: {}, children: [], appendChild(c) { this.children.push(c); } });
  const iframes = [];
  const scores = [];
  const head = el();
  const time = {};
  const players = [];
  const win = {
    document: {
      querySelectorAll: (sel) => (sel === '.lanna-score' ? [...scores] : sel === 'iframe' ? [...iframes] : []),
      querySelector: (sel) => (sel.includes('iframe_api') ? head.children.find((c) => c.src?.includes('iframe_api')) ?? null : null),
      createElement: el,
      head,
    },
    location: { href: 'https://lannamusic.github.io/song/', origin: 'https://lannamusic.github.io' },
    requestAnimationFrame: (f) => { frames.push(f); },
    console: { error() {} },
    URL,
    onYouTubeIframeAPIReady: previousReady,
  };
  win.window = win;
  const YT = { loaded: 1, Player: function (iframe) { players.push({ player: this, iframe }); this.getCurrentTime = () => time[iframe.src.split('/embed/')[1].split('?')[0]] ?? 0; } };
  if (ytLoaded) win.YT = YT;
  const p = {
    win, scores, iframes, head, players,
    add(b) {
      iframes.push({ src: `https://www.youtube.com/embed/${b.id}` });
      const svg = { ...el(), getAttribute: (n) => (n === 'width' ? String(b.width) : null) };
      const block = { ...el(), svg, querySelector: () => svg, getBoundingClientRect: () => ({ width: view }) };
      block.dataset = { youtubeId: b.id, sync: JSON.stringify(b.sync), endX: String(b.endX) };
      scores.push(block);
      return p;
    },
    run() {
      new Function('window', 'document', 'location', 'requestAnimationFrame', 'console', 'URL', code)(win, win.document, win.location, win.requestAnimationFrame, win.console, URL);
      return p;
    },
    // The IFrame API finished loading (it sets YT and calls whatever handler is current).
    apiReady() { win.YT = YT; if (typeof win.onYouTubeIframeAPIReady === 'function') win.onYouTubeIframeAPIReady(); return p; },
    // One animation frame: run every loop that asked for one.
    tick() { const due = frames; frames = []; due.forEach((f) => f()); return p; },
    at(id, t) { time[id] = t; return p.tick(); },
    loops: () => frames.length,
    sheet: (i) => px(scores[i].svg.style.transform),
    marker: (i) => px(scores[i].children[0].style.transform),
  };
  return p;
}

const soi = { id: 'eOlYKeouRKk', sync: [{ time: 2.5, x: 22 }, { time: 233, x: 6880 }], endX: 7044, width: 7057 };
const other = { id: 'ZVKVTwd3LtI', sync: [{ time: 0, x: 20 }, { time: 100, x: 2020 }], endX: 2030, width: 2040 };

test('loads the IFrame API and enables the JS API on the iframe', () => {
  const p = page().add(soi).run();
  assert.equal(p.head.children[0].src, 'https://www.youtube.com/iframe_api');
  assert.match(p.iframes[0].src, /enablejsapi=1/);
  assert.match(p.iframes[0].src, /origin=https%3A%2F%2Flannamusic.github.io/);
});

test('matches soi-wiang-ping: travel, settle at 33%, stop at the end', () => {
  const p = page().add(soi).run().apiReady();
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
  const p = page().add(soi).add(other).run().apiReady();
  p.at(other.id, 50);
  assert.equal(p.players.length, 2);
  assert.ok(Math.abs(p.marker(1) - 724.8 * 0.33) < 0.01);
  assert.equal(p.sheet(0), 0);
});

test('two pasted snippets: the second script does not redo the first score', () => {
  const p = page().add(soi).run().add(other).run();
  p.apiReady().tick();
  assert.equal(p.scores[0].children.length, 1, 'one marker on the first score');
  assert.equal(p.scores[1].children.length, 1);
  assert.equal(p.players.length, 2, 'one player per video');
  assert.equal(p.head.children.length, 1, 'the API script is loaded once');
  assert.equal(p.loops(), 1, 'one shared animation loop');
});

test('leaves an existing onYouTubeIframeAPIReady alone', () => {
  const previous = () => {};
  const p = page({ previousReady: previous }).add(soi).run();
  assert.equal(p.win.onYouTubeIframeAPIReady, previous);
});

test('still starts when a later script replaces onYouTubeIframeAPIReady without chaining', () => {
  const p = page().add(soi).run();
  p.win.onYouTubeIframeAPIReady = () => {}; // like the old soi-wiang-ping script
  p.apiReady().at(soi.id, 60);
  assert.equal(p.players.length, 1);
  assert.ok(Math.abs(p.marker(0) - 724.8 * 0.33) < 0.01);
});

test('starts at once when the API is already loaded', () => {
  const p = page({ ytLoaded: true }).add(soi).run().tick();
  assert.equal(p.head.children.length, 0);
  assert.equal(p.players.length, 1);
});

test('a score narrower than the view stays at the left edge', () => {
  const short = { id: 'Y5-9IWM8X5o', sync: [{ time: 0, x: 20 }, { time: 10, x: 120 }], endX: 130, width: 140 };
  const p = page().add(short).run().apiReady();
  p.at(short.id, 5);
  assert.equal(p.sheet(0), 0);
  assert.equal(p.marker(0), 70);
});
