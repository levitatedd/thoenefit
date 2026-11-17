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
// Finishing shows a recap sheet (#123). Waits for it to finish loading, closes it, and returns its text.
const closeRecap = async (pg) => {
  await pg.waitForSelector('.sheet h2:has-text("Workout saved")');
  await pg.waitForFunction(() => !/Checking for new records/.test(document.querySelector('.sheet')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
  const text = await pg.textContent('.sheet');
  await pg.click('.sheet button:has-text("Close")');
  return text;
};
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
{
  const colour = (sel) => page.$eval(sel, (el) => getComputedStyle(el).color);
  check('Today\'s heading and planned exercise names are mint', (await colour('.today-head h1')) === 'rgb(58, 242, 156)' && (await colour('.plan-row .name-link')) === 'rgb(58, 242, 156)');
}

// The wide logo sits top right on Today, beside the heading.
const order = await page.evaluate(() => {
  const h1 = document.querySelector('.today-head h1').getBoundingClientRect();
  const img = document.querySelector('.today-head img.brand-wide');
  const logo = img && img.getBoundingClientRect();
  return logo ? [logo.left > h1.right, logo.right <= window.innerWidth, logo.top < h1.bottom, img.complete && img.naturalWidth > 0, document.querySelectorAll('.page img.brand-wide').length] : null;
});
check('on Today, the wide logo sits top right beside the heading, and only there', !!order && order.slice(0, 4).every(Boolean) && order[4] === 1, JSON.stringify(order));
check('Recovery estimate is no longer on Today', !(await page.textContent('.page')).includes('Recovery estimate'));
// Scroll the page so the name sits mid-screen, clear of the action bar, and note the spot.
// (A fixed scroll position put it behind the bar with some fonts, so the tap scrolled first, #217.)
const y0 = await page.evaluate(() => { document.querySelector('.plan-row:nth-child(3) h3 a').scrollIntoView({ block: 'center' }); return window.scrollY; });
await page.click('.plan-row:nth-child(3) h3 a');
await page.waitForSelector('.facts');
check(`tapping an exercise name on Today opens its history (${first[2]})`, (await page.textContent('h1')) === first[2] && (await page.locator('.section h2:has-text("History")').count()) === 1);
check('the way back is labelled Today', (await page.textContent('.back')).trim() === 'Today');
await shot('03a-history-from-today');
await page.click('.back');
await page.waitForSelector('.plan-row');
{
  const back = { names: (await names()).join(), y: await page.evaluate(() => window.scrollY) };
  check('going back returns to the same planned workout at the same spot', back.names === first.join() && Math.abs(back.y - y0) < 5, JSON.stringify({ ...back, first: first.join(), y0 }));
}
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
check('during a workout the exercise names stay white, so green still means done', (await page.$eval('.lift .name-link', (el) => getComputedStyle(el).color)) === 'rgb(244, 242, 236)');
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
await page.waitForSelector('text=Back to workout');
check('Today offers a way back to the unfinished workout', true);
await shot('06-resume');
await page.click('a.btn:has-text("Back to workout")');
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
// The signed-in user's display name, so checks don't depend on how the e2e user was created (#178).
const myName = boot.user.display_name;
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
{
  await page.waitForSelector('.sheet h2:has-text("Workout saved")');
  check('finishing shows a recap with the working sets, straight away (#123)', /\d+ working sets? (logged|across)/.test(await page.textContent('.sheet')));
  await page.waitForSelector('.sheet .recap', { timeout: 20000 });
  check('once synced, a first workout lists its lifts as first logged results, not records', /First logged/.test(await page.textContent('.sheet')) && (await page.locator('.sheet .badge.record').count()) === 0 && (await page.locator('.sheet .recap-first a.recap-name').count()) > 0);
  await shot('07c-recap-first');
  await page.click('.sheet button:has-text("Close")');
}
for (let i = 0; i < 40 && !finishSave; i++) await page.waitForTimeout(250);
page.off('request', watchSave);
await context.unroute('**/api.php?a=bootstrap*', connected);
check('the finished workout carries the Strava request to the server',
  finishSave?.strava_send?.include_summary === true && Number.isInteger(finishSave?.strava_send?.utc_offset), JSON.stringify(finishSave?.strava_send));
// #103: Strava lives under Settings → Integrations.
await page.goto(`${URL}#/settings`);
await page.waitForSelector('.settings-main');
check('a connected Strava shows under Integrations', /Connected/.test(await page.textContent('.link-row:has-text("Strava")')));
await page.click('.link-row:has-text("Strava")');
await page.waitForSelector('button:has-text("Disconnect Strava")');
check('the Strava screen offers Disconnect', true);
await page.goto(`${URL}#/today`);
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
await page.click('a.tab[href="#/today"]');
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
  await ip.goto(`${URL}#/settings/install`);
  await ip.waitForSelector('.install-help h3');
  const firstGuide = await ip.locator('.install-help h3').first().textContent();
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
// #166: Recovery estimate as Pick muscle groups tiles, each opening its details.
{
  const tiles = await page.$$eval('.recovery-card .muscle-tile', (ts) => ts.map((t) => [t.dataset.muscle, t.querySelector('.muscle-pct').textContent, !!t.querySelector('img'), t.classList.contains('tired')]));
  check('Recovery estimate shows a tile for every muscle group, with its illustration and percentage, most recovered first (#166)', tiles.length === 13 && tiles.every(([, p, img]) => /^\d+%/.test(p) && img) && tiles.map(([, p]) => parseInt(p, 10)).every((v, i, a) => i === 0 || a[i - 1] >= v), JSON.stringify(tiles));
  check('below 50% the tile says it is still recovering', tiles.every(([, p, , tired]) => (parseInt(p, 10) < 50) === tired && (tired ? /recovering/.test(p) : true)));
  const last = (await page.evaluate(async () => (await (await fetch(`api.php?a=trends&timezone=UTC`)).json()).muscle_last));
  const trained = Object.keys(last)[0];
  await page.click(`.recovery-card .muscle-tile[data-muscle="${trained}"]`);
  await page.waitForSelector('.sheet .muscle-detail');
  const sheetText = await page.textContent('.sheet');
  check('tapping a trained muscle shows its recovery, when it was last trained, the exercises and a link to the workout', /%/.test(sheetText) && /Last trained/.test(sheetText) && last[trained].exercises.every((n) => sheetText.includes(n)) && (await page.getAttribute('.sheet a:has-text("Open workout")', 'href')) === `#/history/${last[trained].workout_id}`, sheetText.slice(0, 200));
  await shot('19-trends-muscle');
  await page.click('.sheet button:has-text("Close")');
  const untrained = tiles.map(([m]) => m).find((m) => !last[m]);
  if (untrained) {
    await page.click(`.recovery-card .muscle-tile[data-muscle="${untrained}"]`);
    await page.waitForSelector('.sheet .muscle-detail');
    check('a muscle with no recent training still opens, showing just its estimate', /No training logged/.test(await page.textContent('.sheet')) && (await page.locator('.sheet a:has-text("Open workout")').count()) === 0);
    await page.click('.sheet button:has-text("Close")');
  }
}
// #184: the line under the title picks the range, and it is remembered.
{
  const range = page.locator('main > .top-head select.trends-range');
  check('the Trends range is the line under the title, starting at Last 8 weeks (#184)', (await range.evaluate((s) => s.selectedOptions[0].textContent)) === 'Last 8 weeks' && (await range.locator('option').allTextContents()).join() === 'Last 8 weeks,Last month,Last 2 months,Last 3 months,Last 6 months,Last year');
  await range.selectOption('52');
  await page.waitForSelector('h2:has-text("Monthly lifting volume")');
  const year = await page.evaluate(async () => (await (await fetch('api.php?a=trends&timezone=UTC&weeks=52')).json()).weeks.length);
  check('Last year covers 52 weeks, shown by month', year === 52 && (await page.locator('h2:has-text("Monthly workout time")').count()) === 1);
  await page.reload();
  await page.waitForSelector('h2:has-text("Monthly lifting volume")');
  check('the chosen range is still there after reopening the app', (await page.locator('main > .top-head select.trends-range').evaluate((s) => s.selectedOptions[0].textContent)) === 'Last year');
  await page.locator('main > .top-head select.trends-range').selectOption('8');
  await page.waitForSelector('h2:has-text("Weekly lifting volume")');
  check('the server only accepts the offered ranges', (await page.evaluate(async () => (await (await fetch('api.php?a=trends&timezone=UTC&weeks=1000')).json()).weeks.length)) === 8);
}
check('Trends is highlighted in the tab bar', (await page.getAttribute('.tab:has-text("Trends")', 'aria-current')) === 'page');
check('no sideways scrolling on Trends', (await overflow()) <= 0);

console.log('Pinned exercises (#126)');
{
  const pinned = () => page.$$eval('.pinned-card .log-title', (els) => els.map((e) => e.textContent));
  check('with nothing pinned, Trends says how to pin', (await pinned()).length === 0 && /Pin up to 5 exercises/.test(await page.textContent('.pinned-card')));
  await page.goto(`${URL}#/exercises`);
  await page.fill('input[type=search]', liftName.slice(0, 12));
  await page.click(`.log-row:has-text("${liftName}")`);
  await page.waitForSelector('.pin-btn');
  await page.click('.pin-btn');
  await page.waitForFunction(() => document.querySelector('.pin-btn')?.getAttribute('aria-pressed') === 'true');
  check('an exercise page pins it to Trends', /Pinned to Trends/.test(await page.textContent('.pin-btn')));
  await page.click('.tab:has-text("Trends")');
  await page.waitForSelector('.pinned-card .log-row');
  const row = await page.textContent('.pinned-card .log-row');
  check('Trends shows the pinned exercise with its latest result, opening its chart', row.includes(liftName) && /× \d+/.test(row) && /\/exercises\/\d+$/.test(await page.getAttribute('.pinned-card .log-row', 'href')), row);
  await shot('19b-trends-pinned');
  // Fill up to five, then try a sixth from its page.
  const ids = await page.evaluate(async (n) => {
    const b = await (await fetch('api.php?a=bootstrap')).json();
    const others = b.exercises.filter((x) => x.name !== n && !x.archived).slice(0, 5);
    for (const x of others.slice(0, 4)) await fetch('api.php?a=pin_exercise', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify({ exercise_id: x.id, pinned: true }) });
    return others.map((x) => x.id);
  }, liftName);
  const refused = await page.evaluate(async (id) => {
    const b = await (await fetch('api.php?a=bootstrap')).json();
    return (await fetch('api.php?a=pin_exercise', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify({ exercise_id: id, pinned: true }) })).status;
  }, ids[4]);
  check('the server refuses a sixth pin', refused === 409, String(refused));
  await page.goto(`${URL}#/exercises/${ids[4]}`);
  await page.reload();
  await page.waitForSelector('.pin-btn');
  await page.click('.pin-btn');
  await page.waitForSelector('.sheet:has-text("Unpin one first")');
  check('pinning a sixth asks which to unpin first', (await page.locator('.sheet .pin-swap').count()) === 5);
  await page.locator('.sheet .pin-swap').first().locator('button:has-text("Unpin")').click();
  await page.waitForFunction(() => document.querySelector('.pin-btn')?.getAttribute('aria-pressed') === 'true');
  const pins = (await page.evaluate(async () => (await (await fetch('api.php?a=pins')).json()).pins)).map((p) => p.exercise_id);
  check('unpinning one makes room, and the new one is pinned', pins.length === 5 && pins.includes(ids[4]), JSON.stringify(pins));
  // Leave nothing pinned for the rest of the walk-through.
  await page.evaluate(async (list) => {
    const b = await (await fetch('api.php?a=bootstrap')).json();
    for (const id of list) await fetch('api.php?a=pin_exercise', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify({ exercise_id: id, pinned: false }) });
  }, pins);
}

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
check('exercise page shows form cues and a trend', (await page.locator('.cues').count()) === 1 && (await page.locator('.chart').count()) >= 2);
// #202: the exercise page uses the pinned header: back link left, name right, no logo.
{
  const head = await page.evaluate(() => {
    const hd = document.querySelector('main > .top-head');
    const back = hd?.querySelector('.detail-back a.back');
    const title = hd?.querySelector('.detail-title');
    return hd && { back: back?.textContent.trim(), backLeft: Math.round(back.getBoundingClientRect().left), title: title?.textContent, titleRight: Math.round(innerWidth - title.getBoundingClientRect().right), titleColor: getComputedStyle(title).color, logo: !!hd.querySelector('img.brand-wide'), h1s: document.querySelectorAll('h1').length, height: Math.round(hd.getBoundingClientRect().height), position: getComputedStyle(hd).position };
  });
  check('the exercise page pins the back link on the left and the exercise name on the right, once, with no logo (#202)', head && head.back === 'Exercises' && head.title === liftName && head.backLeft < 40 && head.titleRight < 40 && head.titleColor === 'rgb(58, 242, 156)' && !head.logo && head.h1s === 1 && head.position === 'sticky', JSON.stringify(head));
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(250);
  check('the header stays at the top while the history scrolls under it', await page.evaluate(() => Math.round(document.querySelector('main > .top-head').getBoundingClientRect().top) === 0 && !!document.querySelector('main > .top-head .detail-title')));
  await page.evaluate(() => window.scrollTo(0, 0));
  const sub = await page.$$eval('.exercise-page .section > h2, .chart-card > h3, .session-count', (els) => els.map((e) => [e.textContent, getComputedStyle(e).color]));
  check('section headings, chart titles and the session count are mint', sub.length >= 5 && sub.every(([, c]) => c === 'rgb(58, 242, 156)'), JSON.stringify(sub));
  const cards = await page.$$eval('.chart-card', (cs) => cs.map((c) => ({ title: c.querySelector('h3').textContent, chart: !!c.querySelector('.chart svg'), readout: !!c.querySelector('.chart-readout'), bg: getComputedStyle(c).backgroundColor, radius: getComputedStyle(c).borderTopLeftRadius })));
  const gap = await page.evaluate(() => { const c = [...document.querySelectorAll('.chart-card')]; return c.length > 1 ? Math.round(c[1].getBoundingClientRect().top - c[0].getBoundingClientRect().bottom) : 0; });
  check('Top weight, Best reps and Estimated 1-rep max each sit in their own rounded card, with a gap', ['Top weight', 'Best reps at top weight', 'Estimated 1-rep max'].every((t) => cards.some((c) => c.title === t && c.chart && c.readout && c.bg === 'rgb(27, 32, 39)' && c.radius === '16px')) && gap > 0, JSON.stringify({ cards, gap }));
  check('the session count comes after the chart cards', await page.evaluate(() => { const n = document.querySelector('.session-count'); const last = [...document.querySelectorAll('.chart-card')].pop(); return !!(n && last && (last.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)); }));
  const p1 = await page.evaluate(() => { const v = document.querySelector('.p1rm-value'); return v && !v.closest('[hidden]') ? [v.previousElementSibling.textContent, v.textContent] : null; });
  const latestDate = await page.evaluate(async (name) => {
    const { bestEstimate } = await import('./js/strength.js');
    const ex = (await (await fetch('api.php?a=bootstrap')).json()).exercises.find((x) => x.name === name);
    const { sessions } = await (await fetch(`api.php?a=exercise_history&id=${ex.id}`)).json();
    const key = sessions[sessions.length - 1].variant_key;
    const s = [...sessions].reverse().find((x) => x.variant_key === key && bestEstimate(x.sets, ex));
    return new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }, liftName);
  check('under Secondary muscles, "P1RM as of:" shows the date of the workout the estimate comes from', !!p1 && p1[0].startsWith('P1RM as of:') && p1[0].includes(latestDate) && /^\d[\d,]* (lb|kg)$/.test(p1[1]) && (await page.evaluate(() => document.querySelector('.p1rm-value').closest('.facts-row').previousElementSibling.previousElementSibling.textContent)) === 'Secondary muscles', JSON.stringify([p1, latestDate]));
}
// #162: estimated 1-rep max per session, from the best working set of 10 reps or fewer.
{
  const exId = Number((await page.evaluate(() => location.hash)).split('/').pop());
  const expected = await page.evaluate(async (id) => {
    const { bestEstimate, estimateLabel } = await import('./js/strength.js');
    const { sessions } = await (await fetch(`api.php?a=exercise_history&id=${id}`)).json();
    const ex = (await (await fetch('api.php?a=bootstrap')).json()).exercises.find((x) => x.id === id);
    return sessions.map((s) => { const e = bestEstimate(s.sets, ex); return e && `${estimateLabel(e, s.unit, s.unit)} from`; }).filter(Boolean);
  }, exId);
  const shareFrom = await page.evaluate(async (id) => {
    const { bestEstimate, estimateLabel } = await import('./js/strength.js');
    const { sessions } = await (await fetch(`api.php?a=exercise_history&id=${id}`)).json();
    const ex = (await (await fetch('api.php?a=bootstrap')).json()).exercises.find((x) => x.id === id);
    const s = [...sessions].reverse().find((x) => bestEstimate(x.sets, ex));
    return s && { workout: s.workout_id, label: estimateLabel(bestEstimate(s.sets, ex), s.unit) };
  }, exId);
  const shown = await page.$$eval('.log-est', (els) => els.map((e) => e.textContent));
  if (shareFrom) {
    const back = await page.evaluate(() => location.hash);
    await page.goto(`${URL}#/history/${shareFrom.workout}`);
    await page.click('button:has-text("Share workout")');
    await page.waitForSelector('.sheet canvas.share-card');
    const label = await page.getAttribute('.sheet canvas.share-card', 'aria-label');
    check(`the share card shows the estimate next to the lift (${shareFrom.label})`, label.includes(`${liftName}, `) && label.includes(shareFrom.label), label);
    await page.click('.sheet button:has-text("Close")');
    await page.goto(`${URL}${back}`);
    await page.waitForSelector('.chart');
  }
  check('exercise history shows an estimated 1-rep max chart and the estimate on each eligible session, with its source set', expected.length > 0 && (await page.locator('h3:has-text("Estimated 1-rep max")').count()) === 1 && shown.length === expected.length && shown.every((t) => /^Est\. 1RM · \d+ (lb|kg) from [\d.]+ (lb|kg) × \d+$/.test(t)) && [...expected].reverse().every((p, i) => shown[i].startsWith(p)), JSON.stringify({ expected, shown }));
}
// #11: tap a point for its details, open that workout, and filter by date range.
{
  const exHash = await page.evaluate(() => location.hash);
  const exId = Number(exHash.split('/').pop());
  const chart = page.locator('.chart').first();
  check('before a point is chosen, the chart says how to use it', /Tap a point/.test(await chart.locator('.chart-readout').textContent()));
  await page.waitForFunction(() => !/Loading/.test(document.querySelector('[data-notes-list]')?.textContent || ''));
  await chart.locator('svg').scrollIntoViewIfNeeded();
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
await gp.waitForSelector('input[name=invite_token]');
if (SHOTS) await gp.screenshot({ path: `${SHOTS}/32-request-invite-code.png` });
check('the request form asks for an Invite code and says where to get one (#137)', (await gp.locator('.field', { has: gp.locator('input[name=invite_token]') }).textContent()).includes('Invite code') && (await gp.textContent('.page')).includes('Ask the person who runs this ThoeneFit site for an invite code.') && !(await gp.textContent('.page')).includes('invite token'));
await gp.fill('input[name=invite_token]', 'wrong-token-zzz');
await gp.fill('input[name=display_name]', 'New Lifter');
await gp.fill('input[name=username]', applicant);
await gp.fill('input[name=password]', 'my-own-password-1');
await gp.fill('input[name=password_again]', 'my-own-password-1');
await gp.click('button:has-text("Send request")');
await gp.waitForSelector('.form-error:not(:empty)');
check('a request with the wrong invite code is refused', /invite code is not right/.test(await gp.textContent('.form-error')), await gp.textContent('.form-error'));
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
check('the other person sees it on Today, with who sent it', (await pp.textContent('.share-card')).includes(`${myName} shared a workout with you`));
if (SHOTS) await pp.screenshot({ path: `${SHOTS}/14-share-incoming.png` });
await pp.click('.share-card button:has-text("Accept")');
await pp.waitForSelector('.shared-note');
await pp.waitForFunction(() => document.querySelectorAll('.plan-row').length > 0 && !document.querySelector('.stack.loading'));
const theirPlan = await planOn(pp);
check('accepting gives the same exercises, order and planned sets', shape(theirPlan) === shape(myPlan), `${shape(theirPlan)} <> ${shape(myPlan)}`);
check('weights are each person\'s own: the sender has suggestions from history, the new partner has none yet', myPlan.some((x) => / at \d/.test(x.target)) && theirPlan.every((x) => !/ at \d/.test(x.target)), JSON.stringify([myPlan[0], theirPlan[0]]));
check('a shared plan has no Lock, Swap or Regenerate, so it stays the same as the sender\'s (Remove is allowed, #155)', (await pp.locator('.plan-row button:not([aria-label^="Remove"])').count()) === 0 && (await pp.locator('button:has-text("Regenerate")').count()) === 0);
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
await closeRecap(pp);
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
  check('a regular user does not see the chatgpt account in the share picker', (await pp.locator('.share-row', { hasText: 'ChatGPT' }).count()) === 0 && (await pp.locator('.share-row', { hasText: myName }).count()) === 1);
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
check('each person has their own history entry, with their own weights', theirs2.length === 1 && (await pp.textContent('[data-notes]')).includes(`Shared by ${myName}`) && !mine2.some((w) => w.id === theirs2[0].id) && (await pp.locator('.set input').first().inputValue()) === '45');
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
check('a workout already in progress can be shared too', (await pp.textContent('.share-card')).includes(`${myName} shared`));
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
await shot('11-settings');
check('Settings shows the app version under its title, and no longer at the bottom', /^Version (dev|\d+\.\d+\.\d+(-staging)?)$/.test(await page.textContent('.top-head a.app-version')) && !/Version /.test(await page.textContent('.page > :last-child')), await page.textContent('.top-head a.app-version'));
// #103: one heading colour, Training and Gyms first, the rest behind links.
{
  const heads = await page.$$eval('.settings-main .top-head h1, .settings-main .section > h2', (els) => els.map((e) => [e.textContent, getComputedStyle(e).color]));
  check('every heading on the main Settings page is mint green', heads.length >= 6 && heads.every(([, c]) => c === 'rgb(58, 242, 156)'), JSON.stringify(heads));
  const order = heads.slice(1).map(([t]) => t);
  check('Training and Gyms come first', order[0] === 'Training' && order[1] === 'Gyms', order.join());
  // #216: one goal dropdown, in the agreed order, with the chosen goal's description under it.
  {
    const goalSel = page.locator('.goal-picker select[aria-label="Goal"]');
    const opts = await goalSel.locator('option').allTextContents();
    check('Goal is one dropdown with all seven goals in order (#216)', opts.join() === 'Get Started,General Fitness,Reduce Bodyweight,Build Muscle,Get Stronger,Muscular Endurance,Powerlifting' && (await page.locator('.settings-main .goal-picker .choice').count()) === 0, opts.join());
    const shown = async () => [await goalSel.evaluate((s) => s.selectedOptions[0].textContent), (await page.textContent('.goal-hint')).trim()];
    const start = await shown();
    check('an existing user sees their goal chosen, with its description underneath', (await api('bootstrap')).user.goal === 'muscle' && start[0] === 'Build Muscle' && start[1] === '6-10 reps on big lifts', JSON.stringify(start));
    await goalSel.selectOption('powerlifting');
    await page.waitForFunction(async () => (await (await fetch('api.php?a=bootstrap')).json()).user.goal === 'powerlifting');
    check('choosing a goal saves it and updates the description', JSON.stringify(await shown()) === JSON.stringify(['Powerlifting', 'Squat, bench, and deadlift']), JSON.stringify(await shown()));
    await shot('11c-goal-dropdown');
    await page.locator('.goal-picker select[aria-label="Goal"]').selectOption('muscle');
    await page.waitForFunction(async () => (await (await fetch('api.php?a=bootstrap')).json()).user.goal === 'muscle');
    // #211: Variety sits under Goal, Mixed by default.
    const variety = page.locator('.field', { has: page.locator('.field-label', { hasText: /^Variety$/ }) });
    const vLabels = await variety.locator('.choice-label').allTextContents();
    check('Variety offers Steady, Mixed and Varied, with Mixed chosen by default (#211)', vLabels.join() === 'Steady,Mixed,Varied' && (await variety.locator('.choice[aria-pressed="true"]').textContent()).startsWith('Mixed'), vLabels.join());
    await variety.locator('.choice', { hasText: 'Varied' }).click();
    await page.waitForFunction(async () => (await (await fetch('api.php?a=bootstrap')).json()).user.variety === 'varied');
    check('picking Varied saves it', (await api('bootstrap')).user.variety === 'varied');
    await page.locator('.field', { has: page.locator('.field-label', { hasText: /^Variety$/ }) }).locator('.choice', { hasText: 'Mixed' }).click();
    await page.waitForFunction(async () => (await (await fetch('api.php?a=bootstrap')).json()).user.variety === 'mixed');
  }
  check('no divider line between the Settings header and Training', (await page.$eval('.settings-main > .top-head + .section', (el) => getComputedStyle(el).borderTopStyle)) === 'none');
  const links = await page.$$eval('.link-row .log-title', (els) => els.map((e) => e.textContent));
  check("Settings links to Routines, data, help and What's new instead of showing them inline", ['Manage routines', 'Export all sets as CSV', 'Import from Fitbod', 'Add to your Home Screen', "What's new"].every((t) => links.includes(t)) && (await page.locator('[data-list=routines]').count()) === 0 && !(await page.textContent('.page')).includes('Tap the Share button'), links.join());
  await page.click('.link-row:has-text("Add to your Home Screen")');
  await page.waitForSelector('.install-help');
  check('the Home Screen link opens the install steps', (await page.textContent('.page')).includes('Tap the Share button') && /remove ThoeneFit from the Home Screen and add it again/.test(await page.textContent('.page')));
  await shot('11b-settings-install');
  await page.click('.back:has-text("Settings")');
  await page.waitForSelector('.settings-main');
}

console.log("What's new");
check('the version under the Settings title is plain text, not underlined', (await page.$eval('.top-head a.app-version', (a) => getComputedStyle(a).textDecorationLine)) === 'none' && (await page.locator('.settings-main > .app-version, .settings-main p.app-version').count()) === 0);
await page.click('.top-head a.app-version');
await page.waitForSelector('h1:has-text("What\'s new")');
{
  const wn = await page.evaluate(() => {
    const hd = document.querySelector('main > .top-head');
    const back = hd?.querySelector('.detail-back a.back');
    const title = hd?.querySelector('.detail-title');
    return hd && { back: back?.textContent.trim(), backLeft: Math.round(back.getBoundingClientRect().left), title: title?.textContent, titleRight: Math.round(innerWidth - title.getBoundingClientRect().right), logo: !!hd.querySelector('img.brand-wide'), h1s: document.querySelectorAll('h1').length };
  });
  check("What's new uses the exercise page header: Settings back link top left, the title top right", wn && wn.back === 'Settings' && wn.title === "What's new" && wn.backLeft < 40 && wn.titleRight < 40 && !wn.logo && wn.h1s === 1, JSON.stringify(wn));
}
await page.waitForSelector('.page .card, .page p.pad:not(:has-text("Loading"))');
if (!process.env.TF_URL) {
  check('tapping the version opens What\'s new, which says notes come with a deploy when there are none', /Release notes are added when the app is deployed/.test(await page.textContent('.page')), (await page.textContent('.page')).slice(0, 300));
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
  check('a routine plan has no Regenerate, Lock or Swap (Remove is allowed, #155)', (await page.locator('button:has-text("Regenerate")').count()) === 0 && (await page.locator('.plan-row button:not([aria-label^="Remove"])').count()) === 0);
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

  // Rename and delete, from Settings → Manage routines (#103).
  await page.goto(`${URL}#/settings`);
  check('Settings shows how many routines are saved', /1 saved/.test(await page.textContent('.link-row:has-text("Manage routines")')));
  await page.click('.link-row:has-text("Manage routines")');
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
  await phone.click('.link-row:has-text("Change password")');
  await phone.waitForSelector('input[autocomplete=current-password]');
  await phone.fill('input[autocomplete=current-password]', 'buddy-password-1');
  await phone.fill('input[autocomplete=new-password]', 'buddy-password-3');
  await phone.click('button[type=submit]:has-text("Change password")');
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
  // #198: the effort question is optional and asked even without a body weight (#38 used to need one).
  await page.click('button:has-text("Finish workout")');
  await page.waitForSelector('.sheet button:has-text("Finish and save")');
  check('finishing asks how hard it was even without a body weight, with nothing chosen (#198)', (await page.locator('.sheet :text("How hard was it?")').count()) === 1 && (await page.locator('.sheet .choice[aria-pressed="true"]').count()) === 0 && /Helps plan your next workouts\.$/.test(await page.textContent('.sheet .field-hint')));
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
  check('with a body weight it still starts with nothing chosen, and mentions calories', (await page.locator('.sheet .choice[aria-pressed="true"]').count()) === 0 && /estimate calories/.test(await page.textContent('.sheet .field-hint')));
  await page.click('.sheet .choice:has-text("Hard")');
  await shot('15-finish-effort');
  await page.click('.sheet button:has-text("Finish and save")');
  await closeRecap(page);
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

console.log('Admin password resets and deactivation');
{
  const csrf = (await api('bootstrap')).csrf;
  const name = `crew${Date.now() % 100000}`;
  await post('create_user', { username: name, display_name: 'Crew Member', password: 'crew-password-1' }, csrf);
  const cctx = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
  const cp = await cctx.newPage();
  const signIn = async (pw) => {
    await cp.goto(URL);
    await cp.waitForSelector('input[name=username]');
    await cp.fill('input[name=username]', name);
    await cp.fill('input[name=password]', pw);
    await cp.click('button[type=submit]');
  };
  const status = () => cp.evaluate(async () => (await fetch('api.php?a=history', { credentials: 'same-origin' })).status);
  await signIn('crew-password-1');
  await cp.waitForSelector('h1:has-text("Welcome")');
  check('the new account can sign in', (await status()) === 200);

  await page.goto(`${URL}#/settings/users`);
  const row = page.locator('.account-row', { hasText: name });
  await row.waitFor();
  check('the admin has no reset or deactivate buttons on their own row', (await page.locator('.account-row', { hasText: 'You' }).locator('button').count()) === 0);
  await row.locator('button:has-text("Reset password")').click();
  await page.waitForSelector('.sheet input[name=reset_password]');
  await page.click('.sheet button:has-text("Make one up for me")');
  const made = await page.inputValue('.sheet input[name=reset_password]');
  await shot('20-admin-reset-password');
  await page.fill('.sheet input[name=reset_password]', 'crew-password-2');
  await page.click('.sheet button:has-text("Set new password")');
  await waitForToast(page, /Password reset/);
  check('Make one up fills in a long enough password', made.length >= 10, made);
  check('a password reset signs the person out on their devices', (await status()) === 401);
  await signIn('crew-password-1');
  await cp.waitForSelector('.form-error:not(:empty)');
  check('the old password no longer works', /Wrong username or password/.test(await cp.textContent('.form-error')));
  await signIn('crew-password-2');
  await cp.waitForSelector('h1:has-text("Welcome")');
  check('the new password works', (await status()) === 200);

  await row.locator('button:has-text("Deactivate")').click();
  await page.click('.sheet button:has-text("Deactivate account")');
  await waitForToast(page, /is deactivated/);
  const off = page.locator('[data-list=inactive] .account-row', { hasText: name });
  check('a deactivated account moves to Deactivated accounts', (await off.count()) === 1 && (await page.locator('.log:not([data-list]) .account-row', { hasText: name }).count()) === 0);
  await off.scrollIntoViewIfNeeded();
  await shot('21-admin-deactivated');
  check('deactivating signs the person out', (await status()) === 401);
  await signIn('crew-password-2');
  await cp.waitForSelector('.form-error:not(:empty)');
  check('a deactivated account cannot sign in and is told why', /deactivated/.test(await cp.textContent('.form-error')));
  if (SHOTS) await cp.screenshot({ path: `${SHOTS}/22-deactivated-sign-in.png` });

  await off.locator('button:has-text("Turn back on")').click();
  await waitForToast(page, /can sign in again/);
  check('turning it back on moves it back to Accounts', (await page.locator('.account-row', { hasText: name }).locator('button:has-text("Deactivate")').count()) === 1 && (await page.locator('[data-list=inactive] .account-row').count()) === 0);
  await signIn('crew-password-2');
  await cp.waitForSelector('h1:has-text("Welcome")');
  check('a turned-back-on account signs in with the same password', (await status()) === 200);
  check('no sideways scrolling on Manage users', (await overflow()) <= 0);
  await cctx.close();
}

console.log("Seeing each other's history");
{
  const csrf = (await api('bootstrap')).csrf;
  const viewerName = `viewer${Date.now() % 100000}`;
  await post('create_user', { username: viewerName, display_name: 'Viewer', password: 'viewer-password-1' }, csrf);
  const vctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await vctx.addInitScript(() => { try { localStorage.setItem('tf.install', JSON.stringify({ never: true })); } catch (e) { /* about:blank */ } });
  const vp = await vctx.newPage();
  vp.on('pageerror', (e) => errors.push(String(e)));
  await vp.goto(URL);
  await vp.fill('input[name=username]', viewerName);
  await vp.fill('input[name=password]', 'viewer-password-1');
  await vp.click('button[type=submit]');
  await vp.waitForSelector('h1:has-text("Welcome")');
  await vp.evaluate(async () => {
    const b = await (await fetch('api.php?a=bootstrap', { credentials: 'same-origin' })).json();
    await fetch('api.php?a=save_profile', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify({ onboarded: true }) });
  });
  const myId = (await api('bootstrap')).user.id;
  const viewerGet = (q) => vp.evaluate(async (u) => (await fetch(u, { credentials: 'same-origin' })).status, `api.php?a=${q}`);
  await vp.goto(`${URL}#/history`);
  await vp.reload();
  await vp.waitForSelector('.tabs');
  await vp.waitForTimeout(400);
  check('history starts private: nobody else is listed on History', (await vp.locator('.people-pick').count()) === 0);
  check('a private history cannot be fetched by another account', (await viewerGet(`member_history&user=${myId}`)) === 404);

  await page.goto(`${URL}#/settings`);
  await page.waitForSelector('text=Who can see your history');
  {
    // #194: selected options use the Pick muscle groups highlight.
    const sel = await page.$eval('.choice[aria-pressed="true"]', (b) => { const c = getComputedStyle(b); return [c.borderTopColor, c.backgroundColor, c.color]; });
    check('selected options in Settings use the Pick muscle groups highlight (mint border, mint tint, mint text) (#194)', JSON.stringify(sel) === JSON.stringify(['rgb(58, 242, 156)', 'rgba(58, 242, 156, 0.14)', 'rgb(58, 242, 156)']), JSON.stringify(sel));
    await page.focus('.choice[aria-pressed="false"]');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => { const c = getComputedStyle(document.activeElement); return [document.activeElement.className, c.outlineStyle, c.outlineColor]; });
    check('keyboard focus on an option is still a distinct blue outline', focus[0] === 'choice' && focus[1] === 'solid' && focus[2] === 'rgb(90, 162, 255)', JSON.stringify(focus));
  }
  check('Settings offers Only me and All signed-in users, starting at Only me', (await page.locator('.choice[aria-pressed="true"]:has-text("Only me")').count()) === 1 && (await page.locator('.choice:has-text("All signed-in users")').count()) === 1);
  await page.click('.choice:has-text("All signed-in users")');
  await waitForToast(page, /visible to signed-in users/);
  await page.locator('.section', { hasText: 'Who can see your history' }).scrollIntoViewIfNeeded();
  await shot('17-history-visibility');

  await vp.goto(`${URL}#/today`);
  await vp.goto(`${URL}#/history`);
  await vp.waitForSelector('.people-pick');
  const pick = await vp.$eval('.people-pick', (s) => [...s.options].map((o) => o.textContent));
  check('once shared, History offers a "View other trainer\'s history" dropdown with them in it', pick[0] === "View other trainer's history" && pick.includes(myName), pick.join(' | '));
  if (SHOTS) await vp.screenshot({ path: `${SHOTS}/18-history-other-people.png` });
  await vp.selectOption('.people-pick', { label: myName });
  await vp.waitForFunction(() => /'s workouts/.test(document.querySelector('h1')?.textContent || '') && document.querySelectorAll('.log-row').length > 0);
  if (SHOTS) await vp.screenshot({ path: `${SHOTS}/18b-history-their-list.png` });
  check("their list opens with the person's name and their workouts", (await vp.textContent('h1')).includes(`${myName}'s workouts`) && (await vp.locator('.log-row').count()) > 0);
  await vp.click('.log-row:has-text("Push")');
  await vp.waitForSelector('.lift.read-only');
  check('no stray text from the page builder', !/object HTMLElement|undefined|null/.test(await vp.textContent('main')));
  check('one of their workouts shows the sets they logged', (await vp.locator('.set-line').count()) > 0 && / × \d/.test(await vp.textContent('.set-line:not(.warm)')));
  check('it is read-only: nothing to type in, no Save or Delete', (await vp.locator('.page input').count()) === 0 && (await vp.locator('button:has-text("Save changes"), button:has-text("Delete workout"), button:has-text("Send to Strava")').count()) === 0);
  check('the History tab stays selected', (await vp.getAttribute('.tab:has-text("History")', 'aria-current')) === 'page');
  check('no sideways scrolling on their workout', (await vp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  if (SHOTS) await vp.screenshot({ path: `${SHOTS}/19-history-other-workout.png`, fullPage: true });
  const wid = (await vp.evaluate(() => location.hash)).split('/').pop();
  const save = await vp.evaluate(async (id) => {
    const b = await (await fetch('api.php?a=bootstrap', { credentials: 'same-origin' })).json();
    const r = await fetch('api.php?a=save_workout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify({ workout: { id, rev: 999, status: 'completed', exercises: [] } }) });
    return r.status;
  }, wid);
  check("the server refuses edits to someone else's workout", save === 403, String(save));

  await page.goto(`${URL}#/settings`);
  await page.waitForSelector('text=Who can see your history');
  await page.click('.choice:has-text("Only me")');
  await waitForToast(page, /now private/);
  check('switching back to Only me hides it again', (await viewerGet(`member_history&user=${myId}`)) === 404 && (await viewerGet(`member_workout&user=${myId}&id=${wid}`)) === 404);
  await vctx.close();
}

// Each width gets a fresh page: resizing a phone-emulated page back up can leave it zoomed in,
// which moves where taps land for the checks after this (#217).
for (const [w, hgt, label] of [[375, 667, 'iPhone SE'], [393, 852, 'iPhone 16'], [440, 956, 'iPhone Pro Max'], [412, 915, 'Pixel']]) {
  const wp = await context.newPage();
  await wp.setViewportSize({ width: w, height: hgt });
  let worst = 0;
  const plain = [];
  for (const tab of ['today', 'history', 'trends', 'exercises', 'settings']) {
    await wp.goto(`${URL}#/${tab}`);
    await wp.waitForSelector('.tabs');
    await wp.waitForTimeout(250);
    worst = Math.max(worst, await wp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
    if ((await wp.$eval('main h1', (el) => getComputedStyle(el).color)) !== 'rgb(58, 242, 156)') plain.push(tab);
  }
  if (w === 375) check('every tab\'s main heading is mint', plain.length === 0, plain.join());
  check(`no sideways scrolling at ${w}px (${label})`, worst <= 0, `${worst}px`);
  await wp.close();
}
console.log('Tab bar while a tab loads (#112)');
{
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('.plan-row');
  await page.evaluate(() => scrollTo(0, 99999));
  await page.waitForTimeout(200);
  // Hold History's data back, and note the scroll position at the moment its page goes in.
  let release;
  const held = new Promise((r) => (release = r));
  await page.route(/a=(history|people_history)\b/, async (r) => { await held; await r.continue().catch(() => {}); });
  await page.evaluate(() => {
    window.__swapY = null;
    const app = document.getElementById('app');
    const swap = app.replaceChildren.bind(app);
    app.replaceChildren = (...kids) => {
      if (kids[0]?.querySelector?.('h1')?.textContent === 'History') window.__swapY = window.scrollY;
      return swap(...kids);
    };
  });
  check('Today was scrolled down before switching', (await page.evaluate(() => scrollY)) > 300);
  await page.click('.tab:has-text("History")');
  await page.waitForSelector('.tab-home');
  const m = await page.evaluate(() => ({ swapY: window.__swapY, doc: document.documentElement.scrollHeight, vh: innerHeight, bottom: Math.round(document.querySelector('.tabs').getBoundingClientRect().bottom) }));
  check('switching tabs scrolls to the top before the loading page goes in', m.swapY === 0, JSON.stringify(m));
  check('while loading, the page still fills the screen and the tab bar sits at the bottom', m.doc >= m.vh && m.bottom === m.vh, JSON.stringify(m));
  release();
  await page.waitForSelector('.log-row, .card h2');
  await page.unroute(/a=(history|people_history)\b/);
  await page.evaluate(() => { delete document.getElementById('app').replaceChildren; });
}

console.log('Pause and resume a workout');
{
  await page.setViewportSize({ width: 402, height: 874 });
  const tabBg = (sel) => page.$eval(sel, (el) => getComputedStyle(el.querySelector('.tab-icon')).backgroundColor);
  await page.goto(`${URL}#/history`);
  await page.waitForSelector('.tabs');
  check('the selected tab has a mint pill behind its icon, the others do not', (await tabBg('.tab[aria-current="page"]')) === 'rgba(58, 242, 156, 0.18)' && (await tabBg('a.tab[href="#/trends"]')) === 'rgba(0, 0, 0, 0)');
  check('with no workout, the middle tab is called Workout, with the barbell, and opens Today', (await page.locator('a.tab[href="#/today"]').textContent()) === 'Workout' && (await page.locator('.pause-tab').count()) === 0);
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('button:has-text("Start workout")');
  await page.click('button:has-text("Start workout")');
  await page.waitForSelector('.lift');
  const pauseTab = page.locator('.pause-tab');
  const fin = await page.$eval('button.finish', (b) => { const s = getComputedStyle(b); return [s.color, s.backgroundColor, s.borderTopColor, s.borderRadius, b.textContent.trim()]; });
  check('Finish workout has the Quick Start treatment in red (#164)', fin[0] === 'rgb(255, 107, 94)' && fin[1] === 'rgba(255, 107, 94, 0.1)' && fin[2] === 'rgba(255, 107, 94, 0.5)' && fin[4] === 'Finish workout', fin.join(' | '));
  check('during a workout the Today spot is a Pause button with an accessible label', (await pauseTab.getAttribute('aria-label')) === 'Pause workout' && (await pauseTab.locator('.tab-icon').count()) === 1);
  const strength = () => page.locator('.lift', { has: page.locator('.set:not(.cardio)') }).first();
  const first = strength().locator('.set').first();
  await first.locator('input').nth(0).fill('95');
  await first.locator('input').nth(1).fill('8');
  await first.locator('.plate').click();
  await page.waitForSelector('#sync.saved');
  await shot('28-workout-running');
  await pauseTab.click();
  await waitForToast(page, /Workout paused/);
  check('pausing switches it to Play, labelled Resume workout, and shows the paused banner', (await page.locator('.pause-tab').getAttribute('aria-label')) === 'Resume workout' && (await page.locator('.paused-banner').count()) === 1);
  check('pausing stops the rest timer', await page.locator('.rest').isHidden());
  const frozen = await page.textContent('#elapsed');
  await page.waitForTimeout(2200);
  check('the workout clock stops while paused', (await page.textContent('#elapsed')) === frozen, frozen);
  await shot('29-workout-paused');
  await page.click('.tab:has-text("History")');
  await page.waitForSelector('.back-to-workout');
  check('other tabs show a way back to the workout, saying it is paused', /in progress/.test(await page.textContent('.back-to-workout')) && /Paused/.test(await page.textContent('.back-to-workout')));
  check('on other tabs the Today spot is a Workout tab with the barbell, not Pause or Play', (await page.locator('.pause-tab').count()) === 0 && (await page.locator('a.workout-tab[href="#/workout"]').textContent()) === 'Workout');
  check('while paused the Workout tab is yellow and still', (await page.$eval('a.workout-tab', (el) => [getComputedStyle(el).color, getComputedStyle(el.querySelector('.tab-icon')).animationName].join())) === 'rgb(245, 198, 60),none');
  check('no sideways scrolling with the way-back bar', (await overflow()) <= 0);
  check('the way-back bar sits in the fixed header, under the History title (#175)', (await page.locator('main > .top-head .back-to-workout').count()) === 1 && (await page.evaluate(() => document.querySelector('.back-to-workout').getBoundingClientRect().top >= document.querySelector('.top-head h1').getBoundingClientRect().bottom)));
  await shot('30-history-during-workout');
  await page.click('.back-to-workout');
  await page.waitForSelector('.paused-banner');
  check('the bar goes back to the workout, with the logged set kept', (await page.locator('.set.done').count()) === 1);
  // From another tab, the Workout tab only goes back: it does not pause or resume.
  await page.click('.tab:has-text("Trends")');
  await page.waitForSelector('.back-to-workout');
  await page.click('a.workout-tab');
  await page.waitForSelector('.lift');
  check('the Workout tab goes back to the workout and leaves it paused', (await page.evaluate(() => location.hash)) === '#/workout' && (await page.locator('.paused-banner').count()) === 1 && (await page.locator('.pause-tab').getAttribute('aria-label')) === 'Resume workout');
  {
    const wh = await page.evaluate(() => {
      const head = document.querySelector('main > .top-head');
      const h1 = head?.querySelector('h1');
      return head && { position: getComputedStyle(head).position, top: Math.round(head.getBoundingClientRect().top), color: getComputedStyle(h1).color, size: getComputedStyle(h1).fontSize, left: Math.round(h1.getBoundingClientRect().left), h1Top: Math.round(h1.getBoundingClientRect().top), clock: !!head.querySelector('#elapsed'), sync: !!head.querySelector('#sync'), logo: !!head.querySelector('img.brand-wide') };
    });
    await page.goto(`${URL}#/history`);
    await page.waitForSelector('main > .top-head');
    const ref = await page.evaluate(() => { const h1 = document.querySelector('main > .top-head h1'); return { color: getComputedStyle(h1).color, size: getComputedStyle(h1).fontSize, left: Math.round(h1.getBoundingClientRect().left), h1Top: Math.round(h1.getBoundingClientRect().top) }; });
    check('during a workout the header matches the other screens, with the clock and save status on the right (#175)', wh && wh.position === 'sticky' && wh.top === 0 && wh.color === 'rgb(58, 242, 156)' && wh.size === ref.size && wh.left === ref.left && wh.h1Top === ref.h1Top && wh.clock && wh.sync && !wh.logo, JSON.stringify({ wh, ref }));
    await page.goto(`${URL}#/workout`);
    await page.waitForSelector('.lift');
  }
  await page.click('.paused-banner button:has-text("Resume")');
  await waitForToast(page, /Workout resumed/);
  check('Resume clears the pause', (await page.locator('.paused-banner').count()) === 0 && (await page.locator('.pause-tab').getAttribute('aria-label')) === 'Pause workout');
  const running = await page.textContent('#elapsed');
  await page.waitForTimeout(1500);
  check('and the clock runs again', (await page.textContent('#elapsed')) !== running);
  await page.click('.tab:has-text("Exercises")');
  await page.waitForSelector('a.workout-tab');
  check('while a workout runs, the Workout tab is mint and pulses', (await page.$eval('a.workout-tab', (el) => [getComputedStyle(el).color, getComputedStyle(el.querySelector('.tab-icon')).animationName].join())) === 'rgb(58, 242, 156),workout-pulse');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/31-workout-tab.png` });
  await page.click('a.workout-tab');
  await page.waitForSelector('.lift');
  check('from a running workout, the Workout tab goes back without pausing it', (await page.locator('.paused-banner').count()) === 0 && (await page.locator('.pause-tab').getAttribute('aria-label')) === 'Pause workout');
  await page.locator('.pause-tab').click();
  await waitForToast(page, /Workout paused/);
  const second = strength().locator('.set').nth(1);
  await second.locator('input').nth(0).fill('95');
  await second.locator('input').nth(1).fill('8');
  await second.locator('.plate').click();
  await waitForToast(page, /Workout resumed/);
  check('logging a set while paused resumes the workout', (await page.locator('.paused-banner').count()) === 0 && (await page.locator('.set.done').count()) === 2);
  // Pause for a few seconds, then finish while paused: that time is left out.
  await page.locator('.pause-tab').click();
  await waitForToast(page, /Workout paused/);
  await page.waitForTimeout(3000);
  await page.waitForSelector('#sync.saved');
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('tf.docs.')))).activeId);
  await page.click('button:has-text("Finish workout")');
  await page.waitForSelector('.sheet button:has-text("Finish and save")');
  await page.click('.sheet button:has-text("Finish and save")');
  await closeRecap(page);
  await page.waitForSelector('.plan-row, .page-head');
  await page.waitForFunction(() => document.querySelector('#sync') === null || document.querySelector('#sync').textContent === 'Saved');
  check('after finishing, the Today spot is the normal Today tab again', (await page.locator('.pause-tab').count()) === 0 && (await page.locator('a.tab[href="#/today"]').count()) === 1 && (await page.locator('.back-to-workout').count()) === 0);
  let saved = null;
  for (let i = 0; i < 20 && !(saved && saved.status === 'completed'); i++) {
    saved = (await api(`workout&id=${id}`)).workout;
    if (saved.status !== 'completed') await page.waitForTimeout(300);
  }
  check('the server has the finished workout with its paused time recorded', saved.status === 'completed' && saved.paused_s >= 4 && saved.paused_at === null && saved.exercises.reduce((n, e) => n + e.sets.length, 0) === 2, JSON.stringify({ s: saved.status, p: saved.paused_s, a: saved.paused_at }));
  await api(`workout&id=${id}`);
  await page.evaluate(async (wid) => {
    const b = await (await fetch('api.php?a=bootstrap')).json();
    await fetch('api.php?a=delete_workout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify({ id: wid }) });
  }, id);
}

console.log('Stretches (#138)');
{
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('.plan-row');
  const box = (label) => page.locator(`label.check:has-text("${label}") input`);
  const settle = async () => { await page.waitForTimeout(300); await page.waitForFunction(() => !document.querySelector('.stack.loading') && document.querySelectorAll('.plan-row').length > 0); };
  const setBox = async (label, on) => { if ((await box(label).isChecked()) !== on) { await box(label).click(); await settle(); } };
  const targets = () => page.$$eval('.plan-row .target', (els) => els.map((e) => e.textContent));
  await page.selectOption('select[aria-label="Workout type"]', 'legs');
  await settle();
  const wasWarm = (await box('Include a warm-up').count()) ? await box('Include a warm-up').isChecked() : false;
  await setBox('Include a warm-up', false);
  // Ticking a box keeps everything in place while the new plan is built: no box
  // disappears and nothing below it jumps (#138 feedback).
  {
    let release;
    const held = new Promise((r) => (release = r));
    await page.route(/a=generate\b/, async (r) => { await held; await r.continue().catch(() => {}); });
    const y = () => page.evaluate(() => Math.round(document.querySelector('.stepper, .controls .field:last-child').getBoundingClientRect().top));
    const before = { y: await y(), boxes: await page.locator('.controls label.check').count(), rows: await page.locator('.plan-row').count() };
    await page.locator('label.check:has-text("Include stretches") input').click();
    await page.waitForTimeout(250);
    const during = { y: await y(), boxes: await page.locator('.controls label.check').count(), rows: await page.locator('.plan-row').count(), dim: await page.locator('.stack.loading').count() };
    release();
    await page.unroute(/a=generate\b/);
    await settle();
    check('while a new plan is built, every box stays and nothing below moves', before.boxes === 3 && during.boxes === 3 && during.y === before.y, JSON.stringify({ before, during }));
    check('the current plan stays on screen, dimmed, until the new one arrives', during.rows === before.rows && during.dim === 1, JSON.stringify({ before, during }));
    await page.locator('label.check:has-text("Include stretches") input').click();
    await settle();
  }
  // Bodyweight only keeps the warm-up box: the warm-up becomes dynamic stretches.
  await setBox('Bodyweight only', true);
  check('Bodyweight only still offers Include a warm-up', (await box('Include a warm-up').count()) === 1);
  await setBox('Include a warm-up', true);
  let bwT = await targets();
  check('the summary calls it a stretch warm-up', /Stretch warm-up and \d+ exercises/.test(await page.textContent('.summary')), await page.textContent('.summary'));
  check('a bodyweight-only warm-up is 2 or 3 dynamic stretches, no machine', [2, 3].includes(bwT.filter((x) => /moving/.test(x)).length) && /moving/.test(bwT[0]) && !bwT.some((x) => /min warm-up/.test(x)), bwT.join(' | '));
  await shot('35-bodyweight-warm-up');
  await setBox('Include a warm-up', false);
  await setBox('Bodyweight only', false);
  check('Include stretches sits with Bodyweight only, off to start with', (await page.locator('.controls label.check:has-text("Include stretches")').count()) === 1 && !(await box('Include stretches').isChecked()) && !(await targets()).some((t) => /^Hold|moving/.test(t)));
  await setBox('Include stretches', true);
  let t = await targets();
  const lastLift = t.map((x) => /sets of/.test(x)).lastIndexOf(true);
  check('Include stretches by itself: 2 or 3 cooldown stretches after the lifting, no warm-up', [2, 3].includes(t.slice(lastLift + 1).length) && t.slice(lastLift + 1).every((x) => /^Hold \d+ s/.test(x)) && !t.some((x) => /warm-up|moving/.test(x)), t.join(' | '));
  check('the summary counts the stretches and their time', /\d+ stretches, about \d+ minutes/.test(await page.textContent('.summary')));
  await setBox('Include a warm-up', true);
  t = await targets();
  const kind = (x) => (/warm-up/.test(x) ? 'cardio' : /moving/.test(x) ? 'dynamic' : /^Hold/.test(x) ? 'cooldown' : 'lift');
  const order = [...new Set(t.map(kind))];
  const moving = t.filter((x) => /moving/.test(x)).length;
  check('both boxes: cardio warm-up, 2 or 3 dynamic stretches, lifting, cooldown stretches', order.join() === 'cardio,dynamic,lift,cooldown' && [2, 3].includes(moving), t.join(' | '));
  await shot('33-stretches-plan');
  await page.reload();
  await page.waitForSelector('.plan-row');
  check('the choice is remembered', await box('Include stretches').isChecked());
  // Log a stretch: seconds per hold, no rest timer.
  await page.click('button:has-text("Start workout")');
  await page.waitForSelector('.lift');
  const card = page.locator('.lift', { has: page.locator('.set.stretch') }).first();
  await card.scrollIntoViewIfNeeded();
  check('a stretch is logged in seconds, per side when done on each side', (await card.locator('.set-head').textContent()).includes('Seconds') && /^(L|1)$/.test((await card.locator('.set-tag').first().textContent()).trim()));
  await card.locator('.set.stretch input').first().fill('40');
  await card.locator('.set.stretch .plate').first().click();
  await page.waitForTimeout(300);
  check('completing a hold starts no rest timer', await page.locator('.rest').isHidden() && (await card.locator('.set.stretch.done').count()) === 1);
  await shot('34-stretch-logging');
  const stretchName = (await card.locator('h2').textContent()).trim();
  await page.click('button:has-text("Finish workout")');
  await page.waitForSelector('.sheet button:has-text("Finish and save")');
  await page.click('.sheet button:has-text("Finish and save")');
  await closeRecap(page);
  await page.waitForFunction(() => document.querySelector('#sync') === null || document.querySelector('#sync').textContent === 'Saved');
  await page.waitForTimeout(800);
  await page.goto(`${URL}#/history`);
  await page.waitForSelector('.log-row');
  check('History lists the logged stretch', (await api('history&limit=1')).workouts[0].exercises.includes(stretchName), stretchName);
  await page.locator('.log-row').first().click();
  await page.waitForSelector('.lift');
  const hcard = page.locator('.lift', { hasText: stretchName });
  check('the finished workout shows the stretch with its seconds', (await hcard.count()) === 1 && (await hcard.locator('.set.stretch input').first().inputValue()) === '40');
  const wid = (await page.evaluate(() => location.hash)).split('/').pop();
  const w = (await api(`workout&id=${wid}`)).workout;
  const hist = (await api('history&limit=1')).workouts[0];
  const liftSets = w.exercises.filter((e) => e.kind !== 'stretch' && e.kind !== 'cardio').reduce((n, e) => n + e.sets.filter((x) => x.done && !x.warmup).length, 0);
  check('stretches add nothing to the workout\'s set count or volume', hist.sets === liftSets, JSON.stringify({ sets: hist.sets, liftSets }));
  await page.goto(`${URL}#/exercises`);
  await page.fill('.filters input', 'child');
  await page.waitForTimeout(300);
  check("stretches are in the Exercises library (Child's Pose)", (await page.textContent('.page')).includes("Child's Pose"));
  // Leave the account as the rest of the walk-through expects.
  await page.evaluate(async (id) => {
    const b = await (await fetch('api.php?a=bootstrap')).json();
    await fetch('api.php?a=delete_workout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify({ id }) });
  }, wid);
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('.plan-row');
  await setBox('Include stretches', false);
  await setBox('Include a warm-up', wasWarm);
}

console.log('Workout recap and records (#123)');
{
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('button:has-text("Start workout")');
  await page.click('button:has-text("Start workout")');
  await page.waitForSelector('.lift');
  const doc = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('tf.docs.'));
    const st = JSON.parse(localStorage.getItem(key));
    return st.docs.find((d) => d.id === st.activeId);
  });
  const lift = doc.exercises.find((e) => !['cardio', 'stretch'].includes(e.kind));
  const weight = lift.sets[0].weight || 50;
  // An earlier workout with the same lift at the same weight for fewer reps, so this one beats it.
  const earlier = await page.evaluate(async ([ex, w, gym]) => {
    const b = await (await fetch('api.php?a=bootstrap')).json();
    const id = crypto.randomUUID();
    const at = new Date(Date.now() - 2 * 86400000).toISOString();
    const body = { workout: { id, gym_id: gym, day_type: 'push', status: 'completed', unit: b.user.unit, started_at: at, completed_at: at, rev: 1,
      exercises: [{ id: crypto.randomUUID(), exercise_id: ex, rep_min: 6, rep_max: 10, target_sets: 1, sets: [{ id: crypto.randomUUID(), weight: w, reps: 5, warmup: false, done: true, done_at: at }] }] } };
    await fetch('api.php?a=save_workout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify(body) });
    return id;
  }, [lift.exercise_id, weight, doc.gym_id]);
  const card = page.locator('.lift', { hasText: lift.name }).first();
  const row = card.locator('.set').first();
  await row.locator('input').nth(0).fill(String(weight));
  await row.locator('input').nth(1).fill('30');
  await row.locator('.plate').click();
  await page.waitForTimeout(300);
  // Difficulty (#170): only once every set of the exercise is checked off.
  const diff = card.locator('button.difficulty');
  check('Difficulty? stays hidden while the exercise has unchecked sets', (await card.locator('.set:not(.done)').count()) > 0 && (await diff.count()) === 0);
  while ((await card.locator('.set:not(.done)').count()) > 0) {
    await card.locator('button:has-text("Remove set")').click();
    await page.waitForTimeout(150);
  }
  await diff.waitFor();
  check('with every set checked off, Difficulty? appears in the action row', (await diff.textContent()) === 'Difficulty?' && (await card.locator('.set-actions button.difficulty').count()) === 1);
  await diff.click();
  await page.waitForSelector('.sheet .choices');
  check('it asks how many more reps a typical working set had, with 0, 1, 2, 3 and 4+, without explaining the rules', /how many more reps could you have done with good form/.test(await page.textContent('.sheet')) && !/usual progression/.test(await page.textContent('.sheet')) && (await page.$$eval('.sheet .choice-label', (els) => els.map((e) => e.textContent).join())) === '0,1,2,3,4+');
  await page.locator('.sheet .choice', { hasText: '4+' }).click();
  await page.waitForFunction(() => document.querySelector('button.difficulty')?.textContent === 'Difficulty: 4+');
  await diff.click();
  await page.waitForSelector('.sheet .choices');
  await page.locator('.sheet .choice[data-value="0"]').click();
  await page.waitForFunction(() => document.querySelector('button.difficulty')?.textContent === 'Difficulty: 0');
  const rated = await page.evaluate((id) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('tf.docs.'));
    const st = JSON.parse(localStorage.getItem(key));
    return st.docs.find((d) => d.id === st.activeId).exercises.find((e) => e.id === id).reps_left;
  }, lift.id);
  check('the rating can be changed, shows on the card and is saved on the workout on the phone', rated === 0 && /rated/.test(await diff.getAttribute('class')));
  await page.click('button:has-text("Finish workout")');
  await page.waitForSelector('.sheet button:has-text("Finish and save")');
  await page.click('.sheet button:has-text("Finish and save")');
  await page.waitForSelector('.sheet .recap', { timeout: 20000 });
  const recapText = await page.textContent('.sheet');
  check('the recap counts the working sets, once', (recapText.match(/working set/g) || []).length === 1 && /1 working set across 1 exercise/.test(recapText), recapText);
  check(`a genuine improvement is called a New record (${lift.name})`, (await page.locator('.sheet .recap-record', { hasText: lift.name }).count()) === 1 && /× 30, (up from \d+ reps at that weight|the heaviest yet)/.test(recapText), recapText);
  await shot('36-recap-record');
  await page.locator('.sheet .recap-record a.recap-name').first().click();
  await page.waitForFunction((n) => document.querySelector('h1')?.textContent === n, lift.name);
  check('the record links to that exercise\'s history', /#\/exercises\/\d+/.test(await page.evaluate(() => location.hash)) && (await page.locator('.sheet').count()) === 0);
  const hist = (await api('history&limit=1')).workouts[0];
  const saved = (await api(`workout&id=${hist.id}`)).workout;
  check('the rating reached the server with the finished workout', saved.exercises.find((e) => e.exercise_id === lift.exercise_id)?.reps_left === 0, JSON.stringify(saved.exercises.map((e) => e.reps_left)));
  await page.goto(`${URL}#/history/${hist.id}`);
  await page.waitForSelector('.recap');
  check('the finished workout in History shows the same recap', (await page.locator('.recap .recap-record', { hasText: lift.name }).count()) === 1);
  check('no sideways scrolling on the recap', (await overflow()) <= 0);
  await shot('37-history-recap');
  // Share as an image (#160): drawn on the phone when asked, released on close.
  await page.click('.recap ~ button:has-text("Share workout"), button:has-text("Share workout")');
  await page.waitForSelector('.sheet canvas.share-card');
  const shareCard = await page.$eval('.sheet canvas.share-card', (cv) => ({ w: cv.width, h: cv.height, data: cv.toDataURL('image/png') }));
  const save = await page.$eval('.sheet a:has-text("Save image")', (a) => [a.getAttribute('download'), a.getAttribute('href').slice(0, 22)]);
  check('Share workout draws a phone-width PNG of the workout', shareCard.w === 1080 && shareCard.h > 900 && shareCard.data.startsWith('data:image/png'), `${shareCard.w}x${shareCard.h}`);
  check('a lift logged only above 10 reps gets no estimate on the share card', !(await page.getAttribute('.sheet canvas.share-card', 'aria-label')).includes('Est. 1RM'));
  check('Save image downloads it as a PNG', /^thoenefit-\d{4}-\d\d-\d\d\.png$/.test(save[0]) && save[1] === 'data:image/png;base64,', save.join());
  if (SHOTS) { const { writeFileSync } = await import('node:fs'); writeFileSync(`${SHOTS}/45-share-card.png`, Buffer.from(shareCard.data.split(',')[1], 'base64')); }
  await page.click('.sheet button:has-text("Close")');
  check('closing releases the image', (await page.locator('canvas.share-card').count()) === 0);
  await page.evaluate(async (ids) => {
    const b = await (await fetch('api.php?a=bootstrap')).json();
    for (const id of ids) await fetch('api.php?a=delete_workout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify({ id }) });
  }, [hist.id, earlier]);
}

console.log('Setup notes (#125)');
{
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('button:has-text("Start workout")');
  const day = await page.inputValue('select[aria-label="Workout type"]');
  await page.click('button:has-text("Start workout")');
  await page.waitForSelector('.lift');
  const card = page.locator('.lift', { has: page.locator('.set:not(.cardio):not(.stretch)') }).first();
  const name = (await card.locator('h2').textContent()).trim();
  check('a lift with no note shows none', (await card.locator('.setup-note').count()) === 0);
  // Write it with no signal: the note rides on the workout and syncs later.
  await context.setOffline(true);
  await card.locator('button[aria-label^="Options for"]').click();
  await page.click('.sheet button:has-text("Add setup note")');
  await page.fill('.sheet textarea[name=setup_note]', 'Seat on 4, wide handle');
  await shot('38-setup-note-sheet');
  await page.click('.sheet button:has-text("Save note")');
  check('the note shows under Last on the workout card straight away, even offline', (await card.locator('.setup-note').textContent()).trim() === 'Seat on 4, wide handle');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForSelector('#sync.saved', { timeout: 20000 }).catch(() => {});
  // Tap the note to change it.
  await card.locator('.setup-note').click();
  await page.fill('.sheet textarea[name=setup_note]', 'Seat on 5, wide handle');
  await page.click('.sheet button:has-text("Save note")');
  const row = card.locator('.set').first();
  if (!(await row.locator('input').nth(0).inputValue())) await row.locator('input').nth(0).fill('50');
  if (!(await row.locator('input').nth(1).inputValue())) await row.locator('input').nth(1).fill('8');
  await row.locator('.plate').click();
  await card.scrollIntoViewIfNeeded();
  await shot('39-setup-note-card');
  await page.click('button:has-text("Finish workout")');
  await page.waitForSelector('.sheet button:has-text("Finish and save")');
  await page.click('.sheet button:has-text("Finish and save")');
  await closeRecap(page);
  // The next matching workout shows it without opening History.
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('.plan-row');
  await page.selectOption('select[aria-label="Workout type"]', day);
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !document.querySelector('.stack.loading') && document.querySelectorAll('.plan-row').length > 0);
  const planRow = page.locator('.plan-row', { hasText: name }).first();
  check(`the next ${day} plan shows the updated note under ${name}`, (await planRow.count()) === 1 && (await planRow.locator('.setup-note').textContent()).trim() === 'Seat on 5, wide handle', name);
  await planRow.scrollIntoViewIfNeeded();
  await shot('40-setup-note-plan');
  check('no sideways scrolling with a note', (await overflow()) <= 0);
  // The exercise page lists the note per gym and can change it.
  const exHref = await planRow.locator('a.name-link').getAttribute('href');
  await page.goto(`${URL}${exHref}`);
  await page.waitForSelector('.note-row');
  const gymRow = page.locator('.note-row').first();
  check('the exercise page shows the note under its gym', (await page.locator('.section h2:has-text("Setup notes")').count()) === 1 && /My gym/.test(await gymRow.textContent()) && (await gymRow.locator('.setup-note').textContent()).trim() === 'Seat on 5, wide handle');
  await gymRow.locator('button:has-text("Edit")').click();
  await gymRow.locator('textarea[name=exercise_note]').fill('Seat on 6, wide handle');
  await gymRow.locator('button:has-text("Save note")').click();
  await waitForToast(page, /Note saved for My gym/);
  check('a note can be edited on the exercise page', (await page.locator('.note-row').first().locator('.setup-note').textContent()).trim() === 'Seat on 6, wide handle');
  await page.locator('.section', { hasText: 'Setup notes' }).scrollIntoViewIfNeeded();
  await shot('41-exercise-page-notes');
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('.plan-row');
  check("the change shows at once in Today's plan", (await page.locator('.plan-row', { hasText: name }).first().locator('.setup-note').textContent()).trim() === 'Seat on 6, wide handle');
  // Clear it from the next workout, so the rest of the walk-through starts clean.
  await page.click('button:has-text("Start workout")');
  await page.waitForSelector('.lift');
  await page.locator('.lift', { hasText: name }).first().locator('.setup-note').click();
  await page.click('.sheet button:has-text("Clear note")');
  check('a note can be cleared', (await page.locator('.lift', { hasText: name }).first().locator('.setup-note').count()) === 0);
  await page.goto(`${URL}#/today`);
  await page.click('button:has-text("Discard workout")');
  await page.click('.sheet button:has-text("Discard workout")');
  await page.waitForSelector('.plan-row');
  const hist = (await api('history&limit=1')).workouts[0];
  await page.evaluate(async (id) => {
    const b = await (await fetch('api.php?a=bootstrap')).json();
    await fetch('api.php?a=delete_workout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify({ id }) });
  }, hist.id);
}

console.log('Muscle illustrations (#150)');
{
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('.plan-row');
  await page.selectOption('select[aria-label="Workout type"]', 'pull');
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !document.querySelector('.stack.loading') && document.querySelectorAll('.plan-row').length > 0);
  const arts = await page.$$eval('.plan-row', (rows) => rows.map((r) => {
    const img = r.querySelector('img.muscle-art');
    return { name: r.querySelector('h3').textContent, target: r.querySelector('.target').textContent, muscle: img?.dataset.muscle || null, loaded: img ? img.complete && img.naturalWidth > 0 : null, alt: img?.getAttribute('alt'), hidden: img?.getAttribute('aria-hidden') };
  }));
  const lifts = arts.filter((a) => !/warm-up|moving|^Hold/.test(a.target));
  check('each planned lift shows its first primary muscle behind the text', lifts.length > 0 && lifts.every((a) => a.muscle && a.loaded), JSON.stringify(arts));
  check('the pull-day lats illustration appears for a lats exercise', arts.some((a) => a.muscle === 'lats'));
  check('the illustration is decorative for screen readers', lifts.every((a) => a.alt === '' && a.hidden === 'true'));
  check('cardio warm-ups and stretches keep a plain card', arts.filter((a) => /warm-up|moving|^Hold/.test(a.target)).every((a) => a.muscle === null));
  const row = page.locator('.plan-row.has-art').first();
  const z = await row.evaluate((r) => [getComputedStyle(r.querySelector('.muscle-art')).zIndex, getComputedStyle(r.querySelector('.plan-main')).zIndex, getComputedStyle(r.querySelector('.muscle-art')).opacity]);
  check('the text and buttons sit above the faint illustration', z[0] === '0' && z[1] === '1' && Number(z[2]) <= 0.3, z.join());
  check('no sideways scrolling with the illustrations', (await overflow()) <= 0);
  await row.scrollIntoViewIfNeeded();
  if (SHOTS) await row.screenshot({ path: `${SHOTS}/42-muscle-art-plan.png` });
  // The exercise page shows it in the space beside the details.
  const crunch = await page.evaluate(async () => (await (await fetch('api.php?a=bootstrap')).json()).exercises.find((e) => e.name === 'Ab Crunch Machine').id);
  await page.goto(`${URL}#/exercises/${crunch}`);
  await page.waitForSelector('.exercise-head');
  await page.waitForFunction(() => document.querySelector('.exercise-head img.muscle-art')?.complete);
  check('the exercise page shows the abs illustration beside the details', (await page.getAttribute('.exercise-head img.muscle-art', 'data-muscle')) === 'abs' && (await page.$eval('.exercise-head img.muscle-art', (i) => i.naturalWidth)) > 0);
  await shot('43-muscle-art-exercise');
  // Started workouts keep their cards as they were.
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('button:has-text("Start workout")');
  await page.click('button:has-text("Start workout")');
  await page.waitForSelector('.lift');
  check('workout cards after Start have no illustration', (await page.locator('.lift .muscle-art').count()) === 0);
  await page.goto(`${URL}#/today`);
  await page.click('button:has-text("Discard workout")');
  await page.click('.sheet button:has-text("Discard workout")');
  await page.waitForSelector('.plan-row');
}

console.log('Pick muscle groups, edit the plan, Quick Start (#154, #155, #127)');
{
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('.plan-row');
  const settle = async () => { await page.waitForTimeout(300); await page.waitForFunction(() => !document.querySelector('.stack.loading') && document.querySelectorAll('.plan-row').length > 0); };
  const names = () => page.$$eval('.plan-row h3', (els) => els.map((e) => e.textContent));
  await page.selectOption('select[aria-label="Workout type"]', 'pick-muscles');
  await page.waitForSelector('.muscle-tile');
  const tiles = await page.$$eval('.muscle-tile', (ts) => ts.map((t) => [t.dataset.muscle, t.querySelector('.muscle-pct').textContent, t.querySelector('img').complete]));
  check('Pick muscle groups shows all 13 with their recovery, most recovered first', tiles.length === 13 && tiles.every(([, p]) => /^\d+%/.test(p)) && tiles.map(([, p]) => parseInt(p, 10)).every((v, i, all) => i === 0 || all[i - 1] >= v), JSON.stringify(tiles));
  // #169: Build sits in the header next to Close, disabled and outlined until something is picked.
  const buildBtn = page.locator('.sheet-head .build-btn');
  const buildLook = () => buildBtn.evaluate((b) => { const s = getComputedStyle(b); return { text: b.textContent.trim(), disabled: b.disabled, bg: s.backgroundColor, color: s.color, border: s.borderTopColor, next: b.nextElementSibling?.textContent }; });
  const empty = await buildLook();
  check('Build sits in the muscle picker header, left of Close', empty.next === 'Close');
  check('with nothing picked, Build is disabled, with mint text and outline on dark gray', empty.text === 'Build' && empty.disabled && empty.color === 'rgb(58, 242, 156)' && empty.border === 'rgb(58, 242, 156)' && empty.bg === 'rgb(38, 45, 55)', JSON.stringify(empty));
  check('the old Build workout button at the bottom is gone', (await page.locator('.sheet-body button:has-text("Build workout")').count()) === 0);
  await page.click('.muscle-tile[data-muscle="lats"]');
  await page.click('.muscle-tile[data-muscle="biceps"]');
  const picked = await buildLook();
  const tileSel = await page.$eval('.muscle-tile[aria-pressed="true"]', (t) => { const c = getComputedStyle(t); return [c.borderTopColor, c.backgroundColor, getComputedStyle(t.querySelector('.muscle-name')).color]; });
  check('the build button counts the picks, filled mint', picked.text === 'Build (2)' && !picked.disabled && picked.bg === 'rgb(58, 242, 156)' && picked.color === 'rgb(14, 17, 21)', JSON.stringify(picked));
  await page.evaluate(() => document.querySelector('.sheet-body').scrollTo(0, 9999));
  const headFits = await page.evaluate(() => { const b = document.querySelector('.sheet-head .build-btn').getBoundingClientRect(); const c = [...document.querySelectorAll('.sheet-head button')].pop().getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight && c.right <= innerWidth && document.querySelector('.sheet-panel').scrollWidth <= innerWidth; });
  check('Build and Close stay visible and fit after scrolling the tiles', headFits);
  await shot('44-pick-muscles');
  await page.click('.sheet-head .build-btn');
  await settle();
  const arts = await page.$$eval('.plan-row img.muscle-art', (is) => is.map((i) => i.dataset.muscle));
  check('the plan trains only the picked groups', arts.length >= 2 && arts.every((m) => ['lats', 'biceps'].includes(m)) && arts.includes('lats') && arts.includes('biceps'), arts.join());
  {
    // #194: a pressed toggle (Lock) uses exactly the picked-tile highlight.
    const lockBtn = page.locator('.plan-row button[aria-pressed]').first();
    await lockBtn.click();
    const lockSel = await lockBtn.evaluate((b) => { const c = getComputedStyle(b); return [c.borderTopColor, c.backgroundColor, c.color]; });
    check('Locked uses the same highlight as a picked muscle tile (#194)', JSON.stringify(lockSel) === JSON.stringify(tileSel), JSON.stringify({ lockSel, tileSel }));
    await lockBtn.click();
  }
  check('the dropdown names the custom day', /Custom: Biceps, Lats/.test(await page.$eval('select[aria-label="Workout type"]', (s) => s.selectedOptions[0].textContent)));
  // Edit before starting (#155).
  const before = await names();
  const gone = (await page.locator('.plan-row.has-art').first().locator('h3').textContent()).trim();
  await page.locator('.plan-row.has-art').first().locator('button:has-text("Remove")').click();
  check('a planned lift can be removed', (await names()).length === before.length - 1 && !(await names()).includes(gone));
  await page.click('button:has-text("Add exercise")');
  await page.selectOption('.sheet select[aria-label="Muscle group"]', 'chest');
  await page.waitForTimeout(200);
  check('the picker can narrow to a muscle group', (await page.locator('.sheet .pick').count()) > 0);
  const added = (await page.locator('.sheet .pick .pick-name').first().textContent()).trim();
  await page.locator('.sheet .pick').first().click();
  await page.waitForFunction((n) => [...document.querySelectorAll('.plan-row h3')].some((e) => e.textContent === n), added);
  check(`an added lift (${added}) joins the plan with a target`, /sets of/.test(await page.locator('.plan-row', { hasText: added }).locator('.target').textContent()));
  await page.click('button:has-text("Regenerate")');
  await settle();
  const regen = await names();
  check('Regenerate keeps the added lift and does not bring back the removed one', regen.includes(added) && !regen.includes(gone), JSON.stringify({ added, gone, regen }));
  const planned = await names();
  await page.click('button:has-text("Start workout")');
  await page.waitForSelector('.lift');
  check('the workout starts with exactly the edited list', JSON.stringify(await page.$$eval('.lift h2', (els) => els.map((e) => e.textContent))) === JSON.stringify(planned));
  await page.goto(`${URL}#/today`);
  await page.click('button:has-text("Discard workout")');
  await page.click('.sheet button:has-text("Discard workout")');
  await page.waitForSelector('.plan-row');
  // Quick Start (#127).
  const countsLoaded = page.waitForResponse((r) => r.url().includes('a=exercise_counts'));
  await page.click('button:has-text("Quick start")');
  await page.waitForSelector('.sheet .pick');
  await countsLoaded;
  await page.waitForTimeout(100);
  check('Quick start opens an empty workout with the exercise picker', /#\/workout$/.test(await page.evaluate(() => location.hash)) && (await page.locator('.lift').count()) === 0);
  // #174: with no search, the lifter's most-performed exercises come first, ties and never-done alphabetical.
  {
    const listed = await page.$$eval('.sheet .pick .pick-name', (els) => els.map((e) => e.textContent.trim()));
    const counts = await page.evaluate(async () => {
      const b = await (await fetch('api.php?a=bootstrap')).json();
      return Object.fromEntries(b.exercises.map((x) => [x.name, b.exercise_counts[x.id] || 0]));
    });
    const n = listed.map((name) => counts[name]);
    const ordered = n.every((c, i) => i === 0 || n[i - 1] > c || (n[i - 1] === c && listed[i - 1].localeCompare(listed[i]) <= 0));
    check('Add exercise lists the most-performed exercises first (#174)', n[0] > 0 && ordered, listed.slice(0, 6).map((x, i) => `${x}:${n[i]}`).join(', '));
    await page.fill('.sheet input[type=search]', 'curl');
    await page.waitForTimeout(150);
    check('a search keeps relevance order rather than most-performed', /curl/i.test(await page.locator('.sheet .pick .pick-name').first().textContent()));
    await page.fill('.sheet input[type=search]', '');
    await page.waitForTimeout(150);
  }
  const first = (await page.locator('.sheet .pick .pick-name').first().textContent()).trim();
  await page.locator('.sheet .pick').first().click();
  await page.waitForSelector('.lift');
  const row = page.locator('.lift').first().locator('.set').first();
  if (!(await row.locator('input').nth(0).inputValue())) await row.locator('input').nth(0).fill('40');
  if (!(await row.locator('input').nth(1).inputValue())) await row.locator('input').nth(1).fill('10');
  await row.locator('.plate').click();
  await page.click('button:has-text("Finish workout")');
  await page.waitForSelector('.sheet button:has-text("Finish and save")');
  await page.click('.sheet button:has-text("Finish and save")');
  await closeRecap(page);
  const qs = (await api('history&limit=1')).workouts[0];
  check('the quick-start session is in History with its lift', qs.exercises.includes(first) && qs.sets >= 1, JSON.stringify(qs));
  await page.evaluate(async (id) => {
    const b = await (await fetch('api.php?a=bootstrap')).json();
    await fetch('api.php?a=delete_workout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify({ id }) });
  }, qs.id);
  check('no sideways scrolling', (await overflow()) <= 0);
}

console.log('Regenerate walks down the list (#211)');
{
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('.plan-row');
  await page.selectOption('select[aria-label="Workout type"]', 'push');
  const settled = () => page.waitForFunction(() => !document.querySelector('.stack.loading') && document.querySelector('.plan-row'));
  await settled();
  await page.waitForTimeout(300);
  const lifts = () => page.$$eval('.plan-row h3', (els) => els.map((e) => e.textContent).filter((n) => !/Bike|Treadmill|Rower|Elliptical|Stair/.test(n)).sort().join('|'));
  const plans = [await lifts()];
  for (let i = 0; i < 2; i++) {
    await page.click('button:has-text("Regenerate")');
    await page.waitForTimeout(150);
    await settled();
    await page.waitForTimeout(300);
    plans.push(await lifts());
  }
  check('three Regenerate taps give three different plans, not back to the first', new Set(plans).size === 3, JSON.stringify(plans));
}

console.log('Effort ratings plan the next workout (#198)');
{
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('.plan-row');
  // Two pull workouts a while back, both rated Hard on purpose.
  const ids = await page.evaluate(async () => {
    const b = await (await fetch('api.php?a=bootstrap')).json();
    const ex = b.exercises.find((x) => x.name === 'Barbell Row') || b.exercises.find((x) => x.pattern === 'horizontal_pull' && x.kind === 'barbell');
    const out = [];
    for (const days of [12, 10]) {
      const id = crypto.randomUUID();
      const at = new Date(Date.now() - days * 86400000).toISOString();
      const sets = [10, 10, 10].map((r) => ({ id: crypto.randomUUID(), weight: 95, reps: r, warmup: false, done: true, done_at: at }));
      await fetch('api.php?a=save_workout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify({ workout: { id, gym_id: b.user.active_gym_id, day_type: 'pull', status: 'completed', unit: 'lb', started_at: at, completed_at: at, effort: 'hard', effort_rated: true, rev: 1, exercises: [{ id: crypto.randomUUID(), exercise_id: ex.id, rep_min: 6, rep_max: 10, target_sets: 3, sets }] } }) });
      out.push(id);
    }
    return out;
  });
  await page.selectOption('select[aria-label="Workout type"]', 'pull');
  await page.waitForFunction(() => !document.querySelector('.stack.loading') && document.querySelector('.plan-row'));
  await page.waitForTimeout(300);
  const note = await page.locator('.effort-note').allTextContents();
  check('after two pull workouts rated Hard, the pull plan says once that it has fewer sets', note.length === 1 && note[0] === 'Your recent pull workouts felt hard, so this one has fewer sets.', JSON.stringify(note));
  await shot('49-effort-note');
  await page.evaluate(async (list) => {
    const b = await (await fetch('api.php?a=bootstrap')).json();
    for (const id of list) await fetch('api.php?a=delete_workout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify({ id }) });
  }, ids);
  await page.click('button:has-text("Regenerate")');
  await page.waitForFunction(() => !document.querySelector('.stack.loading') && document.querySelector('.plan-row'));
  await page.waitForTimeout(300);
  check('without those ratings the note goes away', (await page.locator('.effort-note').count()) === 0);
}

console.log('Stalled lifts (#124)');
{
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('.plan-row');
  await page.click('button:has-text("Add exercise")');
  await page.waitForSelector('.sheet .pick');
  // A barbell lift this gym has, not already planned, and never done before.
  const done = await page.evaluate(async () => {
    const b = await (await fetch('api.php?a=bootstrap')).json();
    const { counts } = await (await fetch('api.php?a=exercise_counts')).json();
    return b.exercises.filter((x) => counts[x.id]).map((x) => x.name);
  });
  const name = (await page.$$eval('.sheet .pick .pick-name', (els) => els.map((e) => e.textContent))).find((n) => /^Barbell /.test(n) && !done.includes(n));
  await page.click('.sheet button:has-text("Close")');
  const ids = await page.evaluate(async (n) => {
    const b = await (await fetch('api.php?a=bootstrap')).json();
    const ex = b.exercises.find((x) => x.name === n);
    const out = [];
    for (const days of [5, 4, 3]) {
      const id = crypto.randomUUID();
      const at = new Date(Date.now() - days * 86400000).toISOString();
      const sets = [8, 7, 6].map((r) => ({ id: crypto.randomUUID(), weight: 100, reps: r, warmup: false, done: true, done_at: at }));
      await fetch('api.php?a=save_workout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify({ workout: { id, gym_id: b.user.active_gym_id, day_type: 'custom', status: 'completed', unit: 'lb', started_at: at, completed_at: at, rev: 1, exercises: [{ id: crypto.randomUUID(), exercise_id: ex.id, rep_min: 6, rep_max: 10, target_sets: 3, sets }] } }) });
      out.push(id);
    }
    return out;
  }, name);
  await page.click('button:has-text("Add exercise")');
  await page.fill('.sheet input[type=search]', name);
  await page.waitForTimeout(200);
  await page.locator('.sheet .pick', { hasText: name }).first().click();
  const row = page.locator('.plan-row', { has: page.locator('h3', { hasText: name }) });
  await row.locator('.stall').waitFor();
  const box = await row.locator('.stall').textContent();
  check('a lift stuck at the same weight for 3 sessions offers repeat, lighter, swap or keep', /Stalled\. 100 lb for 3 sessions without more reps/.test(box) && /Repeat 100 × \d+/.test(box) && /Lower to 9\d × \d+/.test(box) && /Swap/.test(box) && /Keep suggestion/.test(box), box);
  const usual = await row.locator('.target').textContent();
  await row.locator('.stall button:has-text("Lower to")').click();
  const lowered = await row.locator('.target').textContent();
  check('choosing Lower changes today\'s target and says why', /at 9\d lb/.test(lowered) && /lighter day/.test(await row.locator('.why').textContent()) && (await row.locator('.stall').count()) === 0, lowered);
  await row.locator('.stall-change').click();
  check('Change brings back the choices and the usual suggestion', (await row.locator('.stall').count()) === 1 && (await row.locator('.target').textContent()) === usual);
  await row.locator('.stall button:has-text("Keep suggestion")').click();
  check('Keep suggestion leaves the usual target and closes the prompt', (await row.locator('.target').textContent()) === usual && (await row.locator('.stall').count()) === 0 && /keeping the usual suggestion/.test(await row.locator('.stall-chosen').textContent()));
  await shot('48-stall');
  await row.locator('button[aria-label^="Remove"]').click();
  await page.evaluate(async (list) => {
    const b = await (await fetch('api.php?a=bootstrap')).json();
    for (const id of list) await fetch('api.php?a=delete_workout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.csrf }, body: JSON.stringify({ id }) });
  }, ids);
}

console.log('Fixed page headers (#175)');
{
  await page.setViewportSize({ width: 402, height: 874 });
  const look = () => page.evaluate(() => {
    const head = document.querySelector('main > .top-head');
    if (!head) return null;
    const h1 = head.querySelector('h1');
    const hs = getComputedStyle(h1);
    let next = head.nextElementSibling;
    while (next && next.getBoundingClientRect().height === 0) next = next.nextElementSibling;
    return {
      position: getComputedStyle(head).position, top: Math.round(head.getBoundingClientRect().top), bottom: head.getBoundingClientRect().bottom,
      bg: getComputedStyle(head).backgroundColor, shadow: getComputedStyle(head).boxShadow,
      font: `${hs.fontSize} ${hs.fontWeight} ${hs.fontFamily}`, color: hs.color, left: Math.round(h1.getBoundingClientRect().left), h1Top: Math.round(h1.getBoundingClientRect().top),
      nextTop: next ? next.getBoundingClientRect().top : Infinity,
      logo: !!head.querySelector('.top-head-row > img.brand-wide'), logoTop: head.querySelector('.top-head-row > img.brand-wide')?.getBoundingClientRect().top, sub: head.querySelector('p.muted')?.textContent || '',
    };
  });
  await page.goto(`${URL}#/today`);
  await page.waitForSelector('.top-head');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300); // let the header shadow finish fading out
  const today = await look();
  const screens = {};
  for (const tab of ['history', 'trends', 'exercises', 'settings']) {
    await page.goto(`${URL}#/${tab}`);
    await page.waitForSelector('main > .top-head');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    screens[tab] = await look();
  }
  const same = Object.values(screens).every((x) => x.font === today.font && x.color === today.color && x.left === today.left && x.h1Top === today.h1Top);
  check('History, Trends, Exercises and Settings headers match Today: font, mint colour and position', today.color === 'rgb(58, 242, 156)' && same, JSON.stringify({ today, screens }));
  check('every top-level header has the wide logo top right, like Today', [today, ...Object.values(screens)].every((x) => x.logo));
  {
    // The first thing under each header starts the same distance below it (History had an empty slot adding a gap).
    const firstTop = async (tab) => {
      await page.goto(`${URL}#/${tab}`);
      await page.waitForSelector(tab === 'history' ? '.log-row' : 'main > .top-head');
      await page.waitForTimeout(300);
      return page.evaluate(() => {
        const head = document.querySelector('main > .top-head');
        let el = head.nextElementSibling;
        while (el && el.getBoundingClientRect().height === 0) el = el.nextElementSibling;
        return Math.round(el.getBoundingClientRect().top - head.getBoundingClientRect().bottom);
      });
    };
    const gaps = {};
    for (const t of ['today', 'history', 'trends', 'exercises', 'settings']) gaps[t] = await firstTop(t);
    check('content starts the same distance under the header on every tab, History included', Object.values(gaps).every((g) => g === gaps.today), JSON.stringify(gaps));
  }
  check('all top-level headers are the same height', Object.values(screens).every((x) => Math.abs(x.bottom - today.bottom) < 0.5), JSON.stringify([today.bottom, ...Object.values(screens).map((x) => x.bottom)]));
  {
    await page.click('.tab:has-text("Exercises")');
    await page.waitForSelector('[data-list=matches] .log-row');
    const read = async () => [await page.textContent('main > .top-head .ex-count'), await page.locator('[data-list=matches] .log-row').count()];
    await page.fill('input[aria-label="Search exercises"]', '');
    await page.selectOption('select[aria-label="Muscle"]', '');
    await page.waitForTimeout(150);
    const [all, allRows] = await read();
    await page.selectOption('select[aria-label="Muscle"]', 'biceps');
    await page.waitForTimeout(150);
    const [bi, biRows] = await read();
    await page.fill('input[aria-label="Search exercises"]', 'curl');
    await page.waitForTimeout(150);
    const [cu, cuRows] = await read();
    check('Exercises shows how many exercises are listed under its title, and it follows the filter and search', all === `${allRows} exercises` && bi === `${biRows} exercises` && cu === `${cuRows} exercise${cuRows === 1 ? '' : 's'}` && allRows > biRows && biRows >= cuRows, JSON.stringify([all, allRows, bi, biRows, cu, cuRows]));
    await page.fill('input[aria-label="Search exercises"]', '');
    await page.selectOption('select[aria-label="Muscle"]', '');
  }
  check('the logo sits in exactly the same spot on every tab, with or without a line under the title', Object.values(screens).every((x) => Math.abs(x.logoTop - today.logoTop) < 0.5), JSON.stringify([today.logoTop, ...Object.values(screens).map((x) => x.logoTop)]));
  {
    await page.click('.tab:has-text("History")');
    await page.waitForFunction(() => document.querySelector('main > .top-head h1')?.textContent === 'History');
    await page.evaluate(() => { window.__head = document.querySelector('main > .top-head'); window.__logo = window.__head.querySelector('img.brand-wide'); });
    const kept = [];
    for (const t of ['Trends', 'Exercises', 'Settings']) {
      await page.click(`.tab:has-text("${t}")`);
      await page.waitForFunction((x) => document.querySelector('main > .top-head h1')?.textContent === x, t);
      kept.push(await page.evaluate(() => document.querySelector('main > .top-head') === window.__head && document.querySelector('main > .top-head img.brand-wide') === window.__logo));
    }
    check('switching tabs keeps the same header and logo on screen and only changes the title, so nothing blinks', kept.every(Boolean), kept.join());
  }
  check('History says "Last 8 weeks." under its title, and Trends names its range there', screens.history.sub === 'Last 8 weeks.' && screens.trends.sub.startsWith('Last 8 weeks'), JSON.stringify([screens.trends.sub, screens.history.sub]));
  check('Settings shows the version under its title', /^Version /.test(screens.settings.sub), screens.settings.sub);
  {
    await page.click('.tab:has-text("History")');
    await page.waitForSelector('a.log-row[href^="#/history/"]');
    const all = (await page.evaluate(async () => (await (await fetch('api.php?a=history&limit=100')).json()).workouts)).map((w) => w.started_at);
    const cutoff = Date.now() - 56 * 86400000;
    const recent = all.filter((d) => new Date(d).getTime() >= cutoff).length;
    const before = await page.locator('a.log-row[href^="#/history/"]').count();
    check('History opens on the last 8 weeks only, with Show older at the bottom', all.length > recent && before === recent && await page.locator('button:has-text("Show older workouts")').isVisible(), JSON.stringify({ all: all.length, recent, before }));
    await page.click('button:has-text("Show older workouts")');
    await page.waitForFunction((n) => document.querySelectorAll('a.log-row[href^="#/history/"]').length > n, before);
    check('Show older adds the workouts from before the 8 weeks', (await page.locator('a.log-row[href^="#/history/"]').count()) === all.length && !(await page.locator('button:has-text("Show older workouts")').isVisible()));
  }
  check('every top-level header is held at the top, over the page background', [today, ...Object.values(screens)].every((x) => x.position === 'sticky' && x.top === 0 && x.bg === 'rgb(18, 21, 26)'));
  check('at the top of the page there is no shadow, and the first row starts below the header', [today, ...Object.values(screens)].every((x) => x.shadow === 'none' && x.nextTop >= x.bottom));
  for (const tab of ['exercises', 'settings']) {
    await page.goto(`${URL}#/${tab}`);
    await page.waitForSelector('main > .top-head');
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(300);
    const s = await look();
    check(`scrolling ${tab} keeps the header at the top with a drop shadow under it`, s.top === 0 && s.h1Top > 0 && s.shadow !== 'none', JSON.stringify(s));
  }
  await shot('47-fixed-header-scrolled');
  await page.evaluate(() => window.scrollTo(0, 0));
}

console.log('Send feedback');
{
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(`${URL}#/settings`);
  await page.waitForSelector('.settings-main');
  check('without a GitHub token there is no Send feedback option', (await page.locator('.link-row:has-text("Send feedback")').count()) === 0);
  // The test server has no token, so stand in for GitHub at the API's edge.
  const fctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await fctx.addInitScript(() => { try { localStorage.setItem('tf.install', JSON.stringify({ never: true })); } catch (e) { /* about:blank */ } });
  const sentList = [{ id: 1, kind: 'problem', title: 'Rest timer stops when the screen locks', issue_number: 41, issue_url: 'https://github.com/levitatedd/thoenefit/issues/41', status: 'done', created_at: '2026-11-10T12:00:00Z' }];
  let failNext = true;
  let lastSent = null;
  await fctx.route('**/api.php?a=*', async (route) => {
    const action = new globalThis.URL(route.request().url()).searchParams.get('a');
    if (action === 'bootstrap') {
      const response = await route.fetch();
      const json = await response.json();
      if (json.user) json.feedback_enabled = true;
      return route.fulfill({ response, json });
    }
    if (action === 'feedback') return route.fulfill({ json: { feedback: sentList } });
    if (action === 'all_feedback') return route.fulfill({ json: { feedback: sentList.map((f) => ({ ...f, from: 'E2E', username: 'e2e' })) } });
    if (action === 'send_feedback') {
      lastSent = route.request().postDataJSON();
      if (failNext) {
        failNext = false;
        return route.fulfill({ status: 502, json: { error: 'Your feedback could not be sent right now. Try again in a few minutes.' } });
      }
      sentList.unshift({ id: 2, kind: lastSent.kind, title: lastSent.title, issue_number: 42, issue_url: 'https://github.com/levitatedd/thoenefit/issues/42', status: 'sent', created_at: new Date().toISOString() });
      return route.fulfill({ json: { sent: sentList[0], feedback: sentList } });
    }
    return route.continue();
  });
  const fp = await fctx.newPage();
  fp.on('pageerror', (e) => errors.push(String(e)));
  await fp.goto(URL);
  await fp.fill('input[name=username]', USER);
  await fp.fill('input[name=password]', PASS);
  await fp.click('button[type=submit]');
  await fp.waitForSelector('.tabs');
  await fp.goto(`${URL}#/settings`);
  await fp.waitForSelector('.link-row:has-text("Send feedback")');
  check('with a token, Settings → Help offers Send feedback', true);
  await fp.click('.link-row:has-text("Send feedback")');
  await fp.waitForSelector('.feedback-row');
  check('it warns that feedback is public, under the button', /posted publicly on GitHub\. Don't include personal details\./.test(await fp.textContent('.public-note')));
  check('what you sent is listed with its status', /Rest timer stops/.test(await fp.textContent('.feedback-row')) && (await fp.textContent('.status-pill.done')) === 'Done');
  await fp.click('.choice:has-text("Problem")');
  await fp.fill('input[name=feedback_title]', 'Swap button is hard to hit');
  await fp.fill('textarea[name=feedback_body]', 'On a small phone I keep tapping Lock instead.');
  await fp.click('button[type=submit]:has-text("Send feedback")');
  await fp.waitForSelector('.form-error:not(:empty)');
  check('if it cannot be sent, it says so and keeps what was typed', /could not be sent/.test(await fp.textContent('.form-error')) && (await fp.inputValue('input[name=feedback_title]')) === 'Swap button is hard to hit' && /Lock instead/.test(await fp.inputValue('textarea[name=feedback_body]')));
  await fp.click('button[type=submit]:has-text("Send feedback")');
  await waitForToast(fp, /Thanks, your feedback was sent/);
  check('sending it thanks you, clears the form and lists it as Sent', (await fp.inputValue('input[name=feedback_title]')) === '' && /Swap button/.test(await fp.textContent('.feedback-row')) && (await fp.textContent('.feedback-row .status-pill')) === 'Sent');
  check('the app sends the type, title and details', lastSent?.kind === 'problem' && lastSent?.title === 'Swap button is hard to hit' && /Lock instead/.test(lastSent?.body), JSON.stringify(lastSent));
  check('no sideways scrolling on Send feedback', (await fp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  if (SHOTS) await fp.screenshot({ path: `${SHOTS}/26-send-feedback.png`, fullPage: true });
  await fp.goto(`${URL}#/settings/users`);
  await fp.waitForSelector('.feedback-list .feedback-row');
  check("the admin's Manage users lists feedback with who sent it", /E2E/.test(await fp.textContent('.feedback-list')));
  await fp.locator('.feedback-list').scrollIntoViewIfNeeded();
  if (SHOTS) await fp.screenshot({ path: `${SHOTS}/27-admin-feedback.png` });
  await fctx.close();
}

console.log('Sign out and clear local data');
{
  await page.setViewportSize({ width: 402, height: 874 });
  const myId = (await api('bootstrap')).user.id;
  const keys = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tf.')).sort());
  await page.goto(`${URL}#/settings`);
  await page.waitForSelector('button:has-text("Sign out and clear this device")');
  {
    const look = (t) => page.$eval(`.settings-main button:text-is("${t}")`, (b) => { const c = getComputedStyle(b); return [c.borderTopColor, c.color]; });
    const clear = await look('Sign out and clear this device');
    const plain = await look('Sign out');
    check('"Sign out and clear this device" has the red outline; plain Sign out keeps the standard one (#195)', clear[0] === 'rgb(255, 107, 94)' && clear[1] === 'rgb(255, 107, 94)' && plain[0] !== clear[0], JSON.stringify({ clear, plain }));
  }
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
  await page.waitForSelector('button:has-text("Start workout"), a:has-text("Back to workout")');
  check('signing back in works, and the discarded workout did not come back', (await page.locator('a:has-text("Back to workout")').count()) === 0);
  check('the synced history is still on the server', (await api('history')).workouts.length > 0);
}

check('no script errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
