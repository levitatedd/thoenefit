// Install reminder rules (#89): which steps each browser gets, and when to remind.
//   node tests/install.test.mjs

import { detect, isInstalled, shouldRemind, countVisit, snooze, neverRemind, markInstalled } from '../web/js/install.js';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok   ' : 'FAIL '} ${name}${ok || !detail ? '' : `  (${detail})`}`);
};
const nav = (userAgent, platform = '', maxTouchPoints = 0) => ({ userAgent, platform, maxTouchPoints });

console.log('Which steps each browser gets');
const cases = [
  ['iPhone Safari', nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1', 'iPhone', 5), 'ios-safari'],
  ['iPad asking for the desktop site', nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15', 'MacIntel', 5), 'ios-safari'],
  ['iPhone Chrome', nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1', 'iPhone', 5), 'ios-other'],
  ['iPhone Firefox', nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15', 'iPhone', 5), 'ios-other'],
  ['iPhone Edge', nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/131.2903.68 Mobile/15E148 Safari/605.1.15', 'iPhone', 5), 'ios-other'],
  ['Pixel Chrome', nav('Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', 'Linux armv8l', 5), 'android-chrome'],
  ['Android Edge', nav('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 EdgA/131.0.2903.70', 'Linux armv8l', 5), 'android-chrome'],
  ['Samsung Internet', nav('Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36', 'Linux armv8l', 5), 'android-samsung'],
  ['Android Firefox', nav('Mozilla/5.0 (Android 15; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0', 'Linux armv8l', 5), 'android-firefox'],
  ['Windows Chrome', nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Win32'), 'desktop-chromium'],
  ['Windows Edge', nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.70', 'Win32'), 'desktop-chromium'],
  ['Mac Chrome', nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'MacIntel'), 'desktop-chromium'],
  ['Mac Safari', nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15', 'MacIntel'), 'mac-safari'],
  ['Windows Firefox', nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Win32'), 'other'],
  ['Mac Firefox', nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0', 'MacIntel'), 'other'],
  ['an unknown browser', nav('SomethingNew/1.0'), 'other'],
];
for (const [label, n, want] of cases) {
  const got = detect(n);
  check(`${label} gets the ${want} steps`, got && got.key === want, got && got.key);
}
check('Safari steps say where the Share button is and to tap Add to Home Screen', /Share button/.test(detect(cases[0][1]).steps.join(' ')) && /Add to Home Screen/.test(detect(cases[0][1]).steps.join(' ')));

console.log('Installed or in a browser tab');
const win = (standalone, mode) => ({ navigator: { standalone }, matchMedia: (q) => ({ matches: mode !== null && q === `(display-mode: ${mode})` }) });
check('the iPhone Home Screen app counts as installed', isInstalled(win(true, null)) === true);
check('an installed app on Android or a computer counts as installed', isInstalled(win(undefined, 'standalone')) === true);
check('a browser tab does not', isInstalled(win(false, 'browser')) === false);

console.log('When to remind');
const store = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const tab = win(false, 'browser');
let s = store();
countVisit(s);
check('not on the first visit, so a new account is not greeted with it', shouldRemind({ storage: s, win: tab }) === false);
countVisit(s);
check('from the second visit in a browser tab', shouldRemind({ storage: s, win: tab }) === true);
check('never in the installed app', shouldRemind({ storage: s, win: win(true, null) }) === false);
const t0 = Date.UTC(2026, 10, 15);
snooze(s, t0);
check('"Not now" hides it for two weeks', shouldRemind({ storage: s, win: tab, now: t0 + 13 * 86400000 }) === false && shouldRemind({ storage: s, win: tab, now: t0 + 15 * 86400000 }) === true);
s = store();
countVisit(s);
countVisit(s);
neverRemind(s);
check('"Don\'t show this again" stops it for good', shouldRemind({ storage: s, win: tab, now: t0 + 400 * 86400000 }) === false);
s = store();
countVisit(s);
countVisit(s);
markInstalled(s);
check('once installed from the browser, the tab stops reminding too', shouldRemind({ storage: s, win: tab }) === false);
const broken = { getItem: () => '{not json', setItem: () => { throw new Error('full'); } };
check('broken or full storage never throws', (() => { countVisit(broken); return shouldRemind({ storage: broken, win: tab }) === false; })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
