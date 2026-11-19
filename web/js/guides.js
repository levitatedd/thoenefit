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

/** Equipment that can be held. Each draws itself at the hand from the pose. */
export const EQUIPMENT = ['dumbbell-v1'];

const rad = (d) => (d * Math.PI) / 180;
const down = (a, l) => [Math.sin(rad(a)) * l, Math.cos(rad(a)) * l];
const up = (a, l) => [Math.sin(rad(a)) * l, -Math.cos(rad(a)) * l];
const add = (p, d) => [p[0] + d[0], p[1] + d[1]];
const r1 = (n) => Math.round(n * 10) / 10;
const pt = (p) => `${r1(p[0])} ${r1(p[1])}`;

export function rigOf(guide) {
  const rig = RIGS[guide.rig];
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
  return `<g class="g-dumbbell">${bar}${disc(b)}${disc(a)}${hub}</g>`;
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
    dumbbell(J.hand, J.forearm, J.j.supination),
    shape(fist, mint),
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
  const rig = RIGS[guide.rig];
  if (!rig) out.push(`unknown rig "${guide.rig}"`);
  for (const e of guide.equipment || []) if (!EQUIPMENT.includes(e)) out.push(`unknown equipment "${e}"`);
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
  return out;
}
