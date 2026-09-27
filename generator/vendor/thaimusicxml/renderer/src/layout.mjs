// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// Score model to positioned elements.
//
// This is where the specification actually lives. Everything that can be wrong
// in a way that still looks plausible is decided here: how a cell divides, and
// where inside it each symbol lands. The drawing stage receives coordinates and
// cannot get the music wrong because it never sees the music.
//
// layout() itself is the score-walking orchestrator: title band, credits,
// then one pass over <structure> placing each section's grid lines, endings,
// and line repeats. It delegates the two heavyweight passages that walk needs
// to their own modules - pagination bookkeeping to pager.mjs, and the
// box/grid drawing one grid line needs to grid.mjs, with bow/parenthesis span
// drawing in spans.mjs - so this file stays a statement about what a score
// contains and in what order, not about how a page fills up or how a cell
// subdivides. The pure column and glyph math (shares, arrivals, columnX,
// linkSpan, nudge, lyricFitSize, glyph) lives in geometry.mjs and is
// re-exported below unchanged, so nothing importing them from here has to
// change.
//
// Output is a flat list of primitives, which makes the whole layout a value
// that can be compared against a stored copy.

import { defaults } from "./settings.mjs";
import { wrapText } from "./text.mjs";
import { createPager } from "./pager.mjs";
import { createGridRenderer } from "./grid.mjs";
import { createSpanRenderer } from "./spans.mjs";
import { comparePos } from "./pos.mjs";

export { shares, arrivals, columnX, linkSpan, nudge, lyricFitSize, glyph } from "./geometry.mjs";

/**
 * Lay a parsed score out on a page.
 *
 * @param {object} score output of parse()
 * @param {object} [options] overrides on top of the settings defaults
 */
export function layout(score, options = {}) {
  const s = { ...defaults, ...options };

  const left = s.page.marginSide;
  const right = s.page.width - s.page.marginSide;
  const cellWidth = (right - left) / s.measuresPerRow;

  // A part is drawn only where it actually has music, so a part that omits a
  // section has no row there and the parts below it close the gap.
  const playing = (sectionId) => score.parts.filter((p) => score.music[p.id]?.[sectionId]);

  const solo = score.parts.length === 1;

  // A solo score already carries its instrument name beside the title, so a
  // label column would only repeat it; an ensemble score always gets one,
  // since position in the stack alone cannot be trusted once any part is
  // tacet somewhere and the rows below it move up to close the gap.
  const showLabels = s.showLabels ?? !solo;

  // Which levels the score actually has. A level with one member is skipped, so
  // the breaks step outward from whichever level survives innermost.
  const instrumentOf = (p) => p.stack ?? `solo:${p.id}`;
  const instrumentCount = new Set(score.parts.map(instrumentOf)).size;
  const anyMultiRow = score.parts.some(
    (p) => p.stack && score.parts.filter((q) => q.stack === p.stack).length > 1,
  );

  const levels = [];
  if (anyMultiRow) levels.push("row");
  if (instrumentCount > 1) levels.push("instrument");
  levels.push("line", "section");

  const gap = {};
  levels.forEach((name, i) => {
    gap[name] = s.gapScale[i] ?? s.gapScale.at(-1);
  });
  for (const name of ["row", "instrument"]) gap[name] ??= 0;

  // A score longer than one page continues on the next, keeping the same
  // margins and cell width; the pager tracks the current page and cursor.
  const pager = createPager(s.page);
  pager.y = s.page.marginTop + s.titleSize;

  // --- Title band ---------------------------------------------------------
  // The title centers at the top. On a solo score the instrument name prints
  // separately in the top-right corner, level with the title rather than
  // stacked under it as a centered subtitle would read - too much like a
  // second header, the way a composer's name would if it were set that way
  // instead of in the credits band. It takes no part in the vertical flow the
  // rest of the band uses, so it does not push the credits down.
  const centre = (left + right) / 2;
  pager.push({
    kind: "text",
    x: centre,
    y: pager.y,
    text: score.title,
    size: s.titleSize,
    weight: "bold",
    anchor: "middle",
    role: "title",
  });
  if (solo && score.parts[0].name && s.showLabels !== false) {
    pager.push({
      kind: "text",
      x: right,
      y: pager.y,
      text: score.parts[0].name,
      size: s.instrumentNameSize,
      anchor: "end",
      role: "instrument-name",
    });
  }

  // An annotation prints its three alignments as one line, at the same left,
  // centre and right the grid uses. Plain text arrives as the left one.
  //
  // `extra` folds in the height of whatever this annotation heads, so a
  // heading and the grid it introduces move to a fresh page together rather
  // than leaving the heading stranded at the bottom of the one before.
  // `paginate` is off for a part's own annotation atop an instrument box: that
  // annotation is already inside a block measureLine() sized as a whole, so it
  // must not make its own, separate break.
  const annotationRow = (
    note,
    { heading = false, size = s.annotationSize, role = "annotation", extra = 0, paginate = true } = {},
  ) => {
    // Text wider than the grid wraps rather than running off the page. Each
    // alignment wraps against the full width, so a long one keeps its own edge
    // while the others stay where they are.
    const columns = [
      ["left", note.left, left, "start"],
      ["center", note.center, centre, "middle"],
      ["right", note.right, right, "end"],
    ]
      .filter(([, value]) => value)
      .map(([align, value, x, anchor]) => ({
        align,
        x,
        anchor,
        lines: wrapText(value, size, right - left),
      }));

    const step = size * s.annotationLeading;
    const deepest = Math.max(0, ...columns.map((c) => c.lines.length));
    const cap = heading ? Infinity : s.annotationGap;
    const height = size + Math.max(0, deepest - 1) * step;

    if (paginate) pager.ensureRoom(height + extra, cap);

    // Only a heading takes the whole break. Anything else is trailing the grid
    // above and stays with it.
    pager.spend(cap);

    pager.y += size;
    for (const column of columns)
      column.lines.forEach((line, i) => {
        pager.push({
          kind: "text",
          x: column.x,
          y: pager.y + i * step,
          text: line,
          size,
          anchor: column.anchor,
          role: `${role}-${column.align}`,
        });
      });
    pager.y += Math.max(0, deepest - 1) * step;
    // Whatever comes next belongs with this line, so hold a small break, or
    // whatever is still owed if that is larger.
    pager.pending = Math.max(pager.pending, s.annotationGap);
  };

  // A <br> is worth one blank line, the way it is in a text document.
  const blankLine = () => {
    const height = s.annotationSize + s.annotationGap;
    pager.ensureRoom(height);
    pager.spend();
    pager.y += height;
  };

  // "A renderer may offer to print name as a heading for a score whose
  // annotations are sparse" - off by default, since there is no way to tell
  // an authored heading from an unrelated annotation, so turning this on
  // for a score that already writes its own headings prints both.
  const structure = (() => {
    if (!s.generateSectionName) return score.structure;

    const out = [];
    score.structure.forEach((item) => {
      if (item.kind === "section" && item.name) {
        out.push({ kind: "annotation", left: item.name, center: null, right: null });
      }
      out.push(item);
    });
    return out;
  })();

  // Annotations before the first section belong to the title band. Everything
  // from the first section on is the body, where an annotation renders in the
  // gap it sits in.
  const firstSection = structure.findIndex((item) => item.kind === "section");
  const band = firstSection === -1 ? structure : structure.slice(0, firstSection);
  const body = firstSection === -1 ? [] : structure.slice(firstSection);

  // Credits print exactly as written and the renderer prefixes nothing, so a
  // label like ผู้ประพันธ์ : is there only because the arranger typed it. The
  // align values do the positioning, which is what puts the composer on the
  // right in the conventional layout. Bare text centers.
  pager.pending = s.annotationGap;
  for (const value of [score.composer, score.lyricist, score.arranger]) {
    if (!value) continue;
    annotationRow(value, { size: s.creditSize, role: "credit" });
  }

  let bandDrew = false;

  // "A renderer may offer to show them, but no printed convention places
  // them" - <tuning> and <license> from <header>, and <bpm> from whichever
  // <direction> falls in the title band (a later one, changing tempo partway
  // through the score, is left to the reading order it already has - see
  // HANDOVER.md). <nathap> is not offered here at all: its own Rendering
  // section says it is never printed, not an opt-in choice the way these
  // three are.
  if (s.showHeaderExtras) {
    const bandDirection = band.find((item) => item.kind === "direction");
    const extras = [score.tuning, bandDirection?.bpm ? `${bandDirection.bpm} bpm` : null, score.license].filter(
      Boolean,
    );
    if (extras.length > 0) {
      annotationRow(
        { left: extras.join(" · "), center: null, right: null },
        { size: s.headerExtraSize, role: "header-extra" },
      );
      bandDrew = true;
    }
  }

  for (const item of band) {
    if (item.kind === "br") blankLine();
    else if (item.kind === "annotation") annotationRow(item);
    else continue;
    bandDrew = true;
  }

  // The large break under the header separates it from the music, so it only
  // makes sense where the header is the last thing above the grid. An
  // annotation ending the band is a heading for the section right below it, and
  // keeps the small break it set for itself.
  if (!bandDrew) pager.pending = s.titleGap;

  // --- The grid -----------------------------------------------------------
  //
  // A run of text between two grids splits in two. Lines trailing the grid
  // above belong to it and stay close to it, กลับต้น under the section it
  // returns from being the case this exists for. The last line before the next
  // grid is that grid's heading, and belongs to it. The break between sections
  // falls at the split, so it separates the two blocks rather than pushing
  // either line away from the grid it names.
  const headsNextGrid = (from) => {
    for (let j = from + 1; j < body.length; j++) {
      if (body[j].kind === "section") return true;
      if (body[j].kind === "annotation") return false;
    }
    return false;
  };

  // The first line a heading annotation is about to introduce, so its height
  // can be folded into that annotation's own pagination check. Without this a
  // heading can end up alone at the foot of a page with its grid pushed to the
  // one after, which is the stranding "Text inside a break" exists to avoid,
  // now also possible across a page break.
  const nextLineRows = (from) => {
    for (let j = from + 1; j < body.length; j++) {
      if (body[j].kind === "annotation") return null;
      if (body[j].kind !== "section") continue;
      const section = body[j];
      const parts = playing(section.id);
      if (parts.length === 0) return null;
      const rows = parts
        .map((p) => ({ part: p, line: score.music[p.id][section.id].lines[0] }))
        .filter((r) => r.line);
      return rows.length > 0 ? { rows, section } : null;
    }
    return null;
  };

  const { measureLine, renderGridLine } = createGridRenderer({
    pager,
    settings: s,
    score,
    instrumentOf,
    gap,
    showLabels,
    cellWidth,
    left,
    annotationRow,
  });

  const { drawParenSpan, drawBowSpan, drawLinkSpan } = createSpanRenderer({ pager, settings: s });

  // The rows a link span written by `part` reaches. A stack is one physical
  // instrument, so the gesture belongs to all of its notated rows at once - a
  // lyric row has no beats and takes no part in it. Without a stack there is
  // no other row and the span marks the part's own notes.
  const stackMates = (part, parts) =>
    part.stack ? parts.filter((p) => p.stack === part.stack && p.type !== "lyric") : [part];

  for (let index = 0; index < body.length; index++) {
    const item = body[index];
    if (item.kind === "br") {
      blankLine();
      continue;
    }
    if (item.kind === "direction") continue;
    if (item.kind === "annotation") {
      const heading = headsNextGrid(index);
      let extra = 0;
      if (heading) {
        const next = nextLineRows(index);
        if (next) extra = measureLine(next.rows, next.section, 0);
      }
      annotationRow(item, { heading, extra });
      continue;
    }

    const section = item;
    const parts = playing(section.id);
    if (parts.length === 0) continue;

    const lineCount = Math.max(
      ...parts.map((p) => score.music[p.id][section.id].lines.length),
    );

    // A position is dimmed where a resolved parenthesis span covers it and
    // that span's own `dim` (or, absent that, the renderer's own default)
    // says so. Read straight off the position indices resolveSpans()
    // recorded, so this needs no separate range bookkeeping of its own.
    const isDimmed = (partId, pos) =>
      (score.music[partId]?.[section.id]?.parenSpans ?? []).some(
        (sp) => (sp.dim ?? s.dimParenthesisDefault) && comparePos(sp.first, pos) <= 0 && comparePos(pos, sp.last) <= 0,
      );

    const notePos = new Map();
    const rowGeom = new Map();
    const lineBoxes = [];
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
      const rows = parts
        .map((p) => ({ part: p, line: score.music[p.id][section.id].lines[lineIndex] }))
        .filter((r) => r.line);
      lineBoxes.push(
        renderGridLine(rows, section, lineIndex, {
          firstOfGroup: lineIndex === 0,
          notePos,
          rowGeom,
          dimmed: isDimmed,
        }),
      );
    }

    for (const p of parts) {
      for (const span of score.music[p.id][section.id].bowSpans) drawBowSpan(p, span, notePos, rowGeom);
      for (const span of score.music[p.id][section.id].parenSpans) drawParenSpan(p, span, notePos, rowGeom);

      // A stack-mate may sit this section out, in which case it contributes
      // nothing here and the span reads the rows that are present.
      const stackRows = stackMates(p, parts)
        .map((q) => ({ part: q, lines: score.music[q.id]?.[section.id]?.lines }))
        .filter((row) => row.lines);
      for (const span of score.music[p.id][section.id].linkSpans)
        drawLinkSpan(p, span, notePos, rowGeom, stackRows);
    }

    // A line repeat prints as a bracket in the margin right of the grid,
    // aligned to the longest line the span covers. Where the covered lines
    // land on more than one page, split into one bracket per page - the same
    // "belongs together but a page break still falls between lines" the
    // grid itself follows.
    for (const lr of section.lineRepeats ?? []) {
      if (lr.times < 2) continue;
      const covered = lineBoxes.slice(lr.first - 1, lr.last);
      if (covered.length === 0) continue;

      const bracketX = Math.max(...covered.map((b) => b.gridRight)) + s.repeatBracketGap * s.pitchSize;
      const depth = s.repeatBracketDepth * s.pitchSize;
      const label = lr.times === 2 ? "ซ้ำ" : `${lr.times} ครั้ง`;

      let runStart = 0;
      for (let i = 1; i <= covered.length; i++) {
        if (i < covered.length && covered[i].page === covered[runStart].page) continue;
        const run = covered.slice(runStart, i);
        const top = run[0].gridTop;
        const bottom = run.at(-1).gridBottom;
        const pageIndex = run[0].page;

        pager.pushTo(pageIndex, { kind: "line", x1: bracketX, y1: top, x2: bracketX, y2: bottom, role: "repeat-bracket" });
        pager.pushTo(pageIndex, { kind: "line", x1: bracketX, y1: top, x2: bracketX - depth, y2: top, role: "repeat-bracket" });
        pager.pushTo(pageIndex, {
          kind: "line",
          x1: bracketX,
          y1: bottom,
          x2: bracketX - depth,
          y2: bottom,
          role: "repeat-bracket",
        });
        pager.pushTo(pageIndex, {
          kind: "text",
          x: bracketX + 2,
          y: (top + bottom) / 2 + s.repeatLabelSize / 3,
          text: label,
          size: s.repeatLabelSize,
          anchor: "start",
          role: "repeat-label",
        });
        runStart = i;
      }
    }

    // An ending renders below its section, detached from the line(s) it
    // replaces: its own annotation as a heading, then its replacement lines
    // as their own grid. Each part writes its own <ending> (its own
    // annotation, its own replacement lines), but an ending is one event for
    // the ensemble, not one per part - pairing them up by position in
    // document order (endingIndex) and drawing one combined heading and one
    // combined grid, the same way the section's regular lines already treat
    // every part's line at a given lineIndex as one grid line. Left one loop
    // per part, this used to print the heading annotation once per part
    // (identical text duplicated down the page) and rule each part's
    // replacement as its own separate little section instead of one shared
    // grid.
    //
    // `ownAnnotations: false` is passed explicitly rather than relying on
    // `lineIndex === 0`, since `lineIndex` here is the ending's own real line
    // index - needed so notePos/rowGeom keys line up with the lineIndex
    // resolveSpans() recorded for this ending's spans - and that is
    // genuinely 0 for an ending's first line. Conflating the two used to mean
    // a span opening and closing entirely inside one ending's own lines
    // silently failed to draw at all, since rowGeom was only ever keyed under
    // the pinned constant.
    const endingCount = Math.max(0, ...parts.map((p) => score.music[p.id][section.id].endings.length));
    for (let endingIndex = 0; endingIndex < endingCount; endingIndex++) {
      const entries = parts
        .map((p) => ({ part: p, ending: score.music[p.id][section.id].endings[endingIndex] }))
        .filter((e) => e.ending && e.ending.lines.length > 0);
      if (entries.length === 0) continue;

      pager.pending = endingIndex === 0 ? gap.section : gap.line;

      // Parts sharing an ending often write the exact same annotation (a
      // heading like "ลง" repeated in every part's own <ending>, since each
      // part's arranger typed it separately) - print each distinct block of
      // annotation lines once, in the order its part first contributes it,
      // rather than once per part.
      const seenAnnotations = new Set();
      const annotationGroups = [];
      for (const entry of entries) {
        const key = JSON.stringify(entry.ending.annotations);
        if (seenAnnotations.has(key)) continue;
        seenAnnotations.add(key);
        annotationGroups.push(entry.ending.annotations);
      }

      const firstRows = entries.map((e) => ({ part: e.part, line: e.ending.lines[0] }));
      let firstNote = true;
      for (const notes of annotationGroups) {
        notes.forEach((note) => {
          const extra = firstNote ? measureLine(firstRows, section, 0, { ownAnnotations: false }) : 0;
          annotationRow(note, { heading: firstNote, extra });
          firstNote = false;
        });
      }

      const endingByPart = new Map(entries.map((e) => [e.part.id, e.ending]));
      const isEndingDimmed = (partId, pos) =>
        (endingByPart.get(partId)?.parenSpans ?? []).some(
          (sp) => (sp.dim ?? s.dimParenthesisDefault) && comparePos(sp.first, pos) <= 0 && comparePos(pos, sp.last) <= 0,
        );

      const lineCount = Math.max(...entries.map((e) => e.ending.lines.length));
      const endingNotePos = new Map();
      const endingRowGeom = new Map();
      for (let li = 0; li < lineCount; li++) {
        const rows = entries
          .map((e) => ({ part: e.part, line: e.ending.lines[li] }))
          .filter((r) => r.line);
        renderGridLine(rows, section, li, {
          firstOfGroup: li === 0,
          labels: false,
          ownAnnotations: false,
          notePos: endingNotePos,
          rowGeom: endingRowGeom,
          dimmed: isEndingDimmed,
        });
      }

      const endingParts = entries.map((e) => e.part);
      for (const entry of entries) {
        for (const span of entry.ending.bowSpans) drawBowSpan(entry.part, span, endingNotePos, endingRowGeom);
        for (const span of entry.ending.parenSpans) drawParenSpan(entry.part, span, endingNotePos, endingRowGeom);

        // An ending is its own scope, so a stack-mate counts here only if it
        // wrote an ending for this pass too.
        const stackRows = stackMates(entry.part, endingParts)
          .map((q) => ({ part: q, lines: endingByPart.get(q.id)?.lines }))
          .filter((row) => row.lines);
        for (const span of entry.ending.linkSpans)
          drawLinkSpan(entry.part, span, endingNotePos, endingRowGeom, stackRows);
      }
    }

    pager.pending = gap.section;
  }

  return {
    width: s.page.width,
    // In infinite mode there is exactly one page (pageBottom is Infinity, so
    // newPage() is never reached) and its height is read off wherever the
    // content actually finished, plus the same bottom margin every other
    // edge gets - not the fixed `s.page.height`, which was never more than a
    // starting value once pagination itself is off.
    height: s.page.infinite ? pager.y + s.page.marginBottom : s.page.height,
    cellWidth,
    pages: pager.pages.map((elements) => ({ elements })),
  };
}
