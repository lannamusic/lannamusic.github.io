// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// Box layout and grid-line drawing: turning one section's worth of rows, for
// one line, into ruled boxes and positioned symbols.
//
// This is the one place a line's box tops and bottoms are worked out, and so
// also the one place a line's height comes from: measureLine() below calls
// layBoxes() against pager.withScratch() to size a line before committing it
// to a position, and renderGridLine() calls it again to place it for real.
// renderGridLine() also records where every notated symbol and row ended up,
// in the caller-supplied notePos/rowGeom maps, which spans.mjs reads back
// once every line a bow, parenthesis, or link span touches has been drawn - a
// span can reach across lines a single renderGridLine() call never sees at
// once.

import { shares, arrivals, columnX, nudge, lyricFitSize, glyph } from "./geometry.mjs";
import { textWidth } from "./text.mjs";
import { posKey } from "./pos.mjs";

/**
 * @param {object} deps
 * @param {object} deps.pager the pagination cursor - pager.mjs's createPager()
 * @param {object} deps.settings merged renderer settings
 * @param {object} deps.score parse()'s output, read for each part's
 *   own annotations (score.music[partId][sectionId].annotations)
 * @param {(part: object) => string} deps.instrumentOf a part's stack id, or a
 *   solo id of its own where it has none - rows sharing one instrument are
 *   ruled together as a single box
 * @param {object} deps.gap the break each nesting level takes, keyed by level
 *   name; only gap.line and gap.instrument are read here
 * @param {boolean} deps.showLabels whether the label column prints at all
 * @param {number} deps.cellWidth
 * @param {number} deps.left the grid's left edge
 * @param {Function} deps.annotationRow layout.mjs's own annotation-block
 *   renderer, called here for a part's own annotations atop its box
 * @returns {{layBoxes: Function, measureLine: Function, renderGridLine: Function}}
 */
export function createGridRenderer({ pager, settings: s, score, instrumentOf, gap, showLabels, cellWidth, left, annotationRow }) {
  // A label repeats only where it earns its keep: the first grid line, the
  // first one on a fresh page (a reader who just turned the page has lost the
  // run of identical lines behind them), or the first after the row lineup
  // itself changes - which, since nothing else reorders rows, only a tacet
  // part causes. Consecutive lines with the same parts in the same order
  // print nothing, the way a Western score does not repeat a system's names
  // when the instrumentation has not moved.
  let lastLabelRows = null;
  let lastLabelPage = null;

  // measureLine() is asked for the same line's height more than once - once
  // by layout.mjs to fold a heading's next line into its own pagination
  // check, and again here inside renderGridLine() right before laying that
  // same line out for real. Caching by each row's line object identity - one
  // fixed object for the life of one layout() call, and unique to the
  // (part, section, line) it came from, so an ending's own line 1 never
  // collides with its section's - lets the second ask reuse the first
  // answer instead of re-running layBoxes() a second (or third) time.
  const lineIds = new WeakMap();
  let nextLineId = 0;
  const lineId = (line) => {
    if (!lineIds.has(line)) lineIds.set(line, nextLineId++);
    return lineIds.get(line);
  };
  const heightCache = new Map();

  // Rows belonging to one instrument are ruled together as a single box. Parts
  // sharing a stack are that instrument's rows; a part without one is an
  // instrument on its own. The break between boxes is what tells a reader
  // where one instrument ends and the next begins.
  //
  // `ownAnnotations` defaults from `lineIndex === 0`, which is right for the
  // section's regular lines, but an ending's own grid needs the two ideas
  // pulled apart: `lineIndex` there is the ending's own real line index
  // (0-based, needed so notePos/rowGeom keys line up with what
  // resolveSpans() recorded), while whether to reprint the section-ref's own
  // annotations must stay false regardless, since those belong to the
  // section's regular grid and already printed there. Callers rendering an
  // ending pass `ownAnnotations: false` explicitly rather than relying on the
  // default.
  const layBoxes = (rows, section, lineIndex, gridTop, { ownAnnotations = lineIndex === 0 } = {}) => {
    const boxes = [];
    for (const r of rows) {
      const key = instrumentOf(r.part);
      const open = boxes.at(-1);
      if (open && open.key === key) open.rows.push(r);
      else boxes.push({ key, rows: [r] });
    }

    let boxTop = gridTop;
    for (const box of boxes) {
      // A part's own annotations sit directly on top of that instrument's
      // box, which is where they can only be once instruments are ruled
      // separately. A <section-ref>'s belong to the section rather than to
      // the line, so they print once, above the first line of it; a
      // <line>'s belong to that line and print above it every time, which
      // is the only difference between the two.
      const notes = [
        ...(ownAnnotations
          ? box.rows.flatMap((r) => score.music[r.part.id][section.id].annotations)
          : []),
        ...box.rows.flatMap((r) => r.line?.annotations ?? []),
      ];
      if (notes.length > 0) {
        pager.y = boxTop;
        // Clear of the instrument above, where there is one. The first box in
        // a line already has the break that opened it.
        pager.pending = boxTop > gridTop ? s.annotationGap : 0;
        // paginate: false because this annotation is inside a block
        // measureLine() has already sized as a whole; it must not take its
        // own, separate page break.
        for (const note of notes) annotationRow(note, { paginate: false });
        pager.spend(s.annotationGap);
        boxTop = pager.y;
      }

      box.top = boxTop;
      box.rows.forEach((r, i) => {
        r.top = boxTop + i * s.rowHeight;
      });
      box.bottom = boxTop + box.rows.length * s.rowHeight;
      boxTop = box.bottom + gap.instrument;
    }

    return boxes;
  };

  // The height a line would take, worked out by laying it out at the top of a
  // throwaway page and reading off where it ended. Annotation heights do not
  // depend on where the page starts, so the number this returns is exact
  // rather than an estimate.
  const measureLine = (rows, section, lineIndex, boxOptions) => {
    const ownAnnotations = boxOptions?.ownAnnotations ?? lineIndex === 0;
    const key = `${ownAnnotations}:${rows.map((r) => `${r.part.id}#${lineId(r.line)}`).join(",")}`;
    const cached = heightCache.get(key);
    if (cached !== undefined) return cached;

    const height = pager.withScratch(() => layBoxes(rows, section, lineIndex, 0, boxOptions).at(-1).bottom);
    heightCache.set(key, height);
    return height;
  };

  // Draws one grid line whole - box ruling and symbols - and returns its
  // geometry. `firstOfGroup` is the same first-line-inherits,
  // later-lines-take-gap.line rule the section loop always applied; endings
  // reuse it as a plain multi-line grid of their own.
  //
  // `notePos`/`rowGeom`, when given, record where every notated symbol and
  // row ended up, keyed by part id and this call's `lineIndex`. A bow or
  // parenthesis span reads them back once every line it touches has been
  // drawn, since a span can reach across lines a single call here never sees
  // at once.
  const renderGridLine = (
    rows,
    section,
    lineIndex,
    { firstOfGroup = false, notePos, rowGeom, labels = true, ownAnnotations, dimmed } = {},
  ) => {
    if (!firstOfGroup) pager.pending = gap.line;

    const boxOptions = { ownAnnotations };
    pager.ensureRoom(measureLine(rows, section, lineIndex, boxOptions));
    pager.spend();

    const measureCount = Math.max(...rows.map((r) => r.line.measures.length));
    const gridRight = left + measureCount * cellWidth;
    const gridTop = pager.y;

    const boxes = layBoxes(rows, section, lineIndex, gridTop, boxOptions);
    const gridBottom = boxes.at(-1).bottom;

    // A line shorter than eight measures is left-aligned and its ruling
    // stops after the last measure rather than stretching to fill the row.
    for (const box of boxes) {
      pager.push({ kind: "line", x1: left, y1: box.top, x2: gridRight, y2: box.top });
      pager.push({ kind: "line", x1: left, y1: box.bottom, x2: gridRight, y2: box.bottom });
      for (let m = 0; m <= measureCount; m++) {
        const mx = left + m * cellWidth;
        pager.push({ kind: "line", x1: mx, y1: box.top, x2: mx, y2: box.bottom });
      }
      for (let r = 1; r < box.rows.length; r++) {
        const ry = box.top + r * s.rowHeight;
        pager.push({ kind: "line", x1: left, y1: ry, x2: gridRight, y2: ry });
      }
    }

    // Labels take their width from the margin, not from the eight cells, so
    // they print left of the grid rather than moving it. Not offered for an
    // ending's own grid, which is already unambiguous - its heading names the
    // part - so a label would only repeat what the annotation already said.
    if (labels && showLabels) {
      const rowParts = rows.map((r) => r.part.id);
      const changed =
        pager.page !== lastLabelPage ||
        !lastLabelRows ||
        rowParts.length !== lastLabelRows.length ||
        rowParts.some((id, i) => id !== lastLabelRows[i]);

      if (changed) {
        for (const r of rows) {
          // The label column has only the page margin to work with, so a
          // short name takes precedence where the part has one.
          const label = r.part.shortName ?? r.part.name;
          if (!label) continue;
          pager.push({
            kind: "text",
            x: left - s.labelGap * s.pitchSize,
            y: r.top + s.rowHeight / 2 + s.labelSize / 3,
            text: label,
            size: s.labelSize,
            anchor: "end",
            role: "label",
          });
        }
        lastLabelRows = rowParts;
        lastLabelPage = pager.page;
      }
    }

    if (rowGeom)
      for (const r of rows) {
        if (r.part.type === "lyric") continue;
        rowGeom.set(`${r.part.id}:${lineIndex}`, { top: r.top, left, right: gridRight, page: pager.page });
      }

    // Symbols. The share count is worked out for the measure as a whole so
    // that beat positions line up vertically across every part playing it.
    // A lyric row takes no part in it - "Lyric rows take no part in the
    // subdivision count" - so it is excluded here and placed afterward
    // against the columns the notated rows already settled on.
    for (let m = 0; m < measureCount; m++) {
      const cellLeft = left + m * cellWidth;

      const perPart = rows
        .filter((r) => r.part.type !== "lyric")
        .map((r) => (r.line.measures[m]?.beats ?? []).map((b) => b.slots.length));
      const shareList = shares(perPart);
      const total = shareList.reduce((a, b) => a + b, 0);

      // Pack a beat's symbols as tightly as the type allows. The wanted
      // fraction of a column is the target; the legibility floor wins where a
      // crowded measure has made columns narrower than the letters standing
      // in them, which is what a group of three does on a portrait page.
      const columnWidth = (cellWidth * s.spread) / total;
      const floor = (s.minSymbolAdvance * s.pitchSize) / columnWidth;
      const tightness = Math.min(1, Math.max(s.groupTightness, floor));

      const x = (column) => columnX(column, total, cellLeft, cellWidth, s.spread);

      // One arrival column per beat: where a lyric measure's item count
      // matches, syllable i sits exactly where a plain note on beat i would.
      const beatArrivals = arrivals(shareList, shareList.map(() => 1)).map((c) => c[0]);

      // Work out every row's placement, then draw. Nothing here now reaches
      // across rows - link curves used to, and were the reason for the split -
      // but measuring and drawing still read more clearly apart than mixed.
      const placed = rows.map((r) => {
        const measure = r.line.measures[m];
        if (!measure) return null;
        if (r.part.type === "lyric") {
          // The words come first here: a cell packed with long syllables sets
          // smaller than the cell beside it rather than dragging the whole row
          // down with it. The step between two neighbouring cells is visible,
          // and it is the cheaper of the two - one crowded measure should not
          // cost the rest of the line its type size.
          const fit = lyricFitSize(
            measure.items.filter((item) => item.kind === "syllable").map((item) => item.text),
            cellWidth,
            s,
          );
          const size = Math.max(s.lyricMinSize, Math.min(s.lyricSize, fit));
          return { part: r.part, measure, lyric: true, size, baseline: r.top + s.rowHeight / 2 + size / 3 };
        }
        return {
          part: r.part,
          measure,
          columns: arrivals(
            shareList,
            measure.beats.map((b) => b.slots.length),
            tightness,
          ),
          baseline: r.top + s.rowHeight / 2 + s.pitchSize / 3,
        };
      });

      for (const row of placed) {
        if (!row) continue;

        if (row.lyric) {
          // "A lyric measure holding exactly as many items as the measure
          // has beats renders one item per beat... Any other number renders
          // as a single group centered in the cell." A <rest> is เอื้อน and
          // prints as blank space, never the notated rows' hyphen.
          const items = row.measure.items;
          const n = items.length;
          if (n === 0) continue;
          const aligned = n === beatArrivals.length;
          const at = (i) =>
            aligned ? x(beatArrivals[i]) : columnX(i + 1, n, cellLeft, cellWidth, s.spread);

          // Where the words are too wide for the beats they belong to, the
          // beats give: a syllable moves off its arrival into whatever room
          // the cell has left rather than printing on top of its neighbour.
          // Only the syllables take part - a <rest> is blank space, so it
          // neither needs room nor stops a word using its own.
          const sung = items.map((item, i) => ({ item, i })).filter(({ item }) => item.kind === "syllable");
          const size = row.size;
          const pad = s.lyricPad * size;
          const xs = nudge(
            sung.map(({ i }) => at(i)),
            sung.map(({ item }) => textWidth(item.text, size)),
            s.lyricGap * size,
            cellLeft + pad,
            cellLeft + cellWidth - pad,
          );

          sung.forEach(({ item }, k) => {
            pager.push({
              kind: "text",
              x: xs[k],
              y: row.baseline,
              text: item.text,
              size,
              anchor: "middle",
              role: "lyric",
            });
          });
          continue;
        }

        row.measure.beats.forEach((beat, beatIndex) => {
          beat.slots.forEach((slotValue, slotIndex) => {
            const symbolX = x(row.columns[beatIndex][slotIndex]);
            if (notePos) notePos.set(posKey(row.part.id, { lineIndex, measureIndex: m, beatIndex, slotIndex }), symbolX);
            const { text, dot } = glyph(slotValue, s);
            if (!text) return;
            const dim = dimmed?.(row.part.id, { lineIndex, measureIndex: m, beatIndex, slotIndex });
            pager.push({
              kind: "text",
              x: symbolX,
              y: row.baseline,
              text,
              size: s.pitchSize,
              anchor: "middle",
              role: "symbol",
              ...(dim ? { dim: true } : {}),
            });
            // The octave mark: a small dot above or below the letter, drawn
            // rather than set as a diacritic in the font - see "Octave
            // marks" in reference/rendering.
            if (dot) {
              const gap = (dot === "above" ? s.octaveDotGapAbove : s.octaveDotGapBelow) * s.pitchSize;
              pager.push({
                kind: "dot",
                x: symbolX,
                y: row.baseline + (dot === "above" ? -gap : gap),
                r: s.octaveDotRadius * s.pitchSize,
                role: "octave-dot",
                ...(dim ? { dim: true } : {}),
              });
            }
          });
        });
      }
    }

    pager.y = gridBottom;
    return { gridTop, gridBottom, gridRight, boxes, page: pager.page };
  };

  return { layBoxes, measureLine, renderGridLine };
}
