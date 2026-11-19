// Writes a standalone SVG of every pose of every guide, for review and as the
// source artwork record (#259):
//
//   node docs/guides/render-previews.mjs
//
// Output: docs/guides/<exercise>/<pose>.svg and docs/guides/<exercise>/sheet.svg
// (all poses side by side, with arrows). The app draws the same pictures from
// the same code (web/js/guides.js), so these always match what people see.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { render, rigOf } from '../../web/js/guides.js';

const root = new URL('../../', import.meta.url);
const index = JSON.parse(readFileSync(new URL('web/guides/index.json', root), 'utf8'));
for (const [slug, file] of Object.entries(index.guides)) {
  const g = JSON.parse(readFileSync(new URL(`web/guides/${file}`, root), 'utf8'));
  const dir = new URL(`docs/guides/${slug}/`, root);
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
  console.log(`${slug}: ${g.poses.length} poses`);
}
