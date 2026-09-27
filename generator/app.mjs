// Wires the page: photo → grid → preview → snippet.
import { parseGrid, repeatMeasures } from './cells.mjs';
import { buildTxml, TUNINGS } from './txml.mjs';
import { warp, inkMask, findTable } from './image.mjs';
import { youtubeId, parseTime, snippet } from './output.mjs';

const $ = (id) => document.getElementById(id);
const COLS = 8;
const RECTIFIED_WIDTH = 1800;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const emptyLine = () => Array(COLS).fill('');
const state = { lines: [emptyLine(), emptyLine(), emptyLine()], unsure: [], image: null, quad: null, render: null, swept: false };

function status(id, text, isError = false) {
  $(id).textContent = text;
  $(id).classList.toggle('error', isError);
}
const title = () => 'เพลง' + $('title').value.trim();
const times = () => clamp(parseInt($('times').value, 10) || 1, 1, 20);

// ---------- step 1: photo ----------
const canvas = $('photo');
const handles = [...$('stage').querySelectorAll('.handle')];

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return status('read-status', 'ไฟล์นี้ไม่ใช่รูปภาพ', true);
  const img = new Image();
  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const g = canvas.getContext('2d');
    g.drawImage(img, 0, 0);
    state.image = g.getImageData(0, 0, canvas.width, canvas.height);
    const w = canvas.width, h = canvas.height;
    state.quad = [[w * 0.1, h * 0.1], [w * 0.9, h * 0.1], [w * 0.9, h * 0.9], [w * 0.1, h * 0.9]];
    $('drop-empty').hidden = true;
    $('stage').hidden = false;
    $('read').disabled = false;
    status('read-status', '');
    placeHandles();
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => status('read-status', 'เปิดรูปนี้ไม่ได้', true);
  img.src = URL.createObjectURL(file);
}

function placeHandles() {
  handles.forEach((h, i) => {
    const [x, y] = state.quad[i];
    h.style.left = `${(x / canvas.width) * 100}%`;
    h.style.top = `${(y / canvas.height) * 100}%`;
  });
}

handles.forEach((h, i) => {
  h.addEventListener('pointerdown', (e) => h.setPointerCapture(e.pointerId));
  h.addEventListener('pointermove', (e) => {
    if (!h.hasPointerCapture(e.pointerId)) return;
    const r = canvas.getBoundingClientRect();
    state.quad[i] = [clamp((e.clientX - r.left) / r.width, 0, 1) * canvas.width, clamp((e.clientY - r.top) / r.height, 0, 1) * canvas.height];
    placeHandles();
  });
  h.addEventListener('keydown', (e) => {
    const step = ((e.shiftKey ? 20 : 4) * canvas.width) / canvas.getBoundingClientRect().width;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const [x, y] = state.quad[i];
    state.quad[i] = [clamp(x + d[0], 0, canvas.width), clamp(y + d[1], 0, canvas.height)];
    placeHandles();
  });
});

$('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); loadFile(e.dataTransfer.files[0]); });

$('read').addEventListener('click', async () => {
  const [tl, tr, br, bl] = state.quad;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const outW = RECTIFIED_WIDTH;
  const outH = Math.max(1, Math.round((outW * (dist(tl, bl) + dist(tr, br))) / (dist(tl, tr) + dist(bl, br))));
  const flat = warp(state.image, state.quad, outW, outH);
  const table = findTable(inkMask(flat), outW, outH);
  if (table.rows.length < 2 || table.cells.every((xs) => xs.length < 2)) {
    return status('read-status', 'หาตารางโน้ตไม่พบ ลองขยับมุมทั้งสี่ให้ตรงขอบตาราง', true);
  }
  const rectified = document.createElement('canvas');
  rectified.width = outW;
  rectified.height = outH;
  rectified.getContext('2d').putImageData(new ImageData(flat.data, outW, outH), 0, 0);
  $('read').disabled = true;
  try {
    status('read-status', 'กำลังโหลดข้อมูลภาษาไทย…');
    const { readCells } = await import('./ocr.mjs');
    const lines = await readCells(rectified, table, (done, total) => status('read-status', `กำลังอ่าน ${done}/${total} ห้อง`));
    state.lines = lines.map((l) => [...l.map((c) => c.text), ...Array(Math.max(0, COLS - l.length)).fill('')]);
    state.unsure = lines.map((l) => l.map((c) => c.unsure));
    const n = state.unsure.flat().filter(Boolean).length;
    status('read-status', n ? `อ่านแล้ว ตรวจช่องสีทอง ${n} ช่อง` : 'อ่านแล้ว ตรวจทานกับภาพอีกครั้ง');
    drawGrid();
    changed();
  } catch (err) {
    console.error(err);
    status('read-status', 'โหลดข้อมูลภาษาไทยสำหรับอ่านโน้ตไม่สำเร็จ กด “อ่านโน้ต” เพื่อลองใหม่ หรือพิมพ์โน้ตเองได้เลย', true);
  } finally {
    $('read').disabled = false;
  }
});

// ---------- step 2: grid ----------
function drawGrid() {
  const body = $('grid').tBodies[0];
  body.replaceChildren();
  state.lines.forEach((line, li) => {
    const tr = body.insertRow();
    const no = tr.insertCell();
    no.className = 'line-no';
    no.textContent = li + 1;
    line.forEach((text, ci) => {
      const td = tr.insertCell();
      td.classList.toggle('unsure', Boolean(state.unsure[li]?.[ci]));
      const input = document.createElement('input');
      input.value = text;
      input.dataset.line = li;
      input.dataset.cell = ci;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('aria-label', `บรรทัด ${li + 1} ห้อง ${ci + 1}`);
      td.append(input);
    });
  });
}

const cellInput = (li, ci) => $('grid').querySelector(`input[data-line="${li}"][data-cell="${ci}"]`);

$('grid').addEventListener('input', (e) => {
  const li = +e.target.dataset.line, ci = +e.target.dataset.cell;
  state.lines[li][ci] = e.target.value;
  if (state.unsure[li]) state.unsure[li][ci] = false;
  e.target.parentElement.classList.remove('unsure');
  changed();
});
$('grid').addEventListener('focusin', (e) => { if (e.target.tagName === 'INPUT') e.target.select(); });
$('grid').addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.tagName !== 'INPUT') return;
  let li = +t.dataset.line, ci = +t.dataset.cell;
  const atStart = t.selectionStart === 0 && t.selectionEnd === 0;
  const atEnd = t.selectionStart === t.value.length;
  if (e.key === 'ArrowUp') li--;
  else if (e.key === 'ArrowDown') li++;
  else if (e.key === 'Enter') { ci++; if (ci >= state.lines[li].length) { ci = 0; li++; } }
  else if (e.key === 'ArrowLeft' && atStart) ci--;
  else if (e.key === 'ArrowRight' && atEnd) ci++;
  else return;
  const next = cellInput(li, ci);
  if (next) { e.preventDefault(); next.focus(); }
});
$('add-line').addEventListener('click', () => {
  state.lines.push(emptyLine());
  drawGrid();
  changed();
  cellInput(state.lines.length - 1, 0).focus();
});

// ---------- step 3: preview and output ----------
const PLACEHOLDER = '<p class="help">พิมพ์โน้ตหรืออ่านจากภาพ แล้วตัวอย่างจะขึ้นที่นี่</p>';
let renderTimer = null;
let renderToken = 0;

function changed() {
  const { measures, errors } = parseGrid(state.lines);
  $('grid').querySelectorAll('td.invalid').forEach((td) => td.classList.remove('invalid'));
  for (const err of errors) cellInput(err.line, err.cell)?.parentElement.classList.add('invalid');
  const first = errors[0];
  status('grid-errors', first ? `ยังมี ${errors.length} ห้องที่ต้องแก้ เช่น บรรทัด ${first.line + 1} ห้อง ${first.cell + 1}: ${first.message}` : '', true);
  clearTimeout(renderTimer);
  if (errors.length || !measures.length) {
    renderToken++;
    state.render = null;
    $('preview').innerHTML = PLACEHOLDER;
    $('scrub').disabled = true;
    updateActions();
    return;
  }
  renderTimer = setTimeout(() => renderPreview(measures), 600);
}

async function renderPreview(measures) {
  const token = ++renderToken;
  const all = repeatMeasures(measures, times());
  const txml = buildTxml({ title: title(), tuning: $('tuning').value, measures: all });
  status('out-status', 'กำลังสร้างตัวอย่าง…');
  try {
    const { renderScore } = await import('./render.mjs');
    const result = await renderScore(txml, all.length);
    if (token !== renderToken) return;
    state.render = result;
    showPreview(result);
    status('out-status', result.spread > 0.01 ? 'ความกว้างห้องของโน้ตสากลไม่เท่ากัน ตัวชี้อาจคลาดเล็กน้อย' : '');
  } catch (err) {
    console.error(err);
    if (token === renderToken) status('out-status', 'สร้างตัวอย่างไม่สำเร็จ ลองรีเฟรชหน้าเว็บ', true);
  }
  updateActions();
}

function showPreview({ svg }) {
  const box = $('preview');
  box.innerHTML = svg;
  const marker = document.createElement('div');
  marker.className = 'marker';
  box.append(marker);
  $('scrub').disabled = false;
  scrubTo(+$('scrub').value);
  if (!state.swept && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    state.swept = true;
    sweep();
  }
}

// Same rule as sync.js: travel until 33%, then scroll; never past the end.
function scrubTo(v) {
  const r = state.render;
  if (!r) return;
  const box = $('preview');
  const view = box.getBoundingClientRect().width;
  const { firstNoteX, endX, width } = r.geo;
  const x = firstNoteX + ((endX - 20 - firstNoteX) * v) / 1000;
  const shift = Math.max(Math.min(0, view - width), Math.min(0, view * 0.33 - x));
  box.querySelector('svg').style.transform = `translateX(${shift}px)`;
  box.querySelector('.marker').style.transform = `translateX(${x + shift}px)`;
}
$('scrub').addEventListener('input', (e) => scrubTo(+e.target.value));

function sweep() {
  const t0 = performance.now();
  const step = (now) => {
    const v = Math.min(1000, ((now - t0) / 2500) * 1000);
    $('scrub').value = v;
    scrubTo(v);
    if (v < 1000) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function updateActions() {
  $('copy').disabled = !state.render;
  $('download').disabled = !state.render;
}

function syncInputs() {
  const id = youtubeId($('video').value);
  const t1 = parseTime($('t-first').value);
  const t2 = parseTime($('t-last').value);
  if (!id) return { error: 'ใส่ลิงก์ YouTube ให้ถูกต้อง' };
  if (t1 === null || t2 === null) return { error: 'ใส่เวลาเป็น นาที:วินาที เช่น 0:02.5' };
  if (t2 <= t1) return { error: 'เวลาโน้ตตัวสุดท้ายต้องมากกว่าตัวแรก' };
  return { id, t1, t2 };
}

$('copy').addEventListener('click', async () => {
  const s = syncInputs();
  if (s.error) return status('out-status', s.error, true);
  const { svg, geo } = state.render;
  const script = await (await fetch(new URL('./sync.js', import.meta.url))).text();
  const text = snippet({ svg, videoId: s.id, sync: [{ time: s.t1, x: geo.firstNoteX }, { time: s.t2, x: geo.lastNoteX }], endX: geo.endX, script: script.trim() });
  try {
    await navigator.clipboard.writeText(text);
    status('out-status', 'คัดลอกแล้ว นำไปวางใต้วิดีโอในโพสต์ Publii');
  } catch {
    status('out-status', 'คัดลอกไม่ได้ เบราว์เซอร์ไม่อนุญาต', true);
  }
});

$('download').addEventListener('click', () => {
  const { measures } = parseGrid(state.lines);
  const xml = buildTxml({ title: title(), tuning: $('tuning').value, measures: repeatMeasures(measures, times()), perLine: 8 });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
  a.download = `${title()}.txml`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

for (const t of TUNINGS) $('tuning').add(new Option(t.label, t.value));
for (const id of ['times', 'tuning', 'title']) $(id).addEventListener('change', changed);
drawGrid();
changed();
