// Movement guides (#256, pilot #259): run with `node tests/guides.test.mjs`.
// Checks every guide listed in web/guides/index.json against the format in
// docs/movement-guides.md, and that the figure keeps its proportions as it moves.
import { readFileSync, readdirSync } from 'node:fs';
import { RIGS, RIGS3D, joints, between, ease, render, problems, rigOf, pose3d, checkLoop } from '../web/js/guides.js';

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
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

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

console.log('The curl is unchanged by the shared-figure rigs (#261)');
{
  const g = JSON.parse(read('web/guides/dumbbell-curl.json'));
  const same = g.poses.every((p) => `${render(g, p.joints, { id: `dumbbell-curl-${p.id}`, arrowDir: p.arrow, label: `${g.title}, ${p.label}: ${p.description}` })}\n` === read(`docs/guides/dumbbell-curl/${p.id}.svg`));
  check('every curl pose renders exactly as its committed preview', same);
}

// Rig samples (#261): a few poses per new setup, proving the rig before final poses.
const sampleDir = new URL('docs/guides/samples/', root);
const samples = readdirSync(sampleDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(read(`docs/guides/samples/${f}`)));
check('there is a rig sample for the squat, bench press and row', ['goblet-squat', 'dumbbell-bench-press', 'one-arm-dumbbell-row'].every((x) => samples.some((g) => g.exercise === x)));
for (const g of samples) {
  console.log(`Sample ${g.exercise} (${g.rig})`);
  const errs = problems(g, { slugs });
  check('passes the format checks, including contacts and fit', errs.length === 0, errs.join('; '));
  const c = checkLoop(g);
  check(`contacts hold at every pose and between them (${c.frames} frames, worst ${c.contact.toExponential(1)})`, c.frames >= 20 && c.contact < 0.05);
  check('the weights stay with the hands that hold them', c.handGap < 1e-9, String(c.handGap));
  check('the figure and equipment stay inside the picture', c.outside === 0, `${c.outside} at ${c.where2}`);
  // Limbs keep their length in 3D at every frame.
  const rig = RIGS3D[g.rig];
  let worst = 0;
  for (let k = 0; k < g.poses.length; k++) {
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const pose = between(rig, g.poses[k].joints, g.poses[(k + 1) % g.poses.length].joints, ease(t));
      const { P } = pose3d(rig, pose, g);
      for (const side of ['near', 'far']) {
        worst = Math.max(worst,
          Math.abs(dist3(P[`${side}Hip`], P[`${side}Knee`]) - 44), Math.abs(dist3(P[`${side}Knee`], P[`${side}Ankle`]) - 44),
          Math.abs(dist3(P[`${side}Shoulder`], P[`${side}Elbow`]) - 34), Math.abs(dist3(P[`${side}Elbow`], P[`${side}Hand`]) - 30));
      }
      worst = Math.max(worst, Math.abs(dist3(P.hip, P.shoulderC) - 54));
    }
  }
  check('arms, legs and torso keep their length through the loop', worst < 1e-6, String(worst));
  const svg = render(g, g.poses[0].joints, { id: 's', arrowDir: g.poses[0].arrow, label: g.poses[0].label });
  check('draws as SVG with no inline style', svg.startsWith('<svg') && !/style=/.test(svg) && !/NaN/.test(svg));
}

console.log('What each new setup has to show');
{
  const bySlug = Object.fromEntries(samples.map((g) => [g.exercise, g]));
  const sq = bySlug['goblet-squat'];
  const sqRig = RIGS3D[sq.rig];
  const feet = sq.poses.map((p) => pose3d(sqRig, p.joints, sq).P.nearAnkle.join());
  const hips = sq.poses.map((p) => pose3d(sqRig, p.joints, sq).P.hip);
  check('goblet squat: feet stay planted while the hips move back and down', new Set(feet).size === 1 && hips.some((h) => h[0] < hips[0][0] - 10 && h[1] < hips[0][1] - 25));
  const gob = sq.poses.map((p) => pose3d(sqRig, p.joints, sq));
  check('goblet squat: one dumbbell, upright, held at the chest by both hands', gob.every(({ P, held }) => held.length === 1 && held[0].id === 'dumbbell-goblet-v1' && held[0].axis.join() === '0,1,0' && dist3(P.nearHand, P.farHand) < 8 && dist3(held[0].hand, P.shoulderC) < 30));
  const bp = bySlug['dumbbell-bench-press'];
  const bpRig = RIGS3D[bp.rig];
  const one = { ...bp.poses[0].joints, near_shoulder: 70, near_elbow: 70 };
  const a = pose3d(bpRig, bp.poses[0].joints, bp);
  const b = pose3d(bpRig, one, bp);
  check('bench press: two dumbbells, each moving only with its own arm', a.held.length === 2 && dist3(a.held[0].center, b.held[0].center) > 10 && dist3(a.held[1].center, b.held[1].center) === 0);
  check('bench press: back and hips stay on the bench and both feet on the floor', ['back on the bench', 'hips on the bench', 'near foot on the floor', 'far foot on the floor'].every((n) => b.contacts.some((c) => c.name === n && dist3(c.at, c.target) < 1e-9)));
  check('bench press: the three-quarter view shows both arms apart', Math.abs(render(bp, one, { id: 'q' }).length) > 0 && dist3(b.P.nearHand, b.P.farHand) > 20);
  const row = bySlug['one-arm-dumbbell-row'];
  const rowRig = RIGS3D[row.rig];
  const pulled = pose3d(rowRig, row.poses[1].joints, row);
  check('row: far hand and knee on the bench, near foot on the floor, dumbbell in the working hand', ['far hand on the bench', 'far knee on the bench', 'near foot on the floor'].every((n) => pulled.contacts.some((c) => c.name === n && dist3(c.at, c.target) < 0.05)) && pulled.held[0].hand === pulled.P.nearHand);
  check('row: the torso is hinged forward', row.poses.every((p) => p.joints.torso >= 60));
  const upright = structuredClone(row);
  upright.poses[0].joints.torso = 62;
  check('row: a torso too upright for the far hand to reach the bench is reported', problems(upright, { slugs }).some((e) => /far hand on the bench drifts/.test(e)), problems(upright, { slugs }).join('; '));
  const wrongCam = structuredClone(sq);
  wrongCam.camera = 'side-three-quarter';
  wrongCam.equipment = ['flat-bench-v1'];
  const errs = problems(wrongCam, { slugs });
  check('the wrong camera or equipment for a rig is reported', errs.some((e) => /camera must be "side"/.test(e)) && errs.some((e) => /not available on the grounded-side-v1 rig/.test(e)), errs.join('; '));
}

console.log('Format checks catch mistakes');
{
  const tpl = JSON.parse(read('docs/guides/template.json'));
  check('the template lists every rig, camera and equipment id the renderer supports', Object.keys(tpl._help.rigs).sort().join() === [...Object.keys(RIGS), ...Object.keys(RIGS3D)].sort().join()
    && Object.entries(RIGS3D).every(([id, r]) => tpl._help.rigs[id].camera === r.camera && tpl._help.rigs[id].equipment.join() === r.equipment.join() && JSON.stringify(tpl._help.rigs[id].joints) === JSON.stringify(r.limits)));
  check('a guide still carrying the template\'s _help notes is reported', problems(tpl).some((e) => /_help/.test(e)));

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
