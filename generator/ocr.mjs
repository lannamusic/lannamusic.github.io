// Read each table cell with Tesseract (Thai, single-line mode).
import Tesseract from 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';
import { placeInSlots } from './ocr-text.mjs';

const UPSCALE = 2;
const BORDER = 30;
const PAD = 4;
let workerPromise = null;

function worker() {
  workerPromise ??= (async () => {
    const w = await Tesseract.createWorker('tha');
    await w.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: 'ดรมฟซลทคช่ํ_-' });
    return w;
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

export async function readCells(canvas, table, onProgress = () => {}) {
  const w = await worker();
  const total = table.cells.reduce((n, xs) => n + xs.length - 1, 0);
  let done = 0;
  const lines = [];
  for (let r = 0; r < table.rows.length - 1; r++) {
    const y0 = table.rows[r] + PAD;
    const ch = Math.max(1, Math.round(table.rows[r + 1] - table.rows[r] - 2 * PAD));
    const xs = table.cells[r];
    const line = [];
    for (let c = 0; c < xs.length - 1; c++) {
      const x0 = xs[c] + PAD;
      const cw = Math.max(1, Math.round(xs[c + 1] - xs[c] - 2 * PAD));
      const cell = document.createElement('canvas');
      cell.width = cw * UPSCALE + 2 * BORDER;
      cell.height = ch * UPSCALE + 2 * BORDER;
      const g = cell.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, cell.width, cell.height);
      g.filter = 'grayscale(1) contrast(2)';
      g.drawImage(canvas, x0, y0, cw, ch, BORDER, BORDER, cw * UPSCALE, ch * UPSCALE);
      const { data } = await w.recognize(cell, {}, { blocks: true });
      const symbols = (data.blocks ?? [])
        .flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words.flatMap((wd) => wd.symbols))))
        .map((s) => ({ text: s.text, x0: (s.bbox.x0 - BORDER) / UPSCALE, x1: (s.bbox.x1 - BORDER) / UPSCALE, confidence: s.confidence }));
      line.push(placeInSlots(symbols, cw));
      onProgress(++done, total);
    }
    lines.push(line);
  }
  return lines;
}
