import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { between, render, rigOf } from '../../web/js/guides.js';

export function renderHashes(root, guides) {
  return Object.fromEntries(Object.entries(guides).map(([slug, file]) => {
    const guide = JSON.parse(readFileSync(new URL(`web/guides/${file}`, root), 'utf8'));
    const rig = rigOf(guide);
    const hash = createHash('sha256');
    for (const [i, pose] of guide.poses.entries()) {
      hash.update(render(guide, pose.joints, { arrowDir: pose.arrow })).update('\n');
      if (guide.poses.length > 1) {
        const next = guide.poses[(i + 1) % guide.poses.length];
        // Sample the motion too, since an SVG can change only between key poses.
        for (const t of [0.25, 0.5, 0.75]) {
          hash.update(render(guide, between(rig, pose.joints, next.joints, t))).update('\n');
        }
      }
    }
    return [slug, hash.digest('hex')];
  }));
}
