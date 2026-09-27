// The grid as a ThaiMusicXML 1.0 document: one melody part, one section.

export const TUNINGS = [
  { value: 'c-major', label: 'ด = C' },
  { value: 'bb-major', label: 'ด = B♭' },
  { value: 'khrueang-sai', label: 'เครื่องสาย' },
  { value: 'pi-phat-mai-khaeng', label: 'ปี่พาทย์ไม้แข็ง' },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const beat = (b) => (b.rest ? '<rest/>' : `<note pitch="${b.pitch}"/>`);

export function buildTxml({ title, tuning = 'c-major', measures, perLine = Infinity }) {
  const lines = [];
  for (let i = 0; i < measures.length; i += Math.min(perLine, measures.length)) lines.push(measures.slice(i, i + perLine));
  const body = lines
    .map((line, li) => {
      const ms = line.map((m, mi) => `        <measure number="${mi + 1}">${m.map(beat).join('')}</measure>`).join('\n');
      return `      <line number="${li + 1}">\n${ms}\n      </line>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<thai-score xmlns="https://thaimusicxml.anan.ovh/ns/1" version="1.0">
  <header>
    <title>${esc(title)}</title>
    <tuning reference="${esc(tuning)}"/>
  </header>
  <structure>
    <section id="s1"/>
  </structure>
  <ensemble>
    <part id="melody">
      <instrument-name>ทำนอง</instrument-name>
    </part>
  </ensemble>
  <part-data part="melody">
    <section-ref section="s1">
${body}
    </section-ref>
  </part-data>
</thai-score>
`;
}
