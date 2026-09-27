// One cell of the notation book = one measure of 4 beats, typed the way the
// book prints it: notes ด ร ม ฟ ซ ล ท, "_" (or "-") for a beat with no new
// stroke, and an octave mark after the note it changes.

export const BEATS_PER_MEASURE = 4;
const NOTES = 'ดรมฟซลท';
const RESTS = new Set(['_', '-']);
const UP = new Set(['ํ', '่', "'"]); // nikhahit; the book's tick; apostrophe
const DOWN = new Set(['ฺ', ',']); // pinthu; comma
const NIKHAHIT = 'ํ';
const PINTHU = 'ฺ';
const MARK_ERROR = 'เครื่องหมายเสียงสูง/ต่ำต้องตามหลังโน้ต';

export function parseCell(text) {
  const beats = [];
  for (const ch of text.replace(/\s+/g, '')) {
    if (RESTS.has(ch)) beats.push({ rest: true });
    else if (NOTES.includes(ch)) beats.push({ pitch: ch });
    else if (UP.has(ch) || DOWN.has(ch)) {
      const last = beats.at(-1);
      if (!last || last.rest || last.pitch.length > 1) return { beats, error: MARK_ERROR };
      last.pitch += UP.has(ch) ? NIKHAHIT : PINTHU;
    } else return { beats, error: `ไม่รู้จักตัวอักษร “${ch}”` };
  }
  if (beats.length !== BEATS_PER_MEASURE) return { beats, error: `ห้องนี้มี ${beats.length} จังหวะ ต้องมี ${BEATS_PER_MEASURE}` };
  return { beats, error: null };
}

export function formatBeats(beats) {
  return beats.map((b) => (b.rest ? '_' : b.pitch)).join('');
}

/** lines: cell texts per line. Empty cells after a line's last filled cell are not measures. */
export function parseGrid(lines) {
  const measures = [];
  const errors = [];
  lines.forEach((cells, line) => {
    const last = cells.reduce((k, c, i) => (c.trim() ? i : k), -1);
    for (let cell = 0; cell <= last; cell++) {
      if (!cells[cell].trim()) {
        errors.push({ line, cell, message: 'ช่องว่างอยู่กลางบรรทัด' });
        continue;
      }
      const { beats, error } = parseCell(cells[cell]);
      if (error) errors.push({ line, cell, message: error });
      else measures.push(beats);
    }
  });
  return { measures, errors };
}

export function repeatMeasures(measures, times) {
  return Array.from({ length: times }, () => measures).flat();
}
