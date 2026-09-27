# Vendored: ThaiMusicXML renderer and converter

Source: https://github.com/Nopparuj-an/ThaiMusicXML at commit
40b362e090273a48c662ceec46849b973db5c1f2, Apache License 2.0 (see
thaimusicxml/LICENSE.txt and thaimusicxml/NOTICE).

Re-fetch with `sh generator/vendor/fetch.sh`. The script changes three import
lines, and nothing else:

- `parse.mjs`, `resolve.mjs`: `#dom-parser` → the browser's global `DOMParser`.
- `text.mjs`, `draw.mjs`: `#font-loader` → `generator/vendor/font-loader.mjs`
  (Sarabun from jsdelivr).
- `text.mjs`: `opentype.js` default import → namespace import of the jsdelivr
  ESM build (it has no default export).
