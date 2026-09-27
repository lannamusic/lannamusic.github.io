// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// Renderer settings.
//
// The values the specification fixes come from the settings table in
// reference/rendering/index.md. The specification deliberately leaves the
// typographic measurements open, so every number below that it does not state
// is marked OPEN and is a starting point to be judged against a printed score,
// not a value derived from anything.

export const defaults = {
  // A4 portrait in points. OPEN. marginSide is the left and right margin
  // alike (the grid always centers between them); marginTop and marginBottom
  // are independent of it and of each other, since a running header or a
  // deep footer may call for more room on one edge than the sides need.
  //
  // `infinite`: skip pagination altogether. Every page break in "Score
  // layout" exists to fit a fixed sheet of paper; a renderer with no such
  // sheet - a web preview, an arbitrarily tall export - has no reason to
  // insert one. `height` above is then a starting value only: the actual
  // page comes back however tall the content needs, still `width` wide with
  // the same margins on every edge, so no measure ever moves for it.
  page: {
    width: 595.28,
    height: 841.89,
    marginSide: 42,
    marginTop: 42,
    marginBottom: 42,
    infinite: false,
  },

  // Fixed by "The measure grid": the cell width is the usable width divided by
  // eight whatever a line actually holds.
  measuresPerRow: 8,

  // "A <rest> renders as a hyphen", and the default prints one for every rest
  // in every notated part.
  restGlyph: "-",
  printRests: "all",

  // "Case of romanized pitch letters: uppercase". Thai script is unaffected.
  pitchCase: "upper",

  // "Which pitch spelling appears: whichever of the three the file is
  // written in" - "source" prints each note's own spelling, unchanged.
  // "thai", "letter", or "number" re-spell every pitched note into that one
  // of the three spellings regardless of what the file used, per "A renderer
  // may offer to display a score in a spelling other than the one it is
  // written in" (reference/rendering, "Inside a measure").
  pitchSpelling: "source",

  // "Set a Thai score in Sarabun", with Noto Sans Thai as the stated fallback.
  fontFamily: "Sarabun, 'Noto Sans Thai', sans-serif",

  // OPEN, all of it.
  titleSize: 21,
  instrumentNameSize: 12,
  creditSize: 11,

  // Portrait cells are 64pt wide, and a beat carrying a group of three splits
  // one into six columns rather than four. That is what caps the type: much
  // above this and a dense measure has nowhere to put the extra width.
  pitchSize: 12,

  // Tall enough for a same-row link arc to sit under the notes without meeting
  // the rule below, allowing room for an octave dot hanging under a letter.
  rowHeight: 22,

  // The octave mark: a small dot above or below the letter, drawn as its own
  // shape rather than set as a diacritic in the font - see "Octave marks" in
  // reference/rendering. All OPEN, multiples of pitchSize so retuning
  // pitchSize carries the dot with it. octaveDotGapAbove clears the tallest
  // Thai letter's cap height; octaveDotGapBelow only needs to clear the
  // baseline, since a base note letter has no descender.
  octaveDotRadius: 0.08,
  octaveDotGapAbove: 0.85,
  octaveDotGapBelow: 0.2,

  // How much of the cell the run of symbols spans, the rest falling as equal
  // margins either side. OPEN. At 1 the columns divide the whole cell and the
  // margins come to half a column each.
  //
  // This sets the distance between beats, and so also the distance between a
  // beat and the group beside it. It does not reach inside a group, whose
  // symbols are held apart by minSymbolAdvance instead.
  spread: 0.7,

  // The link curve. A <link> span gets one: reaching the other rows of a
  // stacked instrument, or arcing over its own notes where the instrument has
  // only one row. Always above the notes, never below, which is where Thai
  // scores put their curves.
  //
  // All of it OPEN, and all of it a multiple of the type size, so retuning
  // pitchSize carries the curve with it instead of leaving it behind.
  //
  // How far above the baseline a curve attaches. Both kinds share it, so an
  // arc and a connector leaving the same row start at the same height. It has
  // to clear the tallest thing over a letter, which is an octave dot
  // (octaveDotGapAbove + octaveDotRadius).
  linkTop: 0.85,

  // How far the connector steps off the first note's centre, so it starts at
  // that letter's corner rather than on top of it. Roughly half a letter.
  linkSideStep: 0.4,

  // How far a same-row arc bows above its own ends. A ceiling rather than a
  // fixed height: a short rowHeight leaves less than this and wins.
  linkRise: 0.45,

  linkStroke: 0.8,

  // How close a beat's own symbols sit, as a multiple of the type size rather
  // than a fraction of the cell. A group has to read as one fast gesture
  // instead of as separate beats, and the slack that leaves falls to its left
  // because the last symbol is pinned to the arrival.
  //
  // How close a beat's own symbols sit, as a fraction of a column. OPEN.
  groupTightness: 0.7,

  // The tightest two symbols may sit, as a multiple of the type size. This is
  // a floor, not a ceiling: a group packs to whichever of the two is looser, so
  // it is as tight as it can be without the letters touching.
  //
  // The floor has to be here because the room available depends on the
  // measure. A cell holding a group of three divides into six columns rather
  // than four, so the same fraction of a column is a much smaller distance,
  // and on a portrait page it is already close to the width of a letter.
  minSymbolAdvance: 0.6,

  // The break at each nesting level, innermost first.
  //
  // Which level draws which value is not fixed, because "Score layout" says to
  // skip any level with only one member and then give the innermost of what is
  // left no break at all, each level outward getting a larger one. So a solo
  // single-row score uses the first two of these and a mixed ensemble uses all
  // four, and the same list produces every arrangement in that table.
  //
  // OPEN as measurements.
  gapScale: [0, 8, 18, 30],

  // Annotations. These are the arranger's own words, so they print at reading
  // size rather than as headings: the renderer is not deciding that a section
  // heading matters more than a note about sound codes. OPEN.
  annotationSize: 11,
  annotationGap: 6,

  // Line spacing where an annotation is long enough to wrap, as a multiple of
  // its type size. OPEN.
  annotationLeading: 1.35,

  titleGap: 26,
  bandGap: 18,

  // "A renderer may offer to print name as a heading for a score whose
  // annotations are sparse." Off by default: it prints unconditionally, with
  // no way to tell an authored heading from an unrelated annotation, so a
  // score that already writes its own headings would get doubled text.
  generateSectionName: false,

  // "A renderer may offer to show them, but no printed convention places
  // them" - <tuning> and <license> from <header>, and <bpm> from whichever
  // <direction> sits in the title band. <nathap> is excluded: its own
  // Rendering section says it is not printed, full stop, not an opt-in
  // choice the way these three are. Off by default, and the placement and
  // size below are a first pass with nothing to judge them against, since
  // the spec names no convention for it. OPEN.
  showHeaderExtras: false,
  headerExtraSize: 9,

  // Lyric rows. A syllable is several times wider than a pitch letter and
  // nothing widens the cell to help, so "Lyric rows" allows setting the row
  // smaller to buy some of that room back. OPEN.
  lyricSize: 10,

  // Words that will not fit where their beats are. Two things give, in this
  // order: the syllables shift off their arrivals into whatever room the cell
  // has left, and if that is still not enough that one measure sets smaller,
  // down to lyricMinSize. Both are best effort - a word can be wider than the
  // cell on its own, and then it simply overhangs.
  //
  // Shifting first is deliberate. The alignment is worth more than the type
  // size on a measure that misses by a little, and a beat's syllable is still
  // recognisably under its beat once it has moved a few points.
  //
  // Sizes are x the lyric size, so they hold as that changes. lyricGap is the
  // clear space between neighbouring syllables and lyricPad the same at the
  // cell's two edges, which is what keeps a word off the barline. OPEN, all
  // three: nothing printed settles them.
  lyricGap: 0.3,
  lyricPad: 0.25,
  lyricMinSize: 6,

  // Bow spans. Drawn as an arc above the row - "in" domes up toward the row
  // above, "out" is the same arc mirrored back down toward the row's own
  // notes, the direction itself being the "tips pointing down"/"pointing
  // up" the spec describes rather than a separate mark at the tip.
  //
  // "in" ties its tip height to linkTop, the same a same-row link curve
  // uses. "out" needs a taller anchor of its own (bowTop): it dips down
  // from the tip by the same bowRise, and doing that from linkTop's height
  // would cut into the note glyphs rather than clearing them. Neither is
  // clamped to the row's own height the way a link curve's rise is - a link
  // marks its notes and belongs to them, where a bow is a stroke over the
  // passage and is expected to reach past the row's ruling into the gap
  // above, however long either one runs. All OPEN, and judged
  // against a printed score the way the link curve was: this is a first
  // pass, not a settled convention.
  bowTop: 1.05,
  bowRise: 0.4,
  bowStroke: 0.8,

  // A bow marked on a single note has nothing to span - its start and stop
  // resolve to the same note - so this is the width the arc spreads to
  // instead of collapsing to a point, x pitchSize, centered on the note.
  bowMinSpan: 1,

  // Cued passages. A parenthesis span prints its brackets at pitchSize; no
  // width setting needed since the glyphs come from the font. Dimming is the
  // renderer's own default here, overridden per span by `dim`, per "Cued
  // passages": both the brackets and the notes between them take the dimmed
  // color. `mute` has no visual effect at all - it is a playback instruction
  // this renderer, producing only static SVG, has no way to act on.
  dimParenthesisDefault: false,
  dimColor: "#999",

  // Instrument-name label column. On for every ensemble score, off for a
  // solo one (which already carries its name top-right) - null means let
  // layout() decide from the score's part count. true/false override that
  // for every score laid out with these settings. Labels take their width
  // from the margin rather than from the eight cells, so they never move the
  // grid: printed just left of it, in the blank margin band.
  showLabels: null,
  labelSize: 10,
  labelGap: 0.4,

  // Repeat brackets: a bracket in the margin right of the grid. OPEN.
  repeatBracketGap: 0.8, // gap between the grid and the bracket, x pitchSize
  repeatBracketDepth: 0.5, // how far the bracket's arms reach in, x pitchSize
  repeatBracketStroke: 0.8,
  repeatLabelSize: 10,
};
