// Geometry shared by the Thai strip and the Western staff. Both notations use
// one horizontal scale, so the playback marker can use one x for both.

export const MEASURE_WIDTH = 50;
export const MARGIN = 10;
// Half the distance between two beats in a 50 px cell (8.75 px apart).
export const BEAT_HALF = 4.375;
const PITCH = /[ดรมฟซลท]/;

/** Renderer options for one strip of n measures. */
export function thaiOptions(n) {
  return {
    measuresPerRow: n,
    page: { width: n * MEASURE_WIDTH + 2 * MARGIN, height: 200, marginSide: MARGIN, marginTop: MARGIN, marginBottom: MARGIN, infinite: true },
  };
}

/** Drop the title band from a layout() result and move the grid up to the top margin. */
export function withoutTitle(result) {
  const elements = result.pages[0].elements.filter(
    (e) => !(e.kind === 'text' && (e.role === 'title' || e.role === 'instrument-name')),
  );
  const top = Math.min(...elements.filter((e) => e.kind === 'line').map((e) => Math.min(e.y1, e.y2)));
  const dy = top - MARGIN;
  return {
    width: result.width,
    height: result.height - dy,
    elements: elements.map((e) => (e.kind === 'line' ? { ...e, y1: e.y1 - dy, y2: e.y2 - dy } : { ...e, y: e.y - dy })),
  };
}

/** Beat positions: 4 symbols per measure in x order; rests are "-". */
export function anchors(elements) {
  const beats = elements
    .filter((e) => e.kind === 'text' && e.role === 'symbol')
    .map((e) => ({ x: e.x, pitched: PITCH.test(e.text) }))
    .sort((a, b) => a.x - b.x);
  const notes = beats.filter((b) => b.pitched);
  return {
    firstNoteX: notes[0].x,
    lastNoteX: notes.at(-1).x,
    lastBeatXs: beats.filter((_, i) => i % 4 === 3).map((b) => b.x),
  };
}

const svgAttr = (svg, name) => parseFloat(new RegExp(`<svg[^>]*?\\s${name}="([\\d.]+)`).exec(svg)[1]);

export function verovioSize(svg) {
  return { width: svgAttr(svg, 'width'), height: svgAttr(svg, 'height') };
}

/** x (px) of each barline in a Verovio SVG, one per measure. */
export function verovioBarlines(svg) {
  const width = svgAttr(svg, 'width');
  const units = parseFloat(/class="definition-scale"[^>]*viewBox="0 0 ([\d.]+)/.exec(svg)[1]);
  return [...svg.matchAll(/class="barLine">\s*<path d="M([\d.]+) /g)].map((m) => (parseFloat(m[1]) * width) / units);
}

/** Spread of inner measure widths, as a fraction of the widest (the first and last measures hold the clef and the final bar). */
export function measureSpread(bars) {
  const widths = bars.slice(1).map((x, i) => x - bars[i]).slice(1, -1);
  if (!widths.length) return 0;
  return (Math.max(...widths) - Math.min(...widths)) / Math.max(...widths);
}

/**
 * Put the staff under the Thai strip. The converter shifts the music one beat
 * later (downbeatShift), so Western barline k falls just before the 4th beat
 * of Thai measure k. Whichever notation starts further left moves right.
 */
export function placeScore({ thai, west, bars, beats, gap = 8 }) {
  const inner = bars.slice(0, -1);
  const spacing = inner.length > 1 ? (inner.at(-1) - inner[0]) / (inner.length - 1) : MEASURE_WIDTH;
  const scale = MEASURE_WIDTH / spacing;
  const rawWestX = beats.lastBeatXs[0] - BEAT_HALF - scale * bars[0];
  const thaiX = Math.max(0, -rawWestX);
  const westX = Math.max(0, rawWestX);
  return {
    thaiX,
    westX,
    westY: thai.height + gap,
    scale,
    width: Math.ceil(Math.max(thaiX + thai.width, westX + west.width * scale)),
    height: Math.ceil(thai.height + gap + west.height * scale),
    firstNoteX: thaiX + beats.firstNoteX,
    lastNoteX: thaiX + beats.lastNoteX,
    endX: Math.max(thaiX + thai.width - MARGIN, westX + scale * bars.at(-1)),
  };
}

const stripDeclaration = (svg) => svg.replace(/^<\?xml[^>]*>\s*/, '');

export function scoreSvg(thaiSvg, westSvg, p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}" viewBox="0 0 ${p.width} ${p.height}">
<g transform="translate(${p.thaiX.toFixed(2)} 0)">${stripDeclaration(thaiSvg)}</g>
<g transform="translate(${p.westX.toFixed(2)} ${p.westY}) scale(${p.scale.toFixed(5)})">${stripDeclaration(westSvg)}</g>
</svg>`;
}
