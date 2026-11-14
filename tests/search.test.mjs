// Exercise search checks, run against the real built-in catalog:
//   node tests/search.test.mjs

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { searchExercises, editDistance, normalize } from '../web/js/search.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dump = `
require '${join(root, 'web/private/src/bootstrap.php').replace(/'/g, "\\'")}';
$out = []; $id = 1;
foreach (TF\\Catalog::exercises() as $e) {
  $out[] = ['id' => $id++, 'name' => $e[1], 'kind' => $e[2], 'equipment' => $e[3], 'pattern' => $e[4], 'muscles_main' => $e[5], 'muscles_assist' => $e[6], 'priority' => $e[7], 'compound' => in_array($e[4], TF\\Catalog::COMPOUND, true)];
}
echo json_encode(['exercises' => $out, 'vocab' => ['muscles' => TF\\Catalog::MUSCLES, 'kinds' => TF\\Catalog::KINDS, 'patterns' => TF\\Catalog::PATTERNS]]);
`;
const { exercises, vocab } = JSON.parse(execFileSync('php', ['-r', dump], { encoding: 'utf8' }));
// A few of the user's own exercises, as an import would add them.
let nextId = 1000;
const own = (name, kind, pattern, main) => ({ id: nextId++, name, kind, equipment: [], pattern, muscles_main: main, muscles_assist: [], priority: 4, compound: false, custom: true });
const all = [...exercises, own('Dumbbell Rear Delt Raise', 'dumbbell', 'rear_delt', ['upper_back']), own('Barbell Shrug', 'barbell', 'other', ['upper_back']), own('Knee Push-Up', 'bodyweight', 'horizontal_push', ['chest']), own('Incline Push-Up', 'bodyweight', 'horizontal_push', ['chest'])];

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok   ' : 'FAIL '} ${name}${ok || !detail ? '' : `  (${detail})`}`);
};
const run = (q, list = all) => searchExercises(list, q, vocab);
const names = (q, list) => run(q, list).matches.map((e) => e.name);
const top = (q, list) => names(q, list)[0];

console.log('Spacing, hyphens and plurals');
for (const q of ['push up', 'push-up', 'pushup', 'Push Up', ' PUSH-UP ', 'pushups', 'push ups']) {
  check(`"${q}" puts Push-Up first`, top(q) === 'Push-Up', top(q));
}
check('all three spellings give the same results', names('push up').join() === names('push-up').join() && names('push up').join() === names('pushup').join());
check('"push up" is followed by its variations', ['Incline Push-Up', 'Knee Push-Up', 'Diamond Push-Up', 'Feet-Elevated Push-Up', 'Pike Push-Up'].every((n) => names('push up').includes(n)), names('push up').join(', '));
check('"pull ups" finds Pull-Up first', top('pull ups') === 'Pull-Up', top('pull ups'));
check('"curls" finds curls', names('curls').length >= 6 && names('curls').every((n) => /Curl/.test(n)));
check('"skullcrusher" finds the skull crusher', top('skullcrusher') === 'EZ-Bar Skull Crusher', top('skullcrusher'));

check('"pushup" does not drag in pull-ups', !names('pushup').some((n) => /Pull/.test(n)), names('pushup').join(', '));

console.log('Typos');
check('"psuh up" still puts Push-Up first', top('psuh up') === 'Push-Up', top('psuh up'));
check('and lists the variations after it', names('psuh up').slice(1).some((n) => n === 'Incline Push-Up') && names('psuh up').slice(1).some((n) => n === 'Knee Push-Up'), names('psuh up').join(', '));
check('"psuhup" (no space) works too', top('psuhup') === 'Push-Up', top('psuhup'));
const dp = names('dumbell press');
check('"dumbell press" returns dumbbell presses', dp.length >= 4 && dp.every((n) => /Dumbbell/.test(n) && /Press/.test(n)), dp.join(', '));
check('"dumbell bench press" puts Dumbbell Bench Press first', top('dumbell bench press') === 'Dumbbell Bench Press', top('dumbell bench press'));
check('"dumbel curl" (two letters short) still finds Dumbbell Curl', top('dumbel curl') === 'Dumbbell Curl', top('dumbel curl'));
check('"sholder press" finds shoulder presses', names('sholder press').length >= 2 && names('sholder press').every((n) => /Shoulder Press/.test(n)));
check('"benhc" finds bench exercises', names('benhc').length >= 4 && names('benhc').every((n) => /Bench/.test(n)));
check('"barbel sqaut" finds the back squat', top('barbel sqaut') === 'Barbell Back Squat', top('barbel sqaut'));
check('"deadlfit" finds the deadlift', top('deadlfit') === 'Barbell Deadlift', top('deadlfit'));
check('"lat puldown" finds Lat Pulldown', top('lat puldown') === 'Lat Pulldown', top('lat puldown'));
check('"tricep pushdwn" finds the pushdown', top('tricep pushdwn') === 'Cable Triceps Pushdown', top('tricep pushdwn'));
check('short words are not fuzzed ("row" does not match "raw"-like noise)', names('rox').length === 0 || run('rox').closest, names('rox').join(', '));
check('edit distance counts a swap as one mistake', editDistance('psuh', 'push') === 1 && editDistance('dumbell', 'dumbbell') === 1 && editDistance('abc', 'xyz', 2) === 3);

console.log('Aliases');
const rdl = names('RDL');
check('"RDL" finds every Romanian deadlift', rdl.length === 3 && rdl.every((n) => /Romanian Deadlift/.test(n)), rdl.join(', '));
check('"rdl" puts the barbell version first', top('rdl') === 'Barbell Romanian Deadlift', top('rdl'));
check('"db rdl" narrows to the dumbbell one', top('db rdl') === 'Dumbbell Romanian Deadlift' && names('db rdl').length === 1, names('db rdl').join(', '));
check('"ohp" finds the overhead press', top('ohp') === 'Barbell Overhead Press', top('ohp'));
check('"military press" finds it too', top('military press') === 'Barbell Overhead Press', top('military press'));
check('"db bench" finds Dumbbell Bench Press', top('db bench') === 'Dumbbell Bench Press', top('db bench'));
check('"hamstring curl" finds the leg curl', top('hamstring curl') === 'Leg Curl', top('hamstring curl'));
check('"flyes" finds flies', names('flyes').length >= 4 && names('flyes').every((n) => /Fly/.test(n)), names('flyes').join(', '));
check('"bss" finds the Bulgarian split squat', top('bss') === 'Bulgarian Split Squat', top('bss'));
check('an alias does not hide an exercise really named that way ("rear delt")', top('rear delt') === 'Dumbbell Rear Delt Raise', top('rear delt'));

console.log('Ranking');
const bench = names('bench press');
check('exact and whole-word matches come before typo matches', bench[0] === 'Barbell Bench Press' && bench.indexOf('Barbell Bench Press') < bench.indexOf('Close-Grip Bench Press'), bench.slice(0, 4).join(', '));
check('an exact name always wins', top('leg press') === 'Leg Press' && top('crunch') === 'Crunch' && top('chin up') === 'Chin-Up' && top('deadlift') === 'Barbell Deadlift');
const mixed = names('curl');
const typoOnly = names('crul');
check('a typo query gives the same exercises as the correct spelling', typoOnly.length > 0 && typoOnly.every((n) => mixed.includes(n)), typoOnly.join(', '));
check('typing part of a word works while you type ("lat pul", "squ")', top('lat pul') === 'Lat Pulldown' && names('squ').slice(0, 8).every((n) => /Squat/.test(n)));
check('muscle and equipment words work ("calves", "kettlebell", "chest")', names('calves').slice(0, 4).every((n) => /Calf/.test(n)) && names('kettlebell').length >= 4 && names('chest').length >= 8);
check('primary-muscle matches rank above secondary-muscle ones ("triceps")', (() => { const r = run('triceps').matches; const firstMinor = r.findIndex((e) => !/Tricep/.test(e.name) && !e.muscles_main.includes('triceps')); return firstMinor > 3 && r.slice(firstMinor).every((e) => !e.muscles_main.includes('triceps')); })(), names('triceps').slice(0, 8).join(', '));
check('name matches rank above tag-only matches', (() => { const r = names('chest'); const firstTag = r.findIndex((n) => !/Chest/.test(n)); return firstTag === -1 || r.slice(firstTag).every((n) => !/Chest/.test(n)); })(), names('chest').slice(0, 6).join(', '));

console.log('Similar exercises');
const pu = run('psuh up');
const puMatches = new Set(pu.matches.map((e) => e.id));
check('similar exercises are listed separately and never repeat a match', pu.similar.length > 0 && pu.similar.every((e) => !puMatches.has(e.id)));
check('they are related movements (other presses for a push-up)', pu.similar.slice(0, 4).every((e) => e.pattern === 'horizontal_push'), pu.similar.map((e) => e.name).join(', '));
const lp = run('lat pulldown');
check('similar to Lat Pulldown: other pull-downs and pull-ups first', lp.similar.slice(0, 3).every((e) => e.pattern === 'vertical_pull'), lp.similar.map((e) => e.name).join(', '));
check('a broad search does not pad the page with a similar list', run('press').similar.length === 0);
const shrug = run('shrug');
check('an exercise with no movement group still gets similar ones by muscle', shrug.matches[0].name === 'Barbell Shrug' && shrug.similar.length > 0 && shrug.similar.every((e) => e.muscles_main.includes('upper_back')), shrug.similar.map((e) => e.name).join(', '));

console.log('No close match');
const part = run('zzz squat');
check('when not every word matches, the closest partial matches are offered and flagged', part.closest === true && part.matches.length > 0 && part.matches.every((e) => /Squat/.test(e.name)), part.matches.map((e) => e.name).join(', '));
const none = run('xqzv');
check('nonsense returns nothing rather than random exercises', none.matches.length === 0 && none.similar.length === 0);
check('an empty search returns the list unchanged', names('').length === Math.min(40, all.length) && names('   ')[0] === all[0].name);

console.log('Equipment filter (picker)');
const home = all.filter((e) => e.equipment.every((k) => ['dumbbells', 'bench'].includes(k)));
const hr = run('bench press', home);
const allowed = new Set(home.map((e) => e.id));
check('results only come from the list passed in', hr.matches.every((e) => allowed.has(e.id)) && hr.similar.every((e) => allowed.has(e.id)) && !hr.matches.some((e) => /Barbell|Smith|Machine/.test(e.name)), hr.matches.map((e) => e.name).join(', '));
check('with no barbell at the gym, "bench press" leads with the dumbbell one', hr.matches[0].name === 'Dumbbell Bench Press', hr.matches[0].name);
check('"rdl" at a dumbbell gym gives only the dumbbell and bodyweight versions', names('rdl', home).join() === 'Dumbbell Romanian Deadlift,Single-Leg Romanian Deadlift', names('rdl', home).join());
check('normalising strips accents and punctuation', normalize("Farmer’s  Wálk!") === 'farmers walk');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
