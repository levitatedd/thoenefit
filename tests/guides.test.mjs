// Movement guides (#256, pilot #259): run with `node tests/guides.test.mjs`.
// Checks every guide listed in web/guides/index.json against the format in
// docs/movement-guides.md, and that the figure keeps its proportions as it moves.
import { readFileSync } from 'node:fs';
import { RIGS, joints, between, ease, render, problems, rigOf } from '../web/js/guides.js';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok   ' : 'FAIL '} ${name}${ok || !detail ? '' : `  (${detail})`}`);
};
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Built-in exercise slugs, straight from the catalog.
const slugs = [...read('web/private/src/Catalog.php').matchAll(/^\s*\['([a-z0-9-]+)', '[^']+', '(?:barbell|dumbbell|kettlebell|cable|machine|band|bodyweight|cardio|stretch)'/gm)].map((m) => m[1]);
check(`the catalog has built-in exercises to map guides to (${slugs.length})`, slugs.length > 100 && slugs.includes('dumbbell-curl'));

const index = JSON.parse(read('web/guides/index.json'));
check('the index has the expected format', index.format === 'thoenefit-movement-guides-index' && index.version === 1 && typeof index.guides === 'object');

for (const [slug, file] of Object.entries(index.guides)) {
  console.log(`Guide ${slug}`);
  const g = JSON.parse(read(`web/guides/${file}`));
  const errs = problems(g, { slugs });
  check('passes the format checks', errs.length === 0, errs.join('; '));
  check('is listed under its own exercise slug', g.exercise === slug);
  const rig = rigOf(g);
  // Every limb keeps its length in every pose and part way between poses.
  let worst = 0;
  for (let k = 0; k < g.poses.length; k++) {
    const a = g.poses[k].joints;
    const b = g.poses[(k + 1) % g.poses.length].joints;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const J = joints(rig, between(rig, a, b, ease(t)));
      const L = rig.len;
      worst = Math.max(worst,
        Math.abs(dist(J.shoulder, J.elbow) - L.upperArm), Math.abs(dist(J.elbow, J.hand) - L.forearm),
        Math.abs(dist(J.hip, J.knee) - L.thigh), Math.abs(dist(J.knee, J.ankle) - L.shin), Math.abs(dist(J.hip, J.shoulder) - L.torso));
    }
  }
  check('limbs keep their length through the whole loop', worst < 1e-6, String(worst));
  const svg = render(g, g.poses[0].joints, { id: 't', arrowDir: g.poses[0].arrow, label: g.poses[0].label });
  check('draws as SVG with no inline style (the site blocks those)', svg.startsWith('<svg') && !/style=/.test(svg) && !/<script/i.test(svg));
  check('each pose has a picture and a description for screen readers', g.poses.every((p) => render(g, p.joints, { label: p.description }).includes('aria-label=')));
}

console.log('Dumbbell curl pilot (#259)');
{
  const g = JSON.parse(read('web/guides/dumbbell-curl.json'));
  const rig = rigOf(g);
  const by = Object.fromEntries(g.poses.map((p) => [p.id, { ...rig.defaults, ...p.joints }]));
  check('four poses: Setup, Lift, Top, Lower', g.poses.map((p) => p.label).join() === 'Setup,Lift,Top,Lower');
  check('the upper arm stays at the side (no more than 10 degrees forward)', Object.values(by).every((j) => Math.abs(j.shoulder) <= 10));
  check('no swinging: the torso stays upright in every pose', Object.values(by).every((j) => j.torso === 0));
  check('the wrist stays straight', Object.values(by).every((j) => j.wrist === 0));
  check('a long arm at the bottom and a full curl short of the shoulder at the top', by.setup.elbow <= 10 && by.top.elbow >= 120 && by.top.elbow <= 145);
  check('the palm faces the thigh at the bottom and turns up as it rises, as the written cue says', by.setup.supination === 0 && by.top.supination === 1 && by.lift.supination > 0);
  check('the hand at the top is in front of the shoulder, not behind it', joints(rig, by.top).hand[0] > joints(rig, by.top).shoulder[0]);
  check('arrows show the way up on Lift and down on Lower', g.poses.find((p) => p.id === 'lift').arrow === 'up' && g.poses.find((p) => p.id === 'lower').arrow === 'down');
  check('the review record lists its checks, references and limitations', g.review.checks.length >= 4 && g.review.references.length >= 2 && g.review.limitations.length >= 1);
}

console.log('Format checks catch mistakes');
{
  const g = JSON.parse(read('web/guides/dumbbell-curl.json'));
  const bad = structuredClone(g);
  bad.exercise = 'not-a-real-lift';
  bad.poses[0].joints.elbow = 200;
  bad.poses[1].label = '';
  bad.review.references = [];
  const errs = problems(bad, { slugs });
  check('an unknown slug, an impossible elbow, a missing label and no references are all reported', errs.some((e) => /no built-in exercise/.test(e)) && errs.some((e) => /elbow 200/.test(e)) && errs.some((e) => /label/.test(e)) && errs.some((e) => /reference/.test(e)), errs.join('; '));
  check('the rig defines every joint a pose may use', Object.keys(RIGS['standing-side-v1'].limits).join() === Object.keys(RIGS['standing-side-v1'].defaults).join());
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
