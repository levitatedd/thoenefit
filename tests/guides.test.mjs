// Movement guides (#256, pilot #259): run with `node tests/guides.test.mjs`.
// Checks every guide listed in web/guides/index.json against the format in
// docs/movement-guides.md, and that the figure keeps its proportions as it moves.
import { readFileSync, readdirSync } from 'node:fs';
import { RIGS, RIGS3D, CAMERAS, GRIPS, joints, between, ease, render, problems, rigOf, pose3d, checkLoop, viewBoxOf } from '../web/js/guides.js';

import { renderHashes } from '../docs/guides/render-hashes.mjs';

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
const v3mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

// Built-in exercise slugs, straight from the catalog.
const slugs = [...read('web/private/src/Catalog.php').matchAll(/^\s*\['([a-z0-9-]+)', '[^']+', '(?:barbell|dumbbell|kettlebell|cable|machine|band|bodyweight|cardio|stretch)'/gm)].map((m) => m[1]);
check(`the catalog has built-in exercises to map guides to (${slugs.length})`, slugs.length > 100 && slugs.includes('dumbbell-curl'));

const index = JSON.parse(read('web/guides/index.json'));
check('the index has the expected format', index.format === 'thoenefit-movement-guides-index' && index.version === 1 && typeof index.guides === 'object');

const manifest = JSON.parse(read('web/guides/renders.json'));
check('render fingerprints match every indexed guide', JSON.stringify(manifest.renders) === JSON.stringify(renderHashes(root, index.guides)), 'Run node docs/guides/render-previews.mjs');
check('legacy render fingerprints are valid', manifest.legacy && Object.values(manifest.legacy).every((hash) => /^[0-9a-f]{64}$/.test(hash)));

for (const [slug, file] of Object.entries(index.guides)) {
  console.log(`Guide ${slug}`);
  const g = JSON.parse(read(`web/guides/${file}`));
  const errs = problems(g, { slugs });
  check('passes the format checks', errs.length === 0, errs.join('; '));
  check('is listed under its own exercise slug', g.exercise === slug);
  const rig = rigOf(g);
  // Every limb keeps its length in every pose and part way between poses
  // (shared-figure rigs are checked in 3D below).
  let worst = 0;
  for (let k = 0; k < (RIGS3D[g.rig] ? 0 : g.poses.length); k++) {
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
  if (!RIGS3D[g.rig]) check('limbs keep their length through the whole loop', worst < 1e-6, String(worst));
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
check('there is a rig sample for every setup, barbells and machines included', ['goblet-squat', 'dumbbell-bench-press', 'one-arm-dumbbell-row', 'barbell-curl', 'deadlift', 'back-squat', 'overhead-press', 'dumbbell-rdl', 'barbell-bench-press', 'lat-pulldown', 'seated-cable-row'].every((x) => samples.some((g) => g.exercise === x)));
const shipped = Object.values(index.guides).map((f) => JSON.parse(read(`web/guides/${f}`))).filter((g) => RIGS3D[g.rig]);
for (const g of [...samples, ...shipped]) {
  console.log(`${samples.includes(g) ? 'Sample' : 'Guide'} ${g.exercise} (${g.rig})`);
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

console.log('Hammer curl (#261)');
{
  const g = JSON.parse(read('web/guides/hammer-curl.json'));
  const rig = rigOf(g);
  const by = Object.fromEntries(g.poses.map((p) => [p.id, { ...rig.defaults, ...p.joints }]));
  check('hammer curl: the palm faces in the whole way (no turn, unlike the curl)', Object.values(by).every((j) => j.supination === 0));
  check('hammer curl: upper arm still, torso upright, wrist straight', Object.values(by).every((j) => j.shoulder === 0 && j.torso === 0 && j.wrist === 0));
  check('hammer curl: a long arm at the bottom and the dumbbell near the front of the shoulder at the top', by.setup.elbow <= 10 && by.top.elbow >= 120 && by.top.elbow <= 145 && joints(rig, by.top).hand[0] > joints(rig, by.top).shoulder[0]);
}

console.log('Squat, bench press and row guides (#261)');
{
  const load = (slug) => { const g = JSON.parse(read(`web/guides/${slug}.json`)); return { g, rig: RIGS3D[g.rig], at: (id) => pose3d(RIGS3D[g.rig], g.poses.find((p) => p.id === id).joints, g) }; };
  const sq = load('goblet-squat');
  const bottom = sq.at('bottom').P;
  check('goblet squat: the bottom reaches about parallel (hips no more than 6 units above the knees)', bottom.hip[1] - bottom.nearKnee[1] <= 6, `${bottom.hip[1] - bottom.nearKnee[1]}`);
  check('goblet squat: the torso stays fairly upright (no more than 35 degrees of lean)', sq.g.poses.every((p) => p.joints.torso <= 35));
  check('goblet squat: the dumbbell stays at the chest the whole way', sq.g.poses.every((p) => { const { P, held } = sq.at(p.id); return dist3(held[0].hand, P.shoulderC) < 30; }));
  const bp = load('dumbbell-bench-press');
  check('bench press: each fist wraps over its handle and behind its front plate', bp.g.poses.every((p) => {
    const svg = render(bp.g, p.joints);
    const grips = [...svg.matchAll(/<g class="g-dumbbell">([^]*?)<\/g>(?=<path class="g-metal")/g)];
    return grips.length === 2 && grips.every(([, grip]) => /class="g-metal"[^]*class="g-handle"[^]*class="g-grip"/.test(grip));
  }));
  const bpBottom = bp.g.poses.find((p) => p.id === 'bottom').joints;
  check('bench press: wrists over elbows at the bottom (forearms vertical)', ['near', 'far'].every((s) => bpBottom[`${s}_shoulder`] === bpBottom[`${s}_elbow`]));
  check('bench press: upper arms angled away from the ribs at the bottom, not flared or pinned', ['near', 'far'].every((s) => bpBottom[`${s}_tuck`] >= 25 && bpBottom[`${s}_tuck`] <= 55));
  check('bench press: both arms move together', bp.g.poses.every((p) => ['shoulder', 'elbow', 'tuck'].every((k) => p.joints[`near_${k}`] === p.joints[`far_${k}`])));
  check('bench press: arms close to straight at the top', bp.g.poses[0].joints.near_shoulder <= 10);
  const row = load('one-arm-dumbbell-row');
  const top = row.at('top').P;
  check('row: at the top the dumbbell is by the hip, closer to it than to the shoulder', Math.abs(top.nearHand[0] - top.hip[0]) < Math.abs(top.nearHand[0] - top.nearShoulder[0]));
  check('row: at the top the forearm hangs straight down (within 10 degrees)', Math.abs(Math.atan2(top.nearHand[0] - top.nearElbow[0], top.nearElbow[1] - top.nearHand[1]) * 180 / Math.PI) <= 10);
  check('row: the torso stays still (no twisting or heaving)', new Set(row.g.poses.map((p) => p.joints.torso)).size === 1);
  check('row: the arm straightens at the bottom', row.g.poses[0].joints.elbow <= 10);
}

console.log('Barbells, a dumbbell in each hand, and seated machines (#261)');
{
  const bySlug = Object.fromEntries(samples.map((g) => [g.exercise, g]));
  const at = (g, id) => pose3d(RIGS3D[g.rig], g.poses.find((p) => p.id === id).joints, g);
  const loop = (g, fn) => {
    const rig = RIGS3D[g.rig];
    let ok = true;
    for (let k = 0; k < g.poses.length; k++) for (let t = 0; t <= 1.0001; t += 0.1) ok = ok && fn(pose3d(rig, between(rig, g.poses[k].joints, g.poses[(k + 1) % g.poses.length].joints, ease(t)), g));
    return ok;
  };
  const curl = bySlug['barbell-curl'];
  check('barbell: one level bar through both hands, shoulder width apart, the whole loop', loop(curl, ({ P, held }) => held.length === 1 && held[0].id === 'barbell-v1' && held[0].axis.join() === '0,0,1'
    && dist3(held[0].center, v3mid(P.nearHand, P.farHand)) < 1e-9 && Math.abs(dist3(P.nearHand, P.farHand) - 26) < 1e-9));
  const dl = bySlug['deadlift'];
  const setup = at(dl, 'setup');
  check('deadlift: the setup has the plates on the floor and the bar over the feet, in front of the shins', Math.abs(setup.held[0].center[1] - 20) < 1.5 && setup.held[0].center[0] > setup.P.nearAnkle[0] && setup.held[0].center[0] < setup.P.nearAnkle[0] + 14);
  const sunk = structuredClone(dl);
  Object.assign(sunk.poses[0].joints, { knee: 100, shin: 14 });
  check('deadlift: plates pushed into the floor are reported', problems(sunk, { slugs }).some((e) => /sink .* into the floor/.test(e)), problems(sunk, { slugs }).join('; '));
  const sq = bySlug['back-squat'];
  check('back squat: the bar stays on the upper back and both hands stay on it', loop(sq, ({ P, held, contacts }) => dist3(held[0].center, P.shoulderC) < 9 && held[0].center[0] < P.shoulderC[0] + 1
    && ['near hand on the bar', 'far hand on the bar'].every((n) => contacts.some((c) => c.name === n && dist3(c.at, c.target) < 0.05))));
  const ohp = bySlug['overhead-press'];
  const vb = viewBoxOf(RIGS3D[ohp.rig], ohp);
  check('overhead press: the picture grows to fit the bar overhead, and stays the same while it plays', vb[1] < 0 && viewBoxOf(RIGS3D[ohp.rig], ohp) === vb && checkLoop(ohp).outside === 0);
  check('overhead press: the bar finishes over the shoulders with straight arms', (() => { const { P, held } = at(ohp, 'overhead'); return Math.abs(held[0].center[0] - P.shoulderC[0]) < 8 && held[0].center[1] > P.shoulderC[1] + 55; })());
  const rdl = bySlug['dumbbell-rdl'];
  check('dumbbell RDL: a dumbbell in each hand, handles across the body', loop(rdl, ({ P, held }) => held.length === 2 && held.every((h) => h.id === 'dumbbell-pair-v1' && h.axis.join() === '0,0,1') && held[0].hand === P.nearHand && held[1].hand === P.farHand));
  const bb = bySlug['barbell-bench-press'];
  check('barbell bench: the grip stays the same width and both hands stay on the bar', loop(bb, ({ P, held, contacts }) => Math.abs(dist3(P.nearHand, P.farHand) - 52) < 0.1
    && dist3(held[0].center, v3mid(P.nearHand, P.farHand)) < 0.1 && contacts.filter((c) => /hand on the bar|on the bench|on the floor/.test(c.name)).length === 6));
  check('barbell bench: the bar comes down to the chest and goes up to straight arms', (() => { const top = at(bb, 'top'); const chest = at(bb, 'chest'); return chest.held[0].center[1] < 70 && top.held[0].center[1] - top.P.shoulderC[1] > 55; })());
  for (const [slug, feet] of [['lat-pulldown', 'floor'], ['seated-cable-row', 'footplate']]) {
    const g = bySlug[slug];
    check(`${slug}: hips on the seat, feet on the ${feet} and both hands on the handle the whole way`, loop(g, ({ contacts }) => [`hips on the seat`, `near foot on the ${feet}`, `far foot on the ${feet}`, 'near hand on the handle', 'far hand on the handle'].every((n) => contacts.some((c) => c.name === n && dist3(c.at, c.target) < 0.05))));
  }
  check('lat pulldown: the bar comes from overhead down to the upper chest', (() => { const a = at(bySlug['lat-pulldown'], 'reach'); const b = at(bySlug['lat-pulldown'], 'pull'); return a.held[0].center[1] > a.P.neck[1] + 30 && b.held[0].center[1] < b.P.neck[1] && b.held[0].center[1] > b.P.hip[1] + 30; })());
  check('seated cable row: the handle comes from arms long to the stomach', (() => { const a = at(bySlug['seated-cable-row'], 'reach'); const b = at(bySlug['seated-cable-row'], 'pull'); return a.held[0].center[0] > a.P.shoulderC[0] + 40 && b.held[0].center[0] < b.P.shoulderC[0] + 30 && b.held[0].center[1] < b.P.shoulderC[1] - 20; })());
  const far = structuredClone(bySlug['lat-pulldown']);
  far.poses[0].joints.torso = -25;
  check('a handle out of reach is reported', problems(far, { slugs }).some((e) => /hand on the handle drifts/.test(e)), problems(far, { slugs }).join('; '));
}

console.log('Straight-bar grips (#262)');
{
  const load = (f) => JSON.parse(read(f));
  const base = load('web/guides/barbell-curl.json');
  const benchBase = load('web/guides/barbell-bench-press.json');
  const rev = load('docs/guides/samples/reverse-grip-barbell-curl.json');
  const wide = load('docs/guides/samples/wide-grip-barbell-curl.json');
  const close = load('docs/guides/samples/close-grip-bench-press.json');
  // Every pose and nine frames between each pair.
  const frames = (g) => {
    const rig = RIGS3D[g.rig];
    const out = [];
    for (let k = 0; k < g.poses.length; k++) for (let i = 0; i < 10; i++) out.push(between(rig, g.poses[k].joints, g.poses[(k + 1) % g.poses.length].joints, ease(i / 10)));
    return out;
  };
  const spacing = (g, pose) => { const { P } = pose3d(RIGS3D[g.rig], pose, g); return dist3(P.nearHand, P.farHand); };
  for (const [g, half] of [[rev, 13], [wide, 24], [close, 15]]) {
    const rig = RIGS3D[g.rig];
    let worst = 0;
    let level = 0;
    for (const pose of frames(g)) {
      const { P, held, contacts } = pose3d(rig, pose, g);
      const bar = held.find((h) => h.id === 'barbell-v1');
      // Each hand projected onto the bar's axis sits at its own grip point, either side of the middle.
      for (const [side, s] of [['near', 1], ['far', -1]]) {
        const hand = P[`${side}Hand`];
        const along = (hand[2] - bar.center[2]) * s;
        const off = Math.hypot(hand[0] - bar.center[0], hand[1] - bar.center[1]);
        worst = Math.max(worst, Math.abs(along - half), off);
        const c = contacts.find((x) => x.name === `${side} hand on the bar`);
        worst = Math.max(worst, c ? dist3(c.at, c.target) : Infinity);
      }
      level = Math.max(level, Math.abs(P.nearHand[1] - P.farHand[1]), Math.abs(P.nearHand[0] - P.farHand[0]));
    }
    check(`${g.exercise}: both hands stay on their grip points, ${half} either side of the middle, level, through ${frames(g).length} frames`, worst < 1e-9 && level < 1e-9, `${worst} ${level}`);
  }
  check('reverse grip: the same shoulder-width spacing as the barbell curl', Math.abs(spacing(rev, rev.poses[0].joints) - spacing(base, base.poses[0].joints)) < 1e-9);
  check('wide grip: the hands sit well outside the barbell curl grip (48 apart against 26)', spacing(wide, wide.poses[0].joints) - spacing(base, base.poses[0].joints) > 20);
  check('close grip: narrower than the standard bench press grip (30 apart against 52)', Math.abs(spacing(close, close.poses[0].joints) - 30) < 1e-6 && spacing(benchBase, benchBase.poses[0].joints) - spacing(close, close.poses[0].joints) > 20);
  check('close grip: elbows close to the ribs and the bar down to the lower chest', close.poses.every((p) => p.joints.tuck <= 30) && close.poses.some((p) => p.joints.press === 0));
  // The usual grip is the same as no grip, and a grip draws no extra hand marks.
  const curlTop = render(base, base.poses[2].joints, { id: 'p' });
  check('setting the barbell curl\'s usual grip draws it exactly the same', render({ ...base, grip: { width: 'shoulder', palms: 'up' } }, base.poses[2].joints, { id: 'p' }) === curlTop);
  check('setting the bench press\'s usual grip draws it exactly the same', render({ ...benchBase, grip: { width: 'standard', palms: 'down' } }, benchBase.poses[2].joints, { id: 'p' }) === render(benchBase, benchBase.poses[2].joints, { id: 'p' }));
  check('palms are described, not drawn: reverse and palms-up curls look the same', render(rev, rev.poses[2].joints, { id: 'p' }) === curlTop);
  // Layering: the near plates are closer to the camera than the near hand, so they are
  // drawn after it; the bar runs through the hand.
  const layered = (g) => g.poses.every((p) => { const svg = render(g, p.joints, { id: 'l' }); const fist = svg.indexOf('class="g-fist"'); return fist > 0 && svg.indexOf('class="g-barbell"', fist) > fist && svg.lastIndexOf('class="g-metal"') > fist; });
  check('every barbell guide draws the near plates in front of the near hand', ['barbell-curl', 'deadlift', 'back-squat', 'overhead-press', 'barbell-bench-press'].every((slug) => layered(load(`web/guides/${slug}.json`))) && [rev, wide, close].every(layered));
  const bad = (grip, g = base) => problems({ ...g, grip }, { slugs });
  check('a grip width the rig has not got, odd palms, extra keys, or a grip without a barbell are reported',
    bad({ width: 'close', palms: 'up' }).some((e) => /grip width must be "shoulder" or "wide"/.test(e))
    && bad({ width: 'shoulder', palms: 'sideways' }).some((e) => /palms must be/.test(e))
    && bad({ width: 'shoulder', palms: 'up', thumbs: 'out' }).some((e) => /only width and palms/.test(e))
    && bad({ width: 'shoulder', palms: 'up' }, JSON.parse(read('web/guides/hammer-curl.json'))).some((e) => /only for a barbell/.test(e)));
  check('the grip table covers the standing and bench barbell rigs', Object.keys(GRIPS).join() === 'grounded-side-v1,supine-barbell-v1');
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
