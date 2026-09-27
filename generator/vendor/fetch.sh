#!/bin/sh
# Re-vendor the ThaiMusicXML renderer and converter at a pinned commit, and
# rewrite the three imports the upstream repo resolves through package.json
# "imports" and a Vite build, so the files load directly in a browser.
set -eu
SHA=40b362e090273a48c662ceec46849b973db5c1f2
BASE="https://raw.githubusercontent.com/Nopparuj-an/ThaiMusicXML/$SHA"
DIR="$(cd "$(dirname "$0")" && pwd)/thaimusicxml"
mkdir -p "$DIR/renderer/src" "$DIR/converter/src"
for f in parse layout draw ready settings text geometry grid pager spans pos; do
  curl -fsSL "$BASE/renderer/src/$f.mjs" -o "$DIR/renderer/src/$f.mjs"
done
for f in resolve to-musicxml musicxml-durations pitch fraction ensemble-groups; do
  curl -fsSL "$BASE/converter/src/$f.mjs" -o "$DIR/converter/src/$f.mjs"
done
curl -fsSL "$BASE/LICENSE.txt" -o "$DIR/LICENSE.txt"
curl -fsSL "$BASE/NOTICE" -o "$DIR/NOTICE"
perl -pi -e 's|^import \{ DOMParser \} from "#dom-parser";|const { DOMParser } = globalThis;|' \
  "$DIR/renderer/src/parse.mjs" "$DIR/converter/src/resolve.mjs"
perl -pi -e 's|from "#font-loader";|from "../../../font-loader.mjs";|' \
  "$DIR/renderer/src/text.mjs" "$DIR/renderer/src/draw.mjs"
perl -pi -e 's|^import opentype from "opentype.js";|import * as opentype from "https://cdn.jsdelivr.net/npm/opentype.js\@2.0.0/dist/opentype.mjs";|' \
  "$DIR/renderer/src/text.mjs"
