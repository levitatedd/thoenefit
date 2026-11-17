// Estimated one-rep max (#162): run with `node tests/strength.test.mjs`.
import { oneRepMax, bestEstimate, hasComparableLoad, estimateLabel, convertWeight } from '../web/js/strength.js';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok   ' : 'FAIL '} ${name}${ok || !detail ? '' : `  (${detail})`}`);
};
const barbell = { kind: 'barbell', equipment: ['barbell', 'bench'] };

console.log('One set');
check('Epley for 2–10 reps: 185 × 5 is about 216', Math.round(oneRepMax(185, 5)) === 216, oneRepMax(185, 5));
check('a single counts as logged', oneRepMax(225, 1) === 225);
check('more than 10 reps gives no estimate', oneRepMax(100, 11) === null);
check('no load, no reps or bad input gives no estimate', [oneRepMax(0, 5), oneRepMax(100, 0), oneRepMax(-5, 5), oneRepMax(100, 2.5), oneRepMax(NaN, 5)].every((v) => v === null));

console.log('A session');
const sets = [
  { weight: 95, reps: 10, warmup: true, done: true },
  { weight: 185, reps: 5, done: true },
  { weight: 195, reps: 3, done: true },
  { weight: 205, reps: 8, done: false },
  { weight: 135, reps: 15, done: true },
];
const best = bestEstimate(sets, barbell);
check('takes the highest estimate from completed working sets, keeping its source set', best && best.weight === 185 && best.reps === 5 && Math.round(best.value) === 216, JSON.stringify(best));
check('warm-ups and unfinished sets are skipped', bestEstimate([sets[0], sets[3]], barbell) === null);
check('history sets without a done flag count (the server only sends done sets)', bestEstimate([{ weight: 100, reps: 3 }], barbell)?.weight === 100);

console.log('Exercises without a comparable load');
check('unweighted bodyweight sets give nothing', bestEstimate([{ weight: 0, reps: 12, done: true }], { kind: 'bodyweight', equipment: [] }) === null);
check('weighted bodyweight work counts', bestEstimate([{ weight: 25, reps: 6, done: true }], { kind: 'bodyweight', equipment: ['dip_belt'] })?.weight === 25);
check('assisted machines are skipped', !hasComparableLoad({ kind: 'machine', equipment: ['assisted_pullup'] }));
check('cardio and stretches are skipped', !hasComparableLoad({ kind: 'cardio', equipment: [] }) && !hasComparableLoad({ kind: 'stretch', equipment: [] }));
check('an unknown exercise is skipped', bestEstimate(sets, undefined) === null);

console.log('Label and units');
check('label reads "Est. 1RM · 216 lb"', estimateLabel(best, 'lb') === 'Est. 1RM · 216 lb', estimateLabel(best, 'lb'));
check('converts to the lifter\'s unit: 100 kg × 5 is about 117 kg, or 257 lb', estimateLabel(bestEstimate([{ weight: 100, reps: 5 }], barbell), 'kg') === 'Est. 1RM · 117 kg' && estimateLabel(bestEstimate([{ weight: 100, reps: 5 }], barbell), 'kg', 'lb') === 'Est. 1RM · 257 lb');
check('lb to kg and back is stable', Math.abs(convertWeight(convertWeight(100, 'lb', 'kg'), 'kg', 'lb') - 100) < 1e-9);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
