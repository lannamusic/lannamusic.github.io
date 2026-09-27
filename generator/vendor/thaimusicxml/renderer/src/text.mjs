// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// Measuring how wide a string sets, and breaking it to fit a measure.
//
// SVG text does not wrap, so the renderer has to do it, and doing it needs
// widths. `charWidth` reads them from the actual Sarabun font Sarabun's own
// package ships (`@fontsource/sarabun`), the same face `draw.mjs` names in
// `font-family`, so a width is what that font really sets rather than a guess
// at it. A character neither of its two subsets covers - some other script, an
// emoji - falls back to the old estimate, which only has to be close enough
// not to run text off the page.

import * as opentype from "https://cdn.jsdelivr.net/npm/opentype.js@2.0.0/dist/opentype.mjs";
import { loadFontFile } from "../../../font-loader.mjs";

// Fontsource splits one family into per-script subsets. A Thai score's text is
// Thai plus occasional Latin (romanized pitches, an English title), so those
// are the two subsets worth loading; nothing else in the family's range comes
// up in practice.
//
// Loading the bytes is the one part that differs between the Node CLI and a
// browser (see #font-loader, package.json's "imports"); parsing them into
// widths does not, so that stays here. Call textReady() once before measuring
// anything - render.mjs and the playground both do this via ready.mjs.
let thaiFont = null;
let latinFont = null;
let readyPromise = null;

export function textReady() {
  readyPromise ??= (async () => {
    const [thaiBytes, latinBytes] = await Promise.all([
      loadFontFile("sarabun-thai-400-normal.woff"),
      loadFontFile("sarabun-latin-400-normal.woff"),
    ]);
    thaiFont = opentype.parse(thaiBytes);
    latinFont = opentype.parse(latinBytes);
  })();
  return readyPromise;
}

// Advance width as a fraction of one em, or null if neither subset maps the
// character (glyph index 0 is .notdef, not a real zero-width glyph).
function realWidth(ch) {
  if (!thaiFont) throw new Error("text.mjs: await textReady() (or ready() from ready.mjs) before measuring text");
  const glyph = thaiFont.charToGlyph(ch);
  if (glyph.index !== 0) return glyph.advanceWidth / thaiFont.unitsPerEm;
  const latinGlyph = latinFont.charToGlyph(ch);
  if (latinGlyph.index !== 0) return latinGlyph.advanceWidth / latinFont.unitsPerEm;
  return null;
}

// Marks sitting above or below a letter: สระ, วรรณยุกต์, พินทุ, ทัณฑฆาต. Sarabun
// itself gives every one of these zero advance width - checked directly
// against the font - so this is a fast path and a safety net for a mark
// outside the font's own combining range, not a correction to real metrics.
const COMBINING = /[ัิ-ฺ็-๎]/;

const THAI = /[฀-๿]/;
const NARROW = /[iljtIf.,;:!'|()[\]{}]/;
const WIDE = /[mwMW@]/;

export function charWidth(ch, size) {
  if (COMBINING.test(ch)) return 0;

  const real = realWidth(ch);
  if (real !== null) return real * size;

  // Neither Sarabun subset covers this character. Estimate rather than fail.
  if (ch === " ") return size * 0.26;
  if (THAI.test(ch)) return size * 0.54;
  if (NARROW.test(ch)) return size * 0.3;
  if (WIDE.test(ch)) return size * 0.85;
  if (ch >= "A" && ch <= "Z") return size * 0.66;
  return size * 0.52;
}

export const textWidth = (str, size) =>
  Array.from(str).reduce((total, ch) => total + charWidth(ch, size), 0);

/**
 * A base letter with whatever marks hang off it. Breaking a line between a
 * letter and its own วรรณยุกต์ would leave the mark stranded at the start of the
 * next line, so the two never come apart.
 */
export function clusters(str) {
  const out = [];
  for (const ch of str) {
    if (out.length > 0 && COMBINING.test(ch)) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/** The lines a string breaks into to fit within maxWidth. */
export function wrapText(str, size, maxWidth) {
  const source = String(str ?? "").trim();
  if (!source) return [];
  if (!(maxWidth > 0)) return [source];
  if (textWidth(source, size) <= maxWidth) return [source];

  // Thai puts spaces between phrases rather than between every word, and Latin
  // puts them between words. Either way a space is the one place a break is
  // certainly safe, so those come first.
  const chunks = source.split(/(\s+)/).filter((chunk) => chunk !== "");

  const lines = [];
  let line = "";
  const flush = () => {
    if (line.trim()) lines.push(line.trim());
    line = "";
  };

  for (const chunk of chunks) {
    if (/^\s+$/.test(chunk)) {
      if (line) line += " ";
      continue;
    }

    if (textWidth(line + chunk, size) <= maxWidth) {
      line += chunk;
      continue;
    }

    flush();

    if (textWidth(chunk, size) <= maxWidth) {
      line = chunk;
      continue;
    }

    // One run wider than the whole measure, which is what an unbroken stretch
    // of Thai gives, since there is nothing in it to break at. Falling back to
    // letters is wrong about where Thai words end, but it keeps the text on the
    // page, and reading it needs no more than that.
    for (const cluster of clusters(chunk)) {
      if (line && textWidth(line + cluster, size) > maxWidth) flush();
      line += cluster;
    }
  }

  flush();
  return lines.length > 0 ? lines : [source];
}
