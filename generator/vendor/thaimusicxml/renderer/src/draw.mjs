// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// Positioned elements to SVG.
//
// Deliberately stupid. It receives coordinates and emits shapes, and knows
// nothing about beats, parts or measures, so a layout bug cannot hide here.

import { defaults } from "./settings.mjs";
import { loadFontFile } from "../../../font-loader.mjs";

const escape = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The SVG names "Sarabun" in font-family but, unlike the docs site, does
// nothing to make sure whatever opens the file actually has it: a bare
// font-family is only a request, and a viewer without Sarabun installed falls
// back to whatever "sans-serif" resolves to instead, silently. Embedding the
// same font `@fontsource/sarabun` already ships - and the same file
// text.mjs measures widths from - makes the SVG self-contained: correct in
// any browser or tool that reads @font-face, whether or not Sarabun happens
// to be installed system-wide. A viewer that ignores @font-face entirely is
// no worse off than before, since the font-family fallback chain is unchanged.
//
// Fontsource splits the family by script with no unicode-range, which is
// deliberate on their part rather than an oversight: same font-family and
// font-weight, and a browser tries each @font-face in the order given and
// uses the first one that actually has the glyph, the same per-glyph
// fallback a system font stack does. Thai and Latin are the two scripts a
// Thai score's text actually uses - the pitch letters and romanized spellings
// between them - so those are the two subsets loaded, at the two weights
// draw() emits: regular for everything, bold for the title.
//
// Loading the bytes is the one part that differs between the Node CLI and a
// browser (see #font-loader); base64-encoding them for an inline @font-face
// does not. Call drawReady() once before draw() - render.mjs and the
// playground both do this via ready.mjs.
function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const FONT_FACE_FILES = [
  ["sarabun-thai-400-normal.woff2", 400],
  ["sarabun-latin-400-normal.woff2", 400],
  ["sarabun-thai-700-normal.woff2", 700],
  ["sarabun-latin-700-normal.woff2", 700],
];

let fontFacesCss = null;
let readyPromise = null;

export function drawReady() {
  readyPromise ??= (async () => {
    const rules = await Promise.all(
      FONT_FACE_FILES.map(async ([file, weight]) => {
        const bytes = await loadFontFile(file);
        return (
          `    @font-face { font-family: "Sarabun"; font-weight: ${weight}; ` +
          `src: url(data:font/woff2;base64,${bytesToBase64(bytes)}) format("woff2"); }`
        );
      }),
    );
    fontFacesCss = rules.join("\n");
  })();
  return readyPromise;
}

export function draw(page, options = {}) {
  if (fontFacesCss === null) throw new Error("draw.mjs: await drawReady() (or ready() from ready.mjs) before draw()");
  const s = { ...defaults, ...options };

  // Each group carries the stroke and fill its shapes share, so no shape has
  // to repeat them. Which group an element belongs to is its kind (and, for
  // strokes that vary by role - a bow's from a link's, a repeat bracket's
  // from a grid rule's - its role too), decided here as it is emitted rather
  // than read back out of the markup.
  const rulings = [];
  const repeatBrackets = [];
  const links = [];
  const bows = [];
  const marks = [];

  for (const el of page.elements) {
    if (el.kind === "line") {
      const group = el.role === "repeat-bracket" ? repeatBrackets : rulings;
      group.push(`  <line x1="${round(el.x1)}" y1="${round(el.y1)}" x2="${round(el.x2)}" y2="${round(el.y2)}"/>`);
    } else if (el.kind === "arc") {
      // An arc bowing up over the notes it marks - a link curve's own shape
      // where role is "link", a bow's where role is "bow".
      const mid = (el.x1 + el.x2) / 2;
      const group = el.role === "bow" ? bows : links;
      group.push(
        `  <path class="${el.role}" d="M ${round(el.x1)} ${round(el.y)}` +
          ` Q ${round(mid)} ${round(el.y - el.rise)} ${round(el.x2)} ${round(el.y)}"/>`,
      );
    } else if (el.kind === "curve") {
      // A connector arching over a run. Layout picks the control point, which
      // sits at one corner of the box the two ends span, so the stroke leaves
      // one note and arrives at the other along the arch instead of cutting
      // straight across as a diagonal.
      links.push(
        `  <path class="link" d="M ${round(el.x1)} ${round(el.y1)}` +
          ` Q ${round(el.cx)} ${round(el.cy)} ${round(el.x2)} ${round(el.y2)}"/>`,
      );
    } else if (el.kind === "dot") {
      // The octave mark: a small dot drawn as its own shape, not set as a
      // diacritic in the font. See "Octave marks" in reference/rendering.
      const fill = el.dim ? ` fill="${s.dimColor}"` : "";
      marks.push(`  <circle cx="${round(el.x)}" cy="${round(el.y)}" r="${round(el.r)}"${fill}/>`);
    } else {
      const weight = el.weight ? ` font-weight="${el.weight}"` : "";
      const fill = el.dim ? ` fill="${s.dimColor}"` : "";
      marks.push(
        `  <text x="${round(el.x)}" y="${round(el.y)}" font-size="${el.size}"` +
          ` text-anchor="${el.anchor}"${weight}${fill}>${escape(el.text)}</text>`,
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}"`,
    `     viewBox="0 0 ${page.width} ${page.height}" font-family="${s.fontFamily}">`,
    `  <defs>`,
    `    <style>`,
    fontFacesCss,
    `    </style>`,
    `  </defs>`,
    `  <rect width="100%" height="100%" fill="#fff"/>`,
    `  <g stroke="#000" stroke-width="0.7" fill="none">`,
    ...rulings,
    `  </g>`,
    `  <g stroke="#000" stroke-width="${s.repeatBracketStroke}" fill="none">`,
    ...repeatBrackets,
    `  </g>`,
    `  <g stroke="#000" stroke-width="${s.linkStroke}" fill="none" stroke-linecap="round">`,
    ...links,
    `  </g>`,
    `  <g stroke="#000" stroke-width="${s.bowStroke}" fill="none" stroke-linecap="round">`,
    ...bows,
    `  </g>`,
    `  <g fill="#000" stroke="none">`,
    ...marks,
    `  </g>`,
    `</svg>`,
  ].join("\n");
}

const round = (n) => Math.round(n * 100) / 100;
