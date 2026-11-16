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
// php -S ignores web/.htaccess, so send its Content-Security-Policy here too.
// Otherwise anything the live site's policy blocks (like inline style
// attributes, #81) works locally and breaks on the server.
if (!process.env.TF_URL) {
  const { readFileSync } = await import('node:fs');
  const csp = readFileSync(new globalThis.URL('../web/.htaccess', import.meta.url), 'utf8').match(/Content-Security-Policy "([^"]+)"/)[1];
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts) => {
    const ctx = await newContext(opts);
    await ctx.route('**/*', async (route) => {
      // The page itself, and the copy the service worker saves and serves later.
      const req = route.request();
      if (req.resourceType() !== 'document' && !/\/(index\.html)?(\?.*)?$/.test(new globalThis.URL(req.url()).pathname)) return route.continue();
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
    });
    return ctx;
  };
}
const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// The install reminder (#89) is tested on its own below; keep it out of the main walk-through.
await context.addInitScript(() => {
  try {
    localStorage.setItem('tf.install', JSON.stringify({ never: true }));
  } catch (e) {
    // about:blank has no storage
  }
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text()) && errors.push(m.text()));
// Waits for a toast with this text. Waiting for any '.toast.show' can match a toast
// left over from an earlier step (they stay up 3.2 s), and then the next check runs
// before the action has finished (#84).
const waitForToast = (pg, text) => pg.waitForFunction((src) => {
  const t = document.getElementById('toast');
  return !!t && t.classList.contains('show') && new RegExp(src).test(t.textContent);
}, text.source);
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

console.log('Sign in and onboarding');
await page.goto(URL);
const loaded = (sel) => page.$eval(sel, (img) => img.complete && img.naturalWidth > 0).catch(() => false);
await page.waitForSelector('img.brand-wide');
check('the sign-in screen shows the wide ThoeneFit logo', (await loaded('img.brand-wide')) && (await page.getAttribute('img.brand-wide', 'alt')) === 'ThoeneFit');
const fav = await page.evaluate(async () => {
  const links = [...document.querySelectorAll('link[rel=icon]')].map((l) => l.getAttribute('href'));
  const ok = await Promise.all(links.map(async (h) => (await fetch(h)).ok));
  return { links, ok };
});
const off = await page.$eval('img.brand-wide', (img) => { const r = img.getBoundingClientRect(); return Math.abs((r.left + r.right) / 2 - window.innerWidth / 2); });
check('the logo is centred on the sign-in screen, with no other text above the form', off < 2 && !(await page.textContent('.page')).includes('Accounts are created'), `${off}px off centre`);
check('the browser tab icon is the barbell logo', fav.links.some((l) => l.startsWith('favicon.ico')) && fav.links.some((l) => l.startsWith('icons/favicon-32.png')) && fav.ok.every(Boolean), JSON.stringify(fav));
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

// Recovery estimate lives on the Trends tab (#26), so Today ends with the plan and the logo.
const order = await page.evaluate(() => {
  const rows = document.querySelectorAll('.plan-row');
  const last = rows[rows.length - 1];
  const logo = document.querySelector('.page img.brand-wide');
  return logo && last ? [last.getBoundingClientRect().bottom, logo.getBoundingClientRect().top, logo.complete && logo.naturalWidth > 0] : null;
});
check('on Today, the wide logo sits below the planned workout', !!order && order[1] >= order[0] && order[2] === true, JSON.stringify(order));
check('Recovery estimate is no longer on Today', !(await page.textContent('.page')).includes('Recovery estimate'));
const y0 = await page.evaluate(() => { window.scrollTo(0, 300); return window.scrollY; });
await page.click('.plan-row:nth-child(3) h3 a');
await page.waitForSelector('.facts');
check(`tapping an exercise name on Today opens its history (${first[2]})`, (await page.textContent('h1')) === first[2] && (await page.locator('.section h2:has-text("History")').count()) === 1);
check('the way back is labelled Today', (await page.textContent('.back')).trim() === 'Today');
await shot('03a-history-from-today');
await page.click('.back');
await page.waitForSelector('.plan-row');
check('going back returns to the same planned workout at the same spot', (await names()).join() === first.join() && Math.abs((await page.evaluate(() => window.scrollY)) - y0) < 5);
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

await page.locator('.lift').first().locator('h2 a').click();
await page.waitForSelector('.facts');
check('tapping the name during a workout opens its history, with a way back to the workout', (await page.textContent('h1')) === liftName && (await page.textContent('.back')).trim() === 'Workout');
await page.click('.back');
await page.waitForSelector('.lift');
check('the workout is exactly as it was left', (await page.locator('.lift').first().locator('.set.done').count()) === setRows);
await page.click('.tab:has-text("Exercises")');
await page.fill('input[type=search]', liftName);
await page.click(`.log-row:has-text("${liftName}")`);
await page.waitForSelector('.facts');
check('opened from the library, the way back is still Exercises', (await page.textContent('.back')).trim() === 'Exercises');
await page.goto(`${URL}#/workout`);
await page.waitForSelector('.lift');
await page.click('button:has-text("Add exercise")');
await page.fill('.sheet input[type=search]', 'lat puldown');
await page.waitForSelector('.sheet .pick, .sheet p.muted');
const picker = await page.$$eval('.sheet .pick .pick-name', (els) => els.map((e) => e.textContent));
// A garage gym has a pull-up bar but no pulldown machine, cable or bands.
check('the exercise picker tolerates typos but only offers what the gym has (no Lat Pulldown machine at a garage gym)', picker.length > 0 && picker.some((n) => /Pulldown|Pull-Up|Chin-Up/.test(n)) && !picker.some((n) => /^Lat Pulldown$|Band|Cable|Machine/.test(n)), picker.join(', '));
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

// Swap mid-workout: one set logged on the third exercise, then the machine is "busy".
const l3 = page.locator('.lift').nth(2);
const l3name = await l3.locator('h2').textContent();
const l3sets = await l3.locator('.set').count();
const liftsBefore = await page.locator('.lift').count();
await l3.locator('.set').first().locator('input').nth(0).fill('50');
await l3.locator('.set').first().locator('input').nth(1).fill('9');
await l3.locator('.set').first().locator('.plate').click();
await page.waitForSelector('#rest:not([hidden])');
await page.click('#rest button:has-text("Skip")');
await l3.locator('button:has-text("Swap")').click();
await page.waitForSelector('.sheet .pick');
const offered = await page.$$eval('.sheet .pick .pick-name', (els) => els.map((x) => x.textContent));
check('swap offers alternatives the gym has equipment for', offered.length > 0 && !offered.some((n) => /Cable|Machine|Pec Deck|Smith/.test(n)), offered.join(', '));
const l3new = offered[0];
await page.click('.sheet .pick');
await page.waitForSelector('.sheet', { state: 'detached' });
check('the logged set stays under the original exercise', (await page.locator('.lift').nth(2).locator('h2').textContent()) === l3name && (await page.locator('.lift').nth(2).locator('.set.done').count()) === 1 && (await page.locator('.lift').nth(2).locator('.set').count()) === 1);
check('the alternative follows it with the sets that were left', (await page.locator('.lift').nth(3).locator('h2').textContent()) === l3new && (await page.locator('.lift').nth(3).locator('.set').count()) === l3sets - 1 && (await page.locator('.lift').count()) === liftsBefore + 1);
check('a finished exercise no longer offers Swap', (await page.locator('.lift').nth(2).locator('.set-actions button:has-text("Swap")').count()) === 0);
await page.locator('.lift').nth(3).locator('button:has-text("Swap")').click();
await page.waitForSelector('.sheet .pick');
const l3third = await page.textContent('.sheet .pick .pick-name');
await page.click('.sheet .pick');
await page.waitForSelector('.sheet', { state: 'detached' });
check('swapping an exercise with nothing logged simply replaces it', (await page.locator('.lift').nth(3).locator('h2').textContent()) === l3third && (await page.locator('.lift').count()) === liftsBefore + 1);
check('no sideways scrolling with the Swap button', (await overflow()) <= 0);
await shot('05b-swap-mid-workout');
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
check('the server has each set exactly once', new Set(serverSets.map((s) => s.id)).size === serverSets.length && serverSets.filter((s) => s.done).length === setRows + l2rows + 1, `${serverSets.length} sets`);

console.log('Finish, history, next recommendation');
// #87: "Send to Strava" on the Finish sheet. Without a Strava connection it isn't offered.
await page.click('button:has-text("Finish workout")');
await page.waitForSelector('.sheet button:has-text("Finish and save")');
check('without a Strava connection the Finish sheet has no Strava option', (await page.locator('.sheet label:has-text("Send to Strava")').count()) === 0);
await page.click('.sheet button:has-text("Close")');
// The test server has no Strava keys, so act as a connected account.
const connected = async (route) => {
  const response = await route.fetch();
  const json = await response.json();
  if (json.strava) json.strava = { enabled: true, connected: true };
  await route.fulfill({ response, json });
};
await context.route('**/api.php?a=bootstrap*', connected);
await page.reload();
await page.waitForSelector('.lift');
let finishSave = null;
const watchSave = (req) => {
  if (!req.url().includes('a=save_workout')) return;
  const w = req.postDataJSON()?.workout;
  if (w?.status === 'completed') finishSave = w;
};
page.on('request', watchSave);
await page.click('button:has-text("Finish workout")');
await page.waitForSelector('.sheet label:has-text("Send to Strava")');
const stravaBox = page.locator('.sheet label:has-text("Send to Strava") input');
const detailsRow = page.locator('.sheet label:has-text("Include exercises")');
check('connected to Strava, Finish offers Send to Strava, unticked the first time, details hidden until ticked',
  !(await stravaBox.isChecked()) && !(await detailsRow.isVisible()));
await page.click('.sheet label:has-text("Send to Strava")');
check('ticking Send to Strava shows the option to include exercises, sets, reps and weights', await detailsRow.isVisible());
await detailsRow.click();
await shot('07b-finish-send-to-strava');
await page.click('.sheet button:has-text("Finish and save")');
await waitForToast(page, /Workout saved/);
check('the message says it goes to Strava once it syncs', /goes to Strava once it syncs/.test(await page.textContent('.toast')));
for (let i = 0; i < 40 && !finishSave; i++) await page.waitForTimeout(250);
page.off('request', watchSave);
await context.unroute('**/api.php?a=bootstrap*', connected);
check('the finished workout carries the Strava request to the server',
  finishSave?.strava_send?.include_summary === true && Number.isInteger(finishSave?.strava_send?.utc_offset), JSON.stringify(finishSave?.strava_send));
check('the choice is remembered for next time', JSON.stringify(await page.evaluate(() => JSON.parse(localStorage.getItem('tf.stravaOnFinish')))) === '{"send":true,"summary":true,"calories":false}');
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
// The page redraws its exercises once the save returns; wait for that before reading it.
await waitForToast(page, /Changes saved/);
// #19: the Trend link on a past workout reads as a link and comes back to that workout.
const workoutHash = await page.evaluate(() => location.hash);
const trendLink = page.locator('.lift', { hasText: liftName }).locator('a.trend-link');
// Looked up fresh on each try, so a redraw cannot leave the check holding a removed link (#84).
const underlined = await page.waitForFunction((name) => {
  const lift = [...document.querySelectorAll('.lift')].find((l) => l.textContent.includes(name));
  const link = lift && lift.querySelector('a.trend-link');
  return !!link && link.isConnected && getComputedStyle(link).textDecorationLine.includes('underline');
}, liftName, { timeout: 5000 }).then(() => true, () => false);
check('the Trend link on a past workout is underlined', underlined);
await trendLink.click();
await page.waitForSelector('.chart');
check('opened from a past workout, the way back says Workout History', (await page.textContent('.back')).trim() === 'Workout History');
await page.click('.back');
await page.waitForSelector('.lift');
check('and returns to that same workout', (await page.evaluate(() => location.hash)) === workoutHash && (await page.locator('.back').textContent()).trim() === 'History');
await page.click('.tab:has-text("Today")');
await page.waitForSelector('.plan-row');
await page.selectOption('select[aria-label="Workout type"]', 'push');
await page.waitForFunction((n) => [...document.querySelectorAll('.plan-row h3')].some((e) => e.textContent === n) && !document.querySelector('.stack.loading'), liftName);
const target2 = await page.locator('.plan-row', { hasText: liftName }).first().locator('.target').textContent();
check(`correcting a past set changes the advice: "${target2.trim()}"`, /at 135 lb/.test(target2));

console.log('Install reminder');
{
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';
  const PIXEL = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const phoneAs = async (userAgent, init) => {
    const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true, userAgent });
    if (init) await ctx.addInitScript(init);
    const pg = await ctx.newPage();
    await pg.goto(URL);
    await pg.fill('input[name=username]', USER);
    await pg.fill('input[name=password]', PASS);
    await pg.click('button[type=submit]');
    await pg.waitForSelector('.plan-row');
    return [ctx, pg];
  };
  const [ic, ip] = await phoneAs(IPHONE);
  check('no install reminder on the first visit', (await ip.locator('.install-card').count()) === 0);
  await ip.reload();
  await ip.waitForSelector('.plan-row');
  check('on a later visit in Safari, Today reminds them they can install it', (await ip.locator('.install-card').count()) === 1);
  check('no sideways scrolling with the reminder', (await ip.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  if (SHOTS) await ip.screenshot({ path: `${SHOTS}/21-install-card.png` });
  await ip.click('.install-card button:has-text("Show me how")');
  await ip.waitForSelector('[data-install-guide]');
  const iSteps = await ip.textContent('.sheet-body');
  check('the popup shows the iPhone Safari steps', (await ip.getAttribute('[data-install-guide]', 'data-install-guide')) === 'ios-safari' && /Share button/.test(iSteps) && /Add to Home Screen/.test(iSteps) && !/three-dot/.test(iSteps));
  if (SHOTS) await ip.screenshot({ path: `${SHOTS}/22-install-steps.png` });
  await ip.click('.sheet button:has-text("Close")');
  await ip.click('.install-card button:has-text("Not now")');
  check('"Not now" hides it', (await ip.locator('.install-card').count()) === 0);
  await ip.reload();
  await ip.waitForSelector('.plan-row');
  check('and it stays hidden after reopening', (await ip.locator('.install-card').count()) === 0);
  await ip.goto(`${URL}#/settings`);
  await ip.waitForSelector('text=Add to your Home Screen');
  const firstGuide = await ip.locator('.section', { hasText: 'Add to your Home Screen' }).locator('h3').first().textContent();
  check(`Settings lists this browser's steps first (${firstGuide})`, firstGuide === 'iPhone or iPad, Safari' && (await ip.locator('details.fold summary:has-text("Other browsers and phones")').count()) === 1);
  await ic.close();

  const [ac, ap] = await phoneAs(PIXEL);
  await ap.reload();
  await ap.waitForSelector('.plan-row');
  // Stand in for Chrome's own install prompt, which only real installable sites get.
  await ap.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__prompted = true; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await ap.goto(`${URL}#/history`);
  await ap.goto(`${URL}#/today`);
  await ap.waitForSelector('.install-card');
  check('on Android Chrome the reminder offers the browser\'s own Install button', (await ap.locator('.install-card button.primary').textContent()) === 'Install');
  await ap.click('.install-card button:has-text("Install")');
  await ap.waitForFunction(() => !document.querySelector('.install-card'));
  check('tapping Install opens the browser\'s install prompt, and accepting hides the reminder', await ap.evaluate(() => window.__prompted === true));
  await ap.reload();
  await ap.waitForSelector('.plan-row');
  check('after installing, the browser tab no longer reminds', (await ap.locator('.install-card').count()) === 0);
  await ac.close();

  const [sc, sp] = await phoneAs(IPHONE, () => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true }));
  await sp.reload();
  await sp.waitForSelector('.plan-row');
  check('people already using the installed app never see it', (await sp.locator('.install-card').count()) === 0);
  await sc.close();

  const [dc, dp] = await phoneAs(IPHONE);
  await dp.reload();
  await dp.waitForSelector('.install-card');
  await dp.click('.install-card button:has-text("Don\'t show this again")');
  await dp.reload();
  await dp.waitForSelector('.plan-row');
  check('"Don\'t show this again" turns it off on that device', (await dp.locator('.install-card').count()) === 0 && (await dp.evaluate(() => JSON.parse(localStorage.getItem('tf.install')).never)) === true);
  await dc.close();
}

console.log('Trends');
await page.click('.tab:has-text("Trends")');
await page.waitForSelector('h2:has-text("Weekly lifting volume")');
const trendsText = await page.textContent('.page');
check('the Trends tab shows weekly lifting volume, weekly workout time and Recovery estimate', /Weekly workout time/.test(trendsText) && /Recovery estimate/.test(trendsText) && (await page.locator('.chart').count()) >= 1, trendsText.slice(0, 200));
{
  const tb = await page.locator('.chart svg').first().boundingBox();
  await page.touchscreen.tap(tb.x + tb.width - 8, tb.y + tb.height / 2);
  await page.waitForSelector('.chart-readout strong');
  const weekText = await page.locator('.chart-readout').first().textContent();
  check(`tapping a week on Trends shows that week's total and workouts (${weekText.replace(/\s+/g, ' ').trim()})`, /Week of/.test(weekText) && /workout/.test(weekText) && (await page.locator('.chart-readout').first().locator('a').count()) === 0);
  check('no stray text on Trends', !/\b(undefined|null|NaN|false)\b/.test(await page.textContent('.page')));
}
check('Trends is highlighted in the tab bar', (await page.getAttribute('.tab:has-text("Trends")', 'aria-current')) === 'page');
check('no sideways scrolling on Trends', (await overflow()) <= 0);

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
// #11: tap a point for its details, open that workout, and filter by date range.
{
  const exHash = await page.evaluate(() => location.hash);
  const exId = Number(exHash.split('/').pop());
  const chart = page.locator('.chart').first();
  check('before a point is chosen, the chart says how to use it', /Tap a point/.test(await chart.locator('.chart-readout').textContent()));
  const box = await chart.locator('svg').boundingBox();
  await page.touchscreen.tap(box.x + box.width - 12, box.y + box.height / 2);
  await page.waitForSelector('.chart-readout a:has-text("Open workout")');
  const readout = await chart.locator('.chart-readout').textContent();
  check(`tapping a point shows its date and values (${readout.replace(/\s+/g, ' ').trim().slice(0, 70)})`, /\d{4}/.test(readout) && /lb/.test(readout) && /Sets:/.test(readout));
  check('the chosen point is marked on the chart', (await chart.locator('circle.sel').getAttribute('visibility')) === 'visible');
  await chart.locator('svg').focus();
  await page.keyboard.press('Home');
  const firstTitle = await chart.locator('.chart-readout strong').textContent();
  await page.keyboard.press('End');
  check('the arrow, Home and End keys move between points', (await chart.locator('.chart-readout strong').textContent()) !== firstTitle || (await page.locator('.chart').first().locator('.dot').count()) === 1);
  // #75: the details box keeps one height, so the chart stays put while you scrub
  // between a short session and one whose sets run to several lines.
  const tops = await page.evaluate(async () => {
    const { lineChart } = await import('./js/ui.js');
    const long = Array.from({ length: 12 }, (_, i) => (i % 5 ? '150×6' : '135×8')).join(', ') + ' lb';
    const pts = [
      { label: 'A', value: 150, title: 'Thu, Sep 15, 2022', href: '#/history/1', lines: [`Sets: ${long}`, 'My gym'] },
      { label: 'B', value: 155, title: 'Tue, Aug 9, 2022', href: '#/history/2', lines: ['Sets: 155 lb × 8', 'My gym'] },
      { label: 'C', value: 160, title: 'Wed, Aug 10, 2022', href: '#/history/3', lines: [`Sets: ${long}, ${long}`, 'A gym with a rather long name'] },
    ];
    const fig = lineChart(pts, { unit: 'lb' });
    fig.id = 'steady-test';
    document.querySelector('.page').prepend(fig);
    const svg = fig.querySelector('svg');
    const at = () => Math.round(svg.getBoundingClientRect().top + window.scrollY);
    const readout = fig.querySelector('.chart-readout');
    const out = [at()];
    let fits = true;
    svg.focus();
    for (const key of ['Home', 'ArrowRight', 'ArrowRight', 'Home']) {
      svg.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      out.push(at());
      // #81: the details fit inside their box instead of spilling under the chart.
      fits = fits && readout.querySelector('.chart-readout-text').offsetHeight <= readout.clientHeight;
    }
    const clipped = [...fig.querySelectorAll('.chart-readout-text > span[title]')].every((s) => s.title.length > 0);
    fig.remove();
    return { out, clipped, fits };
  });
  check(`the chart stays still between short and long sessions (${tops.out.join(', ')})`, new Set(tops.out).size === 1, tops.out.join(', '));
  check('cut-off detail lines keep their full text on hover', tops.clipped);
  check('the date, value, sets and gym all fit above the chart', tops.fits);
  await chart.locator('.chart-readout a:has-text("Open workout")').click();
  await page.waitForSelector('.lift');
  check('Open workout goes to that session, with a way back to the exercise', /^#\/history\//.test(await page.evaluate(() => location.hash)) && (await page.textContent('.back')).trim() === liftName);
  await page.click('.back');
  await page.waitForSelector('.chart');
  check('and back returns to the exercise', (await page.evaluate(() => location.hash)) === exHash);
  // An older session, about 8 months ago, to give the ranges something to filter.
  const boot = await api('bootstrap');
  const when = new Date(Date.now() - 240 * 86400000).toISOString();
  const old = { id: crypto.randomUUID(), gym_id: boot.user.active_gym_id, day_type: 'push', status: 'completed', unit: 'lb', started_at: when, completed_at: when, rev: 1,
    exercises: [{ id: crypto.randomUUID(), exercise_id: exId, rep_min: 6, rep_max: 10, target_sets: 1, sets: [{ id: crypto.randomUUID(), weight: 95, reps: 10, done: true, done_at: when }] }] };
  const saved = await page.evaluate(async ([t, w]) => (await fetch('api.php?a=save_workout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ workout: w }) })).status, [boot.csrf, old]);
  await page.reload();
  await page.waitForSelector('.range .choice');
  const sessionsShown = async () => Number((await page.locator('h3', { hasText: /session/ }).textContent()).match(/\d+/)[0]);
  await page.click('.range .choice:has-text("All")');
  const allCount = await sessionsShown();
  await page.click('.range .choice:has-text("3 months")');
  const recentCount = await sessionsShown();
  check(`date ranges filter the charts and sessions (All ${allCount}, 3 months ${recentCount})`, saved === 200 && allCount === recentCount + 1);
  await page.click('.range .choice:has-text("1 year")');
  check('1 year includes the session from 8 months ago', (await sessionsShown()) === allCount && (await page.getAttribute('.range .choice:has-text("1 year")', 'aria-pressed')) === 'true');
  check('no sideways scrolling on the exercise page with the range control', (await overflow()) <= 0);
  await shot('10b-exercise-chart-tapped');
}
await shot('10-exercise');
const csv = await page.evaluate(async () => (await fetch('api.php?a=export', { credentials: 'same-origin' })).text());
check('CSV export downloads every set', csv.split('\n').filter(Boolean).length === 1 + setRows + l2rows + 1 + 1 && csv.startsWith('date_utc')); // + the older session added for the range check
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
check('a duplicate username is refused', /taken/.test(await page.locator('.form-error:not(:empty)').first().textContent()));
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
// Account requests with an invite token
await page.fill('input[name=invite_token]', 'crew-token-2026');
await page.click('button:has-text("Save invite token")');
await page.waitForFunction(() => /Requests are open/.test(document.querySelector('[data-invite]').textContent));
check('the admin can set an invite token, and the page never shows it back', !(await page.textContent('.page')).includes('crew-token-2026') && (await page.inputValue('input[name=invite_token]')) === '');
const applicant = `apply${Date.now() % 100000}`;
const guest = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
const gp = await guest.newPage();
await gp.goto(URL);
await gp.click('button:has-text("Request an account")');
await gp.fill('input[name=invite_token]', 'wrong-token-zzz');
await gp.fill('input[name=display_name]', 'New Lifter');
await gp.fill('input[name=username]', applicant);
await gp.fill('input[name=password]', 'my-own-password-1');
await gp.fill('input[name=password_again]', 'my-own-password-1');
await gp.click('button:has-text("Send request")');
await gp.waitForSelector('.form-error:not(:empty)');
check('a request with the wrong invite token is refused', /invite token is not right/.test(await gp.textContent('.form-error')), await gp.textContent('.form-error'));
await gp.fill('input[name=invite_token]', 'crew-token-2026');
await gp.fill('input[name=password_again]', 'different-password');
await gp.click('button:has-text("Send request")');
check('mismatched passwords are caught before sending', /do not match/.test(await gp.textContent('.form-error')));
await gp.fill('input[name=password_again]', 'my-own-password-1');
check('no sideways scrolling on the request form', (await gp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
if (SHOTS) await gp.screenshot({ path: `${SHOTS}/12a-request-account.png` });
await gp.click('button:has-text("Send request")');
await gp.waitForSelector('h1:has-text("Request sent")');
check('the right token sends the request', true);
await gp.click('button:has-text("Back to sign in")');
await gp.fill('input[name=username]', applicant);
await gp.fill('input[name=password]', 'my-own-password-1');
await gp.click('button[type=submit]');
await gp.waitForSelector('.form-error:not(:empty)');
check('the applicant cannot sign in before approval, and is told why', /waiting for the admin/.test(await gp.textContent('.form-error')));
await page.reload();
await page.waitForSelector(`[data-list=requests] .request:has-text("${applicant}")`);
check('the request shows up for the admin under Requests waiting', (await page.locator('[data-list=requests] .request').count()) === 1 && (await page.locator('[data-list=requests]').textContent()).includes('New Lifter'));
await shot('12b-requests-waiting');
await page.goto(`${URL}#/settings`);
await page.waitForSelector('.badge.alert');
check('Settings flags that a request is waiting', /1 waiting/.test(await page.textContent('.badge.alert')));
await page.goto(`${URL}#/settings/users`);
await page.waitForSelector('[data-list=requests] .request');
await page.click('[data-list=requests] button:has-text("Approve")');
await page.waitForSelector(`.log-row:has-text("${applicant}")`);
check('approving moves them into Accounts as a regular user', (await page.locator('[data-list=requests] .request').count()) === 0 && !(await page.locator(`.log-row:has-text("${applicant}")`).textContent()).includes('Admin'));
await gp.click('button[type=submit]');
await gp.waitForSelector('text=Where you train');
check('once approved, the applicant signs in with the password they chose', (await gp.textContent('h1')).includes('New Lifter'));
const gBoot = await gp.evaluate(async () => (await fetch('api.php?a=bootstrap', { credentials: 'same-origin' })).json());
const gDenied = await gp.evaluate(async (t) => (await fetch('api.php?a=set_invite_token', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ token: 'hijacked-token' }) })).status, gBoot.csrf);
check('an approved account is a regular user and cannot touch the invite token or requests', gBoot.user.role === 'user' && gDenied === 403);
await guest.close();
const secondApplicant = `apply${(Date.now() + 7) % 100000}b`;
const sent = await page.evaluate(async (u) => {
  const r = await fetch('api.php?a=request_account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'crew-token-2026', username: u, password: 'second-password-1' }) });
  return r.status;
}, secondApplicant);
await page.reload();
await page.waitForSelector(`[data-list=requests] .request:has-text("${secondApplicant}")`);
await page.click('[data-list=requests] button:has-text("Decline")');
await page.click('.sheet button:has-text("Decline request")');
await page.waitForFunction(() => document.querySelectorAll('[data-list=requests] .request').length === 0);
check('declining removes the request without creating an account', sent === 200 && (await page.locator(`.log-row:has-text("${secondApplicant}")`).count()) === 0);
await page.click('button:has-text("Stop taking requests")');
await page.click('.sheet button:has-text("Stop taking requests")');
await page.waitForFunction(() => /Requests are closed/.test(document.querySelector('[data-invite]').textContent));
const closed = await page.evaluate(async () => (await fetch('api.php?a=request_account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'crew-token-2026', username: 'toolate', password: 'too-late-password' }) })).status);
check('turning requests off stops the token working', closed === 403);

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

console.log('Sharing a workout');
const planOn = (pg) => pg.$$eval('.plan-row', (rows) => rows.map((r) => ({ name: r.querySelector('h3').textContent, target: r.querySelector('.target').textContent.trim() })));
const shape = (plan) => plan.map((x) => `${x.name}: ${x.target.replace(/ at .*/, '')}`).join(' | ');
await page.goto(`${URL}#/today`);
await page.waitForSelector('.plan-row');
await page.selectOption('select[aria-label="Workout type"]', 'push');
await page.waitForFunction((n) => [...document.querySelectorAll('.plan-row h3')].some((e) => e.textContent === n) && !document.querySelector('.stack.loading'), liftName);
const myPlan = await planOn(page);
await page.click('button[aria-label="Share this workout"]');
await page.waitForSelector('.share-row');
check('the share sheet lists the other people on the server, by name', (await page.locator('.share-row').count()) >= 1 && (await page.locator('.share-row', { hasText: 'Training Buddy' }).count()) === 1);
await page.locator('.share-row', { hasText: 'Training Buddy' }).locator('button:has-text("Send")').click();
await page.waitForSelector('.share-status.pending');
check('a planned workout can be sent to another person', true);
await shot('13-share-sheet');
await page.click('.sheet button:has-text("Close")');
const partner = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const pp = await partner.newPage();
await pp.goto(URL);
await pp.fill('input[name=username]', newUser);
await pp.fill('input[name=password]', 'buddy-password-1');
await pp.click('button[type=submit]');
await pp.waitForSelector('.share-card');
check('the other person sees it on Today, with who sent it', /Mike shared a workout with you/.test(await pp.textContent('.share-card')));
if (SHOTS) await pp.screenshot({ path: `${SHOTS}/14-share-incoming.png` });
await pp.click('.share-card button:has-text("Accept")');
await pp.waitForSelector('.shared-note');
await pp.waitForFunction(() => document.querySelectorAll('.plan-row').length > 0 && !document.querySelector('.stack.loading'));
const theirPlan = await planOn(pp);
check('accepting gives the same exercises, order and planned sets', shape(theirPlan) === shape(myPlan), `${shape(theirPlan)} <> ${shape(myPlan)}`);
check('weights are each person\'s own: the sender has suggestions from history, the new partner has none yet', myPlan.some((x) => / at \d/.test(x.target)) && theirPlan.every((x) => !/ at \d/.test(x.target)), JSON.stringify([myPlan[0], theirPlan[0]]));
check('a shared plan has no Lock, Swap or Regenerate, so it stays the same as the sender\'s', (await pp.locator('.plan-row button').count()) === 0 && (await pp.locator('button:has-text("Regenerate")').count()) === 0);
check('no sideways scrolling on the shared plan', (await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
if (SHOTS) await pp.screenshot({ path: `${SHOTS}/15-share-accepted.png` });
await pp.reload();
await pp.waitForSelector('.shared-note');
check('the accepted plan is still there after closing and reopening the app', shape(await planOn(pp)) === shape(myPlan));
await pp.click('button:has-text("Start workout")');
await pp.waitForSelector('.lift');
check('the partner\'s workout has the same exercises', (await pp.$$eval('.lift h2', (els) => els.map((e) => e.textContent))).join() === myPlan.map((x) => x.name).join());
const prow = pp.locator('.lift').first().locator('.set').first();
await prow.locator('input').nth(0).fill('45');
await prow.locator('input').nth(1).fill('8');
await prow.locator('.plate').click();
await pp.waitForSelector('#rest:not([hidden])');
await pp.click('#rest button:has-text("Skip")');
await pp.waitForSelector('#sync.saved');
await page.click('button[aria-label="Share this workout"]');
await page.waitForSelector('.share-status.started');
check('the sender can see that their partner has started', /Training now/.test(await page.locator('.share-row', { hasText: 'Training Buddy' }).textContent()));
await page.click('.sheet button:has-text("Close")');
await pp.click('button:has-text("Finish workout")');
await pp.click('.sheet button:has-text("Finish and save")');
await pp.waitForSelector('.plan-row');
check('after finishing, the partner is back to their own plan', (await pp.locator('.shared-note').count()) === 0 && (await pp.locator('.share-card').count()) === 0);
// #36: only the admin can share with the chatgpt account.
{
  const adminBoot = await api('bootstrap');
  const made = await page.evaluate(async (t) => (await fetch('api.php?a=create_user', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ username: 'chatgpt', display_name: 'ChatGPT', password: 'chatgpt-long-password' }) })).status, adminBoot.csrf);
  await page.click('button[aria-label="Share this workout"]');
  await page.waitForSelector('.share-row');
  check('the admin sees the chatgpt account in the share picker', made === 200 && (await page.locator('.share-row', { hasText: 'ChatGPT' }).count()) === 1);
  await page.click('.sheet button:has-text("Close")');
  await pp.click('button[aria-label="Share this workout"]');
  await pp.waitForSelector('.share-row');
  check('a regular user does not see the chatgpt account in the share picker', (await pp.locator('.share-row', { hasText: 'ChatGPT' }).count()) === 0 && (await pp.locator('.share-row', { hasText: 'Mike' }).count()) === 1);
  await pp.click('.sheet button:has-text("Close")');
  const gptId = (await page.evaluate(async () => (await (await fetch('api.php?a=people', { credentials: 'same-origin' })).json()).people)).find((p) => p.name === 'ChatGPT').id;
  const ppBoot = await pp.evaluate(async () => (await fetch('api.php?a=bootstrap', { credentials: 'same-origin' })).json());
  const refused = await pp.evaluate(async ([t, id]) => {
    const r = await fetch('api.php?a=share_workout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ share_key: crypto.randomUUID(), to: [id], plan: { day_type: 'push', exercises: [{ exercise_id: 1, target_sets: 3, rep_min: 6, rep_max: 10, rest_seconds: 90 }] } }) });
    return r.status;
  }, [ppBoot.csrf, gptId]);
  check('the server refuses a share from a regular user to chatgpt, even sent directly', refused === 422, String(refused));
}
await pp.click('.tab:has-text("History")');
await pp.waitForSelector('.log-row');
await pp.click('.log-row');
await pp.waitForSelector('[data-notes]');
const theirs2 = await pp.evaluate(async () => (await (await fetch('api.php?a=history', { credentials: 'same-origin' })).json()).workouts);
const mine2 = (await api('history')).workouts;
check('each person has their own history entry, with their own weights', theirs2.length === 1 && /Shared by Mike/.test(await pp.textContent('[data-notes]')) && !mine2.some((w) => w.id === theirs2[0].id) && (await pp.locator('.set input').first().inputValue()) === '45');
// Sharing from a workout already in progress, and declining.
await page.click('button:has-text("Start workout")');
await page.waitForSelector('.lift');
await page.click('button:has-text("Share this workout")');
await page.waitForSelector('.share-row');
await page.locator('.share-row', { hasText: 'Training Buddy' }).locator('button:has-text("Send again")').click();
await page.waitForSelector('.share-status.pending');
await page.click('.sheet button:has-text("Close")');
await pp.goto(`${URL}#/today`);
await pp.waitForSelector('.share-card');
check('a workout already in progress can be shared too', /Mike shared/.test(await pp.textContent('.share-card')));
await pp.click('.share-card button:has-text("Decline")');
await pp.waitForFunction(() => !document.querySelector('.share-card'));
await page.click('button:has-text("Share this workout")');
await page.waitForSelector('.share-status.declined');
check('declining removes it and the sender sees that', (await pp.locator('.shared-note').count()) === 0 && /Declined/.test(await page.locator('.share-row', { hasText: 'Training Buddy' }).textContent()));
await page.click('.sheet button:has-text("Close")');
await page.click('button:has-text("Finish workout")');
await page.click('.sheet button:has-text("Discard workout")');
await page.waitForSelector('.plan-row');
await partner.close();

await page.click('.tab:has-text("Settings")');
await page.waitForSelector('text=Add to your Home Screen');
check('settings include Home Screen instructions for Safari', (await page.textContent('.page')).includes('Tap the Share button'));
await shot('11-settings');
check('settings explain that the Home Screen icon only changes when the app is added again', /remove ThoeneFit from the Home Screen and add it again/.test(await page.textContent('.page')));
check('settings end with the app version', /^Version (dev|\d+\.\d+\.\d+(-staging)?)$/.test(await page.textContent('.page > :last-child')), await page.textContent('.page > :last-child'));

console.log("What's new");
await page.click('.app-version a');
await page.waitForSelector('h1:has-text("What\'s new")');
await page.waitForSelector('.page .card, .page p.pad:not(:has-text("Loading"))');
if (!process.env.TF_URL) {
  check('tapping the version opens What\'s new, which says notes come with a deploy when there are none', /Release notes are added when the app is deployed/.test(await page.textContent('.page')));
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const notesFile = new globalThis.URL('../web/changelog.json', import.meta.url);
  try {
    writeFileSync(notesFile, JSON.stringify({
      upcoming: { version: '0.1.5-staging', new: [{ title: 'Log cardio', pr: 9 }], fixed: [] },
      releases: [{ version: '0.1.4', date: '2026-11-15', new: [{ title: 'Save and reuse workout templates', pr: 7 }], fixed: [{ title: 'Fix graph labels being cut off', pr: 8 }] }],
    }));
    await page.reload();
    await page.waitForSelector('.page .card');
    const cards = await page.$$eval('.page .card', (els) => els.map((el) => el.innerText));
    check('upcoming work is listed first, then each release with New and Fixed', cards.length === 2 && /Coming next · 0\.1\.5-staging/.test(cards[0]) && /Log cardio/.test(cards[0]) && /0\.1\.4 · Nov 15, 2026/.test(cards[1]) && /New\s+Save and reuse workout templates/.test(cards[1]) && /Fixed\s+Fix graph labels being cut off/.test(cards[1]), cards.join(' | '));
    await shot('12-whats-new');
  } finally {
    unlinkSync(notesFile);
  }
} else {
  check('tapping the version opens What\'s new', (await page.textContent('h1')) === "What's new");
}
await page.click('a:has-text("Settings")');
await page.waitForSelector('text=Add to your Home Screen');

console.log('Saved routines');
{
  // Save a past workout (it includes the lift with history) as a routine.
  await page.goto(`${URL}#/history`);
  await page.waitForSelector('.log-row');
  await page.locator('.log-row', { hasText: liftName }).first().click();
  await page.waitForSelector('.lift');
  const pastNames = await page.$$eval('.lift h2', (els) => els.map((e) => e.textContent));
  await page.click('button:has-text("Save as routine")');
  await page.waitForSelector('input[name=routine_name]');
  check('saving a past workout as a routine suggests a name', (await page.inputValue('input[name=routine_name]')).length > 0 && (await page.textContent('.sheet button[type=submit]')) === 'Save routine');
  await page.fill('input[name=routine_name]', 'Monday Push');
  await page.click('.sheet button[type=submit]');
  await waitForToast(page, /Saved Monday Push/);
  check('the routine is saved', true);

  // Start a fresh session from it on Today.
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('.plan-row');
  const options = await page.$$eval('select[aria-label="Workout type"] optgroup[label="Your routines"] option', (els) => els.map((e) => e.textContent));
  check('Today lists the routine under Workout', options.includes('Monday Push'), options.join(', '));
  await page.selectOption('select[aria-label="Workout type"]', { label: 'Monday Push' });
  await page.waitForSelector('.routine-note');
  await page.waitForFunction(() => !document.querySelector('.stack.loading') && document.querySelectorAll('.plan-row').length > 0);
  const routineRows = await page.$$eval('.plan-row', (rows) => rows.map((r) => ({ name: r.querySelector('h3').textContent, last: r.querySelector('.last').textContent, target: r.querySelector('.target').textContent })));
  check('picking it loads the same exercises in the same order', routineRows.map((r) => r.name).join() === pastNames.join(), routineRows.map((r) => r.name).join() + ' <> ' + pastNames.join());
  const liftRow = routineRows.find((r) => r.name === liftName);
  check(`each exercise shows the last logged weight and reps (${liftRow && liftRow.last})`, !!liftRow && /^Last: \d+ lb × /.test(liftRow.last) && / at \d+ lb/.test(liftRow.target));
  check('a routine plan has no Regenerate, Lock or Swap', (await page.locator('button:has-text("Regenerate")').count()) === 0 && (await page.locator('.plan-row button').count()) === 0);
  check('no sideways scrolling with a routine on Today', (await overflow()) <= 0);
  await shot('23-routine-on-today');
  await page.click('button:has-text("Save changes to this routine")');
  await page.waitForSelector('input[name=routine_name]');
  check('saving again under the same name offers to replace it', (await page.inputValue('input[name=routine_name]')) === 'Monday Push' && (await page.textContent('.sheet button[type=submit]')) === 'Replace routine');
  await page.click('.sheet button:has-text("Close")');
  await page.click('button:has-text("Start workout")');
  await page.waitForSelector('.lift');
  check('starting it gives a fresh session with those exercises', (await page.$$eval('.lift h2', (els) => els.map((e) => e.textContent))).join() === pastNames.join() && (await page.locator('.set.done').count()) === 0);
  await page.goto(`${URL}#/today`);
  await page.click('button:has-text("Discard workout")');
  await page.click('.sheet button:has-text("Discard workout")');
  await page.waitForSelector('.plan-row');
  check('afterwards Today goes back to a suggested workout', (await page.locator('.routine-note').count()) === 0);

  // Rename and delete in Settings.
  await page.goto(`${URL}#/settings`);
  await page.waitForSelector('[data-list=routines] .routine-row');
  await page.locator('.routine-row', { hasText: 'Monday Push' }).locator('button:has-text("Rename")').click();
  await page.fill('.sheet input[name=routine_name]', 'Push A');
  await page.click('.sheet button:has-text("Rename")');
  await page.waitForSelector('.routine-row[data-routine="Push A"]');
  check('a routine can be renamed in Settings', (await page.locator('.routine-row').count()) === 1);
  await page.locator('[data-list=routines]').scrollIntoViewIfNeeded();
  await shot('24-settings-routines');
  await page.locator('.routine-row', { hasText: 'Push A' }).locator('button:has-text("Delete")').click();
  await page.click('.sheet button:has-text("Delete routine")');
  await page.waitForFunction(() => !document.querySelector('.routine-row'));
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('.plan-row');
  check('and deleted, after which Today no longer lists it', (await page.locator('select[aria-label="Workout type"] optgroup[label="Your routines"]').count()) === 0);
  // Leave things as the next block expects: on Settings, with no toast showing.
  await page.goto(`${URL}#/settings`);
  await page.waitForSelector('text=Add to your Home Screen');
  await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 8000 });
}

console.log('Staying up to date');
if (!process.env.TF_URL) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const versionFile = new globalThis.URL('../web/version.json', import.meta.url); // URL is the server address here
  const original = readFileSync(versionFile, 'utf8');
  const cachedStamp = await page.evaluate(async () => {
    for (const k of await caches.keys()) {
      if ((await (await caches.open(k)).keys()).some((r) => r.url.endsWith('/version.json'))) return true;
    }
    return false;
  });
  check('the build stamp is never saved by the service worker', cachedStamp === false);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(500);
  check('reopening the app with no new deploy does not reload it', (await page.locator('.toast.show').count()) === 0 && (await page.locator('text=Add to your Home Screen').count()) === 1);
  try {
    writeFileSync(versionFile, '{"build":"e2e-new-build"}\n');
    await Promise.all([page.waitForEvent('load'), page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))]);
    await waitForToast(page, /ThoeneFit was updated/).catch(() => {});
    check('after a deploy, reopening the app reloads it and says so', /ThoeneFit was updated/.test(await page.textContent('.toast')));
  } finally {
    writeFileSync(versionFile, original);
  }
  await page.waitForSelector('.tabs');
  await page.goto(`${URL}#/settings`);
  await page.waitForSelector('text=Add to your Home Screen');
}
if (!process.env.TF_URL) {
  console.log('Default library');
  // The admin adds an exercise of their own, it is moved into the default library, and another account can see it.
  await page.goto(`${URL}#/exercises/new`);
  await page.waitForSelector('form');
  await page.fill('form input[type=text]', 'Landmine Press Special');
  await page.locator('fieldset, .field', { hasText: 'Primary muscles' }).locator('label:has-text("Shoulders")').first().click();
  await page.click('button:has-text("Add exercise")');
  await page.waitForSelector('h1:has-text("Landmine Press Special")');
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync('php', ['web/private/bin/promote-exercises.php', USER], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  check(`the move command reports what it did (${out.trim().split('\n')[0]})`, /Moved 1 exercise/.test(out));
  const other = await browser.newContext();
  const op = await other.newPage();
  await op.goto(URL);
  await op.fill('input[name=username]', newUser);
  await op.fill('input[name=password]', 'buddy-password-1');
  await op.click('button[type=submit]');
  await op.waitForSelector('.tabs');
  await op.goto(`${URL}#/exercises`);
  await op.fill('input[type=search]', 'landmine');
  await op.waitForSelector('.log-row:has-text("Landmine Press Special")');
  check('another account now finds the exercise in the library, not marked as someone\'s own', !(await op.locator('.log-row:has-text("Landmine Press Special")').textContent()).includes('Yours'));
  await op.click('.log-row:has-text("Landmine Press Special")');
  await op.waitForSelector('.facts');
  check('a regular account cannot edit it', (await op.locator('a:has-text("Edit exercise")').count()) === 0 && /Added to the default library/.test(await op.textContent('.page')));
  await other.close();
  await page.reload();
  await page.waitForSelector('h1:has-text("Landmine Press Special")');
  check('the admin can still edit it', (await page.locator('a:has-text("Edit exercise")').count()) === 1);
}
if (!process.env.TF_URL) {
  console.log('Changing a password');
  // The buddy account signs in on two "devices", changes its password on one, and the other is signed out.
  const signIn = async (ctx) => {
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.fill('input[name=username]', newUser);
    await p.fill('input[name=password]', 'buddy-password-1');
    await p.click('button[type=submit]');
    await p.waitForSelector('.tabs');
    return p;
  };
  const phoneCtx = await browser.newContext();
  const laptopCtx = await browser.newContext();
  const phone = await signIn(phoneCtx);
  const laptop = await signIn(laptopCtx);
  await phone.goto(`${URL}#/settings`);
  await phone.fill('input[autocomplete=current-password]', 'buddy-password-1');
  await phone.fill('input[autocomplete=new-password]', 'buddy-password-3');
  await phone.click('button:has-text("Change password")');
  await waitForToast(phone, /Password changed/).catch(() => {});
  check('changing the password says other devices are signed out', /Other devices are signed out/.test(await phone.textContent('.toast')));
  // The device that made the change keeps working: a write needs its new session and security token.
  await phone.goto(`${URL}#/exercises/new`);
  await phone.waitForSelector('form');
  await phone.fill('form input[type=text]', 'Password Change Curl');
  await phone.locator('fieldset, .field', { hasText: 'Primary muscles' }).locator('label:has-text("Biceps")').first().click();
  await phone.click('button:has-text("Add exercise")');
  await phone.waitForSelector('h1:has-text("Password Change Curl")', { timeout: 5000 }).catch(() => {});
  check('the device that changed it can still save changes without signing in again', (await phone.locator('h1:has-text("Password Change Curl")').count()) === 1 && (await phone.locator('input[name=password]').count()) === 0);
  await laptop.reload();
  await laptop.waitForSelector('input[name=password]', { timeout: 5000 }).catch(() => {});
  check('the other device is signed out', (await laptop.locator('input[name=password]').count()) === 1 && (await laptop.locator('.tabs').count()) === 0);
  await laptop.fill('input[name=username]', newUser);
  await laptop.fill('input[name=password]', 'buddy-password-1');
  await laptop.click('button[type=submit]');
  await laptop.waitForSelector('.form-error');
  await laptop.fill('input[name=password]', 'buddy-password-3');
  await laptop.click('button[type=submit]');
  await laptop.waitForSelector('.tabs', { timeout: 5000 }).catch(() => {});
  check('it can sign back in with the new password, not the old one', (await laptop.locator('.tabs').count()) === 1);
  await phoneCtx.close();
  await laptopCtx.close();
}

if (!process.env.TF_URL) {
  console.log('Cardio warm-up');
  // #18: tick a stationary bike at the gym, ask for a warm-up, and log it.
  await page.goto(`${URL}#/settings`);
  await page.click('.log-row:has(.badge:has-text("Selected"))');
  await page.click('label.check:has-text("Stationary bike")');
  await page.click('button:has-text("Save gym")');
  await page.waitForSelector('.toast.show');
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('.plan-row');
  const warmBox = page.locator('label.check:has-text("Include a warm-up") input');
  check('with a cardio machine at the gym, Today offers Include a warm-up, unticked at first', (await warmBox.count()) === 1 && !(await warmBox.isChecked()));
  await warmBox.click();
  await page.waitForFunction(() => document.querySelector('.plan-row h3')?.textContent === 'Stationary Bike' && !document.querySelector('.stack.loading'));
  check('ticking it starts the plan with a 10 minute bike warm-up', (await page.textContent('.plan-row .target')) === '10 min warm-up' && /^Warm-up and \d+ exercises/.test(await page.textContent('.summary')));
  await shot('13-warm-up-plan');
  await page.click('button:has-text("Start workout")');
  await page.waitForSelector('.lift');
  const bikeCard = page.locator('.lift').first();
  check('the warm-up is logged as minutes, distance and level, not weight and reps', (await bikeCard.locator('h2').textContent()) === 'Stationary Bike' && /Min\s*mi\s*Level/.test(await bikeCard.locator('.set-head').innerText()) && (await bikeCard.locator('.set input').first().inputValue()) === '10');
  await bikeCard.locator('.set input').nth(0).fill('12');
  await bikeCard.locator('.set input').nth(1).fill('1.8');
  await bikeCard.locator('.set input').nth(2).fill('9');
  await bikeCard.locator('.plate').click();
  check('completing it starts no rest timer', (await bikeCard.locator('.plate').getAttribute('aria-pressed')) === 'true' && await page.locator('#rest').isHidden());
  await shot('14-warm-up-logged');
  await page.waitForFunction(() => document.querySelector('#sync')?.textContent === 'Saved');
  const active = (await page.evaluate(async () => (await fetch('api.php?a=bootstrap', { credentials: 'same-origin' })).json())).active;
  const bikeSet = active.exercises[0].sets[0];
  check('the server has the time, distance in metres and level', bikeSet.duration_s === 720 && Math.abs(bikeSet.distance_m - 2896.8) < 0.2 && bikeSet.level === 9 && bikeSet.reps === null, JSON.stringify(bikeSet));
  await page.reload();
  await page.waitForSelector('.lift');
  check('after a reload, the warm-up still shows what was logged', (await page.locator('.lift').first().locator('.set input').nth(1).inputValue()) === '1.8');

  console.log('Estimated calories');
  // #38: no body weight, no effort question. Add one in Settings, finish, and see the estimate.
  await page.click('button:has-text("Finish workout")');
  await page.waitForSelector('.sheet button:has-text("Finish and save")');
  check('without a body weight, finishing does not ask how hard it was', (await page.locator('.sheet :text("How hard was it?")').count()) === 0);
  await page.click('.sheet button:has-text("Close")');
  await page.goto(`${URL}#/settings`);
  const bw = page.locator('input[aria-label^="Body weight"]');
  await bw.fill('180');
  await bw.press('Tab');
  await waitForToast(page, /Body weight saved/);
  check('body weight is saved from Settings', (await bw.inputValue()) === '180');
  await page.goto(`${URL}#/workout`);
  await page.waitForSelector('.lift');
  await page.click('button:has-text("Finish workout")');
  await page.waitForSelector('.sheet :text("How hard was it?")');
  check('finishing now asks how hard it was, starting at Moderate', (await page.locator('.sheet .choice[aria-pressed="true"]').textContent()).trim() === 'Moderate');
  await page.click('.sheet .choice:has-text("Hard")');
  await shot('15-finish-effort');
  await page.click('.sheet button:has-text("Finish and save")');
  await page.waitForSelector('.plan-row, .page-head');
  await page.waitForFunction(() => document.querySelector('#sync') === null || document.querySelector('#sync').textContent === 'Saved');
  await page.goto(`${URL}#/history`);
  await page.waitForSelector('.log-row');
  await page.click('.log-row');
  await page.waitForSelector('.calories');
  // This test workout lasted seconds, so there is no estimate, and History says why.
  check('History explains when a workout is too short for an estimate', /under a minute/.test(await page.textContent('.calories')), await page.textContent('.calories'));
  check('a panel with nothing to show leaves no stray text behind', !/(^|\s)null(\s|$)/.test(await page.textContent('.page')));
  await shot('16-history-calories');
}

for (const [w, hgt, label] of [[375, 667, 'iPhone SE'], [393, 852, 'iPhone 16'], [440, 956, 'iPhone Pro Max'], [412, 915, 'Pixel']]) {
  await page.setViewportSize({ width: w, height: hgt });
  let worst = 0;
  for (const tab of ['today', 'history', 'trends', 'exercises', 'settings']) {
    await page.goto(`${URL}#/${tab}`);
    await page.waitForSelector('.tabs');
    await page.waitForTimeout(250);
    worst = Math.max(worst, await overflow());
  }
  check(`no sideways scrolling at ${w}px (${label})`, worst <= 0, `${worst}px`);
}
console.log('Sign out and clear local data');
{
  await page.setViewportSize({ width: 402, height: 874 });
  const myId = (await api('bootstrap')).user.id;
  const keys = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tf.')).sort());
  await page.goto(`${URL}#/settings`);
  await page.waitForSelector('button:has-text("Sign out and clear this device")');
  await page.click('button:has-text("Sign out and clear this device")');
  await page.waitForSelector('.sheet');
  check('with everything synced, it asks plainly and says synced workouts stay on the server', /Sign out and clear this device\?/.test(await page.textContent('.sheet h2')) && /stays on the server/.test(await page.textContent('.sheet')));
  await page.click('.sheet button:has-text("Close")');

  // A workout whose saves cannot reach the server, so it is only on this phone.
  await page.route('**/api.php?a=save_workout*', (r) => r.abort());
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('button:has-text("Start workout")');
  await page.click('button:has-text("Start workout")');
  await page.waitForSelector('.lift');
  await page.evaluate(() => localStorage.setItem('tf.stravaOnFinish', JSON.stringify({ send: true })));
  await page.waitForFunction(() => document.querySelector('#sync') && document.querySelector('#sync').textContent !== 'Saved');
  const before = await keys();
  check('the unsynced workout, profile and choices are on the device', [`tf.docs.${myId}`, 'tf.boot', 'tf.stravaOnFinish'].every((k) => before.includes(k)), before.join());
  await page.goto(`${URL}#/settings`);
  await page.click('button:has-text("Sign out and clear this device")');
  await page.waitForSelector('.sheet');
  check('with unsynced changes, it warns they will be discarded', /have not synced/.test(await page.textContent('.sheet h2')) && /deletes them for good/.test(await page.textContent('.sheet')));
  await shot('24-sign-out-clear-unsynced');
  await page.click('.sheet button:has-text("Close")');
  check('cancelling keeps you signed in with the workout still on the device', (await page.locator('.tabs').count()) === 1 && (await keys()).includes(`tf.docs.${myId}`));
  await page.click('button:has-text("Sign out and clear this device")');
  await page.click('.sheet button:has-text("Discard changes, sign out and clear")');
  await page.waitForSelector('input[name=username]');
  await page.unroute('**/api.php?a=save_workout*');
  await page.waitForTimeout(2500);
  const after = await keys();
  check('signing out cleared the workouts, profile, rest timer and Strava choice', ![`tf.docs.${myId}`, 'tf.boot', 'tf.rest', 'tf.stravaOnFinish'].some((k) => after.includes(k)), after.join());
  check('device-wide choices like the install reminder are kept', after.includes('tf.install'));
  check('the server session is ended too', (await page.evaluate(async () => (await fetch('api.php?a=history', { credentials: 'same-origin' })).status)) === 401);
  await shot('25-signed-out-cleared');
  await page.fill('input[name=username]', USER);
  await page.fill('input[name=password]', PASS);
  await page.click('button[type=submit]');
  await page.waitForSelector('.tabs');
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('button:has-text("Start workout"), button:has-text("Resume workout"), a:has-text("Resume workout")');
  check('signing back in works, and the discarded workout did not come back', (await page.locator(':text("Resume workout")').count()) === 0);
  check('the synced history is still on the server', (await api('history')).workouts.length > 0);
}

check('no script errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
