/**
 * Plate calculator (#227): which plates go on each side of a barbell.
 *
 * Every gym uses the standard set of plates for now. Plates are picked largest
 * first, which gives the fewest plates for these sets. When the weight can't be
 * loaded exactly, `loaded` is the closest weight at or below it and `up` the
 * next one above.
 */

export const PLATES = {
  lb: [45, 35, 25, 10, 5, 2.5],
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
};

/** Bar choices per unit; 0 means plates only (no bar). The first is the default. */
export const BARS = {
  lb: [45, 35, 0],
  kg: [20, 15, 0],
};

const EPS = 1e-6;
const plates = (unit) => PLATES[unit] || PLATES.lb;

/** The smallest change that can be loaded: the smallest plate on each side. */
export function plateStep(unit) {
  const list = plates(unit);
  return list[list.length - 1] * 2;
}

/**
 * Plates for `total` on a bar weighing `bar`, in `unit`.
 * Returns null when the weight is missing or lighter than the bar, otherwise
 * { perSide: [45, 25], loaded, exact, up }.
 */
export function loadBar(total, bar, unit) {
  if (!(total > 0) || total + EPS < bar) return null;
  let side = (total - bar) / 2;
  const perSide = [];
  for (const p of plates(unit)) {
    while (side + EPS >= p) {
      perSide.push(p);
      side -= p;
    }
  }
  const loaded = bar + 2 * perSide.reduce((a, b) => a + b, 0);
  const exact = Math.abs(loaded - total) < EPS;
  return { perSide, loaded: round(loaded), exact, up: exact ? round(loaded) : round(loaded + plateStep(unit)) };
}

const round = (n) => Math.round(n * 100) / 100;
const num = (n) => String(round(n));

/** "45 + 25" */
export function sideText(perSide) {
  return perSide.map(num).join(' + ');
}

/**
 * One line for under a set's weight: "Plates: 45 + 25 a side", "Just the bar",
 * or, when it can't be loaded exactly, the closest weight and its plates.
 * Empty when there's nothing useful to say.
 */
export function plateHint(total, bar, unit) {
  const r = loadBar(total, bar, unit);
  if (!r) return '';
  if (r.exact) return r.perSide.length ? `Plates: ${sideText(r.perSide)} a side` : bar > 0 ? 'Just the bar' : '';
  return `Closest: ${num(r.loaded)}${r.perSide.length ? ` (${sideText(r.perSide)} a side)` : ' (just the bar)'}`;
}
