/**
 * Movement guides (#256, pilot #259): an articulated mint figure drawn from one
 * shared rig, posed by joint angles, so every guide uses the same body,
 * proportions and camera, and an animation can never stretch a limb.
 *
 * A guide is a JSON file in web/guides/ (format documented in
 * docs/movement-guides.md). It names a rig and lists poses as joint angles;
 * this module turns a pose into SVG markup. Nothing here touches the DOM, so the
 * same code renders in the app, in the checks and in the preview script.
 *
 * Angles are in degrees. Limbs are measured from straight down, positive
 * towards the way the figure faces (to the right); the torso is measured from
 * straight up, positive leaning forward. Elbow and knee are bend angles.
 */

/** Standing figure seen from its right side, facing right. Lengths in viewBox units. */
export const RIGS = {
  'standing-side-v1': {
    viewBox: [44, 30, 168, 202],
    ground: 224,
    hip: [118, 132],
    len: { torso: 54, neck: 9, upperArm: 34, forearm: 30, thigh: 44, shin: 44, foot: 20 },
    limits: {
      torso: [-15, 45], shoulder: [-40, 100], elbow: [0, 150], wrist: [-30, 30],
      hip: [-30, 100], knee: [0, 140], supination: [0, 1],
    },
    defaults: { torso: 0, shoulder: 0, elbow: 0, wrist: 0, hip: 0, knee: 0, supination: 0 },
  },
};

/**
 * Equipment a guide can list. Each draws itself from the pose: held weights at
 * their hands, benches under the body. Which rigs support each is in RIGS3D.
 */
export const EQUIPMENT = ['dumbbell-v1', 'dumbbell-goblet-v1', 'dumbbell-pair-v1', 'flat-bench-v1', 'barbell-v1', 'barbell-back-v1', 'lat-pulldown-v1', 'seated-row-v1'];

const rad = (d) => (d * Math.PI) / 180;
const down = (a, l) => [Math.sin(rad(a)) * l, Math.cos(rad(a)) * l];
const up = (a, l) => [Math.sin(rad(a)) * l, -Math.cos(rad(a)) * l];
const add = (p, d) => [p[0] + d[0], p[1] + d[1]];
const r1 = (n) => Math.round(n * 10) / 10;
const pt = (p) => `${r1(p[0])} ${r1(p[1])}`;

export function rigOf(guide) {
  const rig = RIGS[guide.rig] || RIGS3D[guide.rig];
  if (!rig) throw new Error(`Unknown rig ${guide.rig}`);
  return rig;
}

/** Joint positions for a pose (forward kinematics from the hip). */
export function joints(rig, pose) {
  const j = { ...rig.defaults, ...pose };
  const L = rig.len;
  const hip = rig.hip;
  const shoulder = add(hip, up(j.torso, L.torso));
  const neck = add(shoulder, up(j.torso, L.neck));
  const upperArm = j.shoulder;
  const elbow = add(shoulder, down(upperArm, L.upperArm));
  const forearm = upperArm + j.elbow;
  const hand = add(elbow, down(forearm, L.forearm)); // the wrist only tilts what is held
  const thigh = j.hip;
  const knee = add(hip, down(thigh, L.thigh));
  const shin = thigh - j.knee;
  const ankle = add(knee, down(shin, L.shin));
  const toe = add(ankle, [L.foot, 0]);
  return { hip, shoulder, neck, elbow, hand, knee, ankle, toe, forearm, upperArm, j };
}

/** Pose halfway (t = 0..1) between two poses: each joint angle moves evenly. */
export function between(rig, a, b, t) {
  const out = {};
  for (const k of Object.keys(rig.defaults)) {
    const x = a[k] ?? rig.defaults[k];
    const y = b[k] ?? rig.defaults[k];
    out[k] = x + (y - x) * t;
  }
  return out;
}

export const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// Colours live on the shapes, so a guide's SVG looks the same in the app and on its own.
const C = {
  edge: '#14724a', metal: '#b9c1ca', metalDark: '#6c757f', metalEdge: '#4d555e',
  handle: '#8a939d', ground: '#2b333d', arrow: '#3af29c', shine: '#d6fff0',
};

/** Unit normal (to the left of travel) and length from a to b. */
const normal = (a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  return [[-dy / L, dx / L], L];
};
const off = (p, n, r) => [p[0] + n[0] * r, p[1] + n[1] * r];
const along = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * A limb: rounded at both ends, `ra` wide at a and `rb` at b, with each side
 * bowing out by `bulgeL` / `bulgeR` at `at` (0..1) along it, like a muscle.
 * Left and right are relative to the direction from a to b.
 */
function limbPath(a, b, ra, rb, { bulgeL = 0, bulgeR = 0, at = 0.4 } = {}) {
  const [n] = normal(a, b);
  const m = along(a, b, at);
  const rm = ra + (rb - ra) * at;
  const pa1 = off(a, n, ra);
  const pb1 = off(b, n, rb);
  const pb2 = off(b, n, -rb);
  const pa2 = off(a, n, -ra);
  const c1 = off(m, n, (rm + bulgeL) * 2 - (ra + rb) / 2);
  const c2 = off(m, n, -((rm + bulgeR) * 2 - (ra + rb) / 2));
  return `M${pt(pa1)} Q${pt(c1)} ${pt(pb1)} A${r1(rb)} ${r1(rb)} 0 0 0 ${pt(pb2)} Q${pt(c2)} ${pt(pa2)} A${r1(ra)} ${r1(ra)} 0 0 0 ${pt(pa1)} Z`;
}

/** A smooth closed outline through points (Catmull-Rom turned into curves). */
function smooth(points) {
  const P = points;
  const n = P.length;
  let d = `M${pt(P[0])}`;
  for (let k = 0; k < n; k++) {
    const p0 = P[(k - 1 + n) % n];
    const p1 = P[k];
    const p2 = P[(k + 1) % n];
    const p3 = P[(k + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return `${d} Z`;
}

/** Points given across (u, forward) and up (v) from an origin, turned by `lean` degrees. */
const frame = (origin, lean) => {
  const f = [Math.cos(rad(lean)), Math.sin(rad(lean))];
  const u = up(lean, 1);
  return ([x, y]) => [origin[0] + f[0] * x + u[0] * y, origin[1] + f[1] * x + u[1] * y];
};

const shape = (d, fill, cls = 'g-body', edge = C.edge) => `<path class="${cls}" d="${d}" fill="${fill}" stroke="${edge}" stroke-width="1.3" stroke-linejoin="round"/>`;
const ball = (p, r, fill) => `<circle class="g-joint" cx="${r1(p[0])}" cy="${r1(p[1])}" r="${r}" fill="${fill}" stroke="${C.edge}" stroke-width="1.1"/>`;

/**
 * A dumbbell in the hand. The handle runs across the palm, square to the
 * forearm. Palm facing the thigh (supination 0) shows the handle side on, with
 * a plate at each end; palm up (1) turns it end on, so the plates meet in one
 * circle. In between it turns smoothly.
 */
function dumbbell(at, forearm, s) {
  const plate = 9;
  const thick = 3.5;
  const half = 11 * (1 - s);
  // Square to the forearm, in the plane of the picture.
  const ax = Math.cos(rad(forearm));
  const ay = -Math.sin(rad(forearm));
  const a = [at[0] + ax * half, at[1] + ay * half];
  const b = [at[0] - ax * half, at[1] - ay * half];
  const rx = r1(thick + (plate - thick) * s);
  const rot = r1(-forearm);
  const disc = (c) => `<ellipse class="g-metal" cx="${r1(c[0])}" cy="${r1(c[1])}" rx="${rx}" ry="${plate}" fill="${C.metal}" stroke="${C.metalEdge}" stroke-width="1.2" transform="rotate(${rot} ${r1(c[0])} ${r1(c[1])})"/><ellipse cx="${r1(c[0])}" cy="${r1(c[1])}" rx="${r1(Math.max(1, rx - 2.4))}" ry="${plate - 2.4}" fill="none" stroke="${C.metalDark}" stroke-width="0.8" transform="rotate(${rot} ${r1(c[0])} ${r1(c[1])})"/>`;
  const bar = half > 0.5 ? `<line class="g-handle" x1="${r1(a[0])}" y1="${r1(a[1])}" x2="${r1(b[0])}" y2="${r1(b[1])}" stroke="${C.handle}" stroke-width="3.5" stroke-linecap="round"/>` : '';
  const hub = s > 0.6 ? `<circle class="g-hub" cx="${r1(at[0])}" cy="${r1(at[1])}" r="${r1(2.2 * s)}" fill="${C.metalDark}"/>` : '';
  // As the palm turns up, the thumb-side plate (a) swings toward the camera, in front
  // of the hand, so it is drawn after the fist (#355). With the palm facing the thigh
  // nothing overlaps the fist and the dumbbell is drawn in one piece, as before.
  if (s <= 0) return { back: `<g class="g-dumbbell">${bar}${disc(b)}${disc(a)}${hub}</g>`, front: '' };
  return { back: `<g class="g-dumbbell">${bar}${disc(b)}</g>`, front: `<g class="g-dumbbell-near">${disc(a)}${hub}</g>` };
}

/** Curved arrow around the elbow, showing which way the forearm is about to move. */
function arrow(J, dir, rig) {
  const r = rig.len.forearm + 9;
  const from = J.forearm + (dir === 'up' ? 18 : -18);
  const to = J.forearm + (dir === 'up' ? 48 : -48);
  const p = (a) => add(J.elbow, down(a, r));
  const s = p(from);
  const e = p(to);
  const sweep = dir === 'up' ? 0 : 1;
  // Arrowhead along the direction of travel.
  const tangent = dir === 'up' ? to + 90 : to - 90;
  const h1 = add(e, down(tangent + 150, 7));
  const h2 = add(e, down(tangent - 150, 7));
  return `<g class="g-arrow" stroke="${C.arrow}"><path d="M${pt(s)} A${r} ${r} 0 0 ${sweep} ${pt(e)}" fill="none" stroke-width="3" stroke-linecap="round"/><path d="M${pt(h1)} L${pt(e)} L${pt(h2)}" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

/**
 * SVG markup for one pose. `id` keeps gradient ids unique when several
 * figures share a page; `arrow` is 'up', 'down' or null.
 */
export function render(guide, pose, { id = 'g', arrowDir = null, label = '' } = {}) {
  if (RIGS3D[guide.rig]) return render3d(guide, pose, { id, arrowDir, label });
  const rig = rigOf(guide);
  const J = joints(rig, pose);
  const [vx, vy, vw, vh] = rig.viewBox;
  const mint = `url(#${id}-mint)`;
  const far = `url(#${id}-far)`;
  const lean = J.j.torso;
  // Torso, pelvis and head are drawn in the body's own frame (x forward, y up from
  // the hip), then turned with the torso, so they lean as one piece.
  const T = frame(J.hip, lean);
  const torso = smooth([[-10, 50], [-12.5, 40], [-10.5, 28], [-8, 17], [7, 17], [13, 26], [16.5, 38], [13.5, 50], [5, 58], [-6, 57]].map(T));
  const belly = smooth([[-8, 20], [-9.5, 9], [-8, 3], [8, 3], [10, 10], [8, 20]].map(T));
  const pelvis = smooth([[-12, 4], [-12.5, -3], [-8, -9], [4, -10], [11, -4], [11.5, 3], [5, 6], [-6, 6]].map(T));
  // Head: an egg tilted a little forward, chin towards the front, on a short neck.
  const H = frame(J.neck, lean);
  const head = smooth([[-8, 5], [-10, 13], [-6, 21], [2, 23.5], [9, 19], [11, 11], [9.5, 4], [4, 0], [-3, 0]].map(H));
  const neck = limbPath(H([0, -6]), H([1.5, 3]), 4.6, 4);
  // Far leg, set a little behind and darker.
  const shift = (p) => [p[0] - 5, p[1]];
  const fHip = shift(J.hip);
  const fKnee = shift(J.knee);
  const fAnkle = shift(J.ankle);
  const foot = (ankle, fill) => shape(smooth([[ankle[0] - 5, ankle[1] - 3], [ankle[0] + 3, ankle[1] - 4], [ankle[0] + rig.len.foot - 2, ankle[1] - 1.5], [ankle[0] + rig.len.foot, ankle[1] + 2.5], [ankle[0] + 2, ankle[1] + 3], [ankle[0] - 6, ankle[1] + 2.5]]), fill);
  // Hand: a closed fist round the handle.
  const [nF] = normal(J.elbow, J.hand);
  const fist = smooth([off(J.hand, nF, 4.6), off(along(J.elbow, J.hand, 1.12), nF, 2.6), off(along(J.elbow, J.hand, 1.12), nF, -2.6), off(J.hand, nF, -4.6), off(along(J.elbow, J.hand, 0.9), nF, -3.4), off(along(J.elbow, J.hand, 0.9), nF, 3.4)]);
  const db = dumbbell(J.hand, J.forearm, J.j.supination);
  const parts = [
    // Gradients span the whole picture (userSpaceOnUse): one sized to a straight
    // vertical shape would have no width and paint nothing.
    `<defs><linearGradient id="${id}-mint" gradientUnits="userSpaceOnUse" x1="${vx}" y1="${vy}" x2="${vx + vw * 0.8}" y2="${vy + vh}"><stop offset="0" stop-color="#b4ffdc"/><stop offset="0.45" stop-color="#6ef3b4"/><stop offset="1" stop-color="#2fd98a"/></linearGradient><linearGradient id="${id}-far" gradientUnits="userSpaceOnUse" x1="${vx}" y1="${vy}" x2="${vx + vw * 0.8}" y2="${vy + vh}"><stop offset="0" stop-color="#5fd6a0"/><stop offset="1" stop-color="#1e9a62"/></linearGradient></defs>`,
    `<ellipse class="g-ground" cx="${r1(J.hip[0] + 4)}" cy="${rig.ground + 1}" rx="40" ry="3" fill="${C.ground}"/>`,
    // Far leg.
    shape(limbPath(fHip, fKnee, 7, 5.2, { bulgeL: 0.8, bulgeR: 1.1 }), far),
    shape(limbPath(fKnee, fAnkle, 5, 3.2, { bulgeR: 1.3, at: 0.3 }), far),
    foot(fAnkle, far),
    // Near leg: thigh, calf, foot, with ball joints at the knee and ankle.
    shape(limbPath(J.hip, J.knee, 7.5, 5.4, { bulgeL: 0.9, bulgeR: 1.2 }), mint),
    shape(limbPath(J.knee, J.ankle, 5.3, 3.4, { bulgeL: 0.5, bulgeR: 1.6, at: 0.3 }), mint),
    foot(J.ankle, mint),
    ball(J.ankle, 3, mint),
    ball(J.knee, 4.6, mint),
    // Body: pelvis, abdomen and chest, with mannequin seams between them.
    shape(pelvis, mint),
    shape(belly, mint),
    shape(torso, mint),
    shape(neck, mint),
    shape(head, mint),
    // Near arm, in front of the body: upper arm, forearm, fist, ball joints.
    shape(limbPath(J.shoulder, J.elbow, 5.6, 4.4, { bulgeL: 0.4, bulgeR: 1.3, at: 0.45 }), mint),
    ball(J.shoulder, 5.4, mint),
    shape(limbPath(J.elbow, J.hand, 4.6, 3.1, { bulgeL: 0.9, bulgeR: 0.4, at: 0.3 }), mint),
    ball(J.elbow, 3.8, mint),
    db.back,
    shape(fist, mint),
    db.front,
    arrowDir ? arrow(J, arrowDir, rig) : '',
  ];
  const title = label ? `<title>${label.replace(/[<&]/g, '')}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="guide-figure" viewBox="${vx} ${vy} ${vw} ${vh}" role="img"${label ? ` aria-label="${label.replace(/"/g, '&quot;')}"` : ''}>${title}${parts.join('')}</svg>`;
}

/**
 * Problems with a guide file, as plain sentences (empty when it is fine).
 * Used by the checks and by anyone adding a guide (see docs/movement-guides.md).
 */
export function problems(guide, { slugs = null } = {}) {
  const out = [];
  if (guide.format !== 'thoenefit-movement-guide') out.push('format must be "thoenefit-movement-guide"');
  if (guide.version !== 1) out.push('version must be 1');
  if (!guide.exercise || !/^[a-z0-9-]+$/.test(guide.exercise)) out.push('exercise must be a built-in exercise slug');
  if (slugs && !slugs.includes(guide.exercise)) out.push(`no built-in exercise has the slug "${guide.exercise}"`);
  const rig = RIGS[guide.rig] || RIGS3D[guide.rig];
  if (!rig) out.push(`unknown rig "${guide.rig}"`);
  for (const e of guide.equipment || []) {
    if (!EQUIPMENT.includes(e)) out.push(`unknown equipment "${e}"`);
    else if (rig && !(rig.equipment || ['dumbbell-v1']).includes(e)) out.push(`equipment "${e}" is not available on the ${guide.rig} rig`);
  }
  if (RIGS3D[guide.rig] && guide.camera !== rig.camera) out.push(`camera must be "${rig.camera}" on the ${guide.rig} rig`);
  if (guide.grip !== undefined) {
    const table = GRIPS[guide.rig];
    const g = guide.grip;
    if (!table || !(guide.equipment || []).includes('barbell-v1')) out.push(`grip is only for a barbell held in the hands (barbell-v1 on ${Object.keys(GRIPS).join(' or ')})`);
    else if (!g || typeof g !== 'object' || Object.keys(g).some((k) => !['width', 'palms'].includes(k))) out.push('grip has only width and palms');
    else {
      if (!(g.width in table.widths)) out.push(`grip width must be ${Object.keys(table.widths).map((w) => `"${w}"`).join(' or ')} on the ${guide.rig} rig`);
      if (!table.palms.includes(g.palms)) out.push('grip palms must be "up" or "down"');
    }
  }
  if ('_help' in guide) out.push('remove the template\'s _help notes before saving the guide');
  if (!guide.title) out.push('title is missing');
  const poses = guide.poses || [];
  if (poses.length < 1 || poses.length > 6) out.push('a guide has 1 to 6 poses');
  const ids = new Set();
  for (const [i, p] of poses.entries()) {
    const at = `pose ${i + 1}`;
    if (!p.id || ids.has(p.id)) out.push(`${at}: id missing or repeated`);
    ids.add(p.id);
    if (!p.label || p.label.length > 12) out.push(`${at}: label missing or longer than 12 characters`);
    if (!p.description || p.description.length > 160) out.push(`${at}: description missing or longer than 160 characters`);
    if (p.arrow != null && !['up', 'down'].includes(p.arrow)) out.push(`${at}: arrow must be "up", "down" or null`);
    if (rig) {
      for (const [k, v] of Object.entries(p.joints || {})) {
        const lim = rig.limits[k];
        if (!lim) out.push(`${at}: unknown joint "${k}"`);
        else if (typeof v !== 'number' || v < lim[0] || v > lim[1]) out.push(`${at}: ${k} ${v} is outside ${lim[0]} to ${lim[1]}`);
      }
    }
  }
  const t = guide.timing || {};
  if (!(t.move_ms >= 300 && t.move_ms <= 3000) || !(t.hold_ms >= 200 && t.hold_ms <= 3000)) out.push('timing needs move_ms 300-3000 and hold_ms 200-3000');
  const r = guide.review || {};
  if (!r.status || !r.checked || !(r.references || []).length) out.push('review needs a status, the date it was checked and at least one reference');
  if (!guide.source || !guide.source.artwork) out.push('source.artwork must say where the drawing comes from');
  // Shared-figure rigs: contacts hold and everything stays in the picture, at every
  // pose and part way between them.
  if (RIGS3D[guide.rig] && out.length === 0) {
    const c = checkLoop(guide);
    if (c.contact > CONTACT_TOLERANCE) out.push(`${c.contactName} drifts ${r1(c.contact)} units from its contact (at ${c.where})`);
    if (c.outside > 0) out.push(`the figure or equipment leaves the picture by ${r1(c.outside)} units (at ${c.where2})`);
    if (c.floor > 0.5) out.push(`the barbell's plates sink ${r1(c.floor)} units into the floor (at ${c.where3})`);
  }
  return out;
}

// ---------------------------------------------------------------- shared-figure rigs (#261)
//
// The same mint mannequin as the pilot, posed in 3D so the body can stand on the
// floor, lie on a bench or brace on one, and seen at an angle so both arms show.
// World units match the pilot's: x forward along the body's facing or lying
// direction, y up from the floor (y = 0), z towards the camera. A camera turns a
// point into the picture with an oblique projection:
//
//   picture x = origin x + x + z * kx      picture y = origin y - y + z * ky
//
// Planes facing the camera (x-y) keep their true shape, so the torso, head and
// pelvis are drawn with the pilot's outlines.
//
// Contacts (feet on the floor, back on the bench, a hand or knee braced on it) are
// fixed points of the rig, not results of the angles: legs and arms that touch them
// are solved to reach them, so they hold at every pose and every frame between.
// checkLoop() measures how far any contact drifts and whether anything leaves the
// picture, and problems() reports both.

export const CAMERAS = {
  side: { kx: 0.35, ky: 0.22 },
  'side-three-quarter': { kx: -0.32, ky: 0.38 },
  'front-three-quarter': { kx: 0.36, ky: 0.26 },
};

const BODY = { torso: 54, neck: 9, upperArm: 34, forearm: 30, thigh: 44, shin: 44, foot: 20, shoulderHalf: 13, hipHalf: 7 };
const CONTACT_TOLERANCE = 0.05;

export const RIGS3D = {
  // Standing on the floor, seen from the side, facing right. Built up from the
  // ankles, so the feet stay planted whatever the knees and hips do.
  'grounded-side-v1': {
    camera: 'side',
    viewBox: [44, 40, 168, 196],
    origin: [118, 224],
    equipment: ['dumbbell-goblet-v1', 'dumbbell-v1', 'dumbbell-pair-v1', 'barbell-v1', 'barbell-back-v1'],
    // Barbells and a dumbbell in each hand reach much further (overhead, the plates):
    // those guides are framed to fit their own whole loop instead.
    views: { 'barbell-v1': 'fit', 'barbell-back-v1': 'fit', 'dumbbell-pair-v1': 'fit' },
    limits: { shin: [-10, 45], knee: [0, 150], torso: [-10, 75], shoulder: [-90, 180], elbow: [0, 160], supination: [0, 1] },
    defaults: { shin: 0, knee: 0, torso: 0, shoulder: 0, elbow: 0, supination: 0 },
    arrowAt: 'hip',
    arrowDx: -24, // behind the hips, clear of the thighs
    shadow: 40,
  },
  // Lying face up on a flat bench, head to the left, feet planted on the floor,
  // seen from the front three-quarter so both arms show. Back, hips and feet are
  // fixed; each arm is posed on its own.
  'supine-bench-v1': {
    camera: 'front-three-quarter',
    viewBox: [18, 70, 240, 166],
    origin: [150, 222],
    equipment: ['flat-bench-v1', 'dumbbell-pair-v1'],
    limits: {
      near_shoulder: [0, 95], near_elbow: [0, 130], near_tuck: [0, 70],
      far_shoulder: [0, 95], far_elbow: [0, 130], far_tuck: [0, 70],
    },
    defaults: { near_shoulder: 0, near_elbow: 0, near_tuck: 0, far_shoulder: 0, far_elbow: 0, far_tuck: 0 },
    arrowAt: 'nearHand',
    shadow: 70,
  },
  // Braced on a flat bench with the far knee and far hand, near foot on the floor,
  // torso hinged forward, facing right, seen from the near side three-quarter. The
  // three contacts are fixed; the near arm is posed.
  'hinge-bench-side-v1': {
    camera: 'side-three-quarter',
    viewBox: [14, 80, 184, 156],
    origin: [104, 222],
    equipment: ['flat-bench-v1', 'dumbbell-v1'],
    limits: { torso: [60, 88], shoulder: [-90, 60], elbow: [0, 150] }, // below about 68 the far hand can't reach the bench: the checks say so
    defaults: { torso: 75, shoulder: 0, elbow: 0 },
    arrowAt: 'nearHand',
    shadow: 70,
  },
  // Barbell bench press: lying face up as in supine-bench-v1, both hands on one bar
  // a fixed grip apart. `press` moves the bar along its path from the chest (0) to
  // straight arms over the shoulders (1); the arms bend to follow it, elbows angled
  // out from the body by `tuck`.
  'supine-barbell-v1': {
    camera: 'front-three-quarter',
    viewBox: [0, 30, 272, 206],
    origin: [150, 222],
    equipment: ['flat-bench-v1', 'barbell-v1'],
    limits: { press: [0, 1], tuck: [20, 80] },
    defaults: { press: 1, tuck: 50 },
    arrowAt: 'nearHand',
    arrowDx: 28,
    shadow: 70,
  },
  // Seated at a cable machine, facing right, seen from the side. Hips stay on the
  // seat and feet on the floor or footplate; `pull` moves the handle along the
  // machine's path from arms long (0) to the end of the pull (1), and the arms
  // follow it. `torso` leans as in the other rigs (negative leans back).
  'seated-side-v1': {
    camera: 'side',
    viewBox: [16, 4, 220, 232],
    origin: [100, 224],
    equipment: ['lat-pulldown-v1', 'seated-row-v1'],
    limits: { torso: [-25, 30], pull: [0, 1] },
    defaults: { torso: 0, pull: 0 },
    arrowAt: 'nearHand',
    shadow: 60,
  },
};

const fitted = new WeakMap();
/**
 * The picture for a guide. Most rigs have one fixed picture; equipment marked 'fit'
 * frames the guide's whole loop (every pose and the frames between) with a margin,
 * so it never moves while playing and nothing is cut off.
 */
export function viewBoxOf(rig, guide) {
  const fit = ((guide && guide.equipment) || []).some((e) => rig.views && rig.views[e] === 'fit');
  if (!fit || !guide.poses || !guide.poses.length) return rig.viewBox;
  if (fitted.has(guide)) return fitted.get(guide);
  const [x0, y0, x1, y1] = checkLoop(guide, 10, true).box;
  const pad = 6;
  let w = x1 - x0 + pad * 2;
  const hgt = y1 - y0 + pad * 2;
  // Never narrower than three quarters of the height, so the player keeps its shape.
  const extra = Math.max(0, hgt * 0.75 - w);
  w += extra;
  const vb = [Math.round(x0 - pad - extra / 2), Math.round(y0 - pad), Math.ceil(w), Math.ceil(hgt)];
  fitted.set(guide, vb);
  return vb;
}

// Barbells: a 20 kg bar, plates the size of bumper plates. Units are about a centimetre.
const BAR = { half: 64, plateIn: 34, plateOut: 44, plate: 20, grip: 13, wideGrip: 26 };
/**
 * Straight-bar grips (#262). A guide may set `grip: { width, palms }`; without it the
 * rig uses its usual grip. Widths are half the distance between the hands, per rig;
 * the first listed is the rig's usual grip. `palms` records which way the palms face
 * for the review; it is not drawn (the written cue says it).
 */
export const GRIPS = {
  'grounded-side-v1': { widths: { shoulder: 13, wide: 24 }, palms: ['up', 'down'] },
  'supine-barbell-v1': { widths: { standard: 26, shoulder: 15 }, palms: ['down', 'up'] },
};
const gripOf = (rigId, guide) => {
  const g = guide && guide.grip;
  const table = GRIPS[rigId];
  if (!g || !table || !((guide.equipment || []).includes('barbell-v1'))) return null;
  return { half: table.widths[g.width] ?? Object.values(table.widths)[0], palms: g.palms };
};
// Seated machines: seat, feet and the handle's path, fixed by the machine.
const SEATED = {
  hip: [0, 52, 0],
  seat: { x: [-20, 22], z: [-16, 16], top: 46, pad: 7 },
  'lat-pulldown-v1': { feet: { near: [42, 4, 10], far: [42, 4, -10] }, from: [8, 160], to: [16, 98], grip: 32, pole: [0, -1, 1.2], pulley: [10, 200] },
  'seated-row-v1': { feet: { near: [64, 22, 10], far: [64, 22, -10] }, from: [64, 82], to: [18, 72], grip: 4, pole: [-1, -0.3, 0.6], pulley: [104, 66] }, // cable close to level (#302)
};

// Fixed contact points and bench boxes, in world units.
const SUPINE = {
  benchTop: 39,
  hip: [0, 49, 0],
  bench: { x: [-118, 16], z: [-13, 13], top: 39, pad: 7 },
  feet: { near: [44, 4, 9], far: [44, 4, -9] },
};
const HINGE = {
  bench: { x: [-62, 64], z: [-27, 3], top: 44, pad: 7 },
  knee: [-4, 47.5, -9], // far knee resting on the bench
  hand: [52, 47, -14], // far hand flat on the bench
  foot: [-4, 4, 13], // near foot on the floor
};

const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  unit: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};
const dist3 = (a, b) => v3.len(v3.sub(a, b));
// Forward/up direction in the x-y plane at `a` degrees: 0 straight down / up, positive forward (+x).
const dn3 = (a, l) => [Math.sin(rad(a)) * l, -Math.cos(rad(a)) * l, 0];
const up3 = (a, l) => [Math.sin(rad(a)) * l, Math.cos(rad(a)) * l, 0];

/**
 * Two-bone reach: the middle joint (knee or elbow) for a limb from `root` to
 * `target`, bending towards `pole`. If the target is out of reach the limb goes as
 * far as it can, and the end it returns shows the gap (checkLoop reports it).
 */
function reach(root, target, l1, l2, pole) {
  const d0 = dist3(root, target);
  const d = Math.min(Math.max(d0, Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6);
  const dir = v3.unit(v3.sub(target, root));
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let side = v3.sub(pole, v3.mul(dir, v3.dot(pole, dir)));
  side = v3.unit(side);
  const mid = v3.add(v3.add(root, v3.mul(dir, a)), v3.mul(side, h));
  const end = v3.add(mid, v3.mul(v3.unit(v3.sub(target, mid)), l2));
  return { mid, end };
}

/**
 * Every point of a pose in world units, plus the contacts as reached by the limbs
 * and where each held weight sits. `guide` decides grips (a goblet hold brings the
 * hands together at the chest).
 */
export function pose3d(rig, pose, guide) {
  const j = { ...rig.defaults, ...pose };
  const B = BODY;
  const eq = (guide && guide.equipment) || [];
  const P = {};
  const contacts = [];
  const held = [];
  if (rig === RIGS3D['grounded-side-v1']) {
    for (const [side, z] of [['near', B.hipHalf], ['far', -B.hipHalf]]) {
      const ankle = [0, 4, z];
      const knee = v3.add(ankle, up3(j.shin, B.shin));
      const hip = v3.add(knee, up3(j.shin - j.knee, B.thigh));
      Object.assign(P, { [`${side}Ankle`]: ankle, [`${side}Knee`]: knee, [`${side}Hip`]: hip });
      contacts.push({ name: `${side} foot on the floor`, at: ankle, target: [0, 4, z] });
    }
    P.hip = [P.nearHip[0], P.nearHip[1], 0];
    P.shoulderC = v3.add(P.hip, up3(j.torso, B.torso));
    const goblet = eq.includes('dumbbell-goblet-v1');
    const bargrip = gripOf('grounded-side-v1', guide);
    for (const [side, s] of [['near', 1], ['far', -1]]) {
      const sh = v3.add(P.shoulderC, [0, 0, s * B.shoulderHalf]);
      // Arm angles are measured from the torso here, so a hold at the chest stays at
      // the chest as the torso leans into the squat.
      const el = v3.add(sh, dn3(j.torso + j.shoulder, B.upperArm));
      // Goblet: the forearms angle in so the hands meet at the middle of the chest.
      // A wide barbell grip: the forearms angle out so the hands sit outside the shoulders.
      const dz = goblet ? -s * (B.shoulderHalf - 3) : bargrip ? s * (bargrip.half - B.shoulderHalf) : 0;
      const flat = Math.sqrt(B.forearm * B.forearm - dz * dz);
      const hand = v3.add(el, v3.add(dn3(j.torso + j.shoulder + j.elbow, flat), [0, 0, dz]));
      Object.assign(P, { [`${side}Shoulder`]: sh, [`${side}Elbow`]: el, [`${side}Hand`]: hand });
    }
    if (goblet) {
      const mid = v3.mul(v3.add(P.nearHand, P.farHand), 0.5);
      held.push({ id: 'dumbbell-goblet-v1', hand: mid, center: v3.add(mid, [3, -10, 0]), axis: [0, 1, 0] });
    } else if (eq.includes('dumbbell-v1')) {
      const fa = j.torso + j.shoulder + j.elbow;
      held.push({ id: 'dumbbell-v1', hand: P.nearHand, center: P.nearHand, axis: v3.unit([Math.cos(rad(fa)) * (1 - j.supination), Math.sin(rad(fa)) * (1 - j.supination), j.supination + 1e-3]) });
    } else if (eq.includes('dumbbell-pair-v1')) {
      // A dumbbell in each hand, handles across the body (palms facing the thighs).
      for (const side of ['near', 'far']) held.push({ id: 'dumbbell-pair-v1', hand: P[`${side}Hand`], center: P[`${side}Hand`], axis: [0, 0, 1] });
    } else if (eq.includes('barbell-v1')) {
      // Both hands on one bar, shoulder width apart: the bar runs through them.
      const mid = v3.mul(v3.add(P.nearHand, P.farHand), 0.5);
      held.push({ id: 'barbell-v1', hand: mid, center: mid, axis: [0, 0, 1] });
      if (bargrip) {
        // Each hand on its own place on the bar.
        held[held.length - 1].grip = bargrip;
        for (const [side, s] of [['near', 1], ['far', -1]]) {
          contacts.push({ name: `${side} hand on the bar`, at: P[`${side}Hand`], target: [mid[0], mid[1], s * bargrip.half] });
        }
      }
    } else if (eq.includes('barbell-back-v1')) {
      // Bar across the upper back, just below the neck; the hands reach back to hold it.
      // The arm joints are not used: the arms are solved to the bar.
      const u = up3(j.torso, 1);
      const back = [-u[1], u[0], 0];
      const bar = v3.add(P.shoulderC, v3.add(v3.mul(back, 7), v3.mul(u, -3)));
      held.push({ id: 'barbell-back-v1', hand: bar, center: bar, axis: [0, 0, 1] });
      for (const [side, s] of [['near', 1], ['far', -1]]) {
        const sh = P[`${side}Shoulder`];
        const grip = [bar[0], bar[1], s * BAR.wideGrip];
        const arm = reach(sh, grip, B.upperArm, B.forearm, v3.add(v3.mul(back, 0.4), [0, -1, 0]));
        Object.assign(P, { [`${side}Elbow`]: arm.mid, [`${side}Hand`]: arm.end });
        contacts.push({ name: `${side} hand on the bar`, at: arm.end, target: grip });
      }
    }
  } else if (rig === RIGS3D['supine-barbell-v1'] || rig === RIGS3D['seated-side-v1']) {
    const seated = rig === RIGS3D['seated-side-v1'];
    const M = seated ? SEATED[eq.find((e) => SEATED[e])] || SEATED['lat-pulldown-v1'] : null;
    if (seated) {
      P.hip = SEATED.hip;
      P.shoulderC = v3.add(P.hip, up3(j.torso, B.torso));
      contacts.push({ name: 'hips on the seat', at: [P.hip[0], P.hip[1] - 6, 0], target: [0, SEATED.seat.top, 0] });
    } else {
      P.hip = SUPINE.hip;
      P.shoulderC = v3.add(P.hip, [-B.torso, 0, 0]);
      contacts.push({ name: 'back on the bench', at: [P.shoulderC[0], P.shoulderC[1] - 10, 0], target: [-B.torso, SUPINE.benchTop, 0] });
      contacts.push({ name: 'hips on the bench', at: [P.hip[0], P.hip[1] - 10, 0], target: [0, SUPINE.benchTop, 0] });
    }
    // The handle: on the machine's path, or the bar between the chest and lockout.
    const t = seated ? j.pull : j.press;
    const [ax, ay] = seated ? M.from : [-38, 67];
    const [bx, by] = seated ? M.to : [-48, 112];
    const bar = [ax + (bx - ax) * t, ay + (by - ay) * t, 0];
    const bargrip = seated ? null : gripOf('supine-barbell-v1', guide);
    const grip = seated ? M.grip : bargrip ? bargrip.half : BAR.wideGrip;
    for (const [side, s] of [['near', 1], ['far', -1]]) {
      const hip = v3.add(P.hip, [0, 0, s * (seated ? B.hipHalf : 9)]);
      const foot = seated ? M.feet[side] : SUPINE.feet[side];
      const leg = reach(hip, foot, B.thigh, B.shin, [1, 0.6, 0]);
      Object.assign(P, { [`${side}Hip`]: hip, [`${side}Knee`]: leg.mid, [`${side}Ankle`]: leg.end });
      contacts.push({ name: `${side} foot on the ${seated && M.feet.near[1] > 10 ? 'footplate' : 'floor'}`, at: leg.end, target: foot });
      const sh = seated ? v3.add(P.shoulderC, [0, 0, s * B.shoulderHalf]) : v3.add(P.shoulderC, [4, 2, s * B.shoulderHalf]);
      const target = [bar[0], bar[1], s * grip];
      const pole = seated ? [M.pole[0], M.pole[1], s * M.pole[2]] : [Math.cos(rad(j.tuck)), -0.4, s * Math.sin(rad(j.tuck))];
      const arm = reach(sh, target, B.upperArm, B.forearm, pole);
      Object.assign(P, { [`${side}Shoulder`]: sh, [`${side}Elbow`]: arm.mid, [`${side}Hand`]: arm.end });
      contacts.push({ name: `${side} hand on the ${seated ? 'handle' : 'bar'}`, at: arm.end, target });
    }
    if (seated) held.push({ id: eq.find((e) => SEATED[e]), hand: bar, center: bar, axis: [0, 0, 1], grip });
    else held.push({ id: 'barbell-v1', hand: bar, center: bar, axis: [0, 0, 1], ...(bargrip ? { grip: bargrip } : {}) });
  } else if (rig === RIGS3D['supine-bench-v1']) {
    P.hip = SUPINE.hip;
    P.shoulderC = v3.add(P.hip, [-B.torso, 0, 0]);
    contacts.push({ name: 'back on the bench', at: [P.shoulderC[0], P.shoulderC[1] - 10, 0], target: [-B.torso, SUPINE.benchTop, 0] });
    contacts.push({ name: 'hips on the bench', at: [P.hip[0], P.hip[1] - 10, 0], target: [0, SUPINE.benchTop, 0] });
    for (const [side, s] of [['near', 1], ['far', -1]]) {
      const hip = v3.add(P.hip, [0, 0, s * 9]);
      const foot = SUPINE.feet[side];
      const leg = reach(hip, foot, B.thigh, B.shin, [1, 0.6, 0]);
      Object.assign(P, { [`${side}Hip`]: hip, [`${side}Knee`]: leg.mid, [`${side}Ankle`]: leg.end });
      contacts.push({ name: `${side} foot on the floor`, at: leg.end, target: foot });
      const sh = v3.add(P.shoulderC, [4, 2, s * B.shoulderHalf]);
      const th = rad(j[`${side}_shoulder`]);
      const tu = rad(j[`${side}_tuck`]);
      const up = [0, Math.cos(th), s * Math.sin(th)];
      const upper = v3.add(v3.mul(up, Math.cos(tu)), [Math.sin(tu), 0, 0]);
      const el = v3.add(sh, v3.mul(upper, B.upperArm));
      const f = rad(j[`${side}_shoulder`] - j[`${side}_elbow`]);
      const hand = v3.add(el, [0, Math.cos(f) * B.forearm, s * Math.sin(f) * B.forearm]);
      Object.assign(P, { [`${side}Shoulder`]: sh, [`${side}Elbow`]: el, [`${side}Hand`]: hand });
      held.push({ id: 'dumbbell-pair-v1', hand, center: hand, axis: [0.55, 0, 1], half: 15 });
    }
  } else if (rig === RIGS3D['hinge-bench-side-v1']) {
    const farHip = v3.add(HINGE.knee, v3.mul(v3.unit([4, 43.6, 2]), B.thigh));
    P.hip = v3.add(farHip, [0, 0, B.hipHalf]);
    Object.assign(P, { farHip, farKnee: HINGE.knee, farAnkle: v3.add(HINGE.knee, [-B.shin, 0, 0]) });
    contacts.push({ name: 'far knee on the bench', at: v3.add(farHip, v3.mul(v3.unit(v3.sub(HINGE.knee, farHip)), B.thigh)), target: HINGE.knee });
    const nearHip = v3.add(P.hip, [0, 0, B.hipHalf]);
    const leg = reach(nearHip, HINGE.foot, B.thigh, B.shin, [1, 0, 0.3]);
    Object.assign(P, { nearHip, nearKnee: leg.mid, nearAnkle: leg.end });
    contacts.push({ name: 'near foot on the floor', at: leg.end, target: HINGE.foot });
    P.shoulderC = v3.add(P.hip, up3(j.torso, B.torso));
    const farSh = v3.add(P.shoulderC, [0, 0, -B.shoulderHalf]);
    const arm = reach(farSh, HINGE.hand, B.upperArm, B.forearm, [-1, 0, -0.4]);
    Object.assign(P, { farShoulder: farSh, farElbow: arm.mid, farHand: arm.end });
    contacts.push({ name: 'far hand on the bench', at: arm.end, target: HINGE.hand });
    const sh = v3.add(P.shoulderC, [0, 0, B.shoulderHalf]);
    const el = v3.add(sh, dn3(j.shoulder, B.upperArm));
    const hand = v3.add(el, dn3(j.shoulder + j.elbow, B.forearm));
    Object.assign(P, { nearShoulder: sh, nearElbow: el, nearHand: hand });
    // Neutral grip: the handle runs front to back, along the body.
    held.push({ id: 'dumbbell-v1', hand, center: hand, axis: [1, 0, 0] });
  } else {
    throw new Error('not a shared-figure rig');
  }
  P.neck = v3.add(P.shoulderC, v3.mul(v3.unit(v3.sub(P.shoulderC, P.hip)), B.neck));
  return { P, contacts, held, j };
}

function project(rig) {
  const cam = CAMERAS[rig.camera];
  const [ox, oy] = rig.origin;
  return (p) => [ox + p[0] + p[2] * cam.kx, oy - p[1] + p[2] * cam.ky];
}

/** A flat bench: padded top, frame and two legs, as a projected box. */
function benchParts(rig, b) {
  const S = project(rig);
  const box = (x0, x1, y0, y1, z0, z1, fill, edge) => {
    const c = (x, y, z) => S([x, y, z]);
    const top = [c(x0, y1, z0), c(x1, y1, z0), c(x1, y1, z1), c(x0, y1, z1)];
    const front = [c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1)];
    const end = rig.camera === 'side-three-quarter' ? [c(x0, y0, z0), c(x0, y0, z1), c(x0, y1, z1), c(x0, y1, z0)] : [c(x1, y0, z0), c(x1, y0, z1), c(x1, y1, z1), c(x1, y1, z0)];
    const poly = (ps, f) => `<path d="M${ps.map(pt).join(' L')} Z" fill="${f}" stroke="${edge}" stroke-width="1.1" stroke-linejoin="round"/>`;
    return poly(end, fill.side) + poly(front, fill.front) + poly(top, fill.top);
  };
  const pad = { top: '#4a5563', front: '#363f4b', side: '#2f3742' };
  const metal = { top: '#8c96a1', front: '#6d7782', side: '#5b646e' };
  const zc = (b.z[0] + b.z[1]) / 2;
  const legs = [b.x[0] + 14, b.x[1] - 14].map((x) => box(x - 2.5, x + 2.5, 0, b.top - b.pad, zc - 2.5, zc + 2.5, metal, '#454d56')).join('');
  return `<g class="g-bench">${legs}${box(b.x[0], b.x[1], b.top - b.pad, b.top, b.z[0], b.z[1], pad, '#202730')}</g>`;
}

/** A dumbbell anywhere in 3D: two plates square to the handle, projected. */
function dumbbell3d(rig, center, axis, { half = 10, plate = 8.5, grip = '' } = {}) {
  const S = project(rig);
  const a = v3.unit(axis);
  const helper = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = v3.unit(v3.cross(a, helper));
  const w = v3.cross(a, u);
  const disc = (c, r) => smooth(Array.from({ length: 12 }, (_, k) => {
    const t = (k / 12) * Math.PI * 2;
    return S(v3.add(c, v3.add(v3.mul(u, Math.cos(t) * r), v3.mul(w, Math.sin(t) * r))));
  }));
  const ends = [v3.add(center, v3.mul(a, half)), v3.add(center, v3.mul(a, -half))].sort((p, q) => p[2] - q[2]);
  const ps = ends.map((e) => [v3.add(e, v3.mul(a, Math.sign(v3.dot(v3.sub(e, center), a)) * 2.2)), e]);
  const handle = `<line class="g-handle" x1="${r1(S(ends[0])[0])}" y1="${r1(S(ends[0])[1])}" x2="${r1(S(ends[1])[0])}" y2="${r1(S(ends[1])[1])}" stroke="${C.handle}" stroke-width="3.5" stroke-linecap="round"/>`;
  const plateAt = ([outer, inner]) => `<path class="g-metal" d="${disc(outer, plate)}" fill="${C.metalDark}" stroke="${C.metalEdge}" stroke-width="1"/><path class="g-metal" d="${disc(inner, plate)}" fill="${C.metal}" stroke="${C.metalEdge}" stroke-width="1.2"/><path d="${disc(inner, plate - 2.6)}" fill="none" stroke="${C.metalDark}" stroke-width="0.8"/>`;
  return `<g class="g-dumbbell">${plateAt(ps[0])}${handle}${grip}${plateAt(ps[1])}</g>`;
}

/** A disc square to `axis` at `c`, projected (plates, pulleys). */
function disc3d(rig, c, axis, r) {
  const S = project(rig);
  const a = v3.unit(axis);
  const helper = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = v3.unit(v3.cross(a, helper));
  const w = v3.cross(a, u);
  return smooth(Array.from({ length: 16 }, (_, k) => {
    const t = (k / 16) * Math.PI * 2;
    return S(v3.add(c, v3.add(v3.mul(u, Math.cos(t) * r), v3.mul(w, Math.sin(t) * r))));
  }));
}

/**
 * One half of a barbell (the far half, -z, or the near half, +z), so the figure can be
 * drawn between them: bar, collar and a bumper plate.
 */
function barbellHalf(rig, center, half, { from = null, to = null } = {}) {
  const S = project(rig);
  const z = (d) => v3.add(center, [0, 0, half * d]);
  const line = (a, b, w, col) => `<line x1="${r1(S(a)[0])}" y1="${r1(S(a)[1])}" x2="${r1(S(b)[0])}" y2="${r1(S(b)[1])}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
  const plate = (d, fill) => `<path class="g-metal" d="${disc3d(rig, z(d), [0, 0, 1], BAR.plate)}" fill="${fill}" stroke="${C.metalEdge}" stroke-width="1.1"/>`;
  const face = `<path d="${disc3d(rig, z(half > 0 ? BAR.plateOut : BAR.plateIn), [0, 0, 1], BAR.plate - 6)}" fill="none" stroke="${C.metalDark}" stroke-width="0.9"/><path d="${disc3d(rig, z(half > 0 ? BAR.plateOut : BAR.plateIn), [0, 0, 1], 3)}" fill="${C.handle}"/>`;
  const plates = half > 0
    ? plate(BAR.plateIn, C.metalDark) + plate(BAR.plateOut, C.metal) + face
    : plate(BAR.plateOut, C.metalDark) + plate(BAR.plateIn, C.metal) + face;
  // `to`: only the bar from the middle to there (inside the hand). `from`: the bar from
  // there outwards, with the collar and plates.
  if (to !== null) return `<g class="g-barbell">${line(z(0), z(to), 3.2, C.handle)}</g>`;
  const bar = line(z(from ?? 0), z(BAR.plateIn), 3.2, C.handle);
  const sleeve = line(z(BAR.plateIn - 2), z(BAR.half), 4.6, C.metalEdge);
  return half > 0 ? `<g class="g-barbell">${bar}${plates}${sleeve}</g>` : `<g class="g-barbell">${sleeve}${plates}${bar}</g>`;
}

/** A cable machine around the seated figure: frame, seat, pads, pulley and cable. */
function machineParts(rig, id, P, layer) {
  const S = project(rig);
  const M = SEATED[id];
  const box = (x0, x1, y0, y1, z0, z1, fill) => {
    const c = (x, y, z) => S([x, y, z]);
    const poly = (ps, f) => `<path d="M${ps.map(pt).join(' L')} Z" fill="${f}" stroke="#202730" stroke-width="1.1" stroke-linejoin="round"/>`;
    return poly([c(x1, y0, z0), c(x1, y0, z1), c(x1, y1, z1), c(x1, y1, z0)], fill[2]) + poly([c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1)], fill[1]) + poly([c(x0, y1, z0), c(x1, y1, z0), c(x1, y1, z1), c(x0, y1, z1)], fill[0]);
  };
  const pad = ['#4a5563', '#363f4b', '#2f3742'];
  const steel = ['#6d7782', '#59626c', '#4b535c'];
  const line = (a, b, w, col) => `<line x1="${r1(S(a)[0])}" y1="${r1(S(a)[1])}" x2="${r1(S(b)[0])}" y2="${r1(S(b)[1])}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
  const st = SEATED.seat;
  if (layer === 'back') {
    const post = id === 'lat-pulldown-v1'
      // Pulldown: the frame and weight stack stand in front, facing the lifter (#301).
      ? box(70, 78, 0, 206, -4, 4, steel) + box(M.pulley[0] - 6, 78, 198, 206, -4, 4, steel) + box(78, 92, 0, 120, -10, 10, steel)
        + box(P.nearKnee[0] - 8, P.nearKnee[0] - 5, 0, P.nearKnee[1] + 6, -2, 2, steel)
      : box(M.pulley[0] - 4, M.pulley[0] + 6, 0, 80, -6, 6, steel) + box(st.x[0], M.pulley[0], 0, 6, -6, 6, steel) + box(M.feet.near[0] + 2, M.feet.near[0] + 8, 0, 40, -16, 16, steel);
    return `<g class="g-machine">${post}${box(-6, 6, 0, st.top - st.pad, -4, 4, steel)}${box(st.x[0], st.x[1], st.top - st.pad, st.top, st.z[0], st.z[1], pad)}</g>`;
  }
  if (layer === 'pad') {
    if (id !== 'lat-pulldown-v1') return '';
    const k = P.nearKnee;
    return `<g class="g-machine">${box(k[0] - 12, k[0] - 2, k[1] + 6, k[1] + 13, -18, 18, pad)}</g>`;
  }
  // The cable and the handle, in front of the figure.
  const h = P.handle;
  const cable = line(h, [M.pulley[0], M.pulley[1], 0], 1.4, C.metalEdge);
  const wheel = `<path d="${disc3d(rig, [M.pulley[0], M.pulley[1], 0], [0, 0, 1], 6)}" fill="${C.metal}" stroke="${C.metalEdge}" stroke-width="1"/>`;
  const handle = id === 'lat-pulldown-v1'
    ? line(v3.add(h, [-2, -3, -M.grip - 10]), v3.add(h, [0, 0, -M.grip + 4]), 3.2, C.handle) + line(v3.add(h, [0, 0, -M.grip + 4]), v3.add(h, [0, 0, M.grip - 4]), 3.2, C.handle) + line(v3.add(h, [0, 0, M.grip - 4]), v3.add(h, [-2, -3, M.grip + 10]), 3.2, C.handle)
    : line(v3.add(h, [6, 0, 0]), v3.add(h, [-2, 0, -M.grip - 2]), 3, C.handle) + line(v3.add(h, [6, 0, 0]), v3.add(h, [-2, 0, M.grip + 2]), 3, C.handle);
  return `<g class="g-cable">${cable}${wheel}${handle}</g>`;
}

/** Straight arrow beside `at` (dx to the side), pointing up or down. */
function arrowStraight(p, dir, dx = 20) {
  const x = p[0] + dx;
  const [y0, y1] = dir === 'up' ? [p[1] + 12, p[1] - 14] : [p[1] - 12, p[1] + 14];
  const h = dir === 'up' ? -1 : 1;
  return `<g class="g-arrow" stroke="${C.arrow}"><path d="M${r1(x)} ${r1(y0)} L${r1(x)} ${r1(y1)}" fill="none" stroke-width="3" stroke-linecap="round"/><path d="M${r1(x - 5)} ${r1(y1 - h * 6)} L${r1(x)} ${r1(y1)} L${r1(x + 5)} ${r1(y1 - h * 6)}" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

/** The pilot's foot outline, pointing forward (+1) or back (-1) from the ankle. */
const footShape = (a, dir, fill) => shape(smooth([[-5, -3], [3, -4], [BODY.foot - 2, -1.5], [BODY.foot, 2.5], [2, 3], [-6, 2.5]].map(([x, y]) => [a[0] + dir * x, a[1] + y])), fill);
const fistAt = (elbow, hand, fill) => {
  const [n] = normal(elbow, hand);
  return shape(smooth([off(hand, n, 4.6), off(along(elbow, hand, 1.12), n, 2.6), off(along(elbow, hand, 1.12), n, -2.6), off(hand, n, -4.6), off(along(elbow, hand, 0.9), n, -3.4), off(along(elbow, hand, 0.9), n, 3.4)]), fill);
};

function render3d(guide, pose, { id, arrowDir, label }) {
  const rig = RIGS3D[guide.rig];
  const { P, held } = pose3d(rig, pose, guide);
  const S = project(rig);
  const s = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, S(v)]));
  const [vx, vy, vw, vh] = viewBoxOf(rig, guide);
  const bar = held.find((h) => h.id === 'barbell-v1' || h.id === 'barbell-back-v1');
  const machine = held.find((h) => SEATED[h.id]);
  const MP = machine ? { ...P, handle: machine.center } : P;
  const mint = `url(#${id}-mint)`;
  const far = `url(#${id}-far)`;
  // The torso leans along the spine as it appears in the picture.
  const sp = [s.shoulderC[0] - s.hip[0], s.shoulderC[1] - s.hip[1]];
  const lean = (Math.atan2(sp[0], -sp[1]) * 180) / Math.PI;
  const T = frame(s.hip, lean);
  const H = frame(s.neck, lean);
  const eq = guide.equipment || [];
  const footDir = (side) => (guide.rig === 'hinge-bench-side-v1' && side === 'far' ? -1 : 1);
  const leg = (side, fill) => [
    shape(limbPath(s[`${side}Hip`], s[`${side}Knee`], side === 'far' ? 7 : 7.5, side === 'far' ? 5.2 : 5.4, { bulgeL: 0.9, bulgeR: 1.2 }), fill),
    shape(limbPath(s[`${side}Knee`], s[`${side}Ankle`], side === 'far' ? 5 : 5.3, side === 'far' ? 3.2 : 3.4, { bulgeL: 0.5, bulgeR: 1.6, at: 0.3 }), fill),
    footShape(s[`${side}Ankle`], footDir(side), fill),
    ball(s[`${side}Ankle`], 3, fill),
    ball(s[`${side}Knee`], 4.6, fill),
  ].join('');
  const arm = (side, fill) => [
    shape(limbPath(s[`${side}Shoulder`], s[`${side}Elbow`], 5.6, 4.4, { bulgeL: 0.4, bulgeR: 1.3, at: 0.45 }), fill),
    ball(s[`${side}Shoulder`], 5.4, fill),
    shape(limbPath(s[`${side}Elbow`], s[`${side}Hand`], 4.6, 3.1, { bulgeL: 0.9, bulgeR: 0.4, at: 0.3 }), fill),
    ball(s[`${side}Elbow`], 3.8, fill),
  ].join('');
  const weight = (side) => held.find((h) => h.id !== 'dumbbell-goblet-v1' && h.hand === P[`${side}Hand`]);
  const weights = (side) => {
    const h = weight(side);
    return h && !h.half ? dumbbell3d(rig, h.center, h.axis) : '';
  };
  const grip = (side, fill) => {
    const fist = fistAt(s[`${side}Elbow`], s[`${side}Hand`], fill);
    const h = weight(side);
    // The bench press fist wraps over the handle and behind the nearer plate.
    return h?.half ? dumbbell3d(rig, h.center, h.axis, { half: h.half, grip: `<g class="g-grip">${fist}</g>` }) : fist;
  };
  const goblet = held.find((h) => h.id === 'dumbbell-goblet-v1');
  const nearGripZ = bar ? Math.abs(P.nearHand[2] - bar.center[2]) : 0;
  const parts = [
    `<defs><linearGradient id="${id}-mint" gradientUnits="userSpaceOnUse" x1="${vx}" y1="${vy}" x2="${vx + vw * 0.8}" y2="${vy + vh}"><stop offset="0" stop-color="#b4ffdc"/><stop offset="0.45" stop-color="#6ef3b4"/><stop offset="1" stop-color="#2fd98a"/></linearGradient><linearGradient id="${id}-far" gradientUnits="userSpaceOnUse" x1="${vx}" y1="${vy}" x2="${vx + vw * 0.8}" y2="${vy + vh}"><stop offset="0" stop-color="#5fd6a0"/><stop offset="1" stop-color="#1e9a62"/></linearGradient></defs>`,
    `<ellipse class="g-ground" cx="${r1(shadowX(s))}" cy="${r1(rig.origin[1] + 1)}" rx="${rig.shadow}" ry="3" fill="${C.ground}"/>`,
    eq.includes('flat-bench-v1') ? benchParts(rig, guide.rig === 'hinge-bench-side-v1' ? HINGE.bench : SUPINE.bench) : '',
    machine ? machineParts(rig, machine.id, MP, 'back') : '',
    bar ? barbellHalf(rig, bar.center, -1) : '',
    leg('far', far),
    weights('far'),
    arm('far', far),
    grip('far', far),
    leg('near', mint),
    machine ? machineParts(rig, machine.id, MP, 'pad') : '',
    shape(smooth([[-12, 4], [-12.5, -3], [-8, -9], [4, -10], [11, -4], [11.5, 3], [5, 6], [-6, 6]].map(T)), mint),
    shape(smooth([[-8, 20], [-9.5, 9], [-8, 3], [8, 3], [10, 10], [8, 20]].map(T)), mint),
    shape(smooth([[-10, 50], [-12.5, 40], [-10.5, 28], [-8, 17], [7, 17], [13, 26], [16.5, 38], [13.5, 50], [5, 58], [-6, 57]].map(T)), mint),
    shape(limbPath(H([0, -6]), H([1.5, 3]), 4.6, 4), mint),
    shape(smooth([[-8, 5], [-10, 13], [-6, 21], [2, 23.5], [9, 19], [11, 11], [9.5, 4], [4, 0], [-3, 0]].map(H)), mint),
    arm('near', mint),
    // A goblet hold sits in front of the arm, cupped by the fists drawn over it.
    goblet ? dumbbell3d(rig, goblet.center, goblet.axis, { half: 9, plate: 8 }) : '',
    weights('near'),
    // The bar passes through the near hand, and the near plates are closer to the
    // camera than the hand, so: the bar up to the hand, then the hand, then the rest.
    bar ? barbellHalf(rig, bar.center, 1, { to: nearGripZ }) : '',
    machine ? machineParts(rig, machine.id, MP, 'front') : '',
    bar ? `<g class="g-fist">${grip('near', mint)}</g>` : grip('near', mint),
    bar ? barbellHalf(rig, bar.center, 1, { from: nearGripZ }) : '',
    arrowDir ? arrowStraight(s[rig.arrowAt] || s.hip, arrowDir, rig.arrowDx ?? 20) : '',
  ];
  const title = label ? `<title>${label.replace(/[<&]/g, '')}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="guide-figure" viewBox="${vx} ${vy} ${vw} ${vh}" role="img"${label ? ` aria-label="${label.replace(/"/g, '&quot;')}"` : ''}>${title}${parts.join('')}</svg>`;
}

const shadowX = (s) => (s.nearAnkle[0] + s.hip[0]) / 2;

/** The bench's corners in the picture, for the fit check. */
function benchCorners(rig, b) {
  const S = project(rig);
  const out = [];
  for (const x of b.x) for (const y of [0, b.top]) for (const z of b.z) out.push(S([x, y, z]));
  return out;
}

/** Interpolate any rig's joints. */
function blend(rig, a, b, t) {
  const out = {};
  for (const k of Object.keys(rig.defaults)) {
    const x = a[k] ?? rig.defaults[k];
    const y = b[k] ?? rig.defaults[k];
    out[k] = x + (y - x) * t;
  }
  return out;
}

/**
 * Plays the whole loop in steps (every pose and nine frames between each pair)
 * and returns the worst contact drift and how far anything leaves the picture.
 * Also used by the checks to prove that weights follow the hands.
 */
export function checkLoop(guide, steps = 10, measuring = false) {
  const rig = RIGS3D[guide.rig];
  const S = project(rig);
  const [vx, vy, vw, vh] = measuring ? [-1e6, -1e6, 2e6, 2e6] : viewBoxOf(rig, guide);
  const res = { contact: 0, contactName: '', where: '', outside: 0, where2: '', handGap: 0, floor: 0, where3: '', frames: 0, box: [Infinity, Infinity, -Infinity, -Infinity] };
  const poses = guide.poses;
  for (let k = 0; k < poses.length; k++) {
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const pose = blend(rig, poses[k].joints, poses[(k + 1) % poses.length].joints, ease(t));
      const { P, contacts, held } = pose3d(rig, pose, guide);
      res.frames++;
      const where = `${poses[k].label} ${Math.round(t * 100)}% towards ${poses[(k + 1) % poses.length].label}`;
      for (const c of contacts) {
        const d = dist3(c.at, c.target);
        if (d > res.contact) Object.assign(res, { contact: d, contactName: c.name, where });
      }
      for (const h of held) res.handGap = Math.max(res.handGap, h.id === 'dumbbell-goblet-v1' ? Math.abs(dist3(h.center, h.hand) - Math.hypot(3, 10)) : dist3(h.center, h.hand));
      // Everything drawn: joints with their thickness, weights with their plates.
      const pts = Object.values(P).map((p) => [S(p), 9]);
      // The head reaches about 24 units past the neck.
      pts.push([S(v3.add(P.neck, v3.mul(v3.unit(v3.sub(P.neck, P.shoulderC)), 13))), 13]);
      for (const h of held) {
        const isBar = h.id === 'barbell-v1' || h.id === 'barbell-back-v1';
        const reachOut = isBar ? BAR.half : SEATED[h.id] ? h.grip + 10 : h.half ? h.half + 2.2 : 12;
        for (const e of [-1, 1]) pts.push([S(v3.add(h.center, v3.mul(v3.unit(h.axis), e * reachOut))), isBar ? BAR.plate + 1 : 10]);
        // Plates rest on the floor at most; they never sink into it.
        if (isBar && BAR.plate - h.center[1] > res.floor) Object.assign(res, { floor: BAR.plate - h.center[1], where3: where });
      }
      const machine = held.find((h) => SEATED[h.id]);
      if (machine) {
        const M = SEATED[machine.id];
        pts.push([S([M.pulley[0], M.pulley[1], 0]), 8], [S([92, 0, 10]), 1], [S([78, 206, 4]), 1], [S([M.pulley[0] + 6, 80, 6]), 1]);
      }
      if ((guide.equipment || []).includes('flat-bench-v1')) for (const c of benchCorners(rig, guide.rig === 'hinge-bench-side-v1' ? HINGE.bench : SUPINE.bench)) pts.push([c, 1]);
      const sx = shadowX(Object.fromEntries(Object.entries(P).map(([k, v]) => [k, S(v)])));
      pts.push([[sx - rig.shadow, rig.origin[1] + 1], 3], [[sx + rig.shadow, rig.origin[1] + 1], 3]);
      for (const [p, r] of pts) {
        res.box = [Math.min(res.box[0], p[0] - r), Math.min(res.box[1], p[1] - r), Math.max(res.box[2], p[0] + r), Math.max(res.box[3], p[1] + r)];
        const o = Math.max(vx - (p[0] - r), p[0] + r - (vx + vw), vy - (p[1] - r), p[1] + r - (vy + vh));
        if (o > res.outside) Object.assign(res, { outside: o, where2: where });
      }
    }
  }
  return res;
}
