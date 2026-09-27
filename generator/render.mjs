// Thai strip (ThaiMusicXML renderer) and Western staff (converter + Verovio),
// both 50 px per measure, combined into one SVG.
import { parse } from './vendor/thaimusicxml/renderer/src/parse.mjs';
import { layout } from './vendor/thaimusicxml/renderer/src/layout.mjs';
import { draw } from './vendor/thaimusicxml/renderer/src/draw.mjs';
import { ready } from './vendor/thaimusicxml/renderer/src/ready.mjs';
import { resolve } from './vendor/thaimusicxml/converter/src/resolve.mjs';
import { toMusicXml } from './vendor/thaimusicxml/converter/src/to-musicxml.mjs';
import { thaiOptions, withoutTitle, anchors, verovioBarlines, verovioSize, measureSpread, placeScore, scoreSvg } from './score-geometry.mjs';

const VEROVIO_URL = 'https://cdn.jsdelivr.net/npm/verovio@6.3.0/dist/verovio-toolkit-wasm.js';
// spacingNonLinear 1 gives measures of equal length the same width; tighter
// than about 0.04 Verovio widens dense measures to avoid collisions.
const SPACINGS = [0.04, 0.05, 0.07, 0.1];
let verovioPromise = null;

function loadVerovio() {
  verovioPromise ??= new Promise((resolveToolkit, reject) => {
    const tag = document.createElement('script');
    tag.src = VEROVIO_URL;
    tag.onerror = () => {
      verovioPromise = null;
      reject(new Error('verovio failed to load'));
    };
    tag.onload = () => {
      const done = () => resolveToolkit(new window.verovio.toolkit());
      if (window.verovio.module.calledRun) done();
      else window.verovio.module.onRuntimeInitialized = done;
    };
    document.head.appendChild(tag);
  });
  return verovioPromise;
}

export async function renderScore(txml, measureCount) {
  await ready();
  const opts = thaiOptions(measureCount);
  const page = withoutTitle(layout(parse(txml), opts));
  const thaiSvg = draw(page, opts);
  const beats = anchors(page.elements);

  const vrv = await loadVerovio();
  const musicXml = toMusicXml(resolve(txml));
  let westSvg = '';
  let bars = [];
  for (const spacingLinear of SPACINGS) {
    vrv.setOptions({ breaks: 'none', scale: 40, adjustPageWidth: true, adjustPageHeight: true, header: 'none', footer: 'none', spacingNonLinear: 1.0, spacingLinear });
    vrv.loadData(musicXml);
    westSvg = vrv.renderToSVG(1);
    bars = verovioBarlines(westSvg);
    if (measureSpread(bars) <= 0.01) break;
  }
  const geo = placeScore({ thai: { width: page.width, height: page.height }, west: verovioSize(westSvg), bars, beats });
  return { svg: scoreSvg(thaiSvg, westSvg, geo), geo, beats, spread: measureSpread(bars), musicXml };
}
