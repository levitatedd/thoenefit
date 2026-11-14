// Browser walk-through of the main path at phone sizes, against a running copy
// of the app. Needs Playwright and Chrome, so it is optional:
//
//   php -S 127.0.0.1:8765 -t web                      (in one terminal)
//   printf 'gym-test-password\n' | php web/private/bin/create-user.php e2e "E2E"
//   NODE_PATH=$(npm root -g) node tests/e2e.mjs       (in another)
//
// Environment: TF_URL, TF_USER, TF_PASS, TF_SHOTS (folder for screenshots), CHROME (path to Chrome).

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.env.TF_URL || 'http://127.0.0.1:8765/';
const USER = process.env.TF_USER || 'e2e';
const PASS = process.env.TF_PASS || 'gym-test-password';
const SHOTS = process.env.TF_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok   ' : 'FAIL '} ${name}${ok || !detail ? '' : `  (${detail})`}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text()) && errors.push(m.text()));
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

console.log('Sign in and onboarding');
await page.goto(URL);
await page.fill('input[name=username]', USER);
await page.fill('input[name=password]', 'wrong-password-here');
await page.click('button[type=submit]');
await page.waitForSelector('.form-error:not(:empty)');
check('wrong password shows an error', (await page.textContent('.form-error')).includes('Wrong'));
await shot('01-sign-in');
await page.fill('input[name=password]', PASS);
await page.click('button[type=submit]');
await page.waitForSelector('text=Where you train');
check('first sign-in opens setup', true);
await shot('02-setup');
await page.click('.choice:has-text("Push / pull / legs")');
await page.click('.chip:has-text("Garage barbell setup")');
await page.click('button:has-text("Save and build my first workout")');

console.log('Generate, lock, swap, regenerate');
await page.waitForSelector('.plan-row');
const names = () => page.$$eval('.plan-row h3', (els) => els.map((e) => e.textContent));
const first = await names();
check(`a workout is generated (${first.length} exercises)`, first.length >= 3);
check('the first day of push/pull/legs is Push', (await page.$eval('select[aria-label="Workout type"]', (s) => s.value)) === 'push');
check('nothing needs a cable or machine at a garage gym', !first.some((n) => /Cable|Machine|Pulldown|Pec Deck|Leg Press/.test(n)), first.join(', '));
check('each exercise explains why', (await page.$$eval('.plan-row .why', (els) => els.every((e) => e.textContent.length > 20))) === true);
check('no sideways scrolling at iPhone width', (await overflow()) <= 0);
await shot('03-today');

await page.click('.plan-row:nth-child(1) button:has-text("Lock")');
await page.click('.plan-row:nth-child(2) button:has-text("Swap")');
await page.waitForSelector('.sheet .pick');
await shot('04-swap');
const swapTo = await page.textContent('.sheet .pick .pick-name');
await page.click('.sheet .pick');
await page.waitForSelector('.sheet', { state: 'detached' });
const afterSwap = await names();
check(`swap replaces the exercise (${first[1]} -> ${afterSwap[1]})`, afterSwap[1] === swapTo && afterSwap[1] !== first[1]);
await page.click('button:has-text("Regenerate")');
await page.waitForFunction((prev) => {
  const now = [...document.querySelectorAll('.plan-row h3')].map((e) => e.textContent);
  return !document.querySelector('.stack.loading') && now.length && now.join() !== prev;
}, afterSwap.join());
const regen = await names();
check('regenerate keeps locked and swapped-in exercises', regen[0] === first[0] && regen[1] === swapTo);
check('regenerate changes at least one of the others', regen.slice(2).join() !== afterSwap.slice(2).join(), regen.join(', '));

console.log('Log sets, resume, offline');
await page.click('button:has-text("Start workout")');
await page.waitForSelector('.lift');
const lift = page.locator('.lift').first();
const liftName = await lift.locator('h2').textContent();
check('weight field asks for a decimal keypad and reps for a number pad', (await lift.locator('.set input').nth(0).getAttribute('inputmode')) === 'decimal' && (await lift.locator('.set input').nth(1).getAttribute('inputmode')) === 'numeric');
const box = await lift.locator('.plate').first().boundingBox();
check(`complete-set button is a large touch target (${Math.round(box.width)}px)`, box.width >= 56 && box.height >= 56);
const setRows = await lift.locator('.set').count();
// Every working set at the top of the rep range, so the next session should go up.
const repMax = Number((await lift.locator('.target').textContent()).match(/of \d+-(\d+)/)[1]);
for (let i = 0; i < setRows; i++) {
  const row = lift.locator('.set').nth(i);
  await row.locator('input').nth(0).fill('135');
  await row.locator('input').nth(1).fill(String(repMax));
  await row.locator('.plate').click();
  if (i === 0) {
    await page.waitForSelector('#rest:not([hidden])');
    check('finishing a set starts the rest timer', /\d:\d\d/.test(await page.textContent('#rest-time')));
    await shot('05-workout');
    await page.click('#rest button:has-text("Skip")');
  }
}
await page.waitForSelector('#sync.saved');
check('status shows Saved once the server has the sets', (await page.textContent('#sync')) === 'Saved');
check('no sideways scrolling on the workout screen', (await overflow()) <= 0);

await page.click('button:has-text("Add exercise")');
await page.fill('.sheet input[type=search]', 'lat puldown');
await page.waitForSelector('.sheet .pick, .sheet p.muted');
const picker = await page.$$eval('.sheet .pick .pick-name', (els) => els.map((e) => e.textContent));
check('the exercise picker tolerates typos but only offers what the gym has (no Lat Pulldown machine at a garage gym)', picker.length > 0 && !picker.includes('Lat Pulldown') && picker.some((n) => /Pull-Up|Chin-Up/.test(n)), picker.join(', '));
await page.fill('.sheet input[type=search]', 'pushup');
check('no stray text in the picker', !/\b(false|undefined|null)\b/.test(await page.textContent('.sheet-body')));
check('picker: "pushup" puts Push-Up first', (await page.textContent('.sheet .pick .pick-name')) === 'Push-Up');
await shot('05a-picker');
await page.click('.sheet button:has-text("Close")');
await page.click('.lift:nth-of-type(2) button:has-text("Add set")');
check('add set adds a row', (await page.locator('.lift').nth(1).locator('.set').count()) >= 3);
const before = await page.locator('.lift').nth(1).locator('.set').count();
await page.locator('.lift').nth(1).locator('button:has-text("Remove set")').click();
check('remove set removes a row', (await page.locator('.lift').nth(1).locator('.set').count()) === before - 1);
await page.locator('.lift').nth(1).locator('.set-tag').first().click();
check('a set can be marked as warm-up', (await page.locator('.lift').nth(1).locator('.set').first().getAttribute('class')).includes('warm'));
await page.locator('.lift').nth(1).locator('.set-tag').first().click();
const second = await page.locator('.lift').nth(1).locator('h2').textContent();
await page.locator('.lift').nth(1).locator('button[aria-label^="Options"]').click();
await page.click('.sheet button:has-text("Move earlier")');
check('exercises can be reordered', (await page.locator('.lift').first().locator('h2').textContent()) === second);
await page.locator('.lift').first().locator('button[aria-label^="Options"]').click();
await page.click('.sheet button:has-text("Move later")');
await page.waitForSelector('#sync.saved');

await page.reload();
await page.waitForSelector('.lift');
check('a refresh mid-workout comes straight back to it with the sets intact', (await page.locator('.lift').first().locator('.set.done').count()) === setRows);
await page.goto(`${URL}#/today`);
await page.waitForSelector('text=Resume workout');
check('Today offers to resume the unfinished workout', true);
await shot('06-resume');
await page.click('text=Resume workout');
await page.waitForSelector('.lift');

// Wait for the service worker so the app can reopen with no network.
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForSelector('.lift');
await context.setOffline(true);
const l2 = page.locator('.lift').nth(1);
const l2rows = await l2.locator('.set').count();
const l2max = Number((await l2.locator('.target').textContent()).match(/of \d+-(\d+)/)[1]);
for (let i = 0; i < l2rows; i++) {
  const row = l2.locator('.set').nth(i);
  await row.locator('input').nth(0).fill('95');
  await row.locator('input').nth(1).fill(String(l2max - 2));
  await row.locator('.plate').click();
}
await page.waitForSelector('#sync.pending');
check('offline edits are marked as waiting to sync', /Offline|Waiting/.test(await page.textContent('#sync')), await page.textContent('#sync'));
await shot('07-offline');
await page.reload();
await page.waitForSelector('.lift');
check('the app reopens offline with the unsynced sets intact', (await page.locator('.lift').nth(1).locator('.set.done').count()) === l2rows);
await context.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForSelector('#sync.saved', { timeout: 45000 });
check('back online, the queue drains to Saved', true);

const api = async (q) => page.evaluate(async (u) => (await fetch(u, { credentials: 'same-origin' })).json(), `api.php?a=${q}`);
const boot = await api('bootstrap');
const serverSets = boot.active.exercises.flatMap((e) => e.sets);
check('the server has each set exactly once', new Set(serverSets.map((s) => s.id)).size === serverSets.length && serverSets.filter((s) => s.done).length === setRows + l2rows, `${serverSets.length} sets`);

console.log('Finish, history, next recommendation');
await page.click('button:has-text("Finish workout")');
await page.click('.sheet button:has-text("Finish and save")');
await page.waitForSelector('.plan-row');
check('after finishing, the next day in the split comes up (Pull)', (await page.$eval('select[aria-label="Workout type"]', (s) => s.value)) === 'pull');
await page.selectOption('select[aria-label="Workout type"]', 'push');
await page.waitForFunction((n) => [...document.querySelectorAll('.plan-row h3')].some((e) => e.textContent === n) && !document.querySelector('.stack.loading'), liftName);
const row = page.locator('.plan-row', { hasText: liftName }).first();
const target = await row.locator('.target').textContent();
const why = await row.locator('.why').textContent();
check(`next time ${liftName} goes up: "${target.trim()}"`, /at 140 lb/.test(target) && /go up 5 lb/.test(why), why);
check('last weight and reps are shown next to it', /Last: 135 lb/.test(await row.locator('.last').textContent()));
await shot('08-next-session');

await page.click('.tab:has-text("History")');
await page.waitForSelector('.log-row');
check('the workout is in History', (await page.locator('.log-row').count()) === 1);
await shot('09-history');
await page.click('.log-row');
await page.waitForSelector('.lift');
const editRow = page.locator('.lift', { hasText: liftName }).locator('.set').last();
await editRow.locator('input').nth(1).fill(String(repMax - 3));
await page.click('button:has-text("Save changes")');
await page.waitForSelector('.toast.show');
await page.click('.tab:has-text("Today")');
await page.waitForSelector('.plan-row');
await page.selectOption('select[aria-label="Workout type"]', 'push');
await page.waitForFunction((n) => [...document.querySelectorAll('.plan-row h3')].some((e) => e.textContent === n) && !document.querySelector('.stack.loading'), liftName);
const target2 = await page.locator('.plan-row', { hasText: liftName }).first().locator('.target').textContent();
check(`correcting a past set changes the advice: "${target2.trim()}"`, /at 135 lb/.test(target2));

console.log('Exercises, settings, small screens');
await page.click('.tab:has-text("Exercises")');
await page.fill('input[type=search]', 'psuh up');
await page.waitForSelector('[data-list=similar]');
const found = await page.$$eval('[data-list=matches] .log-title', (els) => els.map((e) => e.textContent));
const alike = await page.$$eval('[data-list=similar] .log-title', (els) => els.map((e) => e.textContent));
check(`a misspelled search still finds the exercise ("psuh up" -> ${found[0]})`, found[0] === 'Push-Up' && found.slice(1).every((n) => /Push-Up/.test(n)), found.join(', '));
check('related movements appear under Similar exercises without repeating a match', alike.length > 0 && !alike.some((n) => found.includes(n)) && (await page.textContent('.list-head')) === 'Similar exercises', alike.join(', '));
check('no stray text in the results', !/\b(false|undefined|null)\b/.test(await page.textContent('.page')));
await page.fill('input[type=search]', 'RDL');
check('"RDL" finds Romanian deadlifts', (await page.$$eval('[data-list=matches] .log-title', (els) => els.every((e) => /Romanian Deadlift/.test(e.textContent)))) === true);
await shot('10a-search');
await page.fill('input[type=search]', liftName.slice(0, 12));
await page.click(`.log-row:has-text("${liftName}")`);
await page.waitForSelector('.chart');
check('exercise page shows form cues and a trend', (await page.locator('.cues').count()) === 1 && (await page.locator('.chart').count()) === 2);
await shot('10-exercise');
const csv = await page.evaluate(async () => (await fetch('api.php?a=export', { credentials: 'same-origin' })).text());
check('CSV export downloads every set', csv.split('\n').filter(Boolean).length === 1 + setRows + l2rows && csv.startsWith('date_utc'));
console.log('Admin and accounts');
const post = (action, body, token) => page.evaluate(async ([a, b, t]) => {
  const r = await fetch(`api.php?a=${a}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json() };
}, [action, body, token]);
await page.click('.tab:has-text("Settings")');
await page.waitForSelector('text=Manage users');
check('the first account sees Manage users in Settings', true);
await page.click('a:has-text("Manage users")');
await page.waitForSelector('.log-row:has-text("Admin")');
const newUser = `buddy${Date.now() % 100000}`;
await page.fill('input[name=new_username]', newUser);
await page.fill('input[name=new_password]', 'short');
await page.click('button:has-text("Create account")');
check('a too-short password is refused with a reason', /at least 10/.test(await page.textContent('.form-error')) || !(await page.$eval('input[name=new_password]', (el) => el.checkValidity())));
await page.fill('input[name=display_name]', 'Training Buddy');
await page.fill('input[name=new_password]', 'buddy-password-1');
await page.click('button:has-text("Create account")');
await page.waitForSelector('.log-row:has-text("Training Buddy")');
check('the admin can create an account, and it is a regular user', !(await page.locator('.log-row:has-text("Training Buddy")').textContent()).includes('Admin'));
await shot('12-manage-users');
await page.fill('input[name=new_username]', newUser);
await page.fill('input[name=new_password]', 'buddy-password-2');
await page.click('button:has-text("Create account")');
await page.waitForSelector('.form-error:not(:empty)');
check('a duplicate username is refused', /taken/.test(await page.textContent('.form-error')));
const anon = await browser.newContext();
const anonPage = await anon.newPage();
await anonPage.goto(URL);
const noLogin = await anonPage.evaluate(async () => {
  const r = await fetch('api.php?a=create_user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'intruder', password: 'intruder-password' }) });
  const u = await fetch('api.php?a=users');
  return [r.status, u.status];
});
check('there is still no way to create an account without signing in', noLogin[0] === 401 && noLogin[1] === 401, noLogin.join());
await anon.close();
await page.goto(`${URL}#/settings`);
await page.click('button:has-text("Sign out")');
await page.waitForSelector('input[name=username]');
await page.fill('input[name=username]', newUser);
await page.fill('input[name=password]', 'buddy-password-1');
await page.click('button[type=submit]');
await page.waitForSelector('text=Where you train');
check('the new person can sign in and gets their own setup', (await page.textContent('h1')).includes('Training Buddy'));
const theirs = await api('bootstrap');
const denied = await post('create_user', { username: 'sneaky', password: 'sneaky-password' }, theirs.csrf);
const deniedList = await page.evaluate(async () => (await fetch('api.php?a=users', { credentials: 'same-origin' })).status);
check('the server refuses account management from a regular user', theirs.user.role === 'user' && denied.status === 403 && deniedList === 403, `${denied.status} ${deniedList}`);
await page.click('button:has-text("Save and build my first workout")');
await page.waitForSelector('.plan-row');
await page.goto(`${URL}#/settings`);
await page.waitForSelector('text=Add to your Home Screen');
check('a regular user has no Manage users link', (await page.locator('a:has-text("Manage users")').count()) === 0);
await page.goto(`${URL}#/settings/users`);
await page.waitForSelector('text=Only the admin');
check('and opening the page directly shows nothing', (await page.locator('input[name=new_username]').count()) === 0);
await page.goto(`${URL}#/settings`);
await page.click('button:has-text("Sign out")');
await page.waitForSelector('input[name=username]');
await page.fill('input[name=username]', USER);
await page.fill('input[name=password]', PASS);
await page.click('button[type=submit]');
await page.waitForSelector('.tabs');

await page.click('.tab:has-text("Settings")');
await page.waitForSelector('text=Add to your Home Screen');
check('settings include Home Screen instructions for Safari', (await page.textContent('.page')).includes('Tap the Share button'));
await shot('11-settings');
for (const [w, hgt, label] of [[375, 667, 'iPhone SE'], [393, 852, 'iPhone 16'], [440, 956, 'iPhone Pro Max'], [412, 915, 'Pixel']]) {
  await page.setViewportSize({ width: w, height: hgt });
  let worst = 0;
  for (const tab of ['today', 'history', 'exercises', 'settings']) {
    await page.goto(`${URL}#/${tab}`);
    await page.waitForSelector('.tabs');
    await page.waitForTimeout(250);
    worst = Math.max(worst, await overflow());
  }
  check(`no sideways scrolling at ${w}px (${label})`, worst <= 0, `${worst}px`);
}
check('no script errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
