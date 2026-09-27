// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// ThaiMusicXML -> MusicXML. See reference/conversion in the docs for the
// mapping policy this implements.
//
// v1.0 of this writer always unrolls play order (every pass of every
// repeated section becomes its own plain measures) rather than emitting
// native repeat barlines and volta endings. The docs describe native
// encoding as the eventual default; this is a staged interim step so a
// working converter exists sooner, not a change of the documented policy.

import { resolveTuning, resolvePitch } from "./pitch.mjs";
import { ticksPerSlot, encodeDuration } from "./musicxml-durations.mjs";
import { compare, add, subtract, frac, isZero, ZERO } from "./fraction.mjs";
import { groupParts } from "./ensemble-groups.mjs";

/** The output's own beat: 2/4 time, so a quarter note - two note slots. */
const BEAT_SLOTS = 2;

/** How far `downbeatShift` moves the music: one note slot, an eighth note. */
const SHIFT = frac(1);

const escapeXml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One of <text> children's three positions, or plain content: whichever is present, preferring center. */
const creditText = (aligned) => (aligned ? (aligned.center ?? aligned.left ?? aligned.right) : null);

/** Every denominator appearing in a part's re-cut events, for sizing this piece's <divisions>. */
function denominatorsOf(measures) {
  const out = [];
  for (const items of measures) for (const item of items) out.push(item.onset.d, item.duration.d);
  return out;
}

/** Stable map key for an exact-fraction onset, used to match a syllable to the note it lands on. */
const onsetKey = (f) => `${f.n}/${f.d}`;

const timeModification = (tuplet) =>
  tuplet
    ? `<time-modification><actual-notes>${tuplet.actual}</actual-notes><normal-notes>${tuplet.normal}</normal-notes></time-modification>`
    : "";

/**
 * Where a resolved note came from in the source, for a warning message: its
 * part, section, and written line/measure. A `<repeat>` or `<line-repeat>`
 * can replay that same written line/measure several times over the course
 * of the piece - `dedupeWarn` (below) is what collapses those replays back
 * down to the one warning the single underlying source note deserves, not
 * this label, which stays the same across every replay on purpose.
 */
function noteLocation(memberId, note) {
  return `part "${memberId}" section "${note.section}" line ${note.line} measure ${note.measure}`;
}

/**
 * One re-cut event as its head markup plus its tied MusicXML duration
 * segments, in order, and whether it ended up a rest. `ctx.isUnpitched` is
 * the event's own part's declared type; a note whose `sound`/`pitch` doesn't
 * match it (a type mismatch invalid per note.md's Conformance) has no
 * meaningful notehead on either reading and converts as a rest instead, with
 * a warning - the same "soft violation, still produce a playable/printable
 * file" degrade the MIDI writer uses for the same case.
 */
function describeNote(note, ctx) {
  const segments = encodeDuration(note.duration, ctx.slotTicks, ctx.divisions);
  if (note.rest) return { head: "<rest/>", segments, rest: true };

  const usesSound = note.sound !== null && note.sound !== undefined;
  if (usesSound !== ctx.isUnpitched) {
    const value = usesSound ? `sound "${note.sound}"` : `pitch "${note.pitch}${note.octave ?? ""}"`;
    ctx.warn(
      `${noteLocation(ctx.memberId, note)} (part type="${ctx.isUnpitched ? "unpitched" : "pitched"}"): a note carries ${value}, which doesn't match its declared type; treating it as a rest`,
    );
    return { head: "<rest/>", segments, rest: true };
  }

  const head = usesSound
    ? // Unpitched: one fixed notehead position, since sound codes have no
      // defined mapping to a staff position. See "Unpitched and lyric parts".
      `<unpitched><display-step>B</display-step><display-octave>4</display-octave></unpitched>`
    : (() => {
        const pitch = resolvePitch(note.pitch, note.octave, ctx.tuning);
        return `<pitch><step>${pitch.step}</step>${pitch.alter ? `<alter>${pitch.alter}</alter>` : ""}<octave>${pitch.octave}</octave></pitch>`;
      })();
  return { head, segments, rest: false };
}

/**
 * Flatten one staff's measure of re-cut events into one segment per printed
 * note, each carrying its tie marks so the render step doesn't need to
 * re-derive them. A tie has two independent sources: one event may need
 * several printed durations tied together (`encodeDuration`), and one note
 * may already have been cut in two by `recut` at a measure boundary
 * (`tieIn`/`tieOut`) - a segment in the middle of that chain carries both a
 * stop and a start. Rests never tie, however they were split.
 *
 * `ctx.lyricTexts`, when given, is this staff's onset -> syllable-text lookup
 * (see resolveLyricAssignments); it attaches only to a note's own attack -
 * never a tied continuation, whichever kind - since that's where the
 * syllable is sung.
 */
function flattenSegments(items, ctx) {
  const out = [];
  for (const item of items) {
    if (item.wholeMeasure) {
      // A bar nothing sounds in prints as one centred whole-measure rest,
      // whatever the measure's own length, rather than as however many
      // written values that length happens to decompose into.
      out.push({ head: `<rest measure="yes"/>`, ticks: ctx.measureTicks, type: null, dots: 0, tuplet: null });
      continue;
    }
    const { head, segments, rest } = describeNote(item, ctx);
    const lyric = !rest && !item.tieIn && ctx.lyricTexts ? ctx.lyricTexts.get(onsetKey(item.onset)) : undefined;
    segments.forEach(({ ticks, type, dots, tuplet }, i) => {
      out.push({
        head,
        ticks,
        type,
        dots,
        tuplet,
        tieStop: !rest && (i > 0 || Boolean(item.tieIn)),
        tieStart: !rest && (i < segments.length - 1 || Boolean(item.tieOut)),
        lyric: i === 0 ? lyric : undefined,
      });
    });
  }
  return out;
}

/**
 * A <tuplet> bracket needs explicit start/stop markers, not just a
 * <time-modification> on each note - without them, a reader can't tell a
 * tied continuation note is still inside the same bracket, and may revert
 * that one note to its unscaled face value, throwing the measure's total
 * off by the tuplet's own scaling. This finds each contiguous run of
 * same-ratio tuplet segments and marks its first/last item.
 */
function assignTupletBrackets(items) {
  const marks = items.map(() => []);
  const sameRatio = (a, b) => a.actual === b.actual && a.normal === b.normal;
  let open = null; // { ratio, startIndex }
  items.forEach((it, i) => {
    if (it.tuplet) {
      if (!open) {
        marks[i].push("start");
        open = { ratio: it.tuplet, startIndex: i };
      } else if (!sameRatio(open.ratio, it.tuplet)) {
        marks[i - 1].push("stop");
        marks[i].push("start");
        open = { ratio: it.tuplet, startIndex: i };
      }
    } else if (open) {
      marks[i - 1].push("stop");
      open = null;
    }
  });
  if (open) marks[items.length - 1].push("stop");
  return items.map((it, i) => ({ ...it, tupletMarks: marks[i] }));
}

/** One flattened, tuplet-bracketed segment as a complete MusicXML <note> element, in DTD child order. */
function renderSegment(item, staff) {
  // A tie stop is written before a tie start, so a segment in the middle of
  // a tied chain reads "arrive, then carry on" in both the sounding <tie>
  // and the printed <tied>.
  const ties = [item.tieStop ? "stop" : null, item.tieStart ? "start" : null].filter(Boolean);
  const notationsInner = [
    ...ties.map((mark) => `<tied type="${mark}"/>`),
    ...item.tupletMarks.map((mark) => `<tuplet type="${mark}"/>`),
  ].join("");
  const tie = ties.map((mark) => `<tie type="${mark}"/>`).join("");
  const notations = notationsInner ? `<notations>${notationsInner}</notations>` : "";
  const staffTag = staff ? `<staff>${staff}</staff>` : "";
  const lyric = item.lyric ? `<lyric><syllabic>single</syllabic><text>${escapeXml(item.lyric)}</text></lyric>` : "";
  // A whole-measure rest has no written value, so it carries no <type>.
  const type = item.type ? `<type>${item.type}</type>` : "";
  return `<note>${item.head}<duration>${item.ticks}</duration>${tie}${type}${"<dot/>".repeat(item.dots)}${timeModification(item.tuplet)}${staffTag}${notations}${lyric}</note>`;
}

/** The first output beat (quarter note) boundary strictly after `onset`, measured from `measureStart`. */
function nextBeat(onset, measureStart) {
  const offset = subtract(onset, measureStart);
  const beats = Math.floor(offset.n / (offset.d * BEAT_SLOTS)) + 1;
  return add(measureStart, frac(beats * BEAT_SLOTS));
}

/**
 * Break each merged rest at the output's own beat boundaries. A rest is
 * allowed to be as long as the silence it covers, but it should still show
 * the beat: three slots of silence from the second eighth of a 2/4 bar is an
 * eighth rest finishing that beat and then a quarter rest, not one dotted
 * quarter rest straddling both. Notes are left alone - a note is written as
 * one value across the beat wherever it can be, which is what a tie is for.
 */
function splitRestsAtBeats(items, measureStart) {
  const out = [];
  for (const item of items) {
    if (!item.rest) {
      out.push(item);
      continue;
    }
    let start = item.onset;
    const end = add(item.onset, item.duration);
    while (compare(start, end) < 0) {
      const beat = nextBeat(start, measureStart);
      const stop = compare(beat, end) < 0 ? beat : end;
      out.push({ rest: true, onset: start, duration: subtract(stop, start) });
      start = stop;
    }
  }
  return out;
}

/**
 * Let a note `resolve.mjs` marked `openEnded` (nothing - not even a sibling -
 * capped it short of its own source measure's end) claim the room the
 * downbeat shift opens up for it, rather than ringing for a bare fraction of
 * a beat and leaving the rest of what it visually now occupies as silence.
 *
 * `resolve.mjs` deliberately takes no position on this - it doesn't know a
 * shift is coming - so it stops the note dead at the barline and leaves the
 * flag for whoever does. Here, that barline has already moved: the shift
 * pushes the note's onset one slot later, and since its resolved `duration`
 * is untouched, its written end moves the same slot later with it - meaning
 * it now starts *inside* the next output measure rather than ending exactly
 * on the one before it (that's what the shift is for: a Thai measure's last
 * counted beat becomes the next measure's own first beat). Extending it to
 * fill that measure, capped by whichever comes first - the next real attack
 * in this same row, or that measure's own end - is applying the documented
 * "extend to the end of its own measure" rule a second time, to the measure
 * the note is now actually written in.
 *
 * Deliberately narrow: this reaches at most one measure past where the note
 * already stopped, never further, matching the shift's own one-slot move -
 * a note that finds nothing there either stays exactly as short as
 * `resolve.mjs` left it, rather than hunting arbitrarily far ahead for the
 * next attack. It also only ever looks at this row's own later events, not
 * a stack sibling's - unlike the sibling capping `resolve.mjs` already does
 * within a single measure, extending a sibling's cap into a *second* row's
 * *next* measure isn't done here; a stacked open-ended note can currently
 * claim room a sibling would have capped it out of, had that sibling's own
 * next attack fallen inside the newly-claimed measure.
 *
 * A no-op when the shift is off: an unshifted note that reached its own
 * measure's end already sits exactly at that measure's own boundary, so the
 * "next measure" this looks at can never hold anything earlier than where
 * the note already stops - see the regression test for why this holds by
 * construction, not by an explicit shift check here.
 */
function extendOpenEnded(notes, boundaries) {
  const sorted = [...notes].sort((a, b) => compare(a.onset, b.onset));
  return sorted.map((note, i) => {
    if (!note.openEnded) return note;
    // The measure this note's own natural (shifted, still-uncapped) end
    // falls into - not the measure its onset falls into, which for a note
    // whose own resolved duration was already more than the shift's one
    // slot (it absorbed several rests, say) would find the wrong, too-early
    // measure and cap the note short of where it already legitimately reached.
    const naturalEnd = add(note.onset, note.duration);
    const m = boundaries.findIndex((b) => compare(naturalEnd, b) <= 0);
    if (m === -1) return note; // shifted past every boundary this grid has - nothing to extend into
    let cap = boundaries[m];
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].rest) continue;
      if (compare(sorted[j].onset, cap) < 0) cap = sorted[j].onset;
      break;
    }
    return { ...note, duration: subtract(cap, note.onset) };
  });
}

/**
 * One member's flat unrolled notes re-cut against the output's measure grid:
 * one array of printable events per measure, each measure filled edge to
 * edge. Four things happen here that the resolved timeline doesn't do on its
 * own:
 *
 * - **Gaps become rests.** `downbeatShift` moves every note a slot later, so
 *   the first measure opens on a gap and the last one closes on one; a
 *   trimmed prefix can leave one too.
 * - **Consecutive rests merge.** Resolution keeps a real silence as one
 *   event per slot (each reaching only to the next), which prints as a row
 *   of separate eighth rests. One rest of the summed length is the same
 *   silence, written the way a reader expects to see it.
 * - **Events crossing a barline are split and tied.** A note that fit inside
 *   its measure before the shift can straddle the barline after it.
 * - **A bar of nothing but silence collapses** to a single whole-measure
 *   rest.
 *
 * Onsets are absolute and already shifted; `boundaries` are this part's own
 * (already trimmed and, where the shift needs one, extended by a measure).
 */
function recut(notes, boundaries) {
  const events = [...notes].sort((a, b) => compare(a.onset, b.onset));
  const pushRest = (bucket, onset, duration) => {
    const last = bucket[bucket.length - 1];
    if (last?.rest) last.duration = add(last.duration, duration);
    else bucket.push({ rest: true, onset, duration });
  };

  const measures = [];
  let cursor = ZERO;
  let i = 0;
  for (let m = 0; m < boundaries.length; m++) {
    const measureStart = m === 0 ? ZERO : boundaries[m - 1];
    const end = boundaries[m];
    const bucket = [];
    while (compare(cursor, end) < 0) {
      // Anything already behind the cursor is spent: fully consumed by an
      // earlier measure, or (for a note the trim cut away) never reached.
      while (i < events.length && compare(add(events[i].onset, events[i].duration), cursor) <= 0) i++;
      const event = events[i];
      if (!event || compare(event.onset, end) >= 0) {
        pushRest(bucket, cursor, subtract(end, cursor));
        cursor = end;
        break;
      }
      if (compare(event.onset, cursor) > 0) {
        pushRest(bucket, cursor, subtract(event.onset, cursor));
        cursor = event.onset;
      }
      const eventEnd = add(event.onset, event.duration);
      const pieceEnd = compare(eventEnd, end) < 0 ? eventEnd : end;
      const duration = subtract(pieceEnd, cursor);
      if (event.rest) pushRest(bucket, cursor, duration);
      else
        bucket.push({
          ...event,
          onset: cursor,
          duration,
          tieIn: compare(cursor, event.onset) > 0,
          // Nothing after the last barline can hold the other end of a tie:
          // a note still ringing there (or one belonging to a stacked row
          // longer than the row this grid came from) is simply clipped.
          tieOut: compare(pieceEnd, eventEnd) < 0 && m < boundaries.length - 1,
        });
      cursor = pieceEnd;
    }
    const span = subtract(end, measureStart);
    const silent = bucket.length === 1 && bucket[0].rest && compare(bucket[0].duration, span) === 0;
    measures.push(silent ? [{ ...bucket[0], wholeMeasure: true }] : splitRestsAtBeats(bucket, measureStart));
  }
  return measures;
}

/**
 * Pair every lyric part in <ensemble> to the output group its syllables
 * attach to. ThaiMusicXML states no structural pairing (see
 * reference/conversion's "Unpitched and lyric parts"), so a converter has to
 * pick one: `lyricsMap` (a {lyricPartId: notatedPartId} JSON file via
 * --lyrics-map) states it explicitly, part id or stack-member id either way;
 * with no map, the first lyric part in ensemble order pairs to the first
 * output group, and any further lyric part is dropped with a warning.
 */
function resolveLyricPairs(doc, groups, lyricsMap, warn) {
  const lyricParts = doc.parts.filter((p) => p.type === "lyric");
  if (lyricParts.length === 0) return [];

  const findTarget = (targetId) => {
    for (const g of groups) {
      if (g.id === targetId) return { group: g, memberId: g.members[0].id };
      const member = g.members.find((m) => m.id === targetId);
      if (member) return { group: g, memberId: member.id };
    }
    return null;
  };

  if (lyricsMap) {
    const pairs = [];
    for (const [lyricId, targetId] of Object.entries(lyricsMap)) {
      const lyricPart = lyricParts.find((p) => p.id === lyricId);
      if (!lyricPart) {
        warn(`--lyrics-map: "${lyricId}" is not a lyric part, ignoring`);
        continue;
      }
      const target = findTarget(targetId);
      if (!target) {
        warn(`--lyrics-map: no notated part or stack matches "${targetId}", "${lyricId}" not exported`);
        continue;
      }
      pairs.push({ lyricId, ...target });
    }
    for (const p of lyricParts) {
      if (!(p.id in lyricsMap)) warn(`lyric part "${p.id}" has no mapping in --lyrics-map, not exported`);
    }
    return pairs;
  }

  if (groups.length === 0) {
    warn(`lyric part "${lyricParts[0].id}" has no notated part to attach to, not exported`);
    return [];
  }
  const [first, ...rest] = lyricParts;
  for (const p of rest) {
    warn(`lyric part "${p.id}" is dropped: only the first lyric part is paired by default - use --lyrics-map to pair it`);
  }
  return [{ lyricId: first.id, group: groups[0], memberId: groups[0].members[0].id }];
}

/**
 * The note a syllable at `onset` attaches to: whichever note is actually
 * sounding there, first choice - the notated line the words are sung over,
 * not necessarily a note starting exactly there, since a decaying note can
 * still be ringing (see reference/conversion's "Rests"). Failing that
 * (real silence at that instant), the nearest note before it - appending to
 * whatever's still there rather than leaving the syllable stranded. Failing
 * that too (the syllable falls before the target's first note), the nearest
 * note after it instead. `null` only when the target has no notes at all.
 */
function attachTarget(notes, onset) {
  let before = null;
  let after = null;
  for (const n of notes) {
    if (compare(n.onset, onset) <= 0 && compare(add(n.onset, n.duration), onset) > 0) return n;
    if (compare(n.onset, onset) <= 0) {
      if (!before || compare(n.onset, before.onset) > 0) before = n;
    } else if (!after || compare(n.onset, after.onset) < 0) {
      after = n;
    }
  }
  return before ?? after ?? null;
}

/**
 * One lyric pair's syllables, matched to a note in the target part via
 * attachTarget. Only dropped, with a warning, when the target has no note at
 * all to attach to. More than one syllable landing on the same note (a
 * melisma written with several syllables over one held note, or two
 * syllables both falling back to the same nearest note) joins them with a
 * space rather than overwriting.
 *
 * Matching happens in the resolved timeline's own units - a syllable's onset
 * and its target's notes share those - but the keys come out in the output's
 * shifted, trimmed units (`offset`), since that's where the notes the
 * `<lyric>` elements actually land on live.
 */
function resolveLyricTexts(doc, lyricId, memberId, offset, warn) {
  const syllables = doc.unrollLyrics(lyricId, memberId);
  const targetNotes = doc.unroll(memberId).notes.filter((n) => !n.rest);
  const texts = new Map();
  for (const { onset, text, line, measure } of syllables) {
    const note = attachTarget(targetNotes, onset);
    if (!note) {
      warn(
        `lyric part "${lyricId}" line ${line} measure ${measure}: syllable "${text}" has no note at all in "${memberId}" to attach to`,
      );
      continue;
    }
    const key = onsetKey(add(note.onset, offset));
    texts.set(key, texts.has(key) ? `${texts.get(key)} ${text}` : text);
  }
  return texts;
}

/** Every output group's lyric assignment: which member (staff) index carries the text, and the text keyed by that member's note onsets. */
function resolveLyricAssignments(doc, groups, prepared, lyricsMap, warn) {
  const assignments = new Map();
  for (const { lyricId, group, memberId } of resolveLyricPairs(doc, groups, lyricsMap, warn)) {
    const staffIndex = group.members.findIndex((m) => m.id === memberId);
    const offset = prepared.get(group.id).offset;
    assignments.set(group.id, { staffIndex, texts: resolveLyricTexts(doc, lyricId, memberId, offset, warn) });
  }
  return assignments;
}

/** Which measure a part's first actual note falls in, or the measure count if it never plays one. */
function firstSoundingMeasure(notes, boundaries) {
  let earliest = null;
  for (const note of notes) {
    if (note.rest) continue;
    if (!earliest || compare(note.onset, earliest) < 0) earliest = note.onset;
  }
  if (!earliest) return boundaries.length;
  const m = boundaries.findIndex((b) => compare(earliest, b) < 0);
  return m === -1 ? boundaries.length : m;
}

/**
 * How many measures to drop off the front: the leading run no part sounds a
 * note in. Measured across the whole ensemble, never per part, so every part
 * still starts at the same measure number afterwards, and capped so a piece
 * with no notes at all (or one whose only notes are in its last measure)
 * still keeps a measure to write.
 */
function leadingEmptyMeasures(groups, unrolled) {
  let trim = Infinity;
  for (const group of groups)
    for (const member of group.members) {
      const { notes, measureBoundaries } = unrolled.get(member.id);
      trim = Math.min(trim, firstSoundingMeasure(notes, measureBoundaries), measureBoundaries.length - 1);
    }
  return Number.isFinite(trim) ? Math.max(trim, 0) : 0;
}

/**
 * One output part's measure grid and per-staff events, with the two
 * timeline-level settings applied: `trim` measures dropped from the front,
 * and every note moved `shift` later. The grid itself never moves - shifting
 * the music inside a fixed set of barlines is the whole point, since that's
 * what lands a Thai measure's final beat on a Western downbeat - so the
 * shift only shows up in the events, plus one extra measure at the end where
 * the tail needs somewhere to go.
 */
function prepareGroup(group, unrolled, trim, shift, tail, warn) {
  const members = group.members.map((m) => unrolled.get(m.id));
  const raw = members[0]?.measureBoundaries ?? [];
  for (const other of members.slice(1)) {
    if (other.measureBoundaries.length !== raw.length)
      warn(`part "${group.id}": stacked rows disagree on measure count, using the first row's`);
  }

  const trimmed = trim > 0 ? (raw[trim - 1] ?? ZERO) : ZERO;
  const boundaries = raw.slice(trim).map((b) => subtract(b, trimmed));
  if (tail && boundaries.length) {
    const last = boundaries[boundaries.length - 1];
    const span = boundaries.length > 1 ? subtract(last, boundaries[boundaries.length - 2]) : last;
    boundaries.push(add(last, span));
  }

  const offset = subtract(shift, trimmed);
  const measures = members.map(({ notes }) =>
    recut(
      extendOpenEnded(
        notes.map((note) => ({ ...note, onset: add(note.onset, offset) })),
        boundaries,
      ),
      boundaries,
    ),
  );
  return { boundaries, offset, measures };
}

/**
 * Whether any note would be struck past the last barline once shifted, and
 * so needs one more measure to land in. A Thai piece usually ends on its last
 * measure's own final beat, which is exactly the beat the shift moves onto a
 * downbeat, so this is the common case. Only an attack counts: a note still
 * decaying across that barline is clipped there instead, the same way the
 * resolved timeline already clips a decay at every other barline, rather than
 * buying a whole extra measure for a tied continuation nobody strikes.
 */
function needsTailMeasure(groups, unrolled, shift) {
  for (const group of groups)
    for (const member of group.members) {
      const { notes, measureBoundaries } = unrolled.get(member.id);
      const end = measureBoundaries[measureBoundaries.length - 1];
      if (!end) continue;
      for (const note of notes) {
        if (note.rest) continue;
        if (compare(add(note.onset, shift), end) >= 0) return true;
      }
    }
  return false;
}

/**
 * A measure whose beat count does not divide a 2/4 bar exactly.
 *
 * Every measure lasts two <bpm> beats whatever its beat count, so a measure
 * of b beats has to fill the same 2/4 bar as any other. Where b is a power of
 * two the slots land on real note values and nothing is needed; where it is
 * not - five beats, say - the bar can only be written as one tuplet across
 * the whole measure, nested around any <group> tuplets already inside it,
 * which v1.0 does not write. The measure is exported at one eighth per slot
 * instead, so it overruns its own bar. See "MusicXML: rhythm".
 *
 * Warned once per measure that hits it, since a reader has to fix the bar by
 * hand and needs to know which one.
 */
function warnUnevenMeasure(measureSpan, number, groupId, warn) {
  const beats = measureSpan.n / measureSpan.d;
  if (!Number.isInteger(beats) || (beats & (beats - 1)) === 0) return;
  warn(
    `measure ${number} of part "${groupId}" has ${beats} beats, which no 2/4 bar divides evenly; ` +
      `it is written at one eighth per slot and so runs past its own bar. v1.0 does not write a measure-wide tuplet`,
  );
}

function convertPart(group, prepared, tuning, slotTicks, divisions, warn, lyricAssignment) {
  const { boundaries, measures } = prepared;
  const staves = group.members.length;
  const isUnpitched = group.members[0].type === "unpitched";

  let xml = "";
  for (let m = 0; m < boundaries.length; m++) {
    const measureStart = m === 0 ? ZERO : boundaries[m - 1];
    const measureSpan = subtract(boundaries[m], measureStart);
    const measureTicks = Math.round((measureSpan.n * slotTicks) / measureSpan.d);
    warnUnevenMeasure(measureSpan, m + 1, group.id, warn);

    xml += `<measure number="${m + 1}">`;
    if (m === 0) {
      xml += `<attributes><divisions>${divisions}</divisions>`;
      if (!isUnpitched) xml += `<key><fifths>0</fifths></key>`;
      xml += `<time><beats>2</beats><beat-type>4</beat-type></time>`;
      if (staves > 1) xml += `<staves>${staves}</staves>`;
      xml += isUnpitched
        ? `<clef><sign>percussion</sign><line>2</line></clef>`
        : `<clef><sign>G</sign><line>2</line></clef>`;
      xml += `</attributes>`;
    }
    measures.forEach((memberMeasures, staffIndex) => {
      if (staffIndex > 0) xml += `<backup><duration>${measureTicks}</duration></backup>`;
      const member = group.members[staffIndex];
      const items = assignTupletBrackets(
        flattenSegments(memberMeasures[m] ?? [], {
          tuning,
          slotTicks,
          divisions,
          measureTicks,
          isUnpitched: member.type === "unpitched",
          memberId: member.id,
          warn,
          lyricTexts: lyricAssignment?.staffIndex === staffIndex ? lyricAssignment.texts : null,
        }),
      );
      for (const item of items) xml += renderSegment(item, staves > 1 ? staffIndex + 1 : null);
    });
    xml += `</measure>`;
  }
  return xml;
}

/**
 * Wraps `warn` so the exact same message never prints twice in one
 * conversion. A `<repeat>` or `<line-repeat>` replays the same written
 * line/measure as many times as it plays, and each replay of a bad note
 * hits the same warning site with the same message - one warning per
 * distinct source problem is what's useful; one per playback of it just
 * reads as the converter stuttering.
 */
function dedupeWarn(warn) {
  const seen = new Set();
  return (message) => {
    if (seen.has(message)) return;
    seen.add(message);
    warn(message);
  };
}

/**
 * Convert a resolved ThaiMusicXML document (from resolve.mjs) to a MusicXML
 * string. `options.tuning` overrides <tuning> or its absence; `options.splitStacks`
 * gives each stacked row its own part instead of merging them.
 * `options.lyrics` (default true) turns off lyric export entirely when
 * false; `options.lyricsMap` (a {lyricPartId: notatedPartId} object) states
 * which lyric part pairs to which notated part/stack, overriding the
 * first-to-first default - see resolveLyricPairs.
 *
 * `options.downbeatShift` (default true) moves the whole piece one note slot
 * later, so that a Thai measure's last beat - the one the music is counted
 * to - becomes the first beat of a Western measure. `options.trimLeadingEmptyMeasures`
 * (default false) drops the measures at the front of the piece that no part
 * plays a note in.
 */
export function toMusicXml(doc, options = {}) {
  const warn = dedupeWarn(options.warn ?? (() => {}));
  const tuning = resolveTuning(options.tuning ?? doc.tuning, warn);
  const lyricsEnabled = options.lyrics ?? true;
  const shift = (options.downbeatShift ?? true) ? SHIFT : ZERO;

  const groups = groupParts(
    doc.parts.filter((p) => p.type !== "lyric"),
    options.splitStacks,
  );

  // Unrolled once per member and reused: every stage below (the trim count,
  // the tail test, each part's own re-cut) walks the same timelines, and
  // doc.unroll() re-resolves the whole piece on every call.
  const unrolled = new Map();
  for (const g of groups) for (const m of g.members) unrolled.set(m.id, doc.unroll(m.id));

  const trim = options.trimLeadingEmptyMeasures ? leadingEmptyMeasures(groups, unrolled) : 0;
  const tail = !isZero(shift) && needsTailMeasure(groups, unrolled, shift);
  const prepared = new Map(
    groups.map((g) => [g.id, prepareGroup(g, unrolled, trim, shift, tail, warn)]),
  );

  const lyricAssignments = lyricsEnabled
    ? resolveLyricAssignments(doc, groups, prepared, options.lyricsMap, warn)
    : new Map();

  // Sized from the re-cut events, not the resolved notes: merging rests and
  // splitting events at barlines both produce durations, and so denominators,
  // that no single resolved note had.
  const allDenominators = groups.flatMap((g) => prepared.get(g.id).measures.flatMap(denominatorsOf));
  const slotTicks = ticksPerSlot(allDenominators);
  const divisions = slotTicks * 2;

  const partList = groups
    .map((g) => `<score-part id="${g.id}"><part-name>${escapeXml(g.name)}</part-name></score-part>`)
    .join("");

  const parts = groups
    .map(
      (g) =>
        `<part id="${g.id}">${convertPart(g, prepared.get(g.id), tuning, slotTicks, divisions, warn, lyricAssignments.get(g.id))}</part>`,
    )
    .join("");

  const work = doc.title ? `<work><work-title>${escapeXml(doc.title)}</work-title></work>` : "";
  const creators = [
    ["composer", creditText(doc.composer)],
    ["lyricist", creditText(doc.lyricist)],
    ["arranger", creditText(doc.arranger)],
  ]
    .filter(([, text]) => text)
    .map(([type, text]) => `<creator type="${type}">${escapeXml(text)}</creator>`)
    .join("");
  const identification = creators ? `<identification>${creators}</identification>` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">${work}${identification}<part-list>${partList}</part-list>${parts}</score-partwise>`;
}
