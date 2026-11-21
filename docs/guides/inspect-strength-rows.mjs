// Report landmark offsets at the row drafts' top poses and incoming frames.
import { readFileSync } from 'node:fs';
import { between, ease, pose3d, RIGS3D } from '../../web/js/guides.js';

const fixtures = [
  ['barbell-row', 'lower ribs', 0.5],
  ['dumbbell-bent-over-row', 'hip', 0],
];

for (const [slug, landmark, torsoFraction] of fixtures) {
  const guide = JSON.parse(readFileSync(new URL(`samples/${slug}.json`, import.meta.url), 'utf8'));
  const rig = RIGS3D[guide.rig];
  const top = guide.poses.findIndex(pose => pose.id === 'top');
  if (top < 1) throw new Error(`Missing pull-to-top transition for ${slug}`);
  const frames = [0, 0.25, 0.5, 0.75, 1].map(progress => {
    const joints = between(rig, guide.poses[top - 1].joints, guide.poses[top].joints, ease(progress));
    const { P, held } = pose3d(rig, joints, guide);
    const target = P.hip.map((value, axis) => value + torsoFraction * (P.shoulderC[axis] - value));
    // Mirrored loads share the same side-plane path. Measure both so a future asymmetric rig is visible.
    return {
      frame: `${progress * 100}%`,
      landmark,
      'forward offsets': held.map(load => (load.center[0] - target[0]).toFixed(1)).join(', '),
      'height offsets': held.map(load => (load.center[1] - target[1]).toFixed(1)).join(', '),
    };
  });
  console.log(slug);
  console.table(frames);
}
