// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// Turning a resolve.mjs note's duration - an exact fraction of a slot - into
// MusicXML's <duration>/<type>/<dots>/<time-modification>.
//
// A duration's own reduced denominator already says what tuplet it needs:
// strip every factor of 2 from it, and whatever odd factor remains (if any)
// is the k of a k-way <group> division, however that duration came about -
// whether from a plain group member, one that absorbed a sibling rest, or a
// preceding note whose decay ran into a following group's own leading rest.
// No factor of 2 in the denominator means no tuplet at all, which is also
// what a <group>'s last member gets should it happen to ring for a whole
// number of slots: sound and duration are unaffected either way, since a
// tuplet marking only ever changes how a duration is drawn, never how long
// it lasts.

import { lcm } from "./fraction.mjs";

/** k in the time of the largest power of two below it, or null if k already is one. */
export function tupletRatio(k) {
  if (k === 1 || (k & (k - 1)) === 0) return null;
  let normal = 1;
  while (normal * 2 < k) normal *= 2;
  return { actual: k, normal };
}

/** The odd part of a positive integer: d with every factor of 2 divided out. */
const oddPart = (d) => d / (d & -d);

/**
 * Ticks per slot (one eighth note) large enough to represent every fraction
 * this piece's durations introduce as a whole number, tuplet scaling
 * included: a duration of denominator d needs ticks divisible by d, and,
 * where d's odd part isn't 1, by that tuplet's normal-notes too, since a
 * printed note inside it is scaled by k/normal.
 */
export function ticksPerSlot(denominators) {
  let result = 1;
  for (const d of new Set(denominators)) {
    result = lcm(result, d);
    const ratio = tupletRatio(oddPart(d));
    if (ratio) result = lcm(result, ratio.normal);
  }
  return result;
}

const NOTE_TYPES = [
  ["whole", 4],
  ["half", 2],
  ["quarter", 1],
  ["eighth", 0.5],
  ["16th", 0.25],
  ["32nd", 0.125],
  ["64th", 0.0625],
  ["128th", 0.03125],
];

function noteTicks({ type, dots }, divisions) {
  const quarters = NOTE_TYPES.find(([t]) => t === type)[1];
  const base = quarters * divisions;
  return dots ? base * 1.5 : base;
}

/** Greedy decomposition of a tick duration into a tied sequence of {type, dots}, largest note first. */
export function decomposeTicks(ticks, divisions) {
  const notes = [];
  let remaining = ticks;
  let guard = 0;
  while (remaining > 0) {
    if (++guard > 32) throw new Error(`cannot represent a duration of ${ticks} ticks at ${divisions} divisions`);
    const fit = NOTE_TYPES.find(([, quarters]) => {
      const base = quarters * divisions;
      return Number.isInteger(base) && base <= remaining;
    });
    if (!fit) throw new Error(`cannot represent a duration of ${ticks} ticks at ${divisions} divisions`);
    const [type] = fit;
    const base = noteTicks({ type, dots: 0 }, divisions);
    const dotted = base * 1.5;
    if (Number.isInteger(dotted) && dotted <= remaining) {
      notes.push({ type, dots: 1 });
      remaining -= dotted;
    } else {
      notes.push({ type, dots: 0 });
      remaining -= base;
    }
  }
  return notes;
}

/**
 * One resolved note's full MusicXML encoding: a list of tied {ticks, type,
 * dots, tuplet} entries, tuplet being {actual, normal} or null. `duration` is
 * the note's slot-fraction length from resolve.mjs; `slotTicks` is this
 * piece's ticksPerSlot(); `divisions` is its MusicXML <divisions> (ticks per
 * quarter note - twice slotTicks, since a slot is an eighth).
 */
export function encodeDuration(duration, slotTicks, divisions) {
  const ratio = tupletRatio(oddPart(duration.d));
  const rawTicks = (duration.n * slotTicks) / duration.d;
  const printedTicks = ratio ? (rawTicks * ratio.actual) / ratio.normal : rawTicks;
  return decomposeTicks(printedTicks, divisions).map((note) => {
    // <duration> is always a sounding value, so a tied note's own printed
    // ticks (from decomposeTicks(), scaled for display) convert back to
    // sounding ticks by the inverse of the same tuplet scaling.
    const printed = noteTicks(note, divisions);
    const sounding = ratio ? (printed * ratio.normal) / ratio.actual : printed;
    return { ticks: Math.round(sounding), type: note.type, dots: note.dots, tuplet: ratio };
  });
}
