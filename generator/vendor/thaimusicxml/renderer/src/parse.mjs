// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// ThaiMusicXML document to a plain object tree.
//
// This stage does no layout and makes no display decisions. It reads what the
// document says and hands on a structure the layout stage can walk. Anything
// the renderer chooses rather than reads belongs in layout.mjs.
//
// A measure is read as a list of beats, each holding one or more slots. A bare
// <note> or <rest> is a beat of one slot; a <group> is a beat of as many slots
// as it has children. That is the shape the subdivision count in
// reference/rendering/index.md works on.

const { DOMParser } = globalThis;

export const NS = "https://thaimusicxml.anan.ovh/ns/1";

/** The release this parser implements. The namespace is the compatibility
 *  boundary; this only tells releases apart inside it. */
export const VERSION = "1.0";

const els = (node, name) =>
  Array.from(node.getElementsByTagNameNS(NS, name)).filter(
    (el) => el.parentNode === node,
  );

const el = (node, name) => els(node, name)[0] ?? null;

const required = (node, name, parent) => {
  const found = el(node, name);
  if (!found) throw new Error(`invalid ThaiMusicXML document: missing <${name}> in <${parent}>`);
  return found;
};

const text = (node) => (node ? node.textContent.trim() : null);

/** A <note> or <rest> becomes one slot. */
function slot(node) {
  if (node.localName === "rest") return { kind: "rest" };
  return {
    kind: "note",
    pitch: node.getAttribute("pitch") || null,
    sound: node.getAttribute("sound") || null,
    octave: node.hasAttribute("octave")
      ? Number(node.getAttribute("octave"))
      : null,
  };
}

const sounds = (node) =>
  node.nodeType === 1 && (node.localName === "note" || node.localName === "rest");

// The zero-duration markers. All three open and close spans the same way, so
// the walk in resolveSpans() tests membership rather than naming each one.
const MARKERS = new Set(["bow", "parenthesis", "link"]);

/**
 * The three aligned positions shared by <annotation> and the credits. Where the
 * element has <text> children they carry the whole content, so the indentation
 * around them is not read as text.
 *
 * Plain text falls to one position, and which one differs: an annotation sits
 * in the body of the score and goes left, a credit sits under the title and
 * centers.
 */
function aligned(node, fallback) {
  if (!node) return null;
  const texts = els(node, "text");
  if (texts.length === 0) {
    const plain = text(node);
    if (!plain) return null;
    return { left: null, center: null, right: null, [fallback]: plain };
  }
  const at = (align) => {
    const match = texts.find((t) => t.getAttribute("align") === align);
    return match ? text(match) : null;
  };
  const found = { left: at("left"), center: at("center"), right: at("right") };
  return found.left || found.center || found.right ? found : null;
}

const annotation = (node) => aligned(node, "left");
const credit = (node) => aligned(node, "center");

/** A measure's children become beats of one or more slots each. */
function beats(measure) {
  const out = [];
  for (const child of Array.from(measure.childNodes)) {
    if (child.nodeType !== 1) continue;
    if (child.localName === "group") {
      // <bow>, <parenthesis>, and <link> have zero duration, so they take no
      // slot and do not count toward the group's division of its beat.
      const slots = Array.from(child.childNodes).filter(sounds).map(slot);
      out.push({ slots, group: true });
    } else if (child.localName === "note" || child.localName === "rest") {
      out.push({ slots: [slot(child)], group: false });
    }
  }
  return out;
}

/** A lyric measure's children: a <syllable> or a <rest>, in document order. */
function lyricItems(measure) {
  const out = [];
  for (const child of Array.from(measure.childNodes)) {
    if (child.nodeType !== 1) continue;
    if (child.localName === "syllable") out.push({ kind: "syllable", text: text(child) });
    else if (child.localName === "rest") out.push({ kind: "rest" });
  }
  return out;
}

/**
 * One <line>'s measures, shaped by the part's type: a notated part gets beats
 * of slots, a lyric part gets items that do not divide into beats at all. See
 * "Lyric rows" in reference/rendering.
 */
function parseLine(line, partType) {
  return {
    number: Number(line.getAttribute("number")),
    // A line's own annotations, printed above this part's row for this line
    // rather than once above the section. See "Annotations".
    annotations: els(line, "annotation").map(annotation).filter(Boolean),
    measures: els(line, "measure").map((m) =>
      partType === "lyric"
        ? { number: Number(m.getAttribute("number")), items: lyricItems(m) }
        : { number: Number(m.getAttribute("number")), beats: beats(m) },
    ),
  };
}

/**
 * Bow, parenthesis, and link spans, matched across a run of <line> elements
 * in document order. Positions are array indices into the lines this walk was
 * given, in the same shape parseLine() produces, so layout.mjs can address a
 * span's ends directly once it has laid those lines out.
 *
 * A span may cross <measure> and <line> boundaries but never a <section>
 * boundary, so this is called once per <section-ref> over its regular lines,
 * and once more per <ending> over its own lines - a marker left dangling by
 * an ending that substitutes for part of a still-open span (see <ending>'s
 * "Spans across an overridden line") is a resolved-pass subtlety this static
 * renderer does not attempt; the dangling marker is silently unmatched.
 */
function resolveSpans(lineEls) {
  const bowSpans = [];
  const parenSpans = [];
  const linkSpans = [];
  let openBow = null;
  let openParen = null;
  let openLink = null;
  let last = null;

  const noteAt = (position) => {
    last = position;
    if (openBow && !openBow.first) openBow.first = position;
    if (openParen && !openParen.first) openParen.first = position;
    if (openLink && !openLink.first) openLink.first = position;
  };

  const marker = (node) => {
    const type = node.getAttribute("type");
    if (node.localName === "bow") {
      if (type === "start") {
        openBow = { direction: node.getAttribute("direction") || null, first: null };
      } else if (openBow) {
        bowSpans.push({ ...openBow, last });
        openBow = null;
      }
    } else if (node.localName === "parenthesis") {
      if (type === "start") {
        openParen = {
          dim: node.hasAttribute("dim") ? node.getAttribute("dim") === "true" : null,
          mute: node.hasAttribute("mute") ? node.getAttribute("mute") === "true" : null,
          first: null,
        };
      } else if (openParen) {
        parenSpans.push({ ...openParen, last });
        openParen = null;
      }
    } else if (node.localName === "link") {
      // Nothing to carry from the start marker: a link's shape follows from
      // where its notes fell, not from anything the arranger chose.
      if (type === "start") {
        openLink = { first: null };
      } else if (openLink) {
        linkSpans.push({ ...openLink, last });
        openLink = null;
      }
    }
  };

  lineEls.forEach((lineEl, lineIndex) => {
    els(lineEl, "measure").forEach((measureEl, measureIndex) => {
      let beatIndex = -1;
      for (const child of Array.from(measureEl.childNodes)) {
        if (child.nodeType !== 1) continue;
        if (child.localName === "group") {
          beatIndex++;
          let slotIndex = 0;
          for (const gc of Array.from(child.childNodes)) {
            if (gc.nodeType !== 1) continue;
            if (gc.localName === "note" || gc.localName === "rest") {
              noteAt({ lineIndex, measureIndex, beatIndex, slotIndex });
              slotIndex++;
            } else if (MARKERS.has(gc.localName)) {
              marker(gc);
            }
          }
        } else if (child.localName === "note" || child.localName === "rest") {
          beatIndex++;
          noteAt({ lineIndex, measureIndex, beatIndex, slotIndex: 0 });
        } else if (MARKERS.has(child.localName)) {
          marker(child);
        }
      }
    });
  });

  return { bowSpans, parenSpans, linkSpans };
}

/**
 * A browser's native DOMParser never throws on malformed XML (unlike
 * Node's xmldom, which throws directly from parseFromString) - it silently
 * returns a document whose root is a <parsererror> element instead, in a
 * shape that differs per browser (Chrome nests it under a <div>, Firefox
 * puts it at the document root directly), so searching for `<parsererror>`
 * by tag name anywhere in the tree is the one check that works across all
 * of them. Without this, the code below assumes a real <thai-score> root
 * and fails a few calls later on some unrelated null, with no indication
 * the actual problem was upstream, in the XML itself.
 */
function parserErrorMessage(doc) {
  const errorEl = doc.getElementsByTagName("parsererror")[0];
  if (!errorEl) return null;
  return errorEl.textContent.trim().replace(/\s+/g, " ");
}

export function parse(source, { warn = () => {} } = {}) {
  const doc = new DOMParser().parseFromString(source, "text/xml");
  const parseError = parserErrorMessage(doc);
  if (parseError) throw new Error(`the XML is not well-formed: ${parseError}`);
  if (!doc.documentElement) throw new Error("the XML is not well-formed: no root element");
  const score = doc.documentElement;
  if (score.localName !== "thai-score")
    throw new Error(`invalid ThaiMusicXML document: expected <thai-score>, got <${score.localName}>`);
  if (score.namespaceURI !== NS)
    throw new Error(
      `unsupported ThaiMusicXML namespace "${score.namespaceURI ?? ""}"; expected "${NS}"`,
    );
  // The namespace above is the compatibility boundary, and it matched. `version`
  // only tells releases apart inside that boundary, so a document from another
  // release of a namespace this parser implements is readable - it may just use
  // optional elements added after this parser was written. Per <thai-score>'s
  // conformance rules, a mismatch warns and must not reject on its own.
  // The attribute itself is still required, and the RNG demands it non-empty.
  const version = score.getAttribute("version");
  if (version === null || version === "")
    throw new Error("invalid ThaiMusicXML document: <thai-score> has no version");
  if (version !== VERSION)
    warn(
      `ThaiMusicXML version "${version}" does not match "${VERSION}", the current release of this namespace; reading it as "${VERSION}"`,
    );

  const header = required(score, "header", "thai-score");
  const structureEl = required(score, "structure", "thai-score");
  const ensemble = required(score, "ensemble", "thai-score");
  const parts = els(ensemble, "part").map((p) => ({
    id: p.getAttribute("id"),
    type: p.getAttribute("type") || "pitched",
    stack: p.getAttribute("stack") || null,
    row: p.hasAttribute("row") ? Number(p.getAttribute("row")) : null,
    name: text(el(p, "instrument-name")),
    shortName: text(el(p, "instrument-short-name")),
  }));

  // <structure> in the order it lays the score out. A <repeat> contributes what
  // it wraps; the repeat itself prints nothing (see "Repeat brackets"), and
  // neither does a <play>: the section's grid is already on the page where it
  // was declared, and a return to it is written by the arranger as a กลับต้น
  // annotation rather than by printing the music a second time.
  //
  // Annotations and <br> keep their place in the sequence rather than being
  // gathered separately, because where an annotation sits is the only thing
  // that decides where it renders.
  const structure = [];
  const collect = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue;
      if (child.localName === "section")
        structure.push({
          kind: "section",
          id: child.getAttribute("id"),
          name: child.getAttribute("name"),
          // A bracket in the margin right of the grid; see "Repeat brackets".
          lineRepeats: els(child, "line-repeat").map((lr) => ({
            first: Number(lr.getAttribute("first")),
            last: Number(lr.getAttribute("last")),
            // A bare <line-repeat> is worth two plays, the bare ซ้ำ bracket.
            times: lr.hasAttribute("times") ? Number(lr.getAttribute("times")) : 2,
          })),
        });
      else if (child.localName === "annotation") {
        const note = annotation(child);
        if (note) structure.push({ kind: "annotation", ...note });
      } else if (child.localName === "br") structure.push({ kind: "br" });
      else if (child.localName === "repeat") collect(child);
      else if (child.localName === "direction") {
        // None of nathap, chan, or bpm reach the page on their own - see each
        // element's own Rendering section. bpm is read by showHeaderExtras;
        // chan is read by nothing at present (a generated section heading
        // used to combine it with the section's name, and no longer does),
        // and is kept because a <direction>'s place in the sequence is part
        // of what the document says, not a display decision to make here.
        const chanEl = el(child, "chan");
        const bpmEl = el(child, "bpm");
        structure.push({
          kind: "direction",
          chan: chanEl ? chanEl.getAttribute("value") : null,
          bpm: bpmEl ? Number(text(bpmEl)) : null,
        });
      }
    }
  };
  collect(structureEl);
  const sections = structure.filter((item) => item.kind === "section");

  // part id -> section id -> { annotations, lines, bow/paren/linkSpans, endings }
  const music = {};
  for (const pd of els(score, "part-data")) {
    const partId = pd.getAttribute("part");
    const partType = parts.find((p) => p.id === partId)?.type;
    music[partId] = {};
    for (const ref of els(pd, "section-ref")) {
      const lineEls = els(ref, "line");
      // Bow and parenthesis spans are invalid inside a lyric part, so there is
      // nothing to resolve there.
      const { bowSpans, parenSpans, linkSpans } =
        partType === "lyric"
          ? { bowSpans: [], parenSpans: [], linkSpans: [] }
          : resolveSpans(lineEls);

      music[partId][ref.getAttribute("section")] = {
        // Annotations here belong to this part alone, and render above its
        // first row in the section.
        annotations: els(ref, "annotation").map(annotation).filter(Boolean),
        lines: lineEls.map((line) => parseLine(line, partType)),
        bowSpans,
        parenSpans,
        linkSpans,
        // An ending renders below the section, detached from the line(s) it
        // replaces, so it carries its own annotation and its own spans.
        endings: els(ref, "ending").map((endingEl) => {
          const endingLineEls = els(endingEl, "line");
          const spans =
            partType === "lyric"
              ? { bowSpans: [], parenSpans: [], linkSpans: [] }
              : resolveSpans(endingLineEls);
          return {
            pass: (endingEl.getAttribute("pass") || "")
              .split(",")
              .map((n) => Number(n.trim()))
              .filter((n) => Number.isInteger(n)),
            annotations: els(endingEl, "annotation").map(annotation).filter(Boolean),
            lines: endingLineEls.map((line) => parseLine(line, partType)),
            bowSpans: spans.bowSpans,
            parenSpans: spans.parenSpans,
            linkSpans: spans.linkSpans,
          };
        }),
      };
    }
  }

  return {
    version: score.getAttribute("version"),
    namespace: score.namespaceURI,
    title: text(el(header, "title")),
    composer: credit(el(header, "composer")),
    lyricist: credit(el(header, "lyricist")),
    arranger: credit(el(header, "arranger")),
    tuning: el(header, "tuning")?.getAttribute("reference") ?? null,
    license: text(el(header, "license")),
    parts,
    sections,
    structure,
    music,
  };
}
