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
    viewBox: [48, 42, 160, 190],
    ground: 224,
    hip: [118, 132],
    len: { torso: 54, neck: 9, upperArm: 34, forearm: 30, thigh: 44, shin: 44, foot: 20 },
    head: { rx: 12, ry: 15 },
    width: { torso: 24, upperArm: 10, forearm: 9, thigh: 13, shin: 11 },
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
const C = { edge: '#0c4631', joint: '#1c9a63', metal: '#a7b0ba', metalEdge: '#5d6670', handle: '#7c8590', ground: '#2b333d', arrow: '#3af29c' };
const seg = (a, b, w, cls, stroke) => `<line class="${cls}" x1="${r1(a[0])}" y1="${r1(a[1])}" x2="${r1(b[0])}" y2="${r1(b[1])}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;
const limb = (a, b, w, fill) => seg(a, b, w + 3, 'g-edge', C.edge) + seg(a, b, w, 'g-limb', fill);
const joint = (p, r) => `<circle class="g-joint" cx="${r1(p[0])}" cy="${r1(p[1])}" r="${r}" fill="${C.joint}" stroke="${C.edge}" stroke-width="1"/>`;

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
  const disc = (c) => `<ellipse class="g-metal" cx="${r1(c[0])}" cy="${r1(c[1])}" rx="${rx}" ry="${plate}" fill="${C.metal}" stroke="${C.metalEdge}" stroke-width="1.2" transform="rotate(${rot} ${r1(c[0])} ${r1(c[1])})"/>`;
  const bar = half > 0.5 ? `<line class="g-handle" x1="${r1(a[0])}" y1="${r1(a[1])}" x2="${r1(b[0])}" y2="${r1(b[1])}" stroke="${C.handle}" stroke-width="3.5" stroke-linecap="round"/>` : '';
  const hub = s > 0.6 ? `<circle class="g-hub" cx="${r1(at[0])}" cy="${r1(at[1])}" r="${r1(2.4 * s)}" fill="${C.metalEdge}"/>` : '';
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
  const W = rig.width;
  const [vx, vy, vw, vh] = rig.viewBox;
  const back = [J.hip[0] - 5, J.hip[1]];
  const backKnee = [J.knee[0] - 5, J.knee[1]];
  const backAnkle = [J.ankle[0] - 5, J.ankle[1]];
  // Head sits on the neck, tilted with the torso.
  const headC = add(J.neck, up(J.j.torso, rig.head.ry - 1));
  const parts = [
    // Gradients span the whole picture (userSpaceOnUse): a gradient sized to a straight
    // vertical limb would have no width and paint nothing.
    `<defs><linearGradient id="${id}-mint" gradientUnits="userSpaceOnUse" x1="${vx}" y1="${vy}" x2="${vx + vw}" y2="${vy + vh}"><stop offset="0" stop-color="#9dfdd0"/><stop offset="1" stop-color="#2fdd8c"/></linearGradient><linearGradient id="${id}-far" gradientUnits="userSpaceOnUse" x1="${vx}" y1="${vy}" x2="${vx + vw}" y2="${vy + vh}"><stop offset="0" stop-color="#4fc48f"/><stop offset="1" stop-color="#1f8a59"/></linearGradient></defs>`,
    `<line class="g-ground" x1="${r1(J.hip[0] - 55)}" y1="${rig.ground}" x2="${r1(J.hip[0] + 60)}" y2="${rig.ground}" stroke="${C.ground}" stroke-width="1.5"/>`,
    // Far leg, a touch behind and darker.
    limb(back, backKnee, W.thigh, `url(#${id}-far)`),
    limb(backKnee, backAnkle, W.shin, `url(#${id}-far)`),
    limb(backAnkle, [backAnkle[0] + rig.len.foot - 4, backAnkle[1]], 7, `url(#${id}-far)`),
    // Near leg.
    limb(J.hip, J.knee, W.thigh, `url(#${id}-mint)`),
    limb(J.knee, J.ankle, W.shin, `url(#${id}-mint)`),
    limb(J.ankle, J.toe, 8, `url(#${id}-mint)`),
    joint(J.knee, 3.4),
    // Torso and pelvis.
    limb(J.hip, J.shoulder, W.torso, `url(#${id}-mint)`),
    `<ellipse class="g-body" cx="${r1(J.hip[0])}" cy="${r1(J.hip[1] + 2)}" rx="13" ry="9" fill="url(#${id}-mint)" stroke="${C.edge}" stroke-width="1.5"/>`,
    // Chest, so the torso reads as a body rather than a bar.
    (() => { const c = add(J.hip, up(J.j.torso, rig.len.torso * 0.62)); return `<ellipse class="g-body" cx="${r1(c[0] + 2)}" cy="${r1(c[1])}" rx="15" ry="22" fill="url(#${id}-mint)" stroke="${C.edge}" stroke-width="1.5" transform="rotate(${r1(J.j.torso)} ${r1(c[0])} ${r1(c[1])})"/>`; })(),
    limb(J.shoulder, J.neck, 7, `url(#${id}-mint)`),
    `<ellipse class="g-body" cx="${r1(headC[0])}" cy="${r1(headC[1])}" rx="${rig.head.rx}" ry="${rig.head.ry}" fill="url(#${id}-mint)" stroke="${C.edge}" stroke-width="1.5" transform="rotate(${r1(J.j.torso)} ${r1(headC[0])} ${r1(headC[1])})"/>`,
    // Near arm, in front of the body, with the dumbbell.
    limb(J.shoulder, J.elbow, W.upperArm, `url(#${id}-mint)`),
    limb(J.elbow, J.hand, W.forearm, `url(#${id}-mint)`),
    joint(J.shoulder, 4),
    joint(J.elbow, 3.4),
    dumbbell(J.hand, J.forearm, J.j.supination),
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
