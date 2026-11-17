// Refreshes the README screenshots (#134). Seeds a throwaway local copy with
// made-up people (Alex Rivera, Sam Lee) and eight weeks of training, then
// captures the six screenshots at 402px wide, 2x.
//
//   rm -rf data
//   printf 'sample-password-alex\n' | php web/private/bin/create-user.php alex "Alex Rivera"
//   printf 'sample-password-sam\n' | php web/private/bin/create-user.php sam "Sam Lee"
//   php -S 127.0.0.1:8765 -t web                                (in another terminal)
//   NODE_PATH=$(npm root -g) node docs/screenshots/capture.mjs docs/screenshots
//   rm -rf data
//
// CHROME: path to Chrome or Chromium (cloud sessions: /opt/pw-browsers/.../chrome).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = process.argv[2];
const URL = 'http://127.0.0.1:8765/';
const DAY = 86400000;
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

async function person(username, password) {
  // A US phone: in Central time it is still Sunday evening, so "this week" in Trends is full.
  const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Chicago', locale: 'en-US' });
  await ctx.addInitScript(() => { try { localStorage.setItem('tf.install', '{"never":true}'); } catch (e) {} });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror', String(e)));
  await p.goto(URL);
  await p.fill('input[name=username]', username);
  await p.fill('input[name=password]', password);
  await p.click('button[type=submit]');
  await p.waitForTimeout(1200);
  return { ctx, p, call: (a, body) => p.evaluate(async ([a, body]) => {
    const bt = await (await fetch('api.php?a=bootstrap')).json();
    const r = await fetch('api.php?a=' + a, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': bt.csrf }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(a + ': ' + JSON.stringify(j));
    return j;
  }, [a, body]) };
}

const uuid = () => crypto.randomUUID();
const START = { barbell: 95, dumbbell: 30, machine: 70, cable: 40, kettlebell: 26, smith: 75, ez_bar: 50 };

async function setUp(u, profile, gymName) {
  await u.call('save_profile', { onboarded: true, ...profile });
  const bt = await u.call('bootstrap');
  const gym = (await u.call('save_gym', { name: gymName, equipment: bt.vocab.presets[0].equipment })).gym;
  return gym;
}

/** A finished workout on a past day, planned the way the app would have planned it then. */
async function train(u, gym, dayType, when, minutes = 55) {
  const { workout: plan } = await u.call('generate', { gym_id: gym.id, day_type: dayType, minutes, now: Math.floor(when / 1000) });
  let t = when;
  const exercises = plan.exercises.filter((e) => e.kind !== 'cardio').map((e) => {
    const w = e.suggested_weight ?? START[e.kind] ?? 0;
    const sets = Array.from({ length: e.target_sets }, (_, i) => {
      t += (e.rest_seconds + 40) * 1000;
      // Mostly the top of the range, so weights go up over the weeks; the last set sometimes falls short.
      const reps = i === e.target_sets - 1 && Math.random() < 0.35 ? e.rep_max - 1 : e.rep_max;
      return { id: uuid(), weight: w, reps, warmup: false, done: true, done_at: new Date(t).toISOString() };
    });
    return { id: uuid(), exercise_id: e.exercise_id, target_sets: e.target_sets, rep_min: e.rep_min, rep_max: e.rep_max, rest_seconds: e.rest_seconds, suggested_weight: e.suggested_weight, reason: e.reason, sets };
  });
  const doc = { id: uuid(), gym_id: gym.id, day_type: dayType, status: 'completed', unit: 'lb', started_at: new Date(when).toISOString(), completed_at: new Date(t + 4 * 60000).toISOString(), effort: 'moderate', rev: 1, exercises };
  await u.call('save_workout', { workout: doc });
  return plan;
}

const at = (daysAgo, hour) => { const d = new Date(Date.now() - daysAgo * DAY); d.setHours(hour, 10, 0, 0); return d.getTime(); };

// ---- Alex: eight weeks of push / pull / legs, about four sessions a week
const alex = await person('alex', 'sample-password-alex');
const gymA = await setUp(alex, { unit: 'lb', goal: 'muscle', experience: 'intermediate', split_type: 'ppl', minutes: 60, body_weight: 182, history_visibility: 'members' }, 'Downtown Gym');
const rota = ['push', 'pull', 'legs'];
let n = 0;
const plans = {};
for (let d = 56; d >= 2; d -= (n % 4 === 3 ? 3 : 2)) {
  const day = rota[n % 3];
  plans[day] = await train(alex, gymA, day, at(d, 18), 60);
  n++;
}
// A pull session a few hours ago, so this week in Trends is never empty, whatever day it is.
await train(alex, gymA, 'pull', Date.now() - 4 * 3600000, 60);
n++;
console.log('alex workouts', n);
const routineOf = (p) => ({ day_type: p.day_type, exercises: p.exercises.map((e) => ({ exercise_id: e.exercise_id, target_sets: e.target_sets, rep_min: e.rep_min, rep_max: e.rep_max, rest_seconds: e.rest_seconds })) });
await alex.call('save_routine', { name: 'Monday Push', plan: routineOf(plans.push) });
await alex.call('save_routine', { name: 'Heavy Legs', plan: routineOf(plans.legs) });
await alex.call('save_routine', { name: 'Back and Biceps', plan: routineOf(plans.pull) });

// ---- Sam: three weeks of full-body sessions
const sam = await person('sam', 'sample-password-sam');
const gymS = await setUp(sam, { unit: 'lb', goal: 'strength', experience: 'beginner', split_type: 'ppl', minutes: 50 }, 'Downtown Gym');
let m = 0;
for (let d = 22; d >= 3; d -= 3) { await train(sam, gymS, rota[m % 3], at(d, 7), 50); m++; }
console.log('sam workouts', m);

const jpg = async (page, name) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 86 });
const ready = (page) => page.waitForFunction(() => !document.querySelector('.stack.loading') && !/Loading/.test(document.querySelector('main')?.textContent || ''), null, { timeout: 15000 });

// 1. Workout planner
const A = alex.p;
await A.goto(URL + '#/today'); await A.reload();
await A.waitForSelector('.plan-row'); await ready(A);
const pick = async (day) => {
  if ((await A.inputValue('select[aria-label="Workout type"]')) === day) return;
  await A.selectOption('select[aria-label="Workout type"]', day);
  await A.waitForTimeout(800); await ready(A);
};
await pick('push'); await A.waitForTimeout(400);
await jpg(A, 'workout-planner');

// 2. Workout in progress: two sets done on the first lift, resting before the third.
await A.click('button:has-text("Start workout")');
await A.waitForSelector('.lift');
const lift = A.locator('.lift', { has: A.locator('.set:not(.cardio)') }).first();
console.log('in progress lift', await lift.locator('h2').textContent(), await lift.locator('.set input').first().inputValue());
for (let i = 0; i < 2; i++) {
  const row = lift.locator('.set').nth(i);
  const r = row.locator('input').nth(1);
  if (!(await r.inputValue())) await r.fill(String(8 + (i === 0 ? 1 : 0)));
  await row.locator('.plate').click();
  await A.waitForTimeout(300);
}
await A.waitForTimeout(23000); // a believable rest time left on the clock
await A.evaluate(() => scrollTo(0, 0));
await jpg(A, 'workout-in-progress');
await A.goto(URL + '#/today');
await A.click('button:has-text("Discard workout")');
await A.click('.sheet button:has-text("Discard workout")');
await A.waitForSelector('.plan-row');

// 3. Exercise progress: the most-logged lift, with a point selected.
const hist = await alex.call('history&limit=100');
const counts = {};
for (const w of hist.workouts) for (const name of w.exercises) counts[name] = (counts[name] || 0) + 1;
const catalog = (await alex.call('bootstrap')).exercises;
const weighted = (name) => ['barbell', 'dumbbell', 'machine', 'cable', 'smith'].includes(catalog.find((e) => e.name === name)?.kind);
const top = counts['Barbell Bench Press'] ? 'Barbell Bench Press' : Object.entries(counts).filter(([k]) => weighted(k)).sort((a, b) => b[1] - a[1])[0][0];
const exId = catalog.find((e) => e.name === top).id;
console.log('progress lift', top, counts[top]);
await A.goto(URL + `#/exercises/${exId}`);
await A.waitForSelector('.chart svg'); await A.waitForTimeout(400);
await A.evaluate(() => {
  const svg = document.querySelector('.chart svg');
  svg.focus();
  for (const key of ['End', 'ArrowLeft', 'ArrowLeft']) svg.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
});
await A.waitForTimeout(300);
await A.evaluate(() => {
  // From the History heading down: ranges, the selected point's details and the chart.
  // Below the pinned header (#202), so the exercise's name stays in view.
  const head = [...document.querySelectorAll('.section > h2')].find((h) => h.textContent === 'History');
  const pinned = document.querySelector('main > .top-head').getBoundingClientRect().height;
  scrollTo(0, head.getBoundingClientRect().top + scrollY - pinned - 12);
});
await A.waitForTimeout(300);
await jpg(A, 'exercise-progress');

// 4. Trends
await A.goto(URL + '#/trends');
await A.waitForSelector('.chart'); await ready(A); await A.waitForTimeout(400);
// Taller than the others so weekly volume and the whole recovery estimate fit.
const tall = await A.evaluate(() => document.documentElement.scrollHeight);
await A.setViewportSize({ width: 402, height: tall });
await A.waitForTimeout(400);
await jpg(A, 'trends');
await A.setViewportSize({ width: 402, height: 874 });

// 5. Saved routines: the Workout picker open on Your routines.
await A.goto(URL + '#/today');
await A.waitForSelector('.plan-row'); await ready(A);
await A.evaluate(() => {
  // A phone shows its own menu for this picker, which a headless browser cannot
  // capture; expand the real select in place so its actual options show.
  const sel = document.querySelector('select[aria-label="Workout type"]');
  sel.setAttribute('size', String(sel.options.length + sel.querySelectorAll('optgroup').length));
  sel.style.setProperty('background-image', 'none');
  sel.value = sel.querySelector('optgroup[label="Your routines"] option').value;
});
await A.waitForTimeout(300);
await jpg(A, 'saved-routines');

// 7. Pick muscle groups (#154): the picker with recovery, two groups chosen.
await A.goto(URL + '#/today'); await A.reload(); await A.waitForSelector('.plan-row'); await ready(A);
await A.selectOption('select[aria-label="Workout type"]', 'pick-muscles');
await A.waitForSelector('.muscle-tile img');
await A.waitForTimeout(500);
// The two most recovered groups, which is what the picker is for.
const fresh = await A.$$eval('.muscle-tile', (ts) => ts.slice(0, 2).map((t) => t.dataset.muscle));
for (const m of fresh) await A.click(`.muscle-tile[data-muscle="${m}"]`);
await A.waitForTimeout(300);
await jpg(A, 'pick-muscle-groups');
await A.click('.sheet button:has-text("Close")');

// 8. Setup notes (#125): a note for one gym on the exercise page.
await alex.call('save_note', { exercise_id: exId, gym_id: gymA.id, note: 'Bench on the 3rd hole, safeties at 5' });
await A.goto(URL + `#/exercises/${exId}`); await A.reload();
await A.waitForSelector('.note-row .setup-note');
await A.evaluate(() => {
  // Only as far as needed to show the note, keeping the exercise's name in view where it fits.
  const note = document.querySelector('.note-row').getBoundingClientRect();
  scrollTo(0, Math.max(0, note.bottom + scrollY - (innerHeight - 100)));
});
await A.waitForTimeout(400);
await jpg(A, 'setup-notes');

// 9. Share a finished workout as an image (#160): the preview with Share and Save image.
const latest = (await alex.call('history&limit=1')).workouts[0];
await A.goto(URL + `#/history/${latest.id}`); await A.reload();
await A.waitForSelector('.recap');
await A.click('button:has-text("Share workout")');
await A.waitForSelector('.sheet canvas.share-card');
await A.waitForTimeout(500);
await jpg(A, 'share-image');
await A.click('.sheet button:has-text("Close")');

// 6. Shared workout: Alex shares the planned workout; Sam accepts it.
await A.goto(URL + '#/today'); await A.reload(); await A.waitForSelector('.plan-row'); await ready(A);
const samId = (await alex.call('people')).people.find((x) => x.name === 'Sam Lee').id;
const draft = await A.evaluate(() => [...document.querySelectorAll('.plan-row h3')].map((h) => h.textContent));
const { workout: shareable } = await alex.call('generate', { gym_id: gymA.id, day_type: 'push', minutes: 60 });
await alex.call('share_workout', { share_key: uuid(), to: [samId], plan: routineOf(shareable) });
const P = sam.p;
await P.goto(URL + '#/today'); await P.reload();
await P.waitForSelector('.share-card', { timeout: 15000 });
await P.click('.share-card button:has-text("Accept")');
await P.waitForSelector('.shared-note'); await ready(P);
await P.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 10000 });
await P.waitForTimeout(300);
await jpg(P, 'shared-workout');
console.log('done', draft.length);
await b.close();
