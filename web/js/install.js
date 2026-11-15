// Installing ThoeneFit to the Home Screen (#89): which browser this is, the
// steps for it, and whether to remind someone using it in a browser tab.
// No DOM building here, so the rules can be read in one place.

const KEY = 'tf.install';
const SNOOZE_DAYS = 14;

/** Steps for every browser we know, in the order Settings lists them. */
export const GUIDES = [
  {
    key: 'ios-safari',
    name: 'iPhone or iPad, Safari',
    steps: [
      'Tap the Share button (the square with an arrow pointing up).',
      'Scroll down and tap Add to Home Screen.',
      'Tap Add.',
    ],
  },
  {
    key: 'ios-other',
    name: 'iPhone or iPad, Chrome, Edge or Firefox',
    steps: [
      'Tap the Share button, in the address bar or the browser menu.',
      'Tap Add to Home Screen, then Add.',
      'Not there? On iOS older than 16.4, open this page in Safari and add it from there.',
    ],
  },
  {
    key: 'android-chrome',
    name: 'Android, Chrome or Edge',
    steps: [
      'Tap the three-dot menu at the top right.',
      'Tap Install app (or Add to Home screen).',
      'Tap Install.',
    ],
  },
  {
    key: 'android-samsung',
    name: 'Android, Samsung Internet',
    steps: ['Tap the menu (three lines) at the bottom right.', 'Tap Add page to, then Home screen.', 'Tap Add.'],
  },
  {
    key: 'android-firefox',
    name: 'Android, Firefox',
    steps: ['Tap the three-dot menu.', 'Tap Install (or Add to Home screen).', 'Tap Add.'],
  },
  {
    key: 'desktop-chromium',
    name: 'Computer, Chrome or Edge',
    steps: [
      'Click the install icon at the right end of the address bar (a screen with an arrow).',
      'Or open the browser menu and choose Install ThoeneFit (in Edge: Apps, then Install this site as an app).',
    ],
  },
  {
    key: 'mac-safari',
    name: 'Mac, Safari',
    steps: ['In the menu bar, choose File, then Add to Dock.', 'Click Add.'],
  },
  {
    key: 'other',
    name: 'Other browsers',
    steps: [
      'Look in the browser menu for Install app, Add to Home Screen or Add to Dock.',
      'If there is no such option, open this page in Safari on iPhone, or Chrome on Android or a computer.',
    ],
  },
];

/** Which guide fits this browser. Feature checks first, the user agent as a fallback. */
export function detect(nav = navigator) {
  const ua = nav.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const samsung = /SamsungBrowser/i.test(ua);
  const firefox = /Firefox|FxiOS/i.test(ua);
  const edge = /Edg(e|A|iOS)?\//.test(ua);
  const chromium = /Chrome|CriOS|Chromium/.test(ua) || edge;
  let key = 'other';
  if (iOS) key = /CriOS|FxiOS|EdgiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  else if (android) key = samsung ? 'android-samsung' : firefox ? 'android-firefox' : chromium ? 'android-chrome' : 'other';
  else if (chromium && !firefox) key = 'desktop-chromium';
  else if (/Macintosh/.test(ua) && /Safari/.test(ua) && !firefox) key = 'mac-safari';
  return GUIDES.find((g) => g.key === key);
}

/** True when ThoeneFit is running as the installed app rather than in a browser tab. */
export function isInstalled(win = window) {
  try {
    if (win.navigator.standalone === true) return true; // iOS
    return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((m) => win.matchMedia(`(display-mode: ${m})`).matches);
  } catch (e) {
    return false;
  }
}

function read(storage) {
  try {
    return JSON.parse(storage.getItem(KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}

function write(storage, value) {
  try {
    storage.setItem(KEY, JSON.stringify(value));
  } catch (e) {
    // Private mode: the reminder just comes back next time.
  }
}

/** Counts a signed-in visit. The reminder waits for the second one, so it never greets a brand-new account. */
export function countVisit(storage = localStorage) {
  const s = read(storage);
  s.visits = (s.visits || 0) + 1;
  write(storage, s);
  return s.visits;
}

/** Whether to show the reminder now. */
export function shouldRemind({ storage = localStorage, win = window, now = Date.now() } = {}) {
  if (isInstalled(win)) return false;
  const s = read(storage);
  if (s.never || s.installed) return false;
  if ((s.visits || 0) < 2) return false;
  return !(s.snoozedUntil && now < s.snoozedUntil);
}

export function snooze(storage = localStorage, now = Date.now()) {
  write(storage, { ...read(storage), snoozedUntil: now + SNOOZE_DAYS * 86400000 });
}

export function neverRemind(storage = localStorage) {
  write(storage, { ...read(storage), never: true });
}

export function markInstalled(storage = localStorage) {
  write(storage, { ...read(storage), installed: true });
}
