// Writes a standalone SVG of every pose of every guide, for review and as the
// source artwork record (#259):
//
//   node docs/guides/render-previews.mjs
//
// Output: docs/guides/<exercise>/<pose>.svg and docs/guides/<exercise>/sheet.svg
// (all poses side by side, with arrows), and the same for each rig sample under
// docs/guides/samples/<exercise>/. The app draws the same pictures from
// the same code (web/js/guides.js), so these always match what people see.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { render, rigOf } from '../../web/js/guides.js';

const root = new URL('../../', import.meta.url);
const index = JSON.parse(readFileSync(new URL('web/guides/index.json', root), 'utf8'));
// Guides in the app, then the rig samples in docs/guides/samples/ (sheets go to
// docs/guides/samples/<slug>/). Pass file paths to preview just those guides:
//   node docs/guides/render-previews.mjs web/guides/goblet-squat.json
const only = process.argv.slice(2);
const jobs = only.length
  ? only.map((f) => [f, new URL(f, `file://${process.cwd()}/`), new URL(`docs/guides/${f.includes('samples/') ? 'samples/' : ''}${f.split('/').pop().replace(/\.json$/, '')}/`, root)])
  : [
    ...Object.entries(index.guides).map(([slug, file]) => [slug, new URL(`web/guides/${file}`, root), new URL(`docs/guides/${slug}/`, root)]),
    ...readdirSync(new URL('docs/guides/samples/', root)).filter((f) => f.endsWith('.json')).map((f) => [`sample ${f}`, new URL(`docs/guides/samples/${f}`, root), new URL(`docs/guides/samples/${f.replace(/\.json$/, '')}/`, root)]),
  ];
for (const [name, src, dir] of jobs) {
  const g = JSON.parse(readFileSync(src, 'utf8'));
  const slug = g.exercise;
  mkdirSync(dir, { recursive: true });
  const [, , w, h] = rigOf(g).viewBox;
  const panels = [];
  g.poses.forEach((p, k) => {
    const svg = render(g, p.joints, { id: `${slug}-${p.id}`, arrowDir: p.arrow, label: `${g.title}, ${p.label}: ${p.description}` });
    writeFileSync(new URL(`${p.id}.svg`, dir), `${svg}\n`);
    panels.push(`<g transform="translate(${k * (w + 20)} 0)"><rect width="${w}" height="${h + 26}" rx="10" fill="#1b2027"/>${svg.replace('<svg ', `<svg x="0" y="0" width="${w}" height="${h}" `)}<text x="${w / 2}" y="${h + 18}" fill="#f4f2ec" font-family="sans-serif" font-size="13" text-anchor="middle">${k + 1}. ${p.label}</text></g>`);
  });
  const W = g.poses.length * (w + 20) - 20;
  writeFileSync(new URL('sheet.svg', dir), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h + 26}" width="${W * 2}" height="${(h + 26) * 2}"><rect width="100%" height="100%" fill="#12151a"/>${panels.join('')}</svg>\n`);
  console.log(`${name}: ${g.poses.length} poses`);
}
