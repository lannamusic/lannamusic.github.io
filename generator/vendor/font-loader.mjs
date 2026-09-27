// Browser font loader for the vendored ThaiMusicXML renderer. Upstream's
// relies on Vite ?url imports, so fetch the same Sarabun files from jsdelivr.
const BASE = 'https://cdn.jsdelivr.net/npm/@fontsource/sarabun@5.3.0/files/';

export async function loadFontFile(file) {
  const response = await fetch(BASE + file);
  if (!response.ok) throw new Error(`font ${file}: ${response.status}`);
  return response.arrayBuffer();
}
