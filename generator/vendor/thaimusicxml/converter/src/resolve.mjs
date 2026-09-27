// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// Structural resolution shared by every converter target: pass counts, line
// order (line-repeat expanded), ending substitution, and rest folding. See
// reference/conversion in the docs for the policy this implements.
//
// renderer/src/parse.mjs already reads header/parts/music (lines, beats,
// slots, bow and parenthesis spans) well and is reused as-is. What it
// deliberately does not do is unroll <repeat>, since the static page
// renderer draws a section once regardless of how many times it plays. This
// module adds that layer on top rather than duplicating parse.mjs's XML walk.

const { DOMParser } = globalThis;
import { parse } from "../../renderer/src/parse.mjs";
import { frac, add, subtract, compare, ZERO } from "./fraction.mjs";

const NS = "https://thaimusicxml.anan.ovh/ns/1";

const els = (node, name) =>
  Array.from(node.getElementsByTagNameNS(NS, name)).filter((el) => el.parentNode === node);

/**
 * Runs `fn`, rethrowing anything it throws with `context` prepended. Applied
 * at nested granularities (part, then section+pass, then line) so an
 * otherwise-opaque crash deep in resolution - an undefined access, a bad
 * assumption about document shape - comes out naming exactly which part,
 * section, pass, and line it happened in, layer by layer, instead of a bare
 * "Cannot read properties of undefined" with no way to find the offending
 * XML.
 */
function withContext(context, fn) {
  try {
    return fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${context}: ${message}`, { cause: err });
  }
}

// The plays a <repeat> or <line-repeat> without times is worth. See <repeat>.
const DEFAULT_TIMES = 2;

/**
 * <structure> expanded into the sequence the piece is actually played in:
 * one entry per play of a section, carrying that play's absolute pass number.
 *
 * Repeats are expanded rather than carried as a multiplier, because the
 * multiplier alone cannot say what order the plays fall in. A <repeat times="2">
 * around two sections plays A B A B (see <repeat>), so A's two passes are not
 * adjacent, and a section reached twice through <play> is the same problem
 * again. Expanding gets the order right by construction.
 *
 * `pass` counts plays of that section from the first to the last, absolutely,
 * however they were produced - which is what <ending>'s own `pass` attribute
 * counts. `totalPasses` is that count's ceiling, the same on every entry for
 * a given section.
 */
function playOrder(structureEl) {
  const out = [];
  const played = new Map();
  const nextPass = (id) => {
    const pass = (played.get(id) ?? 0) + 1;
    played.set(id, pass);
    return pass;
  };

  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue;
      if (child.localName === "repeat") {
        const times = child.hasAttribute("times") ? Number(child.getAttribute("times")) : DEFAULT_TIMES;
        for (let t = 0; t < times; t++) walk(child);
      } else if (child.localName === "section" || child.localName === "play") {
        // <section> declares the section and takes its first place in the
        // order; <play> takes another. Neither is distinguishable here - both
        // are one play of the same music.
        const id =
          child.localName === "section"
            ? child.getAttribute("id")
            : child.getAttribute("section");
        out.push({ kind: "section", id, pass: nextPass(id) });
      } else if (child.localName === "direction") {
        const chanEl = els(child, "chan")[0];
        const bpmEl = els(child, "bpm")[0];
        out.push({
          kind: "direction",
          chan: chanEl ? chanEl.getAttribute("value") : null,
          bpm: bpmEl ? Number(bpmEl.textContent.trim()) : null,
        });
      } else if (child.localName === "annotation") {
        out.push({ kind: "annotation" });
      } else if (child.localName === "br") {
        out.push({ kind: "br" });
      }
    }
  };
  walk(structureEl);
  for (const item of out)
    if (item.kind === "section") item.totalPasses = played.get(item.id);
  return out;
}

/**
 * <line-repeat> ranges as a forest: a range's children are the ranges
 * properly nested directly inside it. Ranges are guaranteed nested or
 * disjoint, never partially overlapping, so a first-ascending sort plus a
 * containment stack is enough to build it. See <line-repeat>'s Conformance.
 */
function buildRangeForest(ranges) {
  const sorted = [...ranges].sort((a, b) => a.first - b.first);
  const forest = [];
  const stack = [];
  for (const r of sorted) {
    const node = { ...r, children: [] };
    while (stack.length && stack[stack.length - 1].last < r.first) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else forest.push(node);
    stack.push(node);
  }
  return forest;
}

/** One line number in document order for every line a range plays, its own nested ranges included. */
function expandRange(node) {
  const seq = [];
  const childByFirst = new Map(node.children.map((c) => [c.first, c]));
  let l = node.first;
  while (l <= node.last) {
    const child = childByFirst.get(l);
    if (child) {
      for (let t = 0; t < (child.times || DEFAULT_TIMES); t++) seq.push(...expandRange(child));
      l = child.last + 1;
    } else {
      seq.push(l);
      l++;
    }
  }
  return seq;
}

/**
 * The order lines play in for one pass of a section, line-repeat ranges
 * expanded. Independent of which pass: a line-repeat re-triggers identically
 * on every pass, only the content of a given line number varies by pass (via
 * <ending>). See <line-repeat>.
 */
function lineOrder(lineCount, ranges) {
  const forest = buildRangeForest(ranges);
  const topByFirst = new Map(forest.map((n) => [n.first, n]));
  const order = [];
  let l = 1;
  while (l <= lineCount) {
    const node = topByFirst.get(l);
    if (node) {
      for (let t = 0; t < (node.times || DEFAULT_TIMES); t++) order.push(...expandRange(node));
      l = node.last + 1;
    } else {
      order.push(l);
      l++;
    }
  }
  return order;
}

/** Which <ending>, if any, replaces line `lineNumber` on pass `pass`. */
function endingFor(endings, lineNumber, pass) {
  for (const ending of endings) {
    if (!ending.pass.includes(pass)) continue;
    const line = ending.lines.find((l) => l.number === lineNumber);
    if (line) return line;
  }
  return null;
}

/**
 * The line a part actually plays at `number` on `pass`: the section-ref's
 * base line, with any <ending> override applied. In a notated part, a
 * completely empty measure in that override (no beats at all) means
 * "unchanged from the line being replaced" - see ending.md's "Unchanged
 * measures" - so it's swapped back for the base line's own measure at that
 * position rather than read as a real zero-length measure. A lyric part's
 * empty measure keeps its own, different meaning (nothing sung, per
 * syllable.md) and is never substituted this way.
 */
function effectiveLine(sectionMusic, number, pass, isLyric) {
  const base = sectionMusic.lines.find((l) => l.number === number);
  const override = endingFor(sectionMusic.endings, number, pass);
  if (!override || isLyric) {
    const line = override ?? base;
    if (!line) throw new Error(`line ${number} is referenced but this part's section has no such line notated`);
    return line;
  }
  return {
    ...override,
    measures: override.measures.map((m, i) => {
      if (m.beats.length !== 0) return m;
      if (!base) {
        throw new Error(
          `line ${number}, measure ${i + 1}: <ending> leaves this measure empty to mean "unchanged", but this part's section has no line ${number} to inherit from`,
        );
      }
      const baseMeasure = base.measures[i];
      if (!baseMeasure) {
        throw new Error(
          `line ${number}, measure ${i + 1}: <ending> leaves this measure empty to mean "unchanged", but line ${number}'s own base has no measure ${i + 1}`,
        );
      }
      return baseMeasure;
    }),
  };
}

/**
 * Every slot in one measure, flattened across beats and <group> members,
 * each landing at the position group.md and the renderer's arrivals() both
 * use: a beat or group arrives on its last slot, so a k-way split's final
 * member coincides with where a plain note at that beat would fall, and the
 * earlier members run up to it from before. Beat i (0-based) holds k slots
 * at onset i-(k-1-j)/k for member j - the k=1 case reduces to onset i, a
 * plain beat's own position, unchanged.
 */
function flattenBeats(beats) {
  const flat = [];
  beats.forEach((beat, i) => {
    const k = beat.slots.length;
    beat.slots.forEach((slot, j) => {
      flat.push({ onset: frac(i * k - (k - 1 - j), k), slot });
    });
  });
  return flat;
}

/**
 * One measure's slots folded into resolved notes: a <rest> extends the
 * previous note's duration rather than sounding as silence, capped at this
 * measure's own boundary. See reference/conversion's "Rests". Every kept
 * event's duration reaches to the next kept event's onset, not to a fixed
 * share of its own beat: a <group> member's next attack may be its own
 * sibling a fraction of a beat away, or, for a group's last member, nothing
 * closer than the next beat entirely - and the same reach applies to a rest
 * with nothing sounding yet before it, which a following group's early
 * members can cut short by attacking before its beat would otherwise end.
 *
 * `siblingAttacks` are onsets, local to this same measure, of every note in
 * a sibling row of the same <ensemble> stack. A stack is one physical
 * instrument (see link.md), so a note's decay stops mattering the
 * moment *any* row of it strikes again, not only its own. This only ever
 * shortens a note whose own row left its length undetermined - a rest was
 * absorbed after it, or its row simply has nothing more written this
 * measure - never one whose own row's next note follows it with no gap,
 * which is an explicit choice a sibling's activity shouldn't override (that
 * would flatten deliberate interlocking, one hand holding while the other
 * moves, into a single shared grain).
 *
 * A note that reaches this measure's own end with nothing - not even a
 * sibling - left to cap it is marked `openEnded`. Its `duration` still stops
 * dead at the barline here, same as always: this function has no idea
 * whether the output will move anything relative to that barline. It's
 * `openEnded` that lets a consumer which *does* know that (`to-musicxml.mjs`,
 * under the downbeat shift) decide the note may claim more of what it now
 * visually occupies, without this module taking a position on it.
 */
function foldMeasure(beats, siblingAttacks = []) {
  const flat = flattenBeats(beats);
  const kept = [];
  let sounding = false;
  flat.forEach(({ onset, slot }, flatIndex) => {
    if (slot.kind === "note") {
      kept.push({ onset, flatIndex, pitch: slot.pitch, sound: slot.sound, octave: slot.octave });
      sounding = true;
    } else if (!sounding) {
      kept.push({ onset, flatIndex, rest: true });
    }
  });
  kept.forEach((note, idx) => {
    const end = idx + 1 < kept.length ? kept[idx + 1].onset : frac(beats.length);
    const nextFlat = flat[note.flatIndex + 1];
    const explicit = nextFlat?.slot.kind === "note";
    let cappedEnd = end;
    if (!note.rest && !explicit) {
      for (const attack of siblingAttacks) {
        if (compare(attack, note.onset) > 0 && compare(attack, cappedEnd) < 0) cappedEnd = attack;
      }
    }
    note.duration = subtract(cappedEnd, note.onset);
    if (!note.rest && idx === kept.length - 1 && compare(cappedEnd, end) === 0) note.openEnded = true;
    delete note.flatIndex;
  });
  return kept;
}

/**
 * One lyric measure's items (syllable.md's counting rule) as syllable events
 * with a within-measure onset: item i of n lands at `beatCount * i / n`,
 * which reduces to the exact beat position when n equals beatCount (the
 * "match the beat count" case) and spreads evenly across the measure
 * otherwise (the "centered in the cell" case, given a definite time for
 * export purposes rather than the purely visual grouping the renderer uses).
 * `<rest>` items still occupy a slot in that spacing - see "Rests count as
 * items" - but are dropped from the output, since a rest means no new
 * syllable begins there.
 */
function foldLyricMeasure(items, beatCount) {
  const n = items.length;
  if (n === 0) return [];
  const out = [];
  items.forEach((item, i) => {
    if (item.kind !== "syllable") return;
    out.push({ onset: frac(beatCount * i, n), text: item.text });
  });
  return out;
}

/**
 * One pass of a lyric part's syllables over the section, using the paired
 * target part's own line/measure/beat structure for both the beat-grid a
 * measure's items align against and the cursor advance - the two must agree
 * exactly with what `resolveSectionPass` computes for that same target part,
 * since a syllable's onset only means anything alongside the target's own
 * resolved notes. `lyricSectionMusic` is null when the lyric part has no
 * content for this section; the cursor still advances by the target's own
 * length so later sections stay aligned.
 */
function resolveLyricSectionPass(lyricSectionMusic, targetSectionMusic, ranges, pass) {
  const lineCount = targetSectionMusic.lines.length;
  const order = lineOrder(lineCount, ranges);
  const syllables = [];
  let cursor = ZERO;
  for (const number of order) {
    const targetLine = effectiveLine(targetSectionMusic, number, pass, false);
    const lyricLine = lyricSectionMusic ? effectiveLine(lyricSectionMusic, number, pass, true) : null;
    targetLine.measures.forEach((measure, measureIndex) => {
      withContext(`line ${number} measure ${measure.number}`, () => {
        const beatCount = measure.beats.length;
        const lyricMeasure = lyricLine?.measures[measureIndex];
        if (lyricMeasure) {
          for (const { onset, text } of foldLyricMeasure(lyricMeasure.items, beatCount)) {
            syllables.push({ onset: add(cursor, onset), text, line: number, measure: measure.number });
          }
        }
        cursor = add(cursor, frac(beatCount));
      });
    });
  }
  return { syllables, length: cursor };
}

/** Onsets, local to one measure, of every note (not rest) a stack's sibling row plays there. */
function siblingAttackOnsets(siblingMeasures) {
  const onsets = [];
  for (const measure of siblingMeasures) {
    if (!measure) continue;
    for (const { onset, slot } of flattenBeats(measure.beats)) {
      if (slot.kind === "note") onsets.push(onset);
    }
  }
  return onsets;
}

/** Total slot duration of one measure, before folding: the number of beats, each one slot. */
const measureLength = (beats) => frac(beats.length);

/**
 * The resolved note timeline for one part's play of one section on one pass:
 * line order expanded, ending substitutions applied, rests folded per
 * measure, onsets made cumulative across the pass. Independent of any
 * enclosing <repeat>, since a repeat replays this same resolution unchanged
 * on each of its passes.
 */
function resolveSectionPass(sectionMusic, ranges, pass, siblingSectionMusics = [], isLyric = false) {
  const lineCount = sectionMusic.lines.length;
  const order = lineOrder(lineCount, ranges);
  const notes = [];
  const measureBoundaries = [];
  let cursor = ZERO;
  for (const number of order) {
    // effectiveLine's own errors already name the line (and, where relevant,
    // the measure) they came from - no need to re-wrap those. The measure
    // loop below needs its own wrap, since foldMeasure/siblingAttackOnsets
    // know neither.
    const line = effectiveLine(sectionMusic, number, pass, isLyric);
    // A stack's sibling rows are always notated (siblingIdsOf excludes
    // type="lyric"), so their own ending substitutions get the same
    // inherit-empty-measures treatment regardless of the calling part's type.
    const siblingLines = siblingSectionMusics.map((sm) => effectiveLine(sm, number, pass, false));
    line.measures.forEach((measure, measureIndex) => {
      withContext(`line ${number} measure ${measure.number}`, () => {
        const siblingAttacks = siblingAttackOnsets(siblingLines.map((sl) => sl?.measures[measureIndex]));
        for (const note of foldMeasure(measure.beats, siblingAttacks)) {
          notes.push({ ...note, onset: add(cursor, note.onset), line: number, measure: measure.number });
        }
        cursor = add(cursor, measureLength(measure.beats));
        measureBoundaries.push(cursor);
      });
    });
  }
  return { notes, length: cursor, measureBoundaries };
}

export function resolve(source, { warn = () => {} } = {}) {
  const parsed = parse(source, { warn });
  const doc = new DOMParser().parseFromString(source, "text/xml");
  const structureEl = els(doc.documentElement, "structure")[0];
  const order = playOrder(structureEl);
  const rangesBySection = Object.fromEntries(
    parsed.sections.map((s) => [s.id, s.lineRepeats]),
  );

  /** Other notated rows of the same <ensemble> stack - a lyric row has no beats to strike, so it's excluded, per link.md. */
  function siblingIdsOf(partId) {
    const part = parsed.parts.find((p) => p.id === partId);
    if (!part?.stack) return [];
    return parsed.parts
      .filter((p) => p.stack === part.stack && p.id !== partId && p.type !== "lyric")
      .map((p) => p.id);
  }

  /** Every pass of one part's section occurrence, 1-based. */
  function resolveSection(partId, sectionId, totalPasses) {
    const sectionMusic = parsed.music[partId]?.[sectionId];
    if (!sectionMusic) return null;
    const isLyric = parsed.parts.find((p) => p.id === partId)?.type === "lyric";
    const ranges = rangesBySection[sectionId] ?? [];
    const siblingSectionMusics = siblingIdsOf(partId)
      .map((id) => parsed.music[id]?.[sectionId])
      .filter(Boolean);
    const passes = [];
    for (let pass = 1; pass <= totalPasses; pass++) {
      passes.push({
        pass,
        ...withContext(`part "${partId}" section "${sectionId}" pass ${pass}`, () =>
          resolveSectionPass(sectionMusic, ranges, pass, siblingSectionMusics, isLyric),
        ),
      });
    }
    return { sectionId, totalPasses, passes };
  }

  /**
   * A section's own shape (line/measure/beat counts, hence length and
   * measure grid) as resolved from whichever notated part actually
   * references it - used to advance a part that leaves the section out
   * entirely (see section-ref.md's "A part may leave out a section
   * entirely") in lockstep with the rest of the ensemble. section-ref's own
   * Conformance rule guarantees every part that *does* reference a section
   * agrees on this shape, so any one of them is an equally valid stand-in;
   * a lyric part is skipped as a candidate since its measures hold syllable
   * items rather than beats and have no comparable shape to borrow. `null`
   * only when no notated part anywhere references the section either - a
   * section that exists in `<structure>` but nothing ever plays.
   */
  // resolveSection() resolves all of a section's passes at once, and
  // playOrder() now asks for them one play at a time, so the result is kept
  // rather than rebuilt per play. Keyed by part and section; a section's
  // total pass count is fixed for the whole document.
  const resolutionCache = new Map();
  function sectionResolution(partId, sectionId, totalPasses) {
    const key = `${partId}\u0000${sectionId}`;
    if (!resolutionCache.has(key))
      resolutionCache.set(key, resolveSection(partId, sectionId, totalPasses));
    return resolutionCache.get(key);
  }

  function referenceSectionResolution(sectionId, totalPasses) {
    const candidate = parsed.parts.find(
      (p) => p.type !== "lyric" && parsed.music[p.id]?.[sectionId],
    );
    return candidate ? resolveSection(candidate.id, sectionId, totalPasses) : null;
  }

  /**
   * Every part's notes, concatenated in true playback order across the whole
   * piece. A section this part leaves out entirely (no `<section-ref>`, a
   * valid way to sit out - see section-ref.md) contributes no notes of its
   * own, but the cursor and measure grid still have to advance by that
   * section's real length so this part's later sections stay aligned with
   * every other part's - `referenceSectionResolution` borrows another part's
   * resolution of the same section for that shape alone.
   */
  function unroll(partId) {
    const notes = [];
    const measureBoundaries = [];
    let cursor = ZERO;
    let bpm = null;
    const tempoChanges = [];
    const chanChanges = [];
    for (const item of order) {
      if (item.kind === "direction") {
        if (item.bpm) bpm = item.bpm;
        if (bpm !== null) tempoChanges.push({ onset: cursor, bpm });
        if (item.chan) chanChanges.push({ onset: cursor, chan: item.chan });
        continue;
      }
      if (item.kind !== "section") continue;
      const resolved =
        sectionResolution(partId, item.id, item.totalPasses) ??
        referenceSectionResolution(item.id, item.totalPasses);
      if (!resolved) continue;
      const thisPass = resolved.passes[item.pass - 1];
      if (!thisPass) continue;
      const ownNotes = parsed.music[partId]?.[item.id] != null;
      const { notes: passNotes, length, measureBoundaries: passBoundaries } = thisPass;
      if (ownNotes)
        for (const note of passNotes)
          notes.push({ ...note, onset: add(cursor, note.onset), section: resolved.sectionId });
      for (const b of passBoundaries) measureBoundaries.push(add(cursor, b));
      cursor = add(cursor, length);
    }
    return { notes, tempoChanges, chanChanges, measureBoundaries };
  }

  /**
   * A lyric part's syllables, paired to `targetPartId` for the beat-grid
   * each measure aligns against, concatenated across the whole piece in the
   * same playback order and cursor units as `unroll(targetPartId)` - see
   * resolveLyricSectionPass. A section the target leaves out entirely has no
   * beat-grid for a syllable to align against there, so no syllables come
   * from it, but the cursor still has to advance by the section's real
   * length (via `referenceSectionResolution`, the same fallback `unroll`
   * uses) so later sections stay aligned with `unroll(targetPartId)`'s own,
   * now-corrected units.
   */
  function unrollLyrics(lyricPartId, targetPartId) {
    const syllables = [];
    let cursor = ZERO;
    for (const item of order) {
      if (item.kind !== "section") continue;
      const targetSectionMusic = parsed.music[targetPartId]?.[item.id];
      if (!targetSectionMusic) {
        const reference = referenceSectionResolution(item.id, item.totalPasses);
        const thisPass = reference?.passes[item.pass - 1];
        if (thisPass) cursor = add(cursor, thisPass.length);
        continue;
      }
      const lyricSectionMusic = parsed.music[lyricPartId]?.[item.id] ?? null;
      const ranges = rangesBySection[item.id] ?? [];
      const { syllables: passSyllables, length } = withContext(
        `lyric part "${lyricPartId}" (paired to "${targetPartId}") section "${item.id}" pass ${item.pass}`,
        () => resolveLyricSectionPass(lyricSectionMusic, targetSectionMusic, ranges, item.pass),
      );
      for (const s of passSyllables) syllables.push({ ...s, onset: add(cursor, s.onset) });
      cursor = add(cursor, length);
    }
    return syllables;
  }

  return { ...parsed, playOrder: order, resolveSection, unroll, unrollLyrics };
}
