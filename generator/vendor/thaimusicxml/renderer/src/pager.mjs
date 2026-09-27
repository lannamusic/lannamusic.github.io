// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// Pagination: where the cursor sits on the current page, which page is
// "active" for a plain push(), and when a break forces a fresh one. Isolated
// from the content it paginates - annotations, grid lines, spans, all of
// which layout.mjs and grid.mjs decide - so this module only ever answers
// "where am I" and "do I need a new page", never "what goes here".
//
// "Where a section runs past the bottom margin it continues on the next
// page... Do not split one line's part rows across a page: a line's rows
// belong together." That rule generalizes to every atomic thing layout.mjs
// places: an annotation block, a blank line, and a grid line each move to a
// fresh page whole rather than being cut by the bottom margin.
//
// A break is held in `pending` until something is actually drawn under it,
// then spent once via spend(). Without that, text landing between two grids
// would take the gap on both sides. ensureRoom() is checked before the
// pending break is spent, since spending it is what actually commits the
// vertical position.
//
// `page.infinite` drops the bottom edge entirely rather than raising it: a
// pageBottom of Infinity means ensureRoom()'s comparison never holds, so
// newPage() is never called and everything lands on the one page, however
// tall that ends up being.

/**
 * @param {object} pageSettings settings.page - width/height/margins/infinite
 * @returns {object} the pager: mutable `y`, `pending`, `page` fields, an
 *   always-current `pages` array of element arrays, and the methods below
 */
export function createPager(pageSettings) {
  const pageTop = pageSettings.marginTop;
  const pageBottom = pageSettings.infinite ? Infinity : pageSettings.height - pageSettings.marginBottom;

  const pages = [[]];
  let activeSink = pages[0];

  const pager = {
    page: 0,
    y: pageTop,
    pending: 0,
    pages,

    push(el) {
      activeSink.push(el);
    },

    // For an element whose page was decided earlier - a repeat bracket or a
    // bow span, both drawn only once every line touching them is already laid
    // out and may be several lines, and pages, behind by then.
    pushTo(pageIndex, el) {
      pages[pageIndex].push(el);
    },

    newPage() {
      pager.page += 1;
      pages.push([]);
      activeSink = pages[pager.page];
      pager.y = pageTop;
      pager.pending = 0;
    },

    // The `y > pageTop` guard is what stops a block taller than a whole page
    // from looping forever: once a break has already put it at the top of a
    // fresh page, it is placed there even if it still overflows, because
    // there is nowhere else to put it.
    ensureRoom(height, cap = Infinity) {
      if (pager.y > pageTop && pager.y + Math.min(pager.pending, cap) + height > pageBottom) pager.newPage();
    },

    // What a capped spend does not use stays owed, so a trailing line taking
    // its small break does not swallow the section break behind it.
    spend(cap = Infinity) {
      const taken = Math.min(pager.pending, cap);
      pager.y += taken;
      pager.pending -= taken;
    },

    // Runs fn() as though laying out onto a throwaway page at the top margin,
    // then restores the real cursor - used to measure a block's height
    // without actually placing it. Anything fn() draws along the way (a
    // box's own annotations, say) lands on the scratch sink and is discarded
    // with it.
    withScratch(fn) {
      const savedSink = activeSink;
      const savedY = pager.y;
      const savedPending = pager.pending;
      activeSink = [];
      pager.y = 0;
      pager.pending = 0;
      try {
        return fn();
      } finally {
        activeSink = savedSink;
        pager.y = savedY;
        pager.pending = savedPending;
      }
    },
  };

  return pager;
}
