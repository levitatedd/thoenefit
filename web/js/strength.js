/**
 * Estimated one-rep max (#162), used by exercise history and the workout
 * share card so both show the same number.
 *
 * Epley, weight × (1 + reps / 30), for completed working sets of 2–10 reps
 * with a positive logged load. A completed single counts as logged. Warm-ups,
 * unfinished sets, timed work (cardio, stretches), unweighted bodyweight and
 * assisted movements (where the logged weight is help, not load) are skipped.
 */

const LB_PER_KG = 2.20462;

/** The estimate for one set, or null when the set can't give one. */
export function oneRepMax(weight, reps) {
  if (!(weight > 0) || !Number.isInteger(reps) || reps < 1 || reps > 10) return null;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

/** Whether an exercise's logged weight is a load an estimate can use. */
export function hasComparableLoad(ex) {
  if (!ex) return false;
  if (ex.kind === 'cardio' || ex.kind === 'stretch') return false;
  return !(ex.equipment || []).some((k) => /assist/.test(k));
}

/**
 * The highest estimate among a session's sets: { value, weight, reps } in the
 * session's unit, or null. Only done, non-warm-up sets count.
 */
export function bestEstimate(sets, ex) {
  if (!hasComparableLoad(ex)) return null;
  let best = null;
  for (const s of sets || []) {
    if (s.done === false || s.warmup) continue;
    const value = oneRepMax(Number(s.weight), Number(s.reps));
    if (value != null && (!best || value > best.value)) best = { value, weight: Number(s.weight), reps: Number(s.reps) };
  }
  return best;
}

/** Convert a weight between lb and kg. */
export function convertWeight(value, from, to) {
  if (from === to) return value;
  return from === 'kg' ? value * LB_PER_KG : value / LB_PER_KG;
}

/** Display rounding for an estimate: whole numbers in both units. */
export function roundEstimate(value) {
  return Math.round(value);
}

/** "Est. 1RM · 216 lb", in the lifter's unit. */
export function estimateLabel(est, fromUnit, toUnit = fromUnit) {
  return `Est. 1RM · ${roundEstimate(convertWeight(est.value, fromUnit, toUnit)).toLocaleString()} ${toUnit}`;
}
