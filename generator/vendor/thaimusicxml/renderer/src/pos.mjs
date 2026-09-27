// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// Where a part's symbol lives, addressed independently of page coordinates.
// The grid pass (grid.mjs) records one of these for every symbol it places;
// the span pass (spans.mjs) reads them back to find where a bow, parenthesis,
// or link marker's true ends landed, once every line the span touches has
// already been drawn.
export const posKey = (partId, pos) =>
  `${partId}:${pos.lineIndex}:${pos.measureIndex}:${pos.beatIndex}:${pos.slotIndex}`;

// Lexicographic order over a note's position indices - line, then measure,
// beat, slot - matching the document order resolveSpans() walks a part's
// lines in. Used to test whether a position falls inside a resolved span.
export const comparePos = (a, b) =>
  a.lineIndex - b.lineIndex || a.measureIndex - b.measureIndex || a.beatIndex - b.beatIndex || a.slotIndex - b.slotIndex;

// The same order stopping at the beat, for a link span reaching the other rows
// of a stack. Slot indices do not correspond across parts - one row may play a
// group of two where another plays a group of three - so a sibling row's
// contribution is measured in whole beats, which every part does agree on.
export const compareBeat = (a, b) =>
  a.lineIndex - b.lineIndex || a.measureIndex - b.measureIndex || a.beatIndex - b.beatIndex;
