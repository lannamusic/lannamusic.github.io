// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// Bow, parenthesis, and link spans, drawn once every line they touch has
// already been placed. `notePos`/`rowGeom` come from the renderGridLine()
// calls (grid.mjs) that drew those lines - the section's regular grid, or one
// ending's own grid, each its own scope, since line numbering restarts
// inside an ending.

import { posKey, comparePos, compareBeat } from "./pos.mjs";
import { linkSpan } from "./geometry.mjs";

/**
 * @param {object} deps
 * @param {object} deps.pager the pagination cursor - pager.mjs's createPager()
 * @param {object} deps.settings merged renderer settings
 * @returns {{drawParenSpan: Function, drawBowSpan: Function, drawLinkSpan: Function}}
 */
export function createSpanRenderer({ pager, settings: s }) {
  // Where a row's letters sit on the page. The same expression grid.mjs
  // computes as `row.baseline` when it places them.
  const baselineOf = (geom) => geom.top + s.rowHeight / 2 + s.pitchSize / 3;
  const drawParenSpan = (part, span, notePos, rowGeom) => {
    const firstX = notePos.get(posKey(part.id, span.first));
    const lastX = notePos.get(posKey(part.id, span.last));
    const firstGeom = rowGeom.get(`${part.id}:${span.first.lineIndex}`);
    const lastGeom = rowGeom.get(`${part.id}:${span.last.lineIndex}`);
    if (firstX === undefined || lastX === undefined || !firstGeom || !lastGeom) return;

    // "The `(` before its first symbol and a `)` after its last." No further
    // decoration at a line break: unlike a bow, a cued passage does not need
    // a mark saying the span continues, since the brackets at its true ends
    // already say everything a reader needs.
    //
    // Dimming ("showing the span in a less distinct color") is on top of the
    // brackets, not instead of them - the brackets always appear regardless.
    // `dim` overrides the renderer's own default for this one span; the
    // notes themselves are dimmed where renderGridLine() drew them, via the
    // same `span.dim ?? s.dimParenthesisDefault` test.
    const dim = (span.dim ?? s.dimParenthesisDefault) ? { dim: true } : {};
    const step = s.linkSideStep * s.pitchSize;
    pager.pushTo(firstGeom.page, {
      kind: "text",
      x: firstX - step,
      y: baselineOf(firstGeom),
      text: "(",
      size: s.pitchSize,
      anchor: "middle",
      role: "parenthesis",
      ...dim,
    });
    pager.pushTo(lastGeom.page, {
      kind: "text",
      x: lastX + step,
      y: baselineOf(lastGeom),
      text: ")",
      size: s.pitchSize,
      anchor: "middle",
      role: "parenthesis",
      ...dim,
    });
  };

  // "Both bow directions render above the notes: `in` as a curve with both
  // tips pointing down, `out` as a curve with both tips pointing up." The
  // direction is the arc's own facing rather than a separate mark at the
  // tip: `in` domes up over the row (tips low, middle high, the same shape a
  // same-row link curve uses), `out` is that arc mirrored about the tips'
  // own height (tips high, middle low) - both entirely above the notes
  // either way. Drawn as one segment per line the span touches; a cut
  // mid-span gets the same facing as the rest of the span, since there is no
  // longer a separate tip mark to withhold there.
  //
  // The exact amplitude is a first pass rather than a settled convention:
  // see HANDOVER.md.
  const drawBowSpan = (part, span, notePos, rowGeom) => {
    let firstX = notePos.get(posKey(part.id, span.first));
    let lastX = notePos.get(posKey(part.id, span.last));
    const firstGeom = rowGeom.get(`${part.id}:${span.first.lineIndex}`);
    const lastGeom = rowGeom.get(`${part.id}:${span.last.lineIndex}`);
    if (firstX === undefined || lastX === undefined || !firstGeom || !lastGeom) return;

    // A span that opens and closes around a single note - a bow direction
    // marked on one note rather than a passage - has span.first and
    // span.last resolve to that same note, so firstX and lastX land on the
    // same point. Left alone, the arc below collapses to a zero-width path
    // (a spike, not a curve). Spread it symmetrically around the note by a
    // fixed minimum width instead, so a one-note bow still reads as a small
    // arc rather than a dot.
    if (posKey(part.id, span.first) === posKey(part.id, span.last)) {
      const half = (s.bowMinSpan * s.pitchSize) / 2;
      firstX -= half;
      lastX += half;
    }

    const facesUp = span.direction === "in";
    const magnitude = s.bowRise * s.pitchSize;

    for (let li = span.first.lineIndex; li <= span.last.lineIndex; li++) {
      const geom = rowGeom.get(`${part.id}:${li}`);
      if (!geom) continue;

      const baseline = baselineOf(geom);
      // "in" ties its tip height to a link curve's (linkTop), the same
      // shape either already uses. "out" needs its own, taller anchor
      // (bowTop) instead of that same height: it dips back down from the
      // tip by the same rise, and doing that from linkTop's height would
      // cut into the note glyphs (and marks like นิคหิต reaching up from
      // one) rather than clearing them.
      const arcY = baseline - (facesUp ? s.linkTop : s.bowTop) * s.pitchSize;
      const x1 = li === span.first.lineIndex ? firstX : geom.left;
      const x2 = li === span.last.lineIndex ? lastX : geom.right;

      // Unclamped, unlike a link curve: a link marks its notes and belongs
      // to them, where a bow is a stroke drawn over the passage and is
      // expected to reach past its own row's ruling into the gap above -
      // that is what keeps the two readable where they overlap, and it
      // holds for "out" dipping down toward the baseline just as much as
      // for "in" rising up.
      const rise = facesUp ? magnitude : -magnitude;

      pager.pushTo(geom.page, { kind: "arc", x1, x2, y: arcY, rise, role: "bow" });
    }
  };

  // Every note a link span reaches, as placed points.
  //
  // The row that wrote the span contributes exactly the slots between its two
  // markers, so a span opening mid-group does not reach back over that group's
  // earlier notes - the arranger put the marker where they meant it. Every
  // other notated row of the same stack contributes whole beats instead: slot
  // indices do not line up across parts (one row may divide a beat in two
  // where another divides it in three), but beat counts do, so the beat is the
  // only unit the rows genuinely share.
  //
  // Rests are skipped - a rest is no attack, so there is nothing there for a
  // gesture to reach - and so is any position the grid pass did not place.
  const soundingInSpan = (part, span, notePos, rowGeom, stackRows) => {
    const points = [];

    for (const row of stackRows) {
      const own = row.part.id === part.id;
      const covers = (pos) =>
        own
          ? comparePos(span.first, pos) <= 0 && comparePos(pos, span.last) <= 0
          : compareBeat(span.first, pos) <= 0 && compareBeat(pos, span.last) <= 0;

      for (let lineIndex = span.first.lineIndex; lineIndex <= span.last.lineIndex; lineIndex++) {
        const geom = rowGeom.get(`${row.part.id}:${lineIndex}`);
        const line = row.lines?.[lineIndex];
        if (!geom || !line) continue;
        const y = baselineOf(geom);

        line.measures.forEach((measure, measureIndex) => {
          (measure.beats ?? []).forEach((beat, beatIndex) => {
            beat.slots.forEach((slotValue, slotIndex) => {
              if (slotValue.kind === "rest") return;
              const pos = { lineIndex, measureIndex, beatIndex, slotIndex };
              if (!covers(pos)) return;
              const x = notePos.get(posKey(row.part.id, pos));
              if (x === undefined) return;
              points.push({ lineIndex, x, y, page: geom.page });
            });
          });
        });
      }
    }

    return points;
  };

  // "A curve marking the run as one gesture." Drawn one segment per line the
  // span touches, the way a bow is: at a line break the segment runs to the
  // grid's edge rather than to a note, since there is no note there to end on.
  //
  // The two shapes are the ones a linked group already used. A run that ends
  // level bows up over its notes, its rise clamped to the room the row leaves
  // - unlike a bow, which is a passage mark and is expected to reach into the
  // gap above. A run that ends at a different height arches across instead,
  // turning up or down according to where it is going.
  const drawLinkSpan = (part, span, notePos, rowGeom, stackRows) => {
    const points = soundingInSpan(part, span, notePos, rowGeom, stackRows);
    // One note is not a run and there is nothing to span. Counted over the
    // whole span rather than per line: a span crossing a line break may leave
    // one note on each side of the cut and is still a run of two.
    if (points.length < 2) return;

    for (let li = span.first.lineIndex; li <= span.last.lineIndex; li++) {
      const onLine = points.filter((p) => p.lineIndex === li);
      const bounds = linkSpan(onLine);
      const geom = rowGeom.get(`${part.id}:${li}`);
      if (!bounds || !geom) continue;

      const atStart = li === span.first.lineIndex;
      const atStop = li === span.last.lineIndex;
      const x1 = atStart ? bounds.first.x : geom.left;
      const x2 = atStop ? bounds.last.x : geom.right;
      const top = (point) => point.y - s.linkTop * s.pitchSize;

      if (bounds.first.y === bounds.last.y) {
        const arcY = top(bounds.first);
        const rowTop = baselineOf(geom) - s.rowHeight / 2 - s.pitchSize / 3;
        pager.pushTo(geom.page, {
          kind: "arc",
          x1,
          x2,
          y: arcY,
          rise: Math.min(s.linkRise * s.pitchSize, arcY - rowTop - 1),
          role: "link",
        });
        continue;
      }

      // Across rows the stroke arches over the run. Which way it turns follows
      // from where the two notes fell: a run ending higher up the page leaves
      // the first note upward and comes in flat above the last, and one ending
      // lower leaves flat and turns down. Either way it stays above the notes
      // rather than cutting between them.
      const rising = bounds.last.y < bounds.first.y;

      // Step off the first note's centre so the stroke starts at that letter's
      // corner, on the side it departs towards. Only at the span's true start:
      // a segment resumed after a line break begins at the grid edge, where
      // there is no letter to step off.
      const from = atStart ? x1 + (rising ? -1 : 1) * s.linkSideStep * s.pitchSize : x1;
      const y1 = top(bounds.first);
      const y2 = top(bounds.last);

      pager.pushTo(geom.page, {
        kind: "curve",
        x1: from,
        y1,
        x2,
        y2,
        cx: rising ? from : x2,
        cy: rising ? y2 : y1,
        role: "link",
      });
    }
  };

  return { drawParenSpan, drawBowSpan, drawLinkSpan };
}
