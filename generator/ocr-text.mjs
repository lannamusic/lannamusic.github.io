// Turn Tesseract's symbols for one cell into a 4-beat cell string.

const NOTES = 'ดรมฟซลท';
// The notation book's typeface draws ด and ซ close to ค and ช.
const LOOKALIKE = { ค: 'ด', ฅ: 'ด', ช: 'ซ', ฃ: 'ซ' };
const MARKS = new Set(['่', '้', '๊', '๋', 'ํ', "'", '`']);
const RESTS = new Set(['_', '-', '–', '—']);
const LOW_CONFIDENCE = 60;

export function symbolToToken(text) {
  let base = null;
  let up = false;
  let rest = false;
  for (const raw of text) {
    const ch = LOOKALIKE[raw] ?? raw;
    if (NOTES.includes(ch)) base ??= ch;
    else if (MARKS.has(ch)) up = true;
    else if (RESTS.has(ch)) rest = true;
  }
  if (base) return base + (up ? 'ํ' : '');
  if (rest) return '_';
  return up ? 'MARK' : null;
}

export function placeInSlots(symbols, cellWidth) {
  const tokens = [];
  for (const sym of [...symbols].sort((a, b) => a.x0 - b.x0)) {
    const t = symbolToToken(sym.text);
    if (t === null) continue;
    if (t === 'MARK') {
      const last = tokens.at(-1);
      if (last && last.t !== '_' && !last.t.endsWith('ํ')) last.t += 'ํ';
      continue;
    }
    tokens.push({ t, cx: (sym.x0 + sym.x1) / 2, confidence: sym.confidence });
  }
  const lowConfidence = tokens.some((t) => t.confidence < LOW_CONFIDENCE);
  if (tokens.length === 4) return { text: tokens.map((t) => t.t).join(''), unsure: lowConfidence };
  // Otherwise place notes by position; empty slots are rests.
  const slots = ['_', '_', '_', '_'];
  for (const tk of tokens) {
    if (tk.t === '_') continue;
    slots[Math.max(0, Math.min(3, Math.floor((tk.cx / cellWidth) * 4)))] = tk.t;
  }
  return { text: slots.join(''), unsure: true };
}
