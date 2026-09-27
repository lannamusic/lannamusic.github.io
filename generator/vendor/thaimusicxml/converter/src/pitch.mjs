// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// A ThaiMusicXML pitch resolved to an absolute one, shared by both export
// targets. See reference/conversion's "Pitch": a scale degree names a step of
// the Thai scale, not a frequency, so a <tuning> reference is needed before
// either target can write a concrete pitch. Both a MIDI note number and a
// MusicXML step/alter/octave are derived from the same semitone-from-C4
// value, so the two targets can never disagree about which note sounds.

import { NIKHAHIT, PINTHU, DEGREE_BY_SPELLING } from "../../renderer/src/geometry.mjs";

// ด/1/D through ท/7/T, spelled per reference.reference-major, with each
// degree's semitone offset from C4 (MIDI 60) at octave attribute 0. Every
// tuning shifts the same diatonic pattern to a different tonic, so its own
// ด lands at or below the C that follows it - a real major scale read up
// from its own tonic, not seven notes pinned to one fixed octave. bb-major
// (tonic Bb, one whole step below c-major) is the reference case this
// generalizes from.
//
// One tuning per chromatic tonic, spelled as a real major key rather than
// hand-picked note names: each of the 12 tonics below is a (letter,
// accidental) pair, and buildMajorScale walks the 7 letters starting at that
// tonic's own letter - a major scale always uses each of the 7 letter names
// exactly once - choosing each degree's alteration so its pitch matches the
// major-scale interval pattern. Black-key tonics are spelled as flats
// (db/eb/gb/ab/bb), consistent with bb-major, never as sharps.
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

const TONICS = {
  "c-major": ["C", 0],
  "db-major": ["D", -1],
  "d-major": ["D", 0],
  "eb-major": ["E", -1],
  "e-major": ["E", 0],
  "f-major": ["F", 0],
  "gb-major": ["G", -1],
  "g-major": ["G", 0],
  "ab-major": ["A", -1],
  "a-major": ["A", 0],
  "bb-major": ["B", -1],
  "b-major": ["B", 0],
};

/** A tonic's 7-degree major scale, tonic placed at or below C4 (see TONICS above for why). */
function buildMajorScale(letter, tonicAlter) {
  const tonicPitchClass = (((NATURAL_SEMITONE[letter] + tonicAlter) % 12) + 12) % 12;
  const tonicOffset = tonicPitchClass === 0 ? 0 : tonicPitchClass - 12;
  const letterIndex = LETTERS.indexOf(letter);
  return MAJOR_INTERVALS.map((interval, degree) => {
    const step = LETTERS[(letterIndex + degree) % 7];
    const semitone = tonicOffset + interval;
    const natural = NATURAL_SEMITONE[step];
    const alter = ((((semitone - natural + 6) % 12) + 12) % 12) - 6;
    return { step, alter, semitone };
  });
}

const TUNINGS = Object.fromEntries(
  Object.entries(TONICS).map(([name, [letter, tonicAlter]]) => [name, buildMajorScale(letter, tonicAlter)]),
);

/** Every tuning reference the converter can resolve a pitch against - the playground's transpose selector reads this. */
export const TUNING_REFERENCES = Object.keys(TUNINGS);

/**
 * Resolve `<tuning reference>` to one of the twelve defined major-key
 * mappings, falling back to c-major with a warning for anything else -
 * including a missing `<tuning>` altogether. See reference/conversion's
 * "Pitch".
 */
export function resolveTuning(reference, warn = () => {}) {
  if (reference && TUNINGS[reference]) return reference;
  if (reference) warn(`unrecognized tuning reference "${reference}", converting as c-major`);
  else warn("no <tuning>, converting as c-major");
  return "c-major";
}

/**
 * A note's own octave, resolving the Thai modifier/attribute precedence in
 * note.md's Conformance: a literal nikhahit or pinthu in `pitch` determines
 * the octave outright, and an `octave` attribute alongside one is ignored
 * rather than added to it.
 */
function octaveOf(pitch, octaveAttr) {
  if (pitch.includes(NIKHAHIT)) return 1;
  if (pitch.includes(PINTHU)) return -1;
  return octaveAttr ?? 0;
}

/**
 * One note's absolute pitch: a MIDI note number (60 = C4) and the MusicXML
 * step/alter/octave derived from that same semitone value, so the two
 * targets always name the same sound.
 */
export function resolvePitch(pitch, octaveAttr, tuningReference) {
  const bare = pitch.replace(NIKHAHIT, "").replace(PINTHU, "");
  const degree = DEGREE_BY_SPELLING.get(bare);
  if (degree === undefined) throw new Error(`not a recognized pitch: "${pitch}"`);

  const entry = TUNINGS[tuningReference][degree];
  const octave = octaveOf(pitch, octaveAttr);
  const midi = 60 + entry.semitone + 12 * octave;
  return { midi, step: entry.step, alter: entry.alter, octave: Math.floor(midi / 12) - 1 };
}
