// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// Pure column and glyph math: where a symbol sits inside a cell, and what
// text and octave mark it puts on the page. No page, no pagination, no
// mutable state - every function here is a straight computation from its
// arguments, which is what lets layout.test.mjs assert on them directly
// instead of through a whole laid-out score.

import { textWidth } from "./text.mjs";

// The Thai octave modifiers a pitch may spell directly (see note.md's Pitch
// format). Neither is drawn as its own diacritic - glyph() strips whichever
// is present and turns it into a drawn dot instead. See "Octave marks" in
// reference/rendering.
export const NIKHAHIT = "ํ"; // raise one octave
export const PINTHU = "ฺ"; // lower one octave

// The seven base notes, in the three interchangeable spellings note.md's
// Pitch format lists. Order is the scale degree, 1-indexed to match it.
const BASE_NOTES = [
  { thai: "ด", letter: "D", number: "1" },
  { thai: "ร", letter: "R", number: "2" },
  { thai: "ม", letter: "M", number: "3" },
  { thai: "ฟ", letter: "F", number: "4" },
  { thai: "ซ", letter: "S", number: "5" },
  { thai: "ล", letter: "L", number: "6" },
  { thai: "ท", letter: "T", number: "7" },
];

// Any of the three spellings, either letter case, to its scale degree.
export const DEGREE_BY_SPELLING = new Map(
  BASE_NOTES.flatMap(({ thai, letter, number }, i) => [
    [thai, i],
    [letter, i],
    [letter.toLowerCase(), i],
    [number, i],
  ]),
);

// ---------------------------------------------------------------------------
// The subdivision count
// ---------------------------------------------------------------------------

/**
 * Share count per beat for one measure, taken across every part playing it.
 *
 * "Count what each beat needs, taking the largest count across all parts."
 * The counts are summed and the cell divides into that many equal shares, so a
 * four-beat measure carrying one group of two divides into five rather than
 * into four.
 *
 * @param {number[][]} perPart slot counts per beat, one array per part
 * @returns {number[]} shares owed to each beat
 */
export function shares(perPart) {
  const beatCount = Math.max(0, ...perPart.map((b) => b.length));
  return Array.from({ length: beatCount }, (_, i) =>
    Math.max(1, ...perPart.map((b) => b[i] ?? 1)),
  );
}

/**
 * Where each of one part's symbols sits, measured in columns.
 *
 * A cell divides into as many columns as the shares add up to, numbered from 1.
 * Beats anchor to the right: a beat arrives on its last slot, so the shares it
 * holds are the run-up to it and every part's symbol for that beat lands
 * together on the last column of them.
 *
 * A beat carrying several symbols packs them tighter than a whole column apart,
 * so the run reads as one fast gesture rather than as separate beats, and the
 * slack that leaves falls to the left because the last symbol is pinned to the
 * arrival. Two parts subdividing one beat differently therefore meet on the
 * arrival and nowhere else, which is the only alignment the grid promises.
 *
 * Positions are columns rather than page coordinates so that this stays a
 * statement about where the music falls.
 *
 * @param {number[]} shareList output of shares()
 * @param {number[]} slotCounts this part's slot count per beat
 * @param {number} [tightness] how close a beat's own symbols sit, 1 being a
 *   full column apart
 * @returns {number[][]} column position per beat, per slot
 */
export function arrivals(shareList, slotCounts, tightness = 1) {
  let cursor = 0;
  return shareList.map((share, i) => {
    cursor += share;
    const arrival = cursor;
    const k = slotCounts[i] ?? 1;
    if (k === 1) return [arrival];
    const step = (share / k) * tightness;
    return Array.from({ length: k }, (_, j) => arrival - (k - 1 - j) * step);
  });
}

/**
 * Page x for a column position within a cell.
 *
 * The run of symbols centers in the cell rather than filling it, so the margin
 * left of the first symbol matches the one right of the last and the last note
 * clears the barline. Printed scores set it this way.
 */
// The two notes a link curve reaches, out of the notes it covers.
//
// A gesture belongs to the instrument, not to one of its rows, so the caller
// collects points from every row of the stack together (spans.mjs's
// soundingInSpan) and this only has to bound them. Ordering is by x, which
// within a line is time order: "ฟ - -" under "- ซ ล" sounds ฟ ซ ล, so the run
// is bounded by ฟ and ล even though neither row holds both ends of it.
//
// Points come in as { x, y }, y measured with smaller higher up the page.
// Null for no points at all. One point bounds itself: a span crossing a line
// break can leave a single note on one side of the cut, and that side still
// gets a segment, running from the note to the grid's edge. Whether the span
// as a whole has enough notes to be worth drawing is a question about the
// span, not about one line of it, so the caller asks it.
export function linkSpan(points) {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.x - b.x);
  return { first: sorted[0], last: sorted.at(-1) };
}

export function columnX(column, total, cellLeft, cellWidth, spread) {
  const step = (cellWidth * spread) / total;
  return cellLeft + cellWidth / 2 + (column - (total + 1) / 2) * step;
}

// ---------------------------------------------------------------------------
// Fitting words into a cell
// ---------------------------------------------------------------------------

/**
 * Push overlapping boxes apart, moving each as little as possible.
 *
 * Syllables want to sit under their beats, and a word several times wider than
 * a pitch letter cannot always have that. Where two of them collide, both give
 * ground rather than the later one being shoved the whole way: the run keeps
 * its order and its minimum spacing, and every box ends up as near its target
 * as those two things allow. That is least-squares under an ordering
 * constraint, which pool-adjacent-violators solves exactly in one pass.
 *
 * Subtracting each box's running minimum offset turns "far enough apart" into
 * plain "non-decreasing", which is the form the pooling works on; adding the
 * offsets back afterward restores real page coordinates.
 *
 * @param {number[]} targets where each box would sit if nothing were in its way
 * @param {number[]} widths box widths, same order
 * @param {number} gap the clear space to keep between neighbours
 * @param {number} lo left edge the run must stay inside
 * @param {number} hi right edge the run must stay inside
 * @returns {number[]} centers, in the order given
 */
export function nudge(targets, widths, gap, lo, hi) {
  const n = targets.length;
  if (n === 0) return [];

  const offsets = [0];
  for (let i = 1; i < n; i++)
    offsets.push(offsets[i - 1] + (widths[i - 1] + widths[i]) / 2 + gap);

  // Each block is a run of boxes that turned out to want the same position, so
  // they travel together from here on and take the average of what they wanted.
  const blocks = [];
  targets.forEach((target, i) => {
    blocks.push({ sum: target - offsets[i], count: 1 });
    while (blocks.length > 1) {
      const last = blocks.at(-1);
      const before = blocks.at(-2);
      if (before.sum / before.count <= last.sum / last.count) break;
      blocks.pop();
      before.sum += last.sum;
      before.count += last.count;
    }
  });

  const xs = [];
  for (const block of blocks)
    for (let i = 0; i < block.count; i++) xs.push(block.sum / block.count + offsets[xs.length]);

  // The run now holds together, but it may have grown past the cell doing it.
  // Slide it whole, which costs the shape nothing; if it is wider than the cell
  // even after shrinking, center the overflow so it spills both ways equally.
  const runLeft = xs[0] - widths[0] / 2;
  const runRight = xs[n - 1] + widths[n - 1] / 2;
  const shift =
    runRight - runLeft > hi - lo
      ? (lo + hi) / 2 - (runLeft + runRight) / 2
      : Math.max(0, lo - runLeft) - Math.max(0, runRight - hi);
  return shift === 0 ? xs : xs.map((x) => x + shift);
}

/**
 * The largest type size a measure's syllables all fit into its cell at.
 *
 * Widths, the gaps between them and the padding at the cell's edges all scale
 * with the size, so the answer is one division rather than a search. Returns
 * Infinity for a measure with nothing to fit, which then constrains nothing.
 */
export function lyricFitSize(texts, cellWidth, settings) {
  if (texts.length === 0) return Infinity;
  const perSize =
    texts.reduce((total, text) => total + textWidth(text, 1), 0) +
    (texts.length - 1) * settings.lyricGap +
    2 * settings.lyricPad;
  return cellWidth / perSize;
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

const THAI = /[฀-๿]/;

/**
 * The text and octave-dot a single slot puts on the page.
 *
 * @returns {{text: string, dot: "above"|"below"|null}}
 */
export function glyph(slotValue, settings) {
  if (slotValue.kind === "rest")
    return { text: settings.printRests === "none" ? "" : settings.restGlyph, dot: null };

  // "A <note> in an unpitched part renders its sound string verbatim."
  if (slotValue.sound !== null) return { text: slotValue.sound, dot: null };

  let pitch = slotValue.pitch ?? "";
  let dot = null;

  // A pitch may already spell its octave with a literal modifier character
  // (pitch="ดํ"), which wins over the octave attribute - "when pitch carries
  // a Thai octave modifier, that modifier determines the octave" (note.md
  // Conformance). Either way the modifier is not printed as itself: it is
  // stripped from the text and turned into a drawn dot instead.
  if (pitch.includes(NIKHAHIT)) {
    dot = "above";
    pitch = pitch.replace(NIKHAHIT, "");
  } else if (pitch.includes(PINTHU)) {
    dot = "below";
    pitch = pitch.replace(PINTHU, "");
  } else if (slotValue.octave >= 1) {
    // Outside -1..1 there is no Thai spelling to add, so the mark clamps to
    // whichever side it is on rather than growing an extra symbol - the
    // author's call, favoring a plain, readable page over flagging the
    // display as capped. See "Octaves beyond the Thai spellings".
    dot = "above";
  } else if (slotValue.octave <= -1) {
    dot = "below";
  }

  // Re-spell into settings.pitchSpelling's target spelling. "source" is the
  // default and leaves pitch exactly as the file wrote it.
  if (settings.pitchSpelling !== "source") {
    const degree = DEGREE_BY_SPELLING.get(pitch);
    if (degree !== undefined) pitch = BASE_NOTES[degree][settings.pitchSpelling];
  }

  if (!THAI.test(pitch) && settings.pitchCase === "upper") pitch = pitch.toUpperCase();

  return { text: pitch, dot };
}
