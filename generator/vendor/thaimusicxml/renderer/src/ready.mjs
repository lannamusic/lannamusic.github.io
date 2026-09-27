// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// The one thing every caller awaits once, before the first parse/layout/draw:
// text.mjs and draw.mjs each load their own font bytes lazily (Node reads
// them off disk, a browser fetches them - see #font-loader), and both need
// that to finish before charWidth()/draw() can run.

import { textReady } from "./text.mjs";
import { drawReady } from "./draw.mjs";

export async function ready() {
  await Promise.all([textReady(), drawReady()]);
}
