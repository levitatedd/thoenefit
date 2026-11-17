import { Api, WorkoutSync, uuid, clearLocalData } from './store.js';
import { searchExercises, byUsage } from './search.js';
import { bestEstimate, estimateLabel, convertWeight, roundEstimate } from './strength.js';
import { APP_VERSION } from './version.js';
import { h, icon, fmtW, parseNum, fmtDate, fmtTime, fmtClock, fmtSets, fmtCardio, distUnit, metresTo, toMetres, toast, sheet, confirmSheet, choices, stepper, lineChart } from './ui.js';
import * as install from './install.js';

const api = new Api('api.php');
const root = document.getElementById('app');

const S = {
  user: null,
  gyms: [],
  exercises: [],
  exById: new Map(),
  vocab: null,
  offlineBoot: false,
  draft: null, // generated workout not started yet
  draftOpts: { day_type: null, minutes: null, bodyweight_only: false, warm_up: null, stretches: null },
  draftError: null,
  draftLoading: false,
  rest: null, // {endsAt, total}
};
let sync = null;
let ticker = null;
let wakeLock = null;
let audio = null;

// Goals (#192): four in the grid, the rest under Other goals.
const GOALS = [
  ['starter', 'Get Started', 'Fewer reps, easier workouts'],
  ['strength', 'Get Stronger', '4-6 reps, longer rests'],
  ['general', 'General Fitness', '8-12 reps, steady pace'],
  ['endurance', 'Muscular Endurance', '12-15 reps, short rests'],
];
const OTHER_GOALS = [
  ['weight_loss', 'Reduce Bodyweight', 'Higher reps, faster pace'],
  ['powerlifting', 'Powerlifting', 'Squat, bench, and deadlift'],
  ['muscle', 'Build Muscle', '6-10 reps on big lifts'],
];

/**
 * Goal picker (#192): the main goals in a grid, then a collapsed Other goals
 * row with the rest. One choice across both; the row names an Other goal when
 * it's the one chosen. Starts open when it is.
 */
function goalPicker(value, onPick) {
  let current = value;
  const label = () => OTHER_GOALS.find(([k]) => k === current)?.[1];
  const sync = () => {
    for (const b of wrap.querySelectorAll('.choice')) b.setAttribute('aria-pressed', String(b.dataset.value === current));
    rowValue.textContent = label() || '';
  };
  const pick = (v) => {
    current = v;
    sync();
    onPick(v);
  };
  const main = choices(GOALS, value, pick, { columns: 2 });
  const other = choices(OTHER_GOALS, value, pick, { columns: 1 });
  const rowValue = h('span', { class: 'other-goals-value' });
  const open = !!OTHER_GOALS.find(([k]) => k === value);
  other.hidden = !open;
  const row = h('button', { type: 'button', class: 'other-goals-row', 'aria-expanded': String(open), onclick: () => {
    other.hidden = !other.hidden;
    row.setAttribute('aria-expanded', String(!other.hidden));
  } }, h('span', { class: 'other-goals-label' }, 'Other Goals'), rowValue, icon('back', 18));
  const wrap = h('div', { class: 'stack goal-picker' }, main, row, other);
  sync();
  return wrap;
}
const LEVELS = [
  ['beginner', 'Beginner', 'Under a year'],
  ['intermediate', 'Intermediate', '1-3 years'],
  ['advanced', 'Advanced', '3+ years'],
];
const SPLITS = [
  ['full', 'Full body', 'Everything, every session'],
  ['upper_lower', 'Upper / lower', 'Alternates two days'],
  ['ppl', 'Push / pull / legs', 'Rotates three days'],
];

// ---------------------------------------------------------------- boot

api.onUnauthorized = () => {
  if (S.user) {
    S.user = null;
    render();
  }
};

// Fixed headers (#175) cast a shadow once content scrolls under them.
const markScrolled = () => document.body.classList.toggle('scrolled', window.scrollY > 2);
window.addEventListener('scroll', markScrolled, { passive: true });

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!bootBuild) serverBuild().then((b) => (bootBuild = bootBuild || b));
  root.replaceChildren(h('div', { class: 'splash' }, brandMark(), h('p', { class: 'muted' }, 'Loading')));
  let data = null;
  try {
    data = await api.get('bootstrap');
    if (data.user) localStorage.setItem('tf.boot', JSON.stringify({ ...data, active: null, csrf: null }));
  } catch (e) {
    try {
      data = JSON.parse(localStorage.getItem('tf.boot') || 'null');
    } catch (err) {
      data = null;
    }
    if (!data) {
      root.replaceChildren(
        h(
          'div',
          { class: 'splash' },
          brandMark(),
          h('p', { class: 'muted' }, e.offline ? 'No connection. Connect once to load the app, then it works offline.' : e.message),
          h('button', { class: 'btn primary', type: 'button', onclick: boot }, 'Try again'),
        ),
      );
      return;
    }
    S.offlineBoot = true;
  }
  if (!data.user) {
    S.user = null;
    render();
    return;
  }
  applyBoot(data);
  install.countVisit();
  render();
  let updated = null;
  try {
    updated = sessionStorage.getItem('tf.updated');
    sessionStorage.removeItem('tf.updated');
  } catch (e) {
    updated = null;
  }
  if (updated) {
    // Offer the notes only when this release has some.
    loadChangelog().then(
      ({ releases }) => (releases[0]?.version === APP_VERSION
        ? toast("ThoeneFit was updated. Tap to see what's new.", '', () => { location.hash = '#/settings/whats-new'; })
        : toast('ThoeneFit was updated.')),
      () => toast('ThoeneFit was updated.'),
    );
  }
}

function applyBoot(data) {
  S.user = data.user;
  S.strava = data.strava;
  S.feedbackEnabled = !!data.feedback_enabled;
  S.pendingRequests = data.pending_requests || 0;
  S.gyms = data.gyms;
  S.shares = data.shares || [];
  S.routines = data.routines || [];
  S.vocab = data.vocab;
  setExercises(data.exercises);
  S.exerciseCounts = data.exercise_counts || {};
  if (data.csrf) api.csrf = data.csrf;
  if (!sync || sync.key !== `tf.docs.${S.user.id}`) {
    sync = new WorkoutSync({
      storage: localStorage,
      key: `tf.docs.${S.user.id}`,
      send: (doc) => api.post('save_workout', { workout: doc }),
      remove: (id) => api.post('delete_workout', { id }),
      onChange: paintSync,
    });
    sync.load();
  }
  if (!S.offlineBoot) {
    const local = sync.active;
    if (data.active) {
      const mine = sync.docs.get(data.active.id);
      if (!mine ? !local : !mine._dirty && mine.rev <= data.active.rev) sync.adopt(data.active);
    } else if (local && !local._dirty) {
      sync.drop(local.id); // finished or discarded on another device
    }
    sync.flush();
  }
  try {
    S.rest = JSON.parse(localStorage.getItem('tf.rest') || 'null');
  } catch (e) {
    S.rest = null;
  }
}

function setExercises(list) {
  S.exercises = list;
  S.exById = new Map(list.map((e) => [e.id, e]));
}

window.addEventListener('online', () => {
  if (sync) sync.flush();
  if (S.offlineBoot) {
    S.offlineBoot = false;
    boot();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (sync) sync.flush();
    keepAwake();
    checkForUpdate();
  }
});
window.addEventListener('online', () => checkForUpdate());

// ---------------------------------------------------------------- installing (#89)
// Android Chrome and Edge offer their own install prompt. Keep it so the reminder
// can show an Install button instead of written steps.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});
window.addEventListener('appinstalled', () => {
  install.markInstalled();
  installPrompt = null;
  document.querySelectorAll('.install-card').forEach((el) => el.remove());
});

async function promptInstall(btn) {
  const ev = installPrompt;
  if (!ev) return false;
  if (btn) btn.disabled = true;
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    if (choice && choice.outcome === 'accepted') {
      install.markInstalled();
      document.querySelectorAll('.install-card').forEach((el) => el.remove());
    }
  } catch (e) {
    // The browser declined to show it again; the written steps still work.
  }
  installPrompt = null;
  if (btn) btn.disabled = false;
  return true;
}

/** The steps for one browser, numbered. */
function installSteps(guide) {
  return h('ol', { class: 'steps' }, guide.steps.map((step) => h('li', {}, step)));
}

/** Popup with the steps for this browser and phone. */
function installSheet() {
  const guide = install.detect();
  let close = null;
  close = sheet('Install ThoeneFit', h('div', { class: 'stack', 'data-install-guide': guide.key },
    installPrompt && h('button', { class: 'btn primary block', type: 'button', onclick: async (e) => {
      await promptInstall(e.currentTarget);
      close();
    } }, 'Install'),
    h('p', { class: 'muted' }, installPrompt ? `Or do it from the browser (${guide.name}):` : `On ${guide.name}:`),
    installSteps(guide),
    h('p', { class: 'muted small' }, 'Afterwards, open ThoeneFit from its icon instead of the browser. Your workouts and history stay the same. Steps for other browsers are in Settings.')));
}

/** One-time reminder on Today for someone using ThoeneFit in a browser tab. */
function installCard() {
  if (!install.shouldRemind()) return null;
  const card = h('section', { class: 'card install-card' },
    h('h2', {}, 'Install ThoeneFit'),
    h('p', { class: 'muted' }, 'Add it to your Home Screen so it opens full screen and keeps working when the gym has no signal.'),
    h('div', { class: 'plan-actions' },
      h('button', { class: 'btn small primary', type: 'button', onclick: async (e) => {
        if (!(await promptInstall(e.currentTarget))) installSheet();
      } }, installPrompt ? 'Install' : 'Show me how'),
      h('button', { class: 'btn small', type: 'button', onclick: () => {
        install.snooze();
        card.remove();
      } }, 'Not now')),
    h('button', { class: 'btn ghost small', type: 'button', onclick: () => {
      install.neverRemind();
      card.remove();
    } }, "Don't show this again"));
  return card;
}

// ---------------------------------------------------------------- staying up to date
// An app on the Home Screen is usually resumed, not reloaded, so it could keep
// running an old version for days. Each deploy writes its commit id to
// version.json; when the app comes back to the screen and that id has changed,
// it reloads itself. Workouts in progress are saved on the phone, so nothing is
// lost, and it waits if you are in the middle of typing or have a sheet open.

let bootBuild = null;

async function serverBuild() {
  try {
    const res = await fetch('version.json', { cache: 'no-store' });
    return res.ok ? (await res.json()).build || null : null;
  } catch (e) {
    return null; // offline: try again next time
  }
}

async function checkForUpdate() {
  if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
  const build = await serverBuild();
  if (!build) return;
  if (!bootBuild) {
    bootBuild = build;
    return;
  }
  if (build === bootBuild) return;
  const busy = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (busy || document.querySelector('.sheet')) return; // checked again the next time the app is opened
  try {
    sessionStorage.setItem('tf.updated', build);
  } catch (e) {
    // Private mode: reload without the note.
  }
  location.reload();
}
window.addEventListener('hashchange', render);

// ---------------------------------------------------------------- shell

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return parts.length ? parts : ['today'];
}

function go(path) {
  if (location.hash === `#/${path}`) render();
  else location.hash = `#/${path}`;
}

function render() {
  clearInterval(ticker);
  ticker = null;
  if (!S.user) {
    root.replaceChildren(S.authView === 'request' ? viewRequest() : viewLogin());
    window.scrollTo(0, 0);
    return;
  }
  S.authView = null;
  if (!S.user.onboarded) {
    root.replaceChildren(viewOnboarding());
    return;
  }
  const [tab, arg, arg2] = route();
  // S.backTo = {to, path, label, y}: valid only while on the page it was set for.
  const here = route().join('/');
  let restoreY = null;
  if (S.backTo && S.backTo.to !== here) {
    if (S.backTo.path === here) restoreY = S.backTo.y;
    S.backTo = null;
  }
  let view;
  if (tab === 'workout') view = viewWorkout();
  else if (tab === 'history') view = arg ? viewHistoryDetail(arg) : viewHistory();
  else if (tab === 'people') view = arg2 ? viewPersonWorkout(Number(arg), arg2) : viewPersonHistory(Number(arg));
  else if (tab === 'trends') view = viewTrends();
  else if (tab === 'exercises') view = arg === 'new' ? viewExerciseForm(null) : arg === 'edit' ? viewExerciseForm(Number(arg2)) : arg ? viewExercise(Number(arg)) : viewExercises();
  else if (tab === 'settings') {
    const sub = { import: viewImport, users: viewUsers, 'whats-new': viewWhatsNew, routines: viewRoutines, strava: viewStrava, install: viewInstallHelp, password: viewPassword, feedback: viewFeedback }[arg];
    view = arg === 'gym' ? viewGymForm(arg2 === 'new' ? null : Number(arg2)) : sub ? sub() : viewSettings();
  }
  else view = viewToday();
  // The main page of each tab has a mint heading, like Today and Settings (#103).
  if (!arg && ['history', 'trends', 'exercises'].includes(tab)) view.classList.add('tab-home');
  const current = tab === 'workout' ? 'today' : tab === 'people' ? 'history' : tab;
  const nav = h(
    'nav',
    { class: 'tabs', 'aria-label': 'Main' },
    [
      ['history', 'History', 'history'],
      ['trends', 'Trends', 'trends'],
      ['today', 'Workout', 'today'],
      ['exercises', 'Exercises', 'list'],
      ['settings', 'Settings', 'gear'],
    ].map(([key, label, ic]) => (key === 'today' && sync?.active
      // During a workout: Pause / Resume on the workout itself, and a plain way back to it from anywhere else.
      ? (tab === 'workout' ? pauseTab() : h('a', { href: '#/workout', class: `tab workout-tab ${sync.active.paused_at ? 'paused' : ''}`, 'aria-label': sync.active.paused_at ? 'Workout, paused' : 'Workout in progress' }, h('span', { class: 'tab-icon' }, icon('today', 24)), h('span', {}, 'Workout')))
      : h('a', { href: `#/${key}`, class: 'tab', 'aria-current': current === key ? 'page' : null }, h('span', { class: 'tab-icon' }, icon(ic, 24)), h('span', {}, label)))),
  );
  // During a workout the Today spot pauses it (#111), so other tabs get a way back to it.
  // On a screen with a fixed header (#175) it rides along under the title.
  if (sync?.active && tab !== 'workout') {
    const top = view.querySelector(':scope > .top-head');
    if (top) top.append(backToWorkoutBar());
    else view.prepend(backToWorkoutBar());
  }
  // Going to the top of a different screen: scroll there before swapping the
  // content in. Swapping a long page for a short one (History and Trends while
  // they load) while still scrolled down lets iPhones lift the tab bar off the
  // bottom of the screen (#112).
  const toTop = restoreY === null && !(tab === S.lastTab && !S.backTo);
  if (toTop) window.scrollTo(0, 0);
  // Keep the header that is already on screen and update it in place (#175), so
  // switching tabs doesn't rebuild the logo and title and make them blink.
  const liveHead = root.querySelector(':scope > main > .top-head');
  const nextHead = view.querySelector(':scope > .top-head');
  if (liveHead && nextHead) {
    morph(liveHead, nextHead);
    nextHead.replaceWith(liveHead);
  }
  root.replaceChildren(view, restDock(), nav);
  if (tab === 'settings' && ['strava-connected', 'strava-denied', 'strava-error'].includes(arg)) {
    history.replaceState(null, '', '#/settings');
    if (arg === 'strava-connected') toast('Strava connected.');
    else if (arg === 'strava-denied') toast('Allow Strava activity access to send workouts.', 'bad');
    else toast('Could not connect to Strava. Try again in Settings.', 'bad');
  }
  // A page opened from another one (an exercise from Today, a workout from a
  // chart, ...) shows a back link to where it came from, and that screen comes
  // back at the spot it was left.
  if (restoreY !== null) window.scrollTo(0, restoreY);
  else window.scrollTo(0, tab === S.lastTab && !S.backTo ? window.scrollY : 0);
  markScrolled(); // the header shadow follows the new scroll position straight away
  S.lastTab = tab;
  startTicker();
  keepAwake();
}

/**
 * The header of a top-level screen (#175): Today's look (mint title, muted line
 * under it, the wide logo on the right unless something else goes there, like
 * the workout clock), held at the top while the page scrolls.
 */
function topHead(title, { sub = null, right = brandWide('head'), rowClass = '' } = {}) {
  return h('header', { class: 'page-head top-head' },
    h('div', { class: `top-head-row ${rowClass}`.trim() }, h('div', {}, h('h1', {}, title), sub && h('p', { class: 'muted' }, sub)), right));
}

/**
 * The shared pinned header (#175) for a detail page (#202): the back link on
 * the left and the page's title on the right, in the header's title type.
 */
function detailHead(back, title) {
  return h('header', { class: 'page-head top-head detail-head' },
    h('div', { class: 'top-head-row' }, h('div', { class: 'detail-back' }, back), h('h1', { class: `detail-title${title.length > 20 ? ' long' : title.length > 12 ? ' mid' : ''}` }, title)));
}

function page(title, ...kids) {
  return h('main', { class: 'page' }, title && h('h1', {}, title), kids);
}

/**
 * Make `live` match `next` by changing only what differs: text, attributes and
 * children. For plain markup only: event listeners on `next` are not copied, and
 * code holding elements of `next` must look them up again once it is on screen.
 */
function morph(live, next) {
  if (live.nodeType === Node.TEXT_NODE) {
    if (live.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue;
    return;
  }
  for (const { name } of [...live.attributes]) if (!next.hasAttribute(name)) live.removeAttribute(name);
  for (const { name, value } of [...next.attributes]) if (live.getAttribute(name) !== value) live.setAttribute(name, value);
  const want = [...next.childNodes];
  want.forEach((n, i) => {
    const have = live.childNodes[i];
    if (!have) live.append(n);
    else if (have.nodeType === n.nodeType && have.nodeName === n.nodeName) morph(have, n);
    else have.replaceWith(n);
  });
  while (live.childNodes.length > want.length) live.lastChild.remove();
}

/** Replace an element's children, skipping anything falsy (so `cond && node` is safe). */
function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false && k !== ''));
}

/** The square barbell logo, for compact spots. */
function brandMark() {
  return h('img', { class: 'brand-mark', src: 'icons/logo-mark.png', width: 256, height: 256, alt: 'ThoeneFit' });
}

/** The wide ThoeneFit logo. variant: '' (centred footer), 'lead' (top of sign-in), 'small' (top of setup). */
function brandWide(variant = '') {
  return h('img', { class: `brand-wide ${variant}`.trim(), src: 'icons/logo-wide.png', width: 900, height: 146, alt: 'ThoeneFit' });
}

/** Exercise name that opens that exercise's history, with a way back to the screen it was tapped on. */
function historyLink(exerciseId, name, path, label) {
  return h('a', {
    class: 'name-link',
    href: `#/exercises/${exerciseId}`,
    'aria-label': `${name}: view history`,
    onclick: () => (S.backTo = { to: `exercises/${exerciseId}`, path, label, y: window.scrollY }),
  }, name, icon('history', 18));
}

/** Back link for a page that may have been opened from somewhere other than its own list. */
function backOr(path, label) {
  return S.backTo ? backLink(S.backTo.path, S.backTo.label) : backLink(path, label);
}

function backLink(path, label) {
  return h('a', { class: 'back', href: `#/${path}` }, icon('back', 20), label);
}

function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint && h('span', { class: 'field-hint' }, hint));
}

function section(title, ...kids) {
  return h('section', { class: 'section' }, title && h('h2', {}, title), kids);
}

async function act(fn, button) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (e) {
    toast(e.offline ? 'No connection. Try again when you are back online.' : e.message, 'bad');
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

// ---------------------------------------------------------------- sign in

function viewLogin() {
  const error = h('p', { class: 'form-error', role: 'alert' });
  const user = h('input', { type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true });
  const pass = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in');
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = '';
        btn.disabled = true;
        try {
          await api.post('login', { username: user.value, password: pass.value });
          S.offlineBoot = false;
          await boot();
        } catch (err) {
          error.textContent = err.offline ? 'No connection to the server.' : err.message;
          btn.disabled = false;
        }
      },
    },
    field('Username', user),
    field('Password', pass),
    error,
    btn,
  );
  const request = h('button', { class: 'btn ghost block', type: 'button', onclick: () => {
    S.authView = 'request';
    render();
  } }, 'Request an account');
  return h('main', { class: 'page narrow' }, brandWide('lead'), form, request);
}

// ---------------------------------------------------------------- onboarding and profile

function trainingFields(values, onChange) {
  return [
    field('Weight unit', choices([['lb', 'Pounds'], ['kg', 'Kilograms']], values.unit, (v) => onChange('unit', v), { columns: 2 })),
    field('Goal', goalPicker(values.goal, (v) => onChange('goal', v))),
    field('Training experience', choices(LEVELS, values.experience, (v) => onChange('experience', v), { columns: 3 })),
    field('Usual workout length', stepper(values.minutes, { min: 15, max: 150, step: 5, suffix: ' min', onChange: (v) => onChange('minutes', v) })),
    field('Training split', choices(SPLITS, values.split_type, (v) => onChange('split_type', v), { columns: 1 })),
  ];
}

function equipmentPicker(gym) {
  const boxes = new Map();
  const groups = S.vocab.equipment.map((g) =>
    h(
      'fieldset',
      { class: 'checks' },
      h('legend', {}, g.group),
      Object.entries(g.items).map(([key, label]) => {
        const box = h('input', { type: 'checkbox', checked: gym.equipment.includes(key), onchange: () => (gym.equipment = [...boxes].filter(([, b]) => b.checked).map(([k]) => k)) });
        boxes.set(key, box);
        return h('label', { class: 'check' }, box, h('span', {}, label));
      }),
    ),
  );
  const presets = h(
    'div',
    { class: 'chips' },
    S.vocab.presets.map((p) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          onclick: () => {
            gym.equipment = [...p.equipment];
            for (const [k, b] of boxes) b.checked = gym.equipment.includes(k);
          },
        },
        p.name,
      ),
    ),
  );
  return h('div', { class: 'stack' }, field('Start from a preset', presets, 'Then tick or untick anything below. Exercises that need no equipment are always available.'), groups);
}

function viewOnboarding() {
  const profile = { unit: S.user.unit, goal: S.user.goal, experience: S.user.experience, minutes: S.user.minutes, split_type: S.user.split_type };
  const gym = { name: 'My gym', equipment: S.vocab.presets[0].equipment.slice(), increments: {} };
  const name = h('input', { type: 'text', value: gym.name, maxlength: 100, required: true });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Save and build my first workout');
  return h(
    'main',
    { class: 'page' },
    brandWide('small'),
    h('h1', {}, `Welcome, ${S.user.display_name}`),
    h('p', { class: 'muted' }, 'A few choices so the first workout fits. Everything here can be changed later in Settings.'),
    h(
      'form',
      {
        class: 'stack',
        onsubmit: async (e) => {
          e.preventDefault();
          await act(async () => {
            const g = await api.post('save_gym', { name: name.value, equipment: gym.equipment, increments: {} });
            S.gyms = g.gyms;
            const u = await api.post('save_profile', { ...profile, active_gym_id: g.gym.id, onboarded: true });
            S.user = u.user;
            S.draft = null;
            go('today');
          }, btn);
        },
      },
      section('How you train', trainingFields(profile, (k, v) => (profile[k] = v))),
      section('Where you train', field('Gym name', name, 'For example the name of your gym, or "Home". You can add more locations later.'), equipmentPicker(gym)),
      btn,
    ),
  );
}

// ---------------------------------------------------------------- today

function activeGym() {
  return S.gyms.find((g) => g.id === S.user.active_gym_id) || S.gyms[0] || null;
}

async function loadDraft({ regenerate = false } = {}) {
  const gym = activeGym();
  if (!gym) return;
  const body = { gym_id: gym.id, bodyweight_only: S.draftOpts.bodyweight_only, warm_up: S.draftOpts.warm_up ?? !!S.user.warm_up, stretches: S.draftOpts.stretches ?? !!S.user.stretches };
  if (S.draftOpts.day_type) body.day_type = S.draftOpts.day_type;
  if (S.draftOpts.day_type === 'custom') body.muscles = S.draftOpts.muscles || []; // picked muscle groups (#154)
  if (S.draftOpts.minutes) body.minutes = S.draftOpts.minutes;
  if (S.draft && regenerate) {
    body.locked = {};
    body.avoid = [];
    for (const b of S.draft.exercises) {
      if (b.locked) body.locked[b.slot] = b.exercise_id;
      else body.avoid.push(b.exercise_id);
    }
    body.avoid.push(...(S.draftRemoved || [])); // removed by hand (#155): do not bring them back
  } else if (S.draft) {
    body.locked = Object.fromEntries(S.draft.exercises.filter((b) => b.locked).map((b) => [b.slot, b.exercise_id]));
  }
  S.draftLoading = true;
  S.draftError = null;
  if (route()[0] === 'today') render();
  try {
    // A shared workout this person accepted takes the place of their own plan until they start or drop it.
    const accepted = (S.shares || []).find((x) => x.status === 'accepted');
    let res = null;
    if (accepted) {
      try {
        res = await api.post('shared_draft', { id: accepted.id, gym_id: gym.id });
        setExercises(res.exercises);
      } catch (e) {
        if (e.status !== 404) throw e;
        S.shares = S.shares.filter((x) => x.id !== accepted.id); // it lapsed or was withdrawn
      }
    }
    // A saved routine picked under Workout (#16).
    if (!res && S.draftOpts.routine_id) {
      try {
        res = await api.post('routine_draft', { id: S.draftOpts.routine_id, gym_id: gym.id });
      } catch (e) {
        if (e.status !== 404) throw e;
        S.draftOpts.routine_id = null; // deleted on another device
      }
    }
    if (!res) {
      res = await api.post('generate', body);
      // Lifts added by hand (#155) stay through Regenerate and option changes.
      const extra = (S.draftAdded || []).filter((b) => !res.workout.exercises.some((x) => x.exercise_id === b.exercise_id));
      if (extra.length) {
        res.workout.exercises.push(...extra);
        res.workout.est_minutes = Math.round(res.workout.exercises.reduce((n, b) => n + (Number(b.minutes) || 0), 0));
      }
      S.draftOpts.day_type = res.workout.day_type;
      S.draftOpts.minutes = res.workout.minutes;
    }
    S.draft = res.workout;
    pushSharedPlan();
  } catch (e) {
    S.draftError = e.offline ? 'You are offline. Connect to build a new workout.' : e.message;
  }
  S.draftLoading = false;
  if (route()[0] === 'today') render();
}

function blockToEntry(b) {
  return {
    id: uuid(),
    exercise_id: b.exercise_id,
    name: b.name,
    kind: b.kind,
    pattern: b.pattern,
    target_sets: b.target_sets,
    rep_min: b.rep_min,
    rep_max: b.rep_max,
    rest_seconds: b.rest_seconds,
    suggested_weight: b.suggested_weight,
    reason: b.reason,
    previous: b.previous || null,
    note: b.note || null,
    target_seconds: b.target_seconds ?? null,
    per_side: perSideStretch(b),
    sets: isStretch(b)
      ? Array.from({ length: b.target_sets }, () => stretchSet(b.target_seconds))
      : isCardio(b)
      ? [cardioSet(b.target_seconds, b.previous)]
      : Array.from({ length: b.target_sets }, () => ({ id: uuid(), weight: b.suggested_weight, reps: b.suggested_reps, warmup: false, done: false, done_at: null })),
  };
}

/** One stretch hold (#138), filled in with the planned seconds. */
function stretchSet(seconds) {
  return { id: uuid(), weight: null, reps: null, warmup: false, duration_s: seconds || 30, done: false, done_at: null };
}

/** L / R for a stretch done on each side, otherwise the hold's number. */
function holdTag(e, si) {
  return perSideStretch(e) && e.sets.length === 2 ? (si === 0 ? 'L' : 'R') : String(si + 1);
}

/** Seconds input for a stretch hold. */
function secondsInput(s, onChange) {
  return h('input', { class: 'num', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', 'aria-label': 'Seconds', value: s.duration_s == null ? '' : String(s.duration_s),
    oninput: (ev) => { const v = parseNum(ev.target.value); onChange(v == null ? null : Math.max(0, Math.round(v))); } });
}

/** A cardio set (#18), filled in with the target time and the level used last time. */
function cardioSet(seconds, previous) {
  const lastLevel = previous && previous.sets.length ? previous.sets[previous.sets.length - 1].level : null;
  return { id: uuid(), weight: null, reps: null, warmup: false, done: false, done_at: null, duration_s: seconds || 600, distance_m: null, level: lastLevel ?? null };
}

/** Minutes, distance and level inputs for a cardio set. onChange gets the field that changed. */
function cardioInputs(s, unit, onChange) {
  const input = (label, value, inputmode, field, toValue) => h('input', {
    class: 'num',
    type: 'text',
    inputmode,
    enterkeyhint: 'done',
    'aria-label': label,
    placeholder: field === 'duration_s' ? 'min' : field === 'distance_m' ? distUnit(unit) : 'lvl',
    value,
    onfocus: (ev) => ev.target.select(),
    oninput: (ev) => onChange(field, toValue(parseNum(ev.target.value))),
  });
  const show = (v, places) => (v == null ? '' : String(Number(v.toFixed(places))));
  return [
    input('Minutes', show(s.duration_s == null ? null : s.duration_s / 60, 1), 'decimal', 'duration_s', (v) => (v == null ? null : Math.round(v * 60))),
    input(`Distance in ${distUnit(unit) === 'mi' ? 'miles' : 'kilometres'} (optional)`, show(metresTo(s.distance_m, unit), 2), 'decimal', 'distance_m', (v) => (v == null ? null : Math.round(toMetres(v, unit) * 10) / 10)),
    input('Level (optional)', show(s.level, 1), 'decimal', 'level', (v) => v),
  ];
}

function startWorkout() {
  const d = S.draft;
  S.draftAdded = [];
  S.draftRemoved = [];
  sync.start({
    id: uuid(),
    gym_id: d.gym_id,
    gym_name: d.gym_name,
    day_type: d.day_type,
    status: 'active',
    unit: d.unit,
    started_at: new Date().toISOString(),
    completed_at: null,
    notes: d.shared_by ? `Shared by ${d.shared_by}` : d.routine_name ? `Routine: ${d.routine_name}` : null,
    routine_id: d.routine_id || undefined,
    // share_id: this came from someone's shared plan. share_key: this person shared it with others.
    share_id: d.share_id || undefined,
    share_key: S.shareKey || undefined,
    exercises: d.exercises.map(blockToEntry),
  });
  if (d.share_id) S.shares = (S.shares || []).filter((x) => x.id !== d.share_id);
  if (d.routine_id) {
    // Next time Today suggests a workout again, rather than repeating the routine.
    S.draftOpts.routine_id = null;
    S.draftOpts.day_type = null;
  }
  S.shareKey = null;
  S.draft = null;
  primeAudio();
  go('workout');
}

// ---------------------------------------------------------------- saved routines (#16)

/** Popup to name and save a routine. A name already in use replaces that routine. */
function routineSheet(suggested, plan) {
  const taken = (name) => (S.routines || []).find((r) => r.name.toLowerCase() === name.trim().replace(/\s+/g, ' ').toLowerCase());
  const name = h('input', { type: 'text', name: 'routine_name', maxlength: 80, value: suggested || '', autocomplete: 'off', required: true });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' });
  const label = () => (btn.textContent = taken(name.value) ? 'Replace routine' : 'Save routine');
  name.addEventListener('input', label);
  label();
  let close = null;
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    error.textContent = '';
    btn.disabled = true;
    try {
      const r = await api.post('save_routine', { name: name.value, plan });
      S.routines = r.routines;
      close();
      const saved = r.routines.find((x) => x.id === r.id);
      toast(r.replaced ? `Updated ${saved.name}.` : `Saved ${saved.name}. Pick it under Workout on Today.`);
      if (route()[0] === 'today' || route()[0] === 'settings') render();
    } catch (err) {
      error.textContent = err.offline ? 'Saving a routine needs a connection.' : err.message;
      btn.disabled = false;
    }
  } },
    field('Name', name, 'For example: Monday Push. Saved with these exercises, sets and rep ranges; weights are suggested from your history each time.'),
    h('p', { class: 'muted small' }, `${plan.exercises.length} exercise${plan.exercises.length === 1 ? '' : 's'}, ${plan.exercises.reduce((n, e) => n + e.target_sets, 0)} sets.`),
    error,
    btn);
  close = sheet('Save as routine', form);
  name.focus();
  name.select();
}

/** Settings list of saved routines, with rename and delete. */
function routinesList() {
  const list = h('div', { class: 'stack', 'data-list': 'routines' });
  const paint = () => {
    const rs = S.routines || [];
    fill(list,
      !rs.length && h('p', { class: 'muted' }, 'No routines yet. Use Save as routine under a planned workout on Today, or on a past workout in History.'),
      rs.map((r) => h('div', { class: 'routine-row', 'data-routine': r.name },
        h('div', {}, h('span', { class: 'pick-name' }, r.name), h('span', { class: 'pick-meta' }, `${r.exercises.length} exercises, ${r.sets} sets: ${r.exercises.slice(0, 3).join(', ')}${r.exercises.length > 3 ? '…' : ''}`)),
        h('div', { class: 'plan-actions' },
          h('button', { class: 'btn small', type: 'button', onclick: () => renameRoutine(r, paint) }, 'Rename'),
          h('button', { class: 'btn small danger', type: 'button', onclick: async (e) => {
            const b = e.currentTarget;
            if (!(await confirmSheet(`Delete ${r.name}?`, 'The routine is removed. Workouts you did with it stay in your history.', 'Delete routine', true))) return;
            const res = await act(() => api.post('delete_routine', { id: r.id }), b);
            if (res) {
              S.routines = res.routines;
              if (S.draftOpts.routine_id === r.id) {
                S.draftOpts.routine_id = null;
                S.draft = null;
              }
              toast(`Deleted ${r.name}.`);
              paint();
            }
          } }, 'Delete')))));
  };
  paint();
  return list;
}

function renameRoutine(r, done) {
  const name = h('input', { type: 'text', name: 'routine_name', maxlength: 80, value: r.name, autocomplete: 'off', required: true });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Rename');
  let close = null;
  close = sheet('Rename routine', h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      S.routines = (await api.post('rename_routine', { id: r.id, name: name.value })).routines;
      close();
      done();
    } catch (err) {
      error.textContent = err.offline ? 'Renaming needs a connection.' : err.message;
      btn.disabled = false;
    }
  } }, field('Name', name), error, btn));
  name.focus();
}

// ---------------------------------------------------------------- sharing a workout

/** What gets shared: exercises in order with planned sets, rep range and rest. Never weights. */
function planOf(dayType, exercises, setsOf) {
  return { day_type: dayType, exercises: exercises.map((e) => ({ exercise_id: e.exercise_id, target_sets: setsOf(e), rep_min: e.rep_min, rep_max: e.rep_max, rest_seconds: e.rest_seconds })) };
}

/** If the planned workout was shared and has since changed, the people who have not answered yet get the new version. */
function pushSharedPlan() {
  if (!S.shareKey || !S.draft || S.draft.share_id) return;
  api.post('share_workout', { share_key: S.shareKey, to: [], plan: planOf(S.draft.day_type, S.draft.exercises, (b) => b.target_sets) }).catch(() => {});
}

let sharesCheckedAt = 0;
async function refreshShares(force = false) {
  if (!S.user || (!force && Date.now() - sharesCheckedAt < 15000) || navigator.onLine === false) return;
  sharesCheckedAt = Date.now();
  try {
    const before = JSON.stringify(S.shares || []);
    S.shares = (await api.get('shares')).incoming;
    if (JSON.stringify(S.shares) !== before && route()[0] === 'today') render();
  } catch (e) {
    // Offline or signed out: the cards simply stay as they were.
  }
}

/** Sheet for sending a plan to other people and seeing what each has done with it. */
async function shareSheet({ key, plan, workoutId }) {
  const list = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Loading'));
  sheet('Share this workout', h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'They get the same exercises, order and planned sets. Weights are suggested from their own history, and each of you logs your own workout.'),
    list));
  const label = { pending: 'Sent, waiting for them', accepted: 'Accepted', started: 'Training now', declined: 'Declined', expired: 'Not answered' };
  const paint = (people, outgoing) => {
    const state = Object.fromEntries(outgoing.map((o) => [o.to, o.status]));
    fill(list,
      !people.length && h('p', { class: 'muted' }, 'Nobody else has an account on this server yet.'),
      people.map((p) => {
        const st = state[p.id];
        const again = st === 'declined' || st === 'expired' || st === 'started';
        return h('div', { class: 'share-row', 'data-person': p.name },
          h('div', {}, h('span', { class: 'pick-name' }, p.name), st && h('span', { class: `pick-meta share-status ${st}` }, label[st] || st)),
          (!st || again) && h('button', { class: 'btn small primary', type: 'button', onclick: async (e) => {
            const r = await act(() => api.post('share_workout', { share_key: key(), to: [p.id], plan: plan(), workout_id: workoutId }), e.currentTarget);
            if (r) {
              paint(people, r.outgoing);
              toast(`Shared with ${p.name}.`);
            }
          } }, again ? 'Send again' : 'Send'));
      }));
  };
  try {
    const [people, shares] = await Promise.all([api.get('people'), api.get('shares', `&key=${encodeURIComponent(key())}`)]);
    paint(people.people, shares.outgoing);
  } catch (e) {
    fill(list, h('p', { class: 'muted' }, e.offline ? 'Sharing needs a connection.' : e.message));
  }
}

/** Cards on Today for workouts other people have shared with this person and are waiting on. */
function shareCards() {
  return (S.shares || []).filter((x) => x.status === 'pending').map((x) => h('section', { class: 'card share-card', 'data-share': x.id },
    h('h2', {}, `${x.from_name} shared a workout with you`),
    h('p', { class: 'muted' }, `${dayLabel(x.day_type)}, ${x.exercises.length} exercises, ${x.sets} sets: ${x.exercises.slice(0, 4).join(', ')}${x.exercises.length > 4 ? ` and ${x.exercises.length - 4} more` : ''}.`),
    h('p', { class: 'muted small' }, 'You get the same exercises and sets. Weights are suggested from your own history.'),
    h('div', { class: 'plan-actions' },
      h('button', { class: 'btn small primary', type: 'button', onclick: (e) => respondToShare(x, true, e.currentTarget) }, 'Accept'),
      h('button', { class: 'btn small', type: 'button', onclick: (e) => respondToShare(x, false, e.currentTarget) }, 'Decline'))));
}

async function respondToShare(share, accept, btn) {
  const r = await act(() => api.post('share_respond', { id: share.id, accept }), btn);
  if (!r) {
    refreshShares(true);
    return;
  }
  S.shares = r.incoming;
  if (accept) {
    S.draft = null; // Today now builds from the shared plan
    S.draftError = null;
    toast(sync.active ? `Accepted. ${share.from_name}'s workout will be on Today once your current one is finished.` : `Accepted ${share.from_name}'s workout.`);
  }
  render();
}

function viewToday() {
  const gym = activeGym();
  const active = sync.active;
  refreshShares();
  // The wide logo sits top right, beside the heading.
  const head = topHead('Today', { sub: fmtDate(new Date().toISOString(), { weekday: 'long', month: 'long', day: 'numeric' }), rowClass: 'today-head' });
  const waiting = sync.waiting ? h('p', { class: 'notice' }, `${sync.waiting} finished workout${sync.waiting > 1 ? 's are' : ' is'} saved on this phone and will upload when you are back online.`) : null;

  if (active) {
    const done = active.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
    const total = active.exercises.reduce((n, e) => n + e.sets.length, 0);
    return h(
      'main',
      { class: 'page' },
      head,
      waiting,
      shareCards(),
      h(
        'section',
        { class: 'card resume' },
        h('h2', {}, `${dayLabel(active.day_type)} workout in progress`),
        h('p', { class: 'muted' }, `${active.gym_name}, started ${fmtTime(active.started_at)}. ${done} of ${total} sets logged.`),
        h('a', { class: 'btn primary block', href: '#/workout' }, 'Back to workout'),
        h(
          'button',
          {
            class: 'btn ghost block',
            type: 'button',
            onclick: async () => {
              if (await confirmSheet('Discard this workout?', 'Everything logged in it is deleted. This cannot be undone.', 'Discard workout', true)) {
                sync.discard(active.id);
                stopRest();
                render();
              }
            },
          },
          'Discard workout',
        ),
      ),
    );
  }

  if (!gym) {
    return h('main', { class: 'page' }, head, h('section', { class: 'card' }, h('h2', {}, 'Add a gym first'), h('p', { class: 'muted' }, 'A workout is built from the equipment at a gym profile.'), h('a', { class: 'btn primary block', href: '#/settings/gym/new' }, 'Add a gym')));
  }

  // An accepted share replaces whatever plan was on screen; dropping it brings the usual plan back.
  const acceptedShare = (S.shares || []).find((x) => x.status === 'accepted');
  if (S.draft && !S.draftLoading && (S.draft.share_id || 0) !== (acceptedShare ? acceptedShare.id : 0)) S.draft = null;
  if (!S.draft && !S.draftLoading && !S.draftError) loadDraft();
  const shared = S.draft && S.draft.share_id ? S.draft : null;

  const gymSelect = h(
    'select',
    {
      'aria-label': 'Gym',
      onchange: async (e) => {
        const id = Number(e.target.value);
        S.user.active_gym_id = id;
        S.draft = null;
        loadDraft();
        act(async () => {
          const r = await api.post('save_profile', { active_gym_id: id });
          S.user = r.user;
        });
      },
    },
    S.gyms.map((g) => h('option', { value: g.id, selected: g.id === gym.id }, g.name)),
  );
  const days = [...new Set(Object.values(S.vocab.split_days).flat())];
  const preferred = S.vocab.split_days[S.user.split_type] || [];
  const ordered = [...preferred, ...days.filter((d) => !preferred.includes(d))];
  const daySelect = h(
    'select',
    {
      'aria-label': 'Workout type',
      onchange: (e) => {
        const v = e.target.value;
        if (v === 'pick-muscles') {
          e.target.value = S.draftOpts.routine_id ? `routine:${S.draftOpts.routine_id}` : S.draftOpts.day_type || '';
          musclePicker();
          return;
        }
        S.draftAdded = [];
        S.draftRemoved = [];
        if (v === 'custom') return;
        if (v.startsWith('routine:')) {
          S.draftOpts.routine_id = Number(v.slice(8));
        } else {
          S.draftOpts.routine_id = null;
          S.draftOpts.day_type = v;
        }
        S.draft = null;
        loadDraft();
      },
    },
    h('optgroup', { label: 'Suggested' },
      ordered.map((d) => h('option', { value: d, selected: !S.draftOpts.routine_id && d === (S.draft ? S.draft.day_type : S.draftOpts.day_type) }, dayLabel(d))),
      // Picked muscle groups (#154).
      S.draftOpts.day_type === 'custom' && (S.draftOpts.muscles || []).length > 0 && h('option', { value: 'custom', selected: !S.draftOpts.routine_id }, `Custom: ${S.draftOpts.muscles.map((m) => S.vocab.muscles[m]).join(', ')}`),
      h('option', { value: 'pick-muscles' }, 'Pick muscle groups…')),
    (S.routines || []).length > 0 && h('optgroup', { label: 'Your routines' },
      S.routines.map((r) => h('option', { value: `routine:${r.id}`, selected: S.draftOpts.routine_id === r.id }, r.name))),
  );
  const routine = S.draft && S.draft.routine_id ? S.draft : null;
  const controls = routine && !shared
    ? h('section', { class: 'stack' },
        h('div', { class: 'notice routine-note' }, h('strong', {}, `Routine: ${routine.routine_name}. `), 'The same exercises and sets each time. Weights are suggested from your history, with your last numbers under each exercise.'),
        h('div', { class: 'controls' }, field('Gym', gymSelect), field('Workout', daySelect)))
    : shared
    ? h('section', { class: 'stack' },
        h('div', { class: 'notice shared-note' }, h('strong', {}, `Shared by ${shared.shared_by}. `), 'Same exercises, order and sets as theirs. The weights below are suggested from your own history.'),
        field('Gym', gymSelect, 'Pick the gym you are at, so machine history lines up.'))
    : h(
    'section',
    { class: 'controls' },
    field('Gym', gymSelect),
    field('Workout', daySelect),
    h('label', { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: S.draftOpts.bodyweight_only,
        disabled: S.draftLoading,
        onchange: (e) => {
          clearTimeout(S.minutesTimer);
          S.draftOpts.bodyweight_only = e.target.checked;
          loadDraft(); // the current plan stays, dimmed, until the new one arrives, so nothing jumps
        },
      }),
      'Bodyweight only',
    ),
    // Stretches (#138): cooldown stretches after lifting, plus dynamic ones after a warm-up. Remembered.
    h('label', { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: S.draftOpts.stretches ?? !!S.user.stretches,
        disabled: S.draftLoading,
        onchange: (e) => {
          clearTimeout(S.minutesTimer);
          S.draftOpts.stretches = e.target.checked;
          S.user.stretches = e.target.checked;
          loadDraft();
        },
      }),
      'Include stretches',
    ),
    // A warm-up: a cardio machine (#18), or dynamic stretches with no machine (#138). Always
    // shown, so the boxes never shift while a plan is being built. The choice is remembered.
    h('label', { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: S.draftOpts.warm_up ?? !!S.user.warm_up,
        disabled: S.draftLoading,
        onchange: (e) => {
          clearTimeout(S.minutesTimer);
          S.draftOpts.warm_up = e.target.checked;
          S.user.warm_up = e.target.checked;
          loadDraft();
        },
      }),
      'Include a warm-up',
    ),
    field(
      'Time',
      stepper(S.draftOpts.minutes || S.user.minutes, {
        min: 15,
        max: 150,
        step: 5,
        suffix: ' min',
        onChange: (v) => {
          S.draftOpts.minutes = v;
          clearTimeout(S.minutesTimer);
          S.minutesTimer = setTimeout(() => loadDraft(), 500);
        },
      }),
    ),
  );

  let body;
  if (S.draftError) {
    body = h('section', { class: 'card' }, h('p', {}, S.draftError), h('button', { class: 'btn block', type: 'button', onclick: () => loadDraft() }, 'Try again'));
  } else if (!S.draft) {
    body = h('p', { class: 'muted pad' }, 'Building your workout');
  } else {
    const d = S.draft;
    body = h(
      'div',
      { class: S.draftLoading ? 'stack loading' : 'stack' },
      h('p', { class: 'summary' }, planSummary(d)),
      // How recent workouts felt changed the plan (#198): said once, for the whole workout.
      d.effort_note && h('p', { class: 'effort-note' }, d.effort_note),
      d.skipped.map((s) => h('p', { class: 'notice' }, s)),
      h(
        'ol',
        { class: 'plan' },
        d.exercises.map((b) => planRow(b, gym)),
      ),
      h('div', { class: 'plan-edit' },
        h('button', { class: 'btn block', type: 'button', onclick: () => addExerciseSheet({ gym_id: d.gym_id, exercises: d.exercises }, (block) => {
          block.slot = `added${Date.now()}`;
          block.locked = false;
          S.draft.exercises.push(block);
          S.draftAdded = [...(S.draftAdded || []), block];
          replanTime();
          pushSharedPlan();
          render();
        }) }, icon('plus', 18), 'Add exercise')),
      d.exercises.length > 0 && h('button', { class: 'btn block', type: 'button', onclick: () => routineSheet(d.routine_name || dayLabel(d.day_type), planOf(d.day_type, d.exercises, (b) => b.target_sets)) }, icon('plus', 18), d.routine_id ? 'Save changes to this routine' : 'Save as routine'),
      // Quick Start (#127): an empty workout, built as you go.
      h('div', { class: 'quick-start-box' },
        h('button', { class: 'btn block quick-start', type: 'button', onclick: quickStart }, icon('bolt', 18), 'Quick Start'),
        h('p', { class: 'muted small center' }, 'Start an empty workout')),
    );
  }

  return h(
    'main',
    { class: 'page has-bar' },
    head,
    waiting,
    shareCards(),
    installCard(),
    controls,
    body,
    h(
      'div',
      { class: 'action-bar' },
      shared
        ? h('button', { class: 'btn', type: 'button', onclick: (e) => respondToShare({ id: shared.share_id, from_name: shared.shared_by }, false, e.currentTarget) }, 'Use my own')
        : !routine && h('button', { class: 'btn', type: 'button', disabled: !S.draft || S.draftLoading, onclick: () => loadDraft({ regenerate: true }) }, 'Regenerate'),
      !shared && h('button', { class: 'btn square', type: 'button', 'aria-label': 'Share this workout', disabled: !S.draft || S.draftLoading || !S.draft.exercises.length, onclick: () => shareSheet({
        key: () => (S.shareKey = S.shareKey || uuid()),
        plan: () => planOf(S.draft.day_type, S.draft.exercises, (b) => b.target_sets),
      }) }, icon('share')),
      h('button', { class: 'btn primary grow', type: 'button', disabled: !S.draft || S.draftLoading || !S.draft.exercises.length, onclick: startWorkout }, 'Start workout'),
    ),
  );
}

function dayLabel(d) {
  return (S.vocab.day_labels && S.vocab.day_labels[d]) || 'Custom';
}

const isCardio = (b) => b.kind === 'cardio';

/** "Warm-up, 5 exercises and 7 stretches, about 49 minutes" */
function planSummary(d) {
  const lifts = d.exercises.filter((b) => !isTimed(b)).length;
  // Without a cardio machine the warm-up is the dynamic stretches, so they are not counted twice.
  const stretchWarmUp = d.warm_up && d.warm_up_kind === 'stretches';
  const stretches = d.exercises.filter((b) => isStretch(b) && !(stretchWarmUp && b.pattern === 'dynamic_stretch')).length;
  const warm = d.warm_up ? (stretchWarmUp ? 'Stretch warm-up' : 'Warm-up') : '';
  const ex = `${lifts} exercise${lifts === 1 ? '' : 's'}`;
  const list = stretches
    ? `${warm ? `${warm}, ` : ''}${ex} and ${stretches} stretch${stretches === 1 ? '' : 'es'}`
    : `${warm ? `${warm} and ` : ''}${ex}`;
  return `${d.bodyweight_only ? 'Bodyweight only · ' : ''}${list}, about ${d.est_minutes} minutes`;
}

const isStretch = (b) => b.kind === 'stretch';
const isTimed = (b) => isCardio(b) || isStretch(b);
/** A stretch done once on each side: two holds, left then right (#138). */
const perSideStretch = (b) => isStretch(b) && (b.per_side ?? S.exById.get(b.exercise_id)?.per_side ?? false);

function targetLine(b, unit) {
  if (isCardio(b)) return `${Math.round((b.target_seconds || 600) / 60)} min warm-up`;
  if (isStretch(b)) {
    const sec = `${b.target_seconds || 30} s${perSideStretch(b) ? ' each side' : ''}`;
    return b.pattern === 'dynamic_stretch' ? `${sec}, moving` : b.pattern === 'static_stretch' ? `Hold ${sec}` : sec;
  }
  const w = b.suggested_weight != null ? ` at ${fmtW(b.suggested_weight)} ${unit}${b.kind === 'dumbbell' ? ' each' : ''}` : '';
  return `${b.target_sets} sets of ${b.rep_min}-${b.rep_max}${w}`;
}

function lastLine(previous) {
  if (!previous || !previous.sets.length) return 'No history yet';
  const thisYear = new Date(previous.date).getFullYear() === new Date().getFullYear();
  return `Last: ${fmtSets(previous.sets, previous.unit)} on ${fmtDate(previous.date, thisYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** A saved setup note (#125), shown under Last. onEdit makes it tappable. */
function noteLine(note, onEdit) {
  if (!note) return null;
  const body = [icon('pencil', 16), h('span', {}, note)];
  return onEdit
    ? h('button', { type: 'button', class: 'setup-note', 'aria-label': `Setup note: ${note}. Tap to edit`, onclick: onEdit }, ...body)
    : h('p', { class: 'setup-note' }, ...body);
}

/** Add, change or clear an exercise's setup note during a workout. It rides on the workout, so it saves offline. */
function noteSheet(e, edit, gymName) {
  const input = h('textarea', { name: 'setup_note', rows: 3, maxlength: 200, placeholder: 'For example: seat on 4, wide handle' }, e.note || '');
  const save = (value) => {
    close();
    edit((d) => {
      const t = d.exercises.find((x) => x.id === e.id);
      t.note = value || null;
      t.setup_note = value;
    });
    toast(value ? 'Setup note saved.' : 'Setup note cleared.');
  };
  const close = sheet(e.note ? 'Edit setup note' : 'Add setup note', h('form', { class: 'stack', onsubmit: (ev) => { ev.preventDefault(); save(input.value.trim()); } },
    field(e.name, input, `Shown next time ${e.name} comes up ${gymName ? `at ${gymName}` : 'in a workout with no gym'}. Each gym keeps its own note. Only you can see it.`),
    h('button', { class: 'btn primary block', type: 'submit' }, 'Save note'),
    e.note && h('button', { class: 'btn block', type: 'button', onclick: () => save('') }, 'Clear note')));
  input.focus();
}

/** A note saved on the exercise page also shows at once in today's plan and a workout in progress at that gym. */
function applyNoteLocally(exerciseId, gymId, note) {
  if (S.draft && S.draft.gym_id === gymId) {
    for (const b of S.draft.exercises) if (b.exercise_id === exerciseId) b.note = note;
  }
  const doc = sync && sync.active;
  if (doc && doc.gym_id === gymId) {
    for (const e of doc.exercises) {
      if (e.exercise_id !== exerciseId) continue;
      e.note = note;
      if ('setup_note' in e) e.setup_note = note || ''; // so an unsynced edit from the workout cannot undo this one
    }
    sync.persist();
  }
}

/** Setup notes on the exercise page (#125): one per gym, each can be added, changed or cleared. */
function exerciseNotesSection(ex) {
  const box = h('div', { class: 'stack', 'data-notes-list': '' }, h('p', { class: 'muted' }, 'Loading'));
  const paint = (notes) => {
    if (!notes.length) {
      fill(box, h('p', { class: 'muted' }, 'Add a gym in Settings to keep setup notes for it.'));
      return;
    }
    fill(box, h('p', { class: 'muted small' }, 'Settings like a seat height or grip, shown under Last whenever this exercise comes up at that gym. Only you can see them.'),
      h('ul', { class: 'log note-list' }, notes.map((n) => {
        const li = h('li', { class: 'note-row', 'data-gym': n.gym_name });
        const show = () => fill(li,
          h('div', { class: 'note-head' }, h('span', { class: 'log-title' }, n.gym_name),
            h('button', { type: 'button', class: 'btn small', onclick: editNote }, icon('pencil', 16), n.note ? 'Edit' : 'Add note')),
          n.note ? noteLine(n.note) : h('p', { class: 'muted small' }, n.note === undefined ? 'Loading' : 'No note yet.'));
        const editNote = () => {
          const input = h('textarea', { name: 'exercise_note', rows: 2, maxlength: 200, placeholder: 'For example: seat on 4, wide handle' }, n.note || '');
          const error = h('p', { class: 'form-error', role: 'alert' });
          const save = async (value, btn) => {
            btn.disabled = true;
            error.textContent = '';
            try {
              const res = await api.post('save_note', { exercise_id: ex.id, gym_id: n.gym_id, note: value });
              applyNoteLocally(ex.id, n.gym_id, (res.notes.find((x) => x.gym_id === n.gym_id) || {}).note || null);
              paint(res.notes);
              toast(value.trim() ? `Note saved for ${n.gym_name}.` : `Note cleared for ${n.gym_name}.`);
            } catch (err) {
              error.textContent = err.offline ? 'No connection. Try again when you are back online.' : err.message;
              btn.disabled = false;
            }
          };
          fill(li, h('form', { class: 'stack', onsubmit: (ev) => { ev.preventDefault(); save(input.value, ev.submitter || ev.target.querySelector('[type=submit]')); } },
            field(n.gym_name, input),
            error,
            h('div', { class: 'plan-actions' },
              h('button', { class: 'btn small primary', type: 'submit' }, 'Save note'),
              h('button', { class: 'btn small', type: 'button', onclick: show }, 'Cancel'),
              n.note && h('button', { class: 'btn small', type: 'button', onclick: (ev) => save('', ev.currentTarget) }, 'Clear'))));
          input.focus();
        };
        show();
        return li;
      })));
  };
  // Rows for each gym straight away, so the page below does not shift when the notes arrive.
  paint(S.gyms.map((g) => ({ gym_id: g.id, gym_name: g.name, note: undefined })));
  api.get('exercise_notes', `&id=${ex.id}`).then(({ notes }) => paint(notes), (e) => fill(box, h('p', { class: 'muted' }, e.offline ? 'Setup notes need a connection.' : e.message)));
  return box;
}

/** Muscle groups with artwork in icons/muscles (#150): all thirteen. */
const MUSCLE_ART = ['chest', 'shoulders', 'triceps', 'biceps', 'forearms', 'lats', 'upper_back', 'lower_back', 'abs', 'glutes', 'quads', 'hamstrings', 'calves'];

/**
 * A faint muted-mint illustration of an exercise's first primary muscle, drawn
 * behind the text (#150). Decorative, so screen readers skip it. Cardio and
 * stretches, and anything without a matching muscle, get none.
 */
function muscleArt(exerciseId) {
  const ex = S.exById.get(exerciseId);
  const muscle = ex && !['cardio', 'stretch'].includes(ex.kind) ? ex.muscles_main[0] : null;
  if (!MUSCLE_ART.includes(muscle)) return null;
  return h('img', { class: 'muscle-art', src: `icons/muscles/${muscle}.png`, alt: '', 'aria-hidden': 'true', 'data-muscle': muscle, decoding: 'async' });
}

function planRow(b, gym) {
  const art = muscleArt(b.exercise_id);
  return h(
    'li',
    { class: `plan-row${art ? ' has-art' : ''}` },
    art,
    h('div', { class: 'plan-main' }, h('h3', {}, historyLink(b.exercise_id, b.name, 'today', 'Today')), h('p', { class: 'target' }, targetLine(b, S.draft.unit)), !isStretch(b) && h('p', { class: 'last' }, lastLine(b.previous)), noteLine(b.note), h('p', { class: 'why' }, b.reason), !S.draft.share_id && stallBox(b, gym)),
    h(
      'div',
      { class: 'plan-actions' },
      !S.draft.share_id && !S.draft.routine_id && h(
        'button',
        {
          type: 'button',
          class: 'btn small',
          'aria-pressed': String(!!b.locked),
          onclick: () => {
            b.locked = !b.locked;
            render();
          },
        },
        icon(b.locked ? 'lock' : 'unlock', 18),
        b.locked ? 'Locked' : 'Lock',
      ),
      !S.draft.share_id && !S.draft.routine_id && h('button', { type: 'button', class: 'btn small', onclick: () => swapSheet(gym.id, b.exercise_id, S.draft.exercises.map((x) => x.exercise_id), (block) => {
        Object.assign(b, block, { slot: b.slot, locked: true, reason: `You swapped this in. ${block.reason}` });
        pushSharedPlan();
        render();
      }, S.draft.bodyweight_only) }, icon('swap', 18), 'Swap'),
      // Edit the plan before starting (#155).
      h('button', { type: 'button', class: 'btn small', 'aria-label': `Remove ${b.name} from the plan`, onclick: () => {
        S.draft.exercises = S.draft.exercises.filter((x) => x !== b);
        S.draftAdded = (S.draftAdded || []).filter((x) => x !== b);
        S.draftRemoved = [...(S.draftRemoved || []), b.exercise_id];
        replanTime();
        pushSharedPlan();
        render();
      } }, icon('trash', 18), 'Remove'),
    ),
  );
}

/**
 * A stalled lift (#124): the same weight for several sessions without more
 * reps. Offers to repeat the target, go lighter for today or swap the lift;
 * keeping the usual suggestion just closes the prompt. A choice can be undone.
 */
function stallBox(b, gym) {
  const st = b.stall;
  if (!st) return null;
  const unit = S.draft.unit;
  const each = b.kind === 'dumbbell' ? ' each' : '';
  const choose = (choice) => {
    b.stallBefore ??= { suggested_weight: b.suggested_weight, suggested_reps: b.suggested_reps, reason: b.reason };
    Object.assign(b, b.stallBefore);
    b.stallChoice = choice;
    const pick = choice === 'repeat' ? st.repeat : choice === 'lower' ? st.lower : null;
    if (pick) {
      b.suggested_weight = pick.weight;
      b.suggested_reps = pick.reps;
      b.reason = choice === 'repeat'
        ? `Stalled at ${fmtW(st.weight)} ${unit}: you chose to repeat ${fmtW(pick.weight)} ${unit} × ${pick.reps} and own every rep.`
        : `Stalled at ${fmtW(st.weight)} ${unit}: you chose a lighter day at ${fmtW(pick.weight)} ${unit} × ${pick.reps}, then build back up.`;
      b.locked = true;
    }
    pushSharedPlan();
    render();
  };
  if (b.stallChoice) {
    return h('p', { class: 'stall-chosen' },
      b.stallChoice === 'keep' ? 'Stalled: keeping the usual suggestion. ' : 'Stalled: changed for today. ',
      h('button', { type: 'button', class: 'stall-change', onclick: () => {
        if (b.stallBefore) Object.assign(b, b.stallBefore);
        delete b.stallChoice;
        render();
      } }, 'Change'));
  }
  return h('div', { class: 'stall', role: 'group', 'aria-label': `${b.name} has stalled` },
    h('p', {}, h('strong', {}, 'Stalled. '), `${fmtW(st.weight)} ${unit}${each} for ${st.sessions} sessions without more reps. What would you like to do today?`),
    h('div', { class: 'stall-actions' },
      h('button', { type: 'button', class: 'btn small', onclick: () => choose('repeat') }, `Repeat ${fmtW(st.repeat.weight)} × ${st.repeat.reps}`),
      st.lower && h('button', { type: 'button', class: 'btn small', onclick: () => choose('lower') }, `Lower to ${fmtW(st.lower.weight)} × ${st.lower.reps}`),
      !S.draft.routine_id && h('button', { type: 'button', class: 'btn small', onclick: () => swapSheet(gym.id, b.exercise_id, S.draft.exercises.map((x) => x.exercise_id), (block) => {
        Object.assign(b, block, { slot: b.slot, locked: true, reason: `You swapped this in for a stalled lift. ${block.reason}` });
        pushSharedPlan();
        render();
      }, S.draft.bodyweight_only) }, icon('swap', 18), 'Swap'),
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => choose('keep') }, 'Keep suggestion')));
}

function recoveryPanel(recovery) {
  const rows = Object.values(recovery).map((m) => {
    const bar = h('span', { class: 'meter-fill' });
    bar.style.width = `${m.recovery}%`;
    return h('li', { class: 'meter' }, h('span', { class: 'meter-name' }, m.label), h('span', { class: `meter-track ${m.recovery < 50 ? 'low' : ''}` }, bar), h('span', { class: 'meter-num' }, `${m.recovery}%`), h('span', { class: 'meter-sets' }, `${fmtW(m.weekly_sets)} sets`));
  });
  return h('details', { class: 'card fold', open: true }, h('summary', {}, 'Recovery estimate'), h('p', { class: 'muted small' }, 'Estimated only from sets logged here in the last 7 days. It cannot see sleep, soreness or other activity, so treat it as a rough guide.'), h('ul', { class: 'meters' }, rows));
}

async function swapSheet(gymId, exerciseId, exclude, onPick, bodyweightOnly = false) {
  const list = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Finding options'));
  const close = sheet('Swap exercise', list);
  try {
    const res = await api.post('alternatives', { gym_id: gymId, exercise_id: exerciseId, exclude, bodyweight_only: bodyweightOnly });
    if (!res.alternatives.length) {
      list.replaceChildren(h('p', { class: 'muted' }, bodyweightOnly ? 'No other option without equipment.' : 'Nothing else fits the equipment at this gym.'));
      return;
    }
    list.replaceChildren(
      ...res.alternatives.map((a) => {
        const ex = S.exById.get(a.exercise_id);
        return h(
          'button',
          {
            type: 'button',
            class: 'pick',
            onclick: async (e) => {
              const block = await act(async () => (await api.post('suggest', { gym_id: gymId, exercise_id: a.exercise_id, bodyweight_only: bodyweightOnly })).block, e.currentTarget);
              if (block) {
                close();
                onPick(block);
              }
            },
          },
          h('span', { class: 'pick-name' }, ex ? ex.name : 'Exercise'),
          h('span', { class: 'pick-meta' }, `${a.match}, ${S.vocab.kinds[ex.kind].toLowerCase()}`),
        );
      }),
    );
  } catch (e) {
    list.replaceChildren(h('p', { class: 'muted' }, e.offline ? 'Swapping needs a connection.' : e.message));
  }
}

// ---------------------------------------------------------------- active workout

function paintSync() {
  const el = document.getElementById('sync');
  if (!el || !sync) return;
  const st = sync.status();
  el.className = `sync ${st}`;
  el.textContent = sync.error ? 'Not saved' : st === 'saved' ? 'Saved' : st === 'saving' ? 'Saving' : sync.offline || navigator.onLine === false ? 'Offline, saved on phone' : 'Waiting to sync';
  el.title = sync.error || '';
}

function primeAudio() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch (e) {
    audio = null;
  }
}

function beep() {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  if (!audio) return;
  try {
    [0, 0.25].forEach((at) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, audio.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + at + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + at);
      o.stop(audio.currentTime + at + 0.2);
    });
  } catch (e) {
    // Sound is a nicety; the on-screen timer is what matters.
  }
}

async function keepAwake() {
  const want = route()[0] === 'workout' && sync && sync.active && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!want && wakeLock) {
      await wakeLock.release();
    }
  } catch (e) {
    wakeLock = null;
  }
}

function startRest(seconds) {
  if (!seconds) return;
  S.rest = { endsAt: Date.now() + seconds * 1000, total: seconds, rung: false };
  localStorage.setItem('tf.rest', JSON.stringify(S.rest));
  paintRest();
}

function stopRest() {
  S.rest = null;
  localStorage.removeItem('tf.rest');
  paintRest();
}

function restDock() {
  return h(
    'div',
    { id: 'rest', class: 'rest', hidden: true },
    h('div', { class: 'rest-bar' }, h('span', { id: 'rest-fill' })),
    h('div', { class: 'rest-row' },
      h('span', { class: 'rest-label' }, 'Rest'),
      h('output', { id: 'rest-time', class: 'rest-time' }, '0:00'),
      h('button', { type: 'button', class: 'btn small', onclick: () => adjustRest(-15) }, '-15s'),
      h('button', { type: 'button', class: 'btn small', onclick: () => adjustRest(15) }, '+15s'),
      h('button', { type: 'button', class: 'btn small', onclick: stopRest }, 'Skip'),
    ),
  );
}

function adjustRest(delta) {
  if (!S.rest) return;
  S.rest.endsAt += delta * 1000;
  S.rest.total = Math.max(1, S.rest.total + delta);
  S.rest.rung = false;
  localStorage.setItem('tf.rest', JSON.stringify(S.rest));
  paintRest();
}

function paintRest() {
  const dock = document.getElementById('rest');
  if (!dock) return;
  if (!S.rest) {
    dock.hidden = true;
    document.body.classList.remove('resting');
    return;
  }
  const left = (S.rest.endsAt - Date.now()) / 1000;
  if (left <= -20) {
    stopRest();
    return;
  }
  dock.hidden = false;
  document.body.classList.add('resting');
  dock.classList.toggle('over', left <= 0);
  document.getElementById('rest-time').textContent = left > 0 ? fmtClock(left) : 'Go';
  document.getElementById('rest-fill').style.width = `${Math.max(0, Math.min(100, (left / S.rest.total) * 100))}%`;
  if (left <= 0 && !S.rest.rung) {
    S.rest.rung = true;
    localStorage.setItem('tf.rest', JSON.stringify(S.rest));
    beep();
  }
}

function startTicker() {
  paintRest();
  paintSync();
  ticker = setInterval(() => {
    paintRest();
    const el = document.getElementById('elapsed');
    if (el && sync.active) el.textContent = fmtClock(workoutSeconds(sync.active));
    const bar = document.getElementById('back-elapsed');
    if (bar && sync.active) bar.textContent = fmtClock(workoutSeconds(sync.active));
    if (route()[0] === 'today' && document.visibilityState === 'visible') refreshShares(); // throttled inside
  }, 500);
}

/** Seconds of training so far: start to now, minus time paused (#111). Frozen while paused. */
function workoutSeconds(doc, now = Date.now()) {
  const until = doc.paused_at ? new Date(doc.paused_at).getTime() : now;
  return Math.max(0, (until - new Date(doc.started_at).getTime()) / 1000 - (doc.paused_s || 0));
}

/** Ends a pause on a workout document, adding it to the paused total. */
function endPause(d) {
  if (!d.paused_at) return;
  d.paused_s = (d.paused_s || 0) + Math.max(0, Math.round((Date.now() - new Date(d.paused_at).getTime()) / 1000));
  d.paused_at = null;
}

/** Pause or resume the workout in progress. It is saved on the phone first, like every other change. */
function togglePause() {
  const doc = sync.active;
  if (!doc) return;
  const pausing = !doc.paused_at;
  if (pausing) stopRest();
  sync.edit(doc.id, (d) => (pausing ? (d.paused_at = new Date().toISOString()) : endPause(d)), 0);
  render();
  toast(pausing ? 'Workout paused. The clock is stopped.' : 'Workout resumed.');
}

/** The Today spot in the tab bar on the workout screen: Pause or Play. */
function pauseTab() {
  const paused = !!sync.active.paused_at;
  return h('button', {
    type: 'button',
    class: `tab pause-tab ${paused ? 'paused' : ''}`,
    'aria-current': 'page',
    'aria-label': paused ? 'Resume workout' : 'Pause workout',
    onclick: togglePause,
  }, h('span', { class: 'tab-icon' }, icon(paused ? 'play' : 'pause', 24)), h('span', {}, paused ? 'Resume' : 'Pause'));
}

/** Shown on the other tabs during a workout: a way back to it, separate from pausing. */
function backToWorkoutBar() {
  const doc = sync.active;
  return h('a', { class: `back-to-workout ${doc.paused_at ? 'paused' : ''}`, href: '#/workout' },
    h('span', { class: 'btw-label' }, h('strong', {}, `${dayLabel(doc.day_type)} in progress`), h('span', {}, doc.paused_at ? 'Paused' : h('output', { id: 'back-elapsed' }, fmtClock(workoutSeconds(doc))))),
    h('span', { class: 'btw-go' }, 'Back to workout', icon('back', 18)));
}

function viewWorkout() {
  const doc = sync.active;
  if (!doc) {
    return h('main', { class: 'page' }, h('h1', {}, 'No workout in progress'), h('a', { class: 'btn primary block', href: '#/today' }, 'Go to Today'));
  }
  const edit = (fn, structural = true) => {
    sync.edit(doc.id, fn);
    if (structural) render();
  };
  // The next set to do gets the highlight.
  let nextSet = null;
  for (const e of doc.exercises) {
    const s = e.sets.find((x) => !x.done);
    if (s) {
      nextSet = s.id;
      break;
    }
  }
  const doneSets = doc.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const totalSets = doc.exercises.reduce((n, e) => n + e.sets.length, 0);

  // Today's header (#175), with the clock and save status where Today has the logo.
  const head = topHead(dayLabel(doc.day_type), {
    sub: `${doc.gym_name}, ${doneSets} of ${totalSets} sets`,
    right: h('div', { class: 'workout-meta' }, h('output', { id: 'elapsed', class: `elapsed ${doc.paused_at ? 'paused' : ''}` }, fmtClock(workoutSeconds(doc))), h('span', { id: 'sync', class: 'sync', role: 'status' }, 'Saved')),
    rowClass: 'workout-head',
  });
  const paused = doc.paused_at && h('section', { class: 'paused-banner', role: 'status' },
    h('div', {}, h('strong', {}, 'Paused'), h('span', { class: 'muted small' }, 'The clock is stopped. Logging a set resumes it.')),
    h('button', { class: 'btn primary small', type: 'button', onclick: () => togglePause() }, icon('play', 18), 'Resume'));

  const cards = doc.exercises.map((e, idx) => exerciseCard(doc, e, idx, nextSet, edit));

  return h(
    'main',
    { class: `page workout ${doc.paused_at ? 'is-paused' : ''}` },
    head,
    paused,
    cards,
    h('button', { class: 'btn block', type: 'button', onclick: () => addExerciseSheet(doc) }, icon('plus', 18), 'Add exercise'),
    h('button', { class: 'btn block', type: 'button', onclick: () => shareSheet({
      key: () => {
        if (!doc.share_key) sync.edit(doc.id, (d) => (d.share_key = uuid()));
        return sync.active.share_key;
      },
      plan: () => planOf(sync.active.day_type, sync.active.exercises, (e) => e.sets.filter((s) => !s.warmup).length || e.target_sets),
      workoutId: doc.id,
    }) }, icon('share', 18), 'Share this workout'),
    // Styled like Quick Start, in red (#164).
    h('button', { class: 'btn block finish', type: 'button', onclick: () => finishSheet(doc) }, icon('check', 18), 'Finish workout'),
  );
}

function exerciseCard(doc, e, idx, nextSet, edit) {
  const ex = S.exById.get(e.exercise_id);
  const cardio = isCardio(e);
  const stretch = isStretch(e);
  const needsWeight = !['bodyweight', 'band'].includes(e.kind);
  const perSide = e.kind === 'dumbbell' ? `${doc.unit} each` : doc.unit;
  let workingNo = 0;

  const cardioRow = (s, n) => {
    const [minutes, distance, level] = cardioInputs(s, doc.unit, (field, v) => edit((d) => (find(d, e.id, s.id)[field] = v), false));
    const done = h('button', {
      type: 'button',
      class: 'plate',
      'aria-pressed': String(s.done),
      'aria-label': s.done ? 'Completed. Tap to undo' : 'Complete',
      onclick: () => {
        if (s.done) {
          edit((d) => Object.assign(find(d, e.id, s.id), { done: false, done_at: null }));
          return;
        }
        const cur = find(doc, e.id, s.id);
        if (!cur.duration_s || cur.duration_s <= 0) {
          minutes.focus();
          toast('Enter the minutes you did.');
          return;
        }
        document.activeElement && document.activeElement.blur();
        // No rest timer after cardio: the next exercise can start straight away.
        edit((d) => {
          Object.assign(find(d, e.id, s.id), { done: true, done_at: new Date().toISOString() });
          if (d.paused_at) {
            endPause(d); // logging a set means training again
            toast('Workout resumed.');
          }
        });
      },
    }, icon('check', 30));
    return h('li', { class: `set cardio ${s.done ? 'done' : ''} ${s.id === nextSet ? 'next' : ''}` },
      h('span', { class: 'set-tag', 'aria-hidden': 'true' }, String(n)), minutes, distance, level, done);
  };

  // A stretch hold (#138): seconds, then done. No rest timer and no weights.
  const stretchRow = (s, si) => {
    const seconds = secondsInput(s, (v) => edit((d) => (find(d, e.id, s.id).duration_s = v), false));
    const done = h('button', {
      type: 'button',
      class: 'plate',
      'aria-pressed': String(s.done),
      'aria-label': s.done ? 'Completed. Tap to undo' : 'Complete',
      onclick: () => {
        if (s.done) {
          edit((d) => Object.assign(find(d, e.id, s.id), { done: false, done_at: null }));
          return;
        }
        if (!(find(doc, e.id, s.id).duration_s > 0)) {
          seconds.focus();
          toast('Enter the seconds you held it.');
          return;
        }
        document.activeElement && document.activeElement.blur();
        edit((d) => {
          Object.assign(find(d, e.id, s.id), { done: true, done_at: new Date().toISOString() });
          if (d.paused_at) {
            endPause(d);
            toast('Workout resumed.');
          }
        });
      },
    }, icon('check', 30));
    return h('li', { class: `set stretch ${s.done ? 'done' : ''} ${s.id === nextSet ? 'next' : ''}` },
      h('span', { class: 'set-tag', 'aria-label': perSideStretch(e) && e.sets.length === 2 ? (si === 0 ? 'Left side' : 'Right side') : `Hold ${si + 1}` }, holdTag(e, si)), seconds, done);
  };

  const rows = e.sets.map((s, si) => {
    if (stretch) return stretchRow(s, si);
    if (cardio) return cardioRow(s, si + 1);
    if (!s.warmup) workingNo += 1;
    const weight = h('input', {
      class: 'num',
      type: 'text',
      inputmode: 'decimal',
      enterkeyhint: 'done',
      'aria-label': `Weight in ${doc.unit}`,
      placeholder: needsWeight ? doc.unit : 'BW',
      value: fmtW(s.weight),
      onfocus: (ev) => ev.target.select(),
      oninput: (ev) => edit((d) => (find(d, e.id, s.id).weight = parseNum(ev.target.value)), false),
    });
    const reps = h('input', {
      class: 'num',
      type: 'text',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      enterkeyhint: 'done',
      'aria-label': 'Reps',
      placeholder: `${e.rep_min}-${e.rep_max}`,
      value: s.reps == null ? '' : String(s.reps),
      onfocus: (ev) => ev.target.select(),
      oninput: (ev) => edit((d) => {
        const n = parseNum(ev.target.value);
        find(d, e.id, s.id).reps = n == null ? null : Math.round(n);
      }, false),
    });
    const done = h(
      'button',
      {
        type: 'button',
        class: 'plate',
        'aria-pressed': String(s.done),
        'aria-label': s.done ? 'Completed. Tap to undo' : 'Complete set',
        onclick: () => {
          primeAudio();
          if (s.done) {
            edit((d) => Object.assign(find(d, e.id, s.id), { done: false, done_at: null }));
            return;
          }
          const cur = find(doc, e.id, s.id);
          if (cur.reps == null || cur.reps <= 0) {
            reps.focus();
            toast('Enter the reps you got.');
            return;
          }
          if (needsWeight && cur.weight == null) {
            weight.focus();
            toast('Enter the weight you used.');
            return;
          }
          document.activeElement && document.activeElement.blur();
          edit((d) => {
            const used = cur.weight == null ? 0 : cur.weight;
            Object.assign(find(d, e.id, s.id), { done: true, done_at: new Date().toISOString(), weight: used });
            if (d.paused_at) {
              endPause(d); // logging a set means training again
              toast('Workout resumed.');
            }
            // Carry the weight down to the sets still to come, so only reps need typing.
            for (const later of d.exercises.find((x) => x.id === e.id).sets) {
              if (!later.done && later.weight == null && !later.warmup && !s.warmup) later.weight = used;
            }
          });
          const more = doc.exercises.some((x) => x.sets.some((y) => !y.done));
          if (more) startRest(s.warmup ? Math.min(60, e.rest_seconds) : e.rest_seconds);
        },
      },
      icon('check', 30),
    );
    return h(
      'li',
      { class: `set ${s.done ? 'done' : ''} ${s.id === nextSet ? 'next' : ''} ${s.warmup ? 'warm' : ''}` },
      h(
        'button',
        {
          type: 'button',
          class: 'set-tag',
          'aria-label': s.warmup ? 'Warm-up set. Tap to make it a working set' : `Working set ${workingNo}. Tap to mark as warm-up`,
          onclick: () => edit((d) => {
            const t = find(d, e.id, s.id);
            t.warmup = !t.warmup;
          }),
        },
        s.warmup ? 'W' : String(workingNo),
      ),
      weight,
      h('span', { class: 'times', 'aria-hidden': 'true' }, '×'),
      reps,
      done,
    );
  });

  // Swap for an alternative the gym has equipment for. Sets already logged stay
  // under the original exercise; the alternative takes over the sets still to do.
  const swap = () => swapSheet(doc.gym_id, e.exercise_id, doc.exercises.map((x) => x.exercise_id), (block) => {
    const logged = e.sets.filter((s) => s.done).length;
    const remaining = Math.max(1, e.sets.length - logged);
    edit((d) => {
      const at = d.exercises.findIndex((x) => x.id === e.id);
      if (at < 0) return;
      const fresh = blockToEntry({ ...block, reason: `Swapped in for ${e.name}. ${block.reason}` });
      if (!logged) {
        d.exercises[at] = fresh;
        return;
      }
      fresh.sets = fresh.sets.slice(0, remaining);
      while (fresh.sets.length < remaining) fresh.sets.push({ ...fresh.sets[fresh.sets.length - 1], id: uuid() });
      fresh.target_sets = remaining;
      d.exercises[at].sets = d.exercises[at].sets.filter((s) => s.done);
      d.exercises[at].target_sets = logged;
      d.exercises.splice(at + 1, 0, fresh);
    });
    toast(logged ? `Kept your ${logged} logged set${logged === 1 ? '' : 's'} of ${e.name}. ${block.name} takes the rest.` : `Swapped to ${block.name}.`);
  });

  const menu = () => {
    const close = sheet(e.name, h(
      'div',
      { class: 'stack' },
      ex && ex.cues && h('p', { class: 'cues' }, ex.cues),
      h('button', { type: 'button', class: 'btn block', onclick: () => { close(); noteSheet(e, edit, doc.gym_id && doc.gym_name); } }, icon('pencil', 18), e.note ? 'Edit setup note' : 'Add setup note'),
      h('button', { type: 'button', class: 'btn block', disabled: idx === 0, onclick: () => { close(); edit((d) => move(d.exercises, idx, idx - 1)); } }, icon('up', 18), 'Move earlier'),
      h('button', { type: 'button', class: 'btn block', disabled: idx === doc.exercises.length - 1, onclick: () => { close(); edit((d) => move(d.exercises, idx, idx + 1)); } }, icon('down', 18), 'Move later'),
      h('button', { type: 'button', class: 'btn block', disabled: !doc.gym_id, onclick: () => {
        close();
        swap();
      } }, icon('swap', 18), 'Swap for another exercise'),
      h('button', { type: 'button', class: 'btn danger block', onclick: async () => {
        close();
        if (!e.sets.some((s) => s.done) || await confirmSheet(`Remove ${e.name}?`, 'The sets you logged for it are deleted.', 'Remove exercise', true)) edit((d) => d.exercises.splice(idx, 1));
      } }, icon('trash', 18), 'Remove from workout'),
    ));
  };

  return h(
    'section',
    { class: `card lift ${e.sets.length && e.sets.every((s) => s.done) ? 'complete' : ''}` },
    h('header', { class: 'lift-head' },
      h('div', {}, h('h2', {}, historyLink(e.exercise_id, e.name, 'workout', 'Workout')), h('p', { class: 'target' }, targetLine(e, doc.unit)), !stretch && h('p', { class: 'last' }, lastLine(e.previous)), noteLine(e.note, () => noteSheet(e, edit, doc.gym_id && doc.gym_name))),
      h('button', { type: 'button', class: 'btn square ghost', 'aria-label': `Options for ${e.name}`, onclick: menu }, icon('more')),
    ),
    e.reason && h('details', { class: 'why-fold' }, h('summary', {}, 'Why this'), h('p', { class: 'why' }, e.reason)),
    stretch
      ? h('div', { class: 'set-head stretch', 'aria-hidden': 'true' }, h('span', {}, perSideStretch(e) ? 'Side' : 'Hold'), h('span', {}, 'Seconds'), h('span', {}, 'Done'))
      : cardio
      ? h('div', { class: 'set-head cardio', 'aria-hidden': 'true' }, h('span', {}, ''), h('span', {}, 'Min'), h('span', {}, distUnit(doc.unit)), h('span', {}, 'Level'), h('span', {}, 'Done'))
      : h('div', { class: 'set-head', 'aria-hidden': 'true' }, h('span', {}, 'Set'), h('span', {}, perSide), h('span', {}), h('span', {}, 'Reps'), h('span', {}, 'Done')),
    h('ol', { class: 'sets' }, rows),
    h('div', { class: 'set-actions' },
      h('button', { type: 'button', class: 'btn small', onclick: () => edit((d) => {
        const t = d.exercises.find((x) => x.id === e.id);
        const last = t.sets[t.sets.length - 1];
        t.sets.push(stretch
          ? stretchSet(last ? last.duration_s : e.target_seconds)
          : cardio
          ? { ...cardioSet(last ? last.duration_s : e.target_seconds, null), level: last ? last.level : null }
          : { id: uuid(), weight: last ? last.weight : e.suggested_weight, reps: last ? last.reps : null, warmup: false, done: false, done_at: null });
      }) }, icon('plus', 18), stretch ? 'Add hold' : cardio ? 'Add interval' : 'Add set'),
      h('button', { type: 'button', class: 'btn small', disabled: e.sets.length === 0, onclick: async () => {
        const last = e.sets[e.sets.length - 1];
        if (last.done && !(await confirmSheet('Remove a completed set?', `The last set (${cardio || stretch ? fmtCardio(last, doc.unit) : `${fmtW(last.weight)} × ${last.reps}`}) is deleted.`, 'Remove set', true))) return;
        edit((d) => d.exercises.find((x) => x.id === e.id).sets.pop());
      } }, icon('minus', 18), stretch ? 'Remove hold' : cardio ? 'Remove interval' : 'Remove set'),
      doc.gym_id && e.sets.some((s) => !s.done) && h('button', { type: 'button', class: 'btn small', 'aria-label': `Swap ${e.name} for another exercise`, onclick: swap }, icon('swap', 18), 'Swap'),
      // Difficulty (#170): once every set is checked off, one optional rating for the exercise.
      !cardio && !stretch && e.sets.length > 0 && e.sets.every((s) => s.done) && h('button', {
        type: 'button',
        class: `btn small difficulty${e.reps_left != null ? ' rated' : ''}`,
        'aria-label': e.reps_left != null ? `Difficulty for ${e.name}: ${repsLeftLabel(e.reps_left)} reps left. Change` : `Rate how hard ${e.name} felt`,
        onclick: () => difficultySheet(e, (v) => edit((d) => {
          const t = d.exercises.find((x) => x.id === e.id);
          if (v == null) delete t.reps_left;
          else t.reps_left = v;
        })),
      }, e.reps_left != null ? `Difficulty: ${repsLeftLabel(e.reps_left)}` : 'Difficulty?'),
    ),
  );
}

/** 0-4 reps left, where 4 means 4 or more (#170). */
function repsLeftLabel(v) {
  return v >= 4 ? '4+' : String(v);
}

/** Ask how many more reps a typical working set had in it (#170). Optional; can be changed or cleared. */
function difficultySheet(e, onPick) {
  const close = sheet('Difficulty', h('div', { class: 'stack' },
    h('p', {}, h('strong', {}, e.name)),
    h('p', {}, 'At the end of a typical working set, how many more reps could you have done with good form?'),
    choices([0, 1, 2, 3, 4].map((v) => [v, repsLeftLabel(v)]), e.reps_left ?? null, (v) => {
      close();
      onPick(v);
    }, { columns: 5 }),
    h('p', { class: 'muted small' }, 'Your next suggestion for this exercise takes it into account.'),
    e.reps_left != null && h('button', { class: 'btn ghost block', type: 'button', onclick: () => {
      close();
      onPick(null);
    } }, 'Clear rating')));
}

function find(doc, exId, setId) {
  return doc.exercises.find((x) => x.id === exId).sets.find((s) => s.id === setId);
}

function move(list, from, to) {
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
}

/** Recomputes the plan's time after lifts are added or removed by hand (#155). */
function replanTime() {
  S.draft.est_minutes = Math.round(S.draft.exercises.reduce((n, b) => n + (Number(b.minutes) || 0), 0));
}

/**
 * Quick Start (#127): an empty workout at the selected gym, built as you go
 * with Add exercise. Logging, pause and saving work as usual.
 */
function quickStart() {
  const gym = activeGym();
  if (!gym || sync.active) return;
  S.draftAdded = [];
  S.draftRemoved = [];
  sync.start({ id: uuid(), gym_id: gym.id, gym_name: gym.name, day_type: 'custom', status: 'active', unit: S.user.unit, started_at: new Date().toISOString(), completed_at: null, notes: 'Quick start', exercises: [] });
  go('workout');
  addExerciseSheet(sync.active);
}

/**
 * The muscle groups to train (#154), with each one's recovery from the same
 * estimate as Trends, most recovered first. Picking builds a custom plan.
 */
async function musclePicker() {
  const chosen = new Set(S.draftOpts.day_type === 'custom' ? S.draftOpts.muscles || [] : []);
  const grid = h('div', { class: 'muscle-grid' }, h('p', { class: 'muted' }, 'Loading'));
  // Build (n) sits in the sheet header, next to Close, so it stays in reach while the tiles scroll (#169).
  const build = h('button', { class: 'btn build-btn', type: 'button', disabled: true, onclick: () => {
    if (!chosen.size) return;
    close();
    S.draftOpts.day_type = 'custom';
    S.draftOpts.muscles = MUSCLE_ART.filter((m) => chosen.has(m));
    S.draftOpts.routine_id = null;
    S.draftAdded = [];
    S.draftRemoved = [];
    loadDraft();
  } }, 'Build');
  const refresh = () => {
    build.disabled = chosen.size === 0;
    build.textContent = chosen.size ? `Build (${chosen.size})` : 'Build';
  };
  const close = sheet('Pick muscle groups', h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Recovery comes from the sets you logged in the last week, like on Trends. Below 50% is still recovering.'), grid), { actions: [build] });
  refresh();
  try {
    const { recovery } = await api.get('recovery');
    const order = MUSCLE_ART.slice().sort((a, b) => (recovery[b]?.recovery ?? 100) - (recovery[a]?.recovery ?? 100));
    fill(grid, order.map((m) => {
      const pct = Math.round(recovery[m]?.recovery ?? 100);
      return h('button', { type: 'button', class: `muscle-tile${pct < 50 ? ' tired' : ''}`, 'aria-pressed': String(chosen.has(m)), 'data-muscle': m, onclick: (e) => {
        const on = !chosen.has(m);
        if (on) chosen.add(m); else chosen.delete(m);
        e.currentTarget.setAttribute('aria-pressed', String(on));
        refresh();
      } },
      h('img', { src: `icons/muscles/${m}.png`, alt: '', 'aria-hidden': 'true' }),
      h('span', { class: 'muscle-name' }, S.vocab.muscles[m]),
      h('span', { class: 'muscle-pct' }, pct < 50 ? `${pct}% · recovering` : `${pct}%`));
    }));
  } catch (e) {
    fill(grid, h('p', { class: 'muted' }, e.offline ? 'Picking muscle groups needs a connection.' : e.message));
  }
}

function addExerciseSheet(doc, onAdd) {
  const gym = S.gyms.find((g) => g.id === doc.gym_id);
  const have = new Set(gym ? gym.equipment : []);
  const used = new Set(doc.exercises.map((e) => e.exercise_id));
  const list = h('div', { class: 'stack' });
  const search = h('input', { type: 'search', placeholder: 'Search exercises', 'aria-label': 'Search exercises', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', oninput: () => paint() });
  let close = null;
  // Only exercises this gym has the equipment for, and that are not already in the workout.
  const aliases = S.vocab.equipment_alternatives || {};
  const pool = S.exercises.filter((x) => !x.archived && !used.has(x.id)
    && x.equipment.every((k) => have.has(k) || aliases[k]?.some((option) => have.has(option))));
  const row = (x) =>
    h('button', { type: 'button', class: 'pick', onclick: async (ev) => {
          let block = null;
          if (gym) {
            ev.currentTarget.disabled = true;
            try {
              block = (await api.post('suggest', { gym_id: gym.id, exercise_id: x.id })).block;
            } catch (err) {
              block = null; // offline: add it without history
            }
          }
          if (!block) block = { exercise_id: x.id, name: x.name, kind: x.kind, pattern: x.pattern, target_sets: 3, rep_min: x.compound ? 6 : 10, rep_max: x.compound ? 10 : 15, rest_seconds: x.compound ? 120 : 75, suggested_weight: null, suggested_reps: null, reason: 'Added by you.', previous: null };
          else block.reason = `Added by you. ${block.reason}`;
          close();
          if (onAdd) onAdd(block);
          else {
            sync.edit(doc.id, (d) => d.exercises.push(blockToEntry(block)));
            render();
          }
        } }, h('span', { class: 'pick-name' }, x.name), h('span', { class: 'pick-meta' }, x.muscles_main.map((m) => S.vocab.muscles[m]).join(', ')));
  // Narrow to one muscle group (#155).
  const muscle = h('select', { 'aria-label': 'Muscle group', onchange: () => paint() },
    h('option', { value: '' }, 'All muscles'), Object.entries(S.vocab.muscles).map(([k, v]) => h('option', { value: k }, v)));
  const paint = () => {
    const q = search.value.trim();
    const pick = muscle.value ? pool.filter((x) => x.muscles_main.includes(muscle.value)) : pool;
    // With no search, the lifter's most-performed exercises come first (#174); a search keeps relevance order.
    const r = searchExercises(q ? pick : byUsage(pick, S.exerciseCounts), q, S.vocab, { limit: 40, similarLimit: 6 });
    fill(list,
      r.closest && h('p', { class: 'muted' }, `Nothing at this gym matches "${q}" exactly. Closest:`),
      ...r.matches.map(row),
      r.similar.length > 0 && h('h3', { class: 'list-head' }, 'Similar exercises'),
      ...r.similar.map(row),
      !r.matches.length && h('p', { class: 'muted' }, q ? `Nothing matches "${q}" with the equipment at this gym.` : 'Every exercise this gym has equipment for is already in the workout.'),
    );
  };
  close = sheet('Add exercise', h('div', { class: 'stack' }, h('div', { class: 'filters' }, search, muscle), list));
  paint();
  // The counts from bootstrap can be days old in an installed app. Refresh them,
  // and reorder only if nothing has been typed yet. Offline, the cached order stands.
  api.get('exercise_counts').then(({ counts }) => {
    S.exerciseCounts = counts || {};
    if (list.isConnected && !search.value.trim()) paint();
  }).catch(() => {});
}

// "Send to Strava" on the Finish sheet (#87): the choice is remembered on this device.
function stravaOnFinish() {
  try {
    return { send: false, summary: false, calories: false, ...JSON.parse(localStorage.getItem('tf.stravaOnFinish') || '{}') };
  } catch (e) {
    return { send: false, summary: false, calories: false };
  }
}

function finishSheet(doc) {
  const done = doc.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const open = doc.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
  let close = null;
  // Shown only when this account is connected to Strava. The workout carries the
  // request through the offline sync, and the server sends it once the finished
  // workout reaches it, so finishing with no signal still works.
  let strava = null;
  if (done && S.strava?.connected) {
    const pref = stravaOnFinish();
    const send = h('input', { type: 'checkbox', checked: pref.send });
    const summary = h('input', { type: 'checkbox', checked: pref.summary });
    const details = h('label', { class: 'check strava-details', hidden: !pref.send }, summary, 'Include exercises, sets, reps, and weights');
    // Estimated calories (#38), offered once a body weight is set.
    const calories = h('input', { type: 'checkbox', checked: pref.calories });
    const caloriesRow = S.user.body_weight != null && h('label', { class: 'check strava-details', hidden: !pref.send }, calories, 'Include estimated calories');
    send.onchange = () => {
      details.hidden = !send.checked;
      if (caloriesRow) caloriesRow.hidden = !send.checked;
    };
    strava = { send, summary, calories: caloriesRow ? calories : null, el: h('div', { class: 'stack' }, h('label', { class: 'check' }, send, 'Send to Strava'), details, caloriesRow) };
  }
  // How hard it felt: optional, nothing chosen until tapped (#198). A choice helps plan the next
  // workouts of this kind and the calorie estimate (#38); skipping keeps the usual effort for calories only.
  let effort = null;
  const effortField = done && field('How hard was it?', choices(EFFORTS, null, (v) => (effort = v), { columns: 3 }),
    S.user.body_weight != null ? 'Optional. Helps plan your next workouts and estimate calories.' : 'Optional. Helps plan your next workouts.');
  const body = done
    ? h('div', { class: 'stack' },
        h('p', {}, `${done} set${done === 1 ? '' : 's'} logged over ${fmtClock((Date.now() - new Date(doc.started_at).getTime()) / 1000)}.`),
        open > 0 && h('p', { class: 'muted' }, `${open} set${open === 1 ? ' was' : 's were'} not marked done and will be left out.`),
        effortField,
        strava?.el,
        h('button', { class: 'btn primary block', type: 'button', onclick: () => {
          const toStrava = !!strava?.send.checked;
          if (strava) {
            try {
              localStorage.setItem('tf.stravaOnFinish', JSON.stringify({ send: toStrava, summary: strava.summary.checked, calories: !!strava.calories?.checked }));
            } catch (e) {
              // Private mode: the choice just isn't remembered.
            }
          }
          close();
          sync.edit(doc.id, (d) => {
            for (const e of d.exercises) e.sets = e.sets.filter((s) => s.done);
            d.exercises = d.exercises.filter((e) => e.sets.length);
            endPause(d); // a pause counts up to the finish, then stops
            d.status = 'completed';
            d.completed_at = new Date().toISOString();
            if (effort) {
              d.effort = effort;
              d.effort_rated = true;
              S.user.effort = effort;
            } else if (S.user.body_weight != null) {
              d.effort = S.user.effort || 'moderate'; // for the calorie estimate only
              d.effort_rated = false;
            }
            if (toStrava) d.strava_send = { include_summary: strava.summary.checked, include_calories: !!strava.calories?.checked, utc_offset: -new Date(d.started_at).getTimezoneOffset() * 60 };
          }, 0);
          stopRest();
          S.draft = null;
          S.draftOpts.day_type = null;
          if (toStrava) toast('Workout saved. It goes to Strava once it syncs.');
          go('today');
          recapSheet(doc.id, workingSets(sync.docs.get(doc.id) || doc));
        } }, 'Finish and save'))
    : h('div', { class: 'stack' },
        h('p', { class: 'muted' }, 'No sets are marked done, so there is nothing to save.'),
        h('button', { class: 'btn danger block', type: 'button', onclick: () => {
          close();
          sync.discard(doc.id);
          stopRest();
          go('today');
        } }, 'Discard workout'));
  close = sheet('Finish workout', body);
}

// ---------------------------------------------------------------- recap (#123)

/** Completed working sets of lifts: not warm-ups, cardio or stretches. */
function workingSets(doc) {
  return doc.exercises.filter((e) => !isTimed(e)).reduce((n, e) => n + e.sets.filter((s) => s.done && !s.warmup && s.reps > 0).length, 0);
}

/** "135 lb × 10", or "12 reps" for bodyweight. */
function liftResult(weight, reps, unit) {
  return weight > 0 ? `${fmtW(weight)} ${unit} × ${reps}` : `${reps} reps`;
}

function recordLine(r, unit) {
  if (r.type === 'weight') return `${liftResult(r.weight, r.reps, unit)}, the heaviest yet (up from ${fmtW(r.previous_weight)} ${unit})`;
  return r.weight > 0 ? `${liftResult(r.weight, r.reps, unit)}, up from ${r.previous_reps} reps at that weight` : `${r.reps} reps, up from ${r.previous_reps}`;
}

/**
 * Working sets, new records and first results for a finished workout. Each
 * lift links to its history, where the record shows on the chart.
 */
function recapBody(recap, path, label) {
  const link = (x) => h('a', { class: 'recap-name', href: `#/exercises/${x.exercise_id}`, onclick: () => (S.backTo = { to: `exercises/${x.exercise_id}`, path, label, y: window.scrollY }) }, x.name);
  return h('div', { class: 'stack recap' },
    h('p', { class: 'recap-count' }, h('strong', {}, `${recap.working_sets} working set${recap.working_sets === 1 ? '' : 's'}`), ` across ${recap.exercises} exercise${recap.exercises === 1 ? '' : 's'}`),
    recap.records.length > 0 && h('ul', { class: 'recap-list' }, recap.records.map((r) => h('li', { class: 'recap-record' },
      h('span', { class: 'badge record' }, 'New record'), link(r), h('span', { class: 'recap-detail' }, recordLine(r, recap.unit))))),
    !recap.records.length && !recap.firsts.length && h('p', { class: 'muted' }, 'No new records this time. Matching your best still counts.'),
    recap.firsts.length > 0 && [h('h3', {}, 'First logged'), h('ul', { class: 'recap-list' }, recap.firsts.map((f) => h('li', { class: 'recap-first' },
      link(f), h('span', { class: 'recap-detail' }, `${liftResult(f.weight, f.reps, recap.unit)}, the result to beat next time`))))]);
}

// ---------------------------------------------------------------- share as an image (#160)

const SHARE_FONT = '"Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", "Helvetica Neue", system-ui, sans-serif';
const SHARE_BODY = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, "Segoe UI", system-ui, sans-serif';

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** "140 lb × 10 / 9 / 8", "140×10, 135×8 lb", "10 min · 1.7 mi" or "30 s / 30 s". */
function shareSets(e, unit) {
  const sets = e.sets.filter((s) => s.done && !s.warmup);
  if (!sets.length) return '';
  if (sets.every((s) => s.duration_s != null && s.reps == null)) return sets.map((s) => fmtCardio(s, unit)).join(' / ');
  const same = sets.every((s) => s.weight === sets[0].weight);
  if (same) return sets[0].weight > 0 ? `${fmtW(sets[0].weight)} ${unit} × ${sets.map((s) => s.reps).join(' / ')}` : `${sets.map((s) => s.reps).join(' / ')} reps`;
  return `${sets.map((s) => `${fmtW(s.weight)}×${s.reps}`).join(', ')} ${unit}`;
}

/**
 * Draws a finished workout as a phone-friendly PNG card: logo, date, time and
 * set counts, the top new record, then each exercise. Long workouts switch to
 * one-line rows and the image grows taller. No names, gym or notes on it.
 */
async function drawShareCard(workout, recap) {
  const W = 1080;
  const P = 64;
  const unit = workout.unit;
  const lifts = workout.exercises.filter((e) => e.sets.some((s) => s.done && !s.warmup));
  const compact = lifts.length > 4;
  const record = recap && recap.records[0];
  const [logo, art] = await Promise.all([
    loadImage('icons/logo-wide.png'),
    record ? loadImage(`icons/muscles/${(S.exById.get(record.exercise_id)?.muscles_main || [])[0]}.png`) : null,
  ]);
  const seconds = Math.max(0, (new Date(workout.completed_at) - new Date(workout.started_at)) / 1000 - (workout.paused_s || 0));
  const sets = lifts.reduce((n, e) => n + e.sets.filter((s) => s.done && !s.warmup).length, 0);
  const stats = [seconds >= 60 && seconds <= 4 * 3600 && `${Math.round(seconds / 60)} min`, `${lifts.length} exercise${lifts.length === 1 ? '' : 's'}`, `${sets} working set${sets === 1 ? '' : 's'}`].filter(Boolean).join('  •  ');
  // Estimated 1-rep max per lift (#162), from this workout's sets, in its unit.
  const ests = new Map(lifts.map((e) => [e, bestEstimate(e.sets, S.exById.get(e.exercise_id))]));
  const anyEst = [...ests.values()].some(Boolean);
  const rowH = compact ? (anyEst ? 128 : 92) : 168;
  const recordH = record ? 330 + (recap.records.length > 1 ? 52 : 0) : 0;
  const H = P + 90 + 120 + 70 + (record ? recordH + 40 : 0) + lifts.length * (rowH + 18) + 40 + P;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  const box = (x, y, w, h, r, fill, stroke) => {
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.fillStyle = fill;
    c.fill();
    if (stroke) { c.lineWidth = 4; c.strokeStyle = stroke; c.stroke(); }
  };
  const fit = (text, max) => {
    let t = text;
    while (c.measureText(t).width > max && t.length > 1) t = t.slice(0, -2) + '…';
    return t;
  };
  c.fillStyle = '#0f1216';
  c.fillRect(0, 0, W, H);
  let y = P;
  if (logo) c.drawImage(logo, P, y, 360, 360 * logo.height / logo.width);
  y += 90;
  c.fillStyle = '#f4f2ec';
  c.font = `800 italic 92px ${SHARE_FONT}`;
  c.textBaseline = 'top';
  c.fillText(fit(fmtDate(workout.started_at, { month: 'long', day: 'numeric', year: 'numeric' }), W - 2 * P), P, y);
  y += 120;
  c.font = `500 40px ${SHARE_BODY}`;
  c.fillStyle = '#d9dde3';
  c.fillText(stats, P, y);
  y += 70;
  if (record) {
    box(P - 20, y, W - 2 * P + 40, recordH, 32, '#163026', '#3af29c');
    if (art) {
      c.save();
      c.globalAlpha = 0.35;
      const ah = recordH - 30;
      c.drawImage(art, W - P - ah + 30, y + 15, ah, ah);
      c.restore();
    }
    let ry = y + 34;
    c.fillStyle = '#3af29c';
    c.font = `800 italic 52px ${SHARE_FONT}`;
    c.fillText('🏆  NEW PERSONAL RECORD', P + 12, ry);
    ry += 80;
    c.fillStyle = '#f4f2ec';
    c.font = `700 50px ${SHARE_FONT}`;
    c.fillText(fit(record.name, W - 2 * P - 260), P + 12, ry);
    ry += 66;
    c.font = `800 italic 96px ${SHARE_FONT}`;
    c.fillText(liftResult(record.weight, record.reps, unit) + (record.weight > 0 ? ' reps' : ''), P + 12, ry);
    ry += 108;
    c.fillStyle = '#a6afbb';
    c.font = `500 36px ${SHARE_BODY}`;
    c.fillText(record.type === 'weight' ? `Heaviest set, up from ${fmtW(record.previous_weight)} ${unit}` : `Most reps at that weight, up from ${record.previous_reps}`, P + 12, ry);
    if (recap.records.length > 1) {
      c.fillStyle = '#3af29c';
      c.fillText(`+ ${recap.records.length - 1} more: ${recap.records.slice(1).map((r) => r.name).join(', ')}`.slice(0, 60), P + 12, ry + 52);
    }
    y += recordH + 40;
  }
  for (const e of lifts) {
    box(P - 20, y, W - 2 * P + 40, rowH, 24, '#1b2027');
    const text = shareSets(e, unit);
    const est = ests.get(e) && estimateLabel(ests.get(e), unit);
    if (compact) {
      c.font = `500 40px ${SHARE_BODY}`;
      const tw = Math.min(c.measureText(text).width, 470);
      c.fillStyle = '#3af29c';
      c.font = `700 44px ${SHARE_FONT}`;
      c.fillText(fit(e.name, W - 2 * P - tw - 60), P + 16, y + 24);
      c.fillStyle = '#f4f2ec';
      c.font = `500 40px ${SHARE_BODY}`;
      c.textAlign = 'right';
      c.fillText(fit(text, 470), W - P - 16, y + 26);
      if (est) {
        c.fillStyle = '#a6afbb';
        c.font = `500 32px ${SHARE_BODY}`;
        c.fillText(est, W - P - 16, y + 80);
      }
      c.textAlign = 'left';
    } else {
      c.font = `500 40px ${SHARE_BODY}`;
      const ew = est ? c.measureText(est).width + 30 : 0;
      c.fillStyle = '#3af29c';
      c.font = `700 54px ${SHARE_FONT}`;
      c.fillText(fit(e.name, W - 2 * P - 40 - ew), P + 16, y + 26);
      if (est) {
        c.fillStyle = '#a6afbb';
        c.font = `500 40px ${SHARE_BODY}`;
        c.textAlign = 'right';
        c.fillText(est, W - P - 16, y + 34);
        c.textAlign = 'left';
      }
      c.fillStyle = '#f4f2ec';
      c.font = `500 50px ${SHARE_BODY}`;
      c.fillText(fit(text, W - 2 * P - 40), P + 16, y + 96);
    }
    y += rowH + 18;
  }
  // What the image shows, for screen readers.
  canvas.dataset.summary = [fmtDate(workout.started_at, { month: 'long', day: 'numeric', year: 'numeric' }), stats,
    ...lifts.map((e) => [e.name, shareSets(e, unit), ests.get(e) && estimateLabel(ests.get(e), unit)].filter(Boolean).join(', '))].join('. ');
  return canvas;
}

/**
 * Share workout (#160): a preview of the card, with Share (the device's share
 * sheet, when it can share files) and Save image outside it. Drawn on the
 * phone only now; nothing is uploaded or kept, and it is released on close.
 */
async function shareWorkoutSheet(workout, recap) {
  const preview = h('div', { class: 'share-preview' }, h('p', { class: 'muted' }, 'Drawing…'));
  const actions = h('div', { class: 'stack' });
  let canvas = null;
  let file = null;
  const close = sheet('Share workout', h('div', { class: 'stack' }, preview, actions), { onClose: () => {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    canvas = null;
    file = null;
  } });
  canvas = await drawShareCard(workout, recap);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const name = `thoenefit-${(workout.started_at || '').slice(0, 10)}.png`;
  file = new File([blob], name, { type: 'image/png' });
  canvas.classList.add('share-card');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Workout summary image. ${canvas.dataset.summary}`);
  fill(preview, canvas);
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  fill(actions,
    canShare && h('button', { class: 'btn primary block', type: 'button', onclick: async () => {
      try { await navigator.share({ files: [file], title: 'My ThoeneFit workout' }); } catch (e) { /* cancelled */ }
    } }, icon('share', 18), 'Share'),
    h('a', { class: `btn block${canShare ? '' : ' primary'}`, href: canvas.toDataURL('image/png'), download: name }, 'Save image'),
    h('p', { class: 'muted small center' }, 'Only your lifts and the date are on the image.'));
  return close;
}

/**
 * Shown on finishing. The working sets are counted on the phone, so they show
 * straight away, even offline; records need the server, so they follow once
 * the workout has synced.
 */
function recapSheet(id, sets) {
  // Until the server's recap arrives (or if it cannot), the count from the phone.
  const box = h('div', { class: 'stack' },
    h('p', { class: 'recap-count' }, h('strong', {}, `${sets} working set${sets === 1 ? '' : 's'}`), ' logged.'),
    h('p', { class: 'muted', 'data-recap-status': '' }, 'Checking for new records…'));
  const close = sheet('Workout saved', h('div', { class: 'stack' },
    box,
    h('a', { class: 'btn block', href: `#/history/${id}`, onclick: () => close() }, 'Open in History')));
  // A lift's name opens its history: close the sheet on the way.
  box.addEventListener('click', (e) => e.target.closest('a') && close());
  const started = Date.now();
  const attempt = async () => {
    if (!document.body.contains(box)) return; // closed
    const pending = sync && sync.docs.has(id);
    if (!pending) {
      try {
        const { recap } = await api.get('recap', `&id=${encodeURIComponent(id)}`);
        box.replaceChildren(recapBody(recap, 'today', 'Workout'),
          h('button', { class: 'btn primary block', type: 'button', onclick: async () => {
            const { workout } = await api.get('workout', `&id=${encodeURIComponent(id)}`);
            close();
            shareWorkoutSheet(workout, recap);
          } }, icon('share', 18), 'Share workout'));
        return;
      } catch (e) {
        if (!e.offline && e.status !== 404) {
          box.replaceChildren(h('p', { class: 'recap-count' }, h('strong', {}, `${sets} working set${sets === 1 ? '' : 's'}`), ' logged.'), h('p', { class: 'muted' }, e.message));
          return;
        }
      }
    }
    if (Date.now() - started > 15000) {
      box.replaceChildren(
        h('p', { class: 'recap-count' }, h('strong', {}, `${sets} working set${sets === 1 ? '' : 's'}`), ' logged.'),
        h('p', { class: 'muted' }, 'Saved on this phone. Records show in History once this workout syncs.'));
      return;
    }
    setTimeout(attempt, 600);
  };
  attempt();
}

// ---------------------------------------------------------------- history

/** A history chart in its own card (#202): mint title, the chart and its readout together. */
function chartCard(title, chart) {
  return h('section', { class: 'chart-card' }, h('h3', {}, title), chart);
}

function asyncSection(load, build) {
  const box = h('div', { class: 'stack' }, h('p', { class: 'muted pad' }, 'Loading'));
  load().then(
    // Skip empty parts (a panel that has nothing to show returns null or false), so they don't render as text.
    (data) => box.replaceChildren(...[build(data)].flat().filter((kid) => kid != null && kid !== false)),
    (e) => box.replaceChildren(h('p', { class: 'muted pad' }, e.offline ? 'This needs a connection.' : e.message)),
  );
  return box;
}

function viewTrends() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const content = asyncSection(() => api.get('trends', '&timezone=' + encodeURIComponent(timezone)), ({ weeks, unit, recovery }) => {
    const points = weeks.map((week) => ({
      ...week,
      label: fmtDate(week.start + 'T12:00:00', { month: 'short', day: 'numeric' }),
      title: `Week of ${fmtDate(week.start + 'T12:00:00', { month: 'long', day: 'numeric' })}`,
      lines: [week.workouts ? `${week.workouts} workout${week.workouts === 1 ? '' : 's'}` : 'No workouts'],
    }));
    const whole = (v) => Math.round(v).toLocaleString();
    return h('div', { class: 'stack' },
      h('section', { class: 'card stack' },
        h('h2', {}, 'Weekly lifting volume'),
        h('p', { class: 'muted small' }, 'Logged weight × reps across completed working sets.'),
        weeks.some((w) => w.workouts > 0)
          ? lineChart(points.map((p) => ({ ...p, value: p.volume })), { unit: unit + ' × reps', format: whole })
          : h('p', { class: 'muted' }, 'No completed workouts in the last 8 weeks.')),
      h('section', { class: 'card stack' },
        h('h2', {}, 'Weekly workout time'),
        h('p', { class: 'muted small' }, 'Start to finish, leaving out long idle stretches before the first set or after the last. A workout still over 4 hours is not counted.'),
        weeks.some((w) => w.seconds !== null)
          ? lineChart(points.map((p) => ({ ...p, value: (p.seconds ?? 0) / 60 })), { unit: 'min', format: whole })
          : h('p', { class: 'muted' }, 'No workout time recorded in the last 8 weeks.')),
      recoveryPanel(recovery));
  });
  return h('main', { class: 'page' }, topHead('Trends', { sub: 'Last 8 weeks.' }), content);
}

/**
 * A page-by-page list of finished workouts. fetchPage(offset, limit) returns
 * {workouts}; hrefOf(w) is where a row opens; empty is shown when there are none.
 */
/**
 * A list of finished workouts, newest first, with Show older at the bottom.
 * With `recentDays`, it opens on just that window (History: the last 8 weeks);
 * Show older then reveals everything before it, a page at a time.
 */
function workoutList(fetchPage, hrefOf, empty, { recentDays = null } = {}) {
  const PAGE = 50;
  const list = h('ul', { class: 'log' });
  const more = h('button', { class: 'btn block', type: 'button', hidden: true }, 'Show older workouts');
  const note = h('p', { class: 'muted pad' }, 'Loading');
  const cutoff = recentDays ? Date.now() - recentDays * 86400000 : null;
  let offset = 0; // how many the server has sent
  let done = false; // the server has nothing older
  let held = []; // fetched but older than the window, waiting for Show older
  let shown = 0;
  const row = (w, older) => h('li', {}, h('a', { class: 'log-row', href: hrefOf(w) },
    h('span', { class: 'log-date' }, fmtDate(w.started_at, older || new Date(w.started_at).getFullYear() !== new Date().getFullYear() ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } : undefined)),
    h('span', { class: 'log-title' }, `${dayLabel(w.day_type)} at ${w.gym_name}`),
    h('span', { class: 'log-meta' }, `${w.exercises.length} exercises, ${w.sets} sets, ${Number(w.volume).toLocaleString()} ${w.unit} lifted`),
    h('span', { class: 'log-names' }, w.exercises.slice(0, 4).join(', ') + (w.exercises.length > 4 ? ` and ${w.exercises.length - 4} more` : ''))));
  const fetchMore = async () => {
    const data = await fetchPage(offset, PAGE);
    offset += data.workouts.length;
    done = data.workouts.length < PAGE;
    return data.workouts;
  };
  const show = (ws) => {
    list.append(...ws.map((w) => row(w, shown > 0 && !cutoff)));
    shown += ws.length;
  };
  const first = async () => {
    if (!cutoff) {
      show(await fetchMore());
    } else {
      // Fetch until the window is covered; anything older waits for Show older.
      while (!done && !held.length) {
        const ws = await fetchMore();
        show(ws.filter((w) => new Date(w.started_at).getTime() >= cutoff));
        held = ws.filter((w) => new Date(w.started_at).getTime() < cutoff);
      }
    }
    if (!shown && !held.length) {
      list.replaceWith(empty);
      return;
    }
    if (!shown) {
      note.hidden = false;
      note.textContent = `No workouts in the last ${Math.round(recentDays / 7)} weeks.`;
    }
  };
  const older = async () => {
    if (held.length) {
      show(held);
      held = [];
    } else {
      show(await fetchMore());
    }
  };
  const load = async (step) => {
    more.disabled = true;
    try {
      note.hidden = true;
      await step();
    } catch (e) {
      note.hidden = false;
      note.textContent = e.offline ? 'History needs a connection.' : e.message;
    }
    more.hidden = done && !held.length;
    more.disabled = false;
  };
  more.onclick = () => load(older);
  load(first);
  return [note, list, more];
}

function viewHistory() {
  // Other people who share their history (#13): a dropdown to open one. Nothing shows until someone does.
  const people = h('div', { 'data-people': '' });
  api.get('people_history').then(({ people: list }) => fill(people, list.length > 0 && h('select', {
    class: 'people-pick',
    'aria-label': "View other trainer's history",
    onchange: (e) => {
      if (e.target.value) location.hash = `#/people/${e.target.value}`;
    },
  }, h('option', { value: '', selected: true }, "View other trainer's history"), list.map((p) => h('option', { value: String(p.id) }, p.name)))), () => {});
  return h('main', { class: 'page' }, topHead('History', { sub: 'Last 8 weeks.' }), people,
    workoutList(
      (offset, limit) => api.get('history', `&limit=${limit}&offset=${offset}`),
      (w) => `#/history/${w.id}`,
      h('section', { class: 'card' }, h('h2', {}, 'No workouts yet'), h('p', { class: 'muted' }, 'Finished workouts show up here, and you can correct any entry afterwards.'), h('a', { class: 'btn primary block', href: '#/today' }, 'Go to Today')),
      { recentDays: 56 }));
}

/** Someone else's finished workouts (#13). Read-only; the server checks they share them (#15). */
function viewPersonHistory(personId) {
  const title = h('h1', {}, 'Workout history');
  return h('main', { class: 'page' }, backLink('history', 'History'), title,
    h('p', { class: 'muted' }, 'Read-only. You can look, but only they can change their workouts.'),
    workoutList(
      async (offset, limit) => {
        const data = await api.get('member_history', `&user=${personId}&limit=${limit}&offset=${offset}`);
        title.textContent = `${data.person.name}'s workouts`;
        return data;
      },
      (w) => `#/people/${personId}/${w.id}`,
      h('section', { class: 'card' }, h('h2', {}, 'No workouts yet'), h('p', { class: 'muted' }, 'Their finished workouts will show up here.'))));
}

/** One of someone else's workouts, read-only. */
function viewPersonWorkout(personId, id) {
  const back = h('a', { class: 'back', href: `#/people/${personId}` }, icon('back', 20), 'Their workouts');
  return h('main', { class: 'page' }, back,
    asyncSection(
      () => api.get('member_workout', `&user=${personId}&id=${encodeURIComponent(id)}`),
      ({ person, workout }) => {
        fill(back, icon('back', 20), `${person.name}'s workouts`);
        return [
          h('header', { class: 'page-head' },
            h('h1', {}, `${dayLabel(workout.day_type)} at ${workout.gym_name}`),
            h('p', { class: 'muted' }, `${person.name}, ${fmtDate(workout.started_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, ${fmtTime(workout.started_at)}. Weights in ${workout.unit}.`),
            workout.notes && h('p', { class: 'muted', 'data-notes': '' }, workout.notes)),
          ...workout.exercises.filter((e) => e.sets.length).map((e) => {
            let n = 0;
            return h('section', { class: 'card lift read-only' },
              h('header', { class: 'lift-head' }, h('div', {}, h('h2', {}, e.name))),
              h('ol', { class: 'sets read-only' }, e.sets.map((s, si) => {
                if (isTimed(e)) return h('li', { class: 'set-line' }, h('span', { class: 'set-tag', 'aria-hidden': 'true' }, isStretch(e) ? holdTag(e, si) : String(si + 1)), h('span', {}, fmtCardio(s, workout.unit)));
                if (!s.warmup) n += 1;
                return h('li', { class: `set-line ${s.warmup ? 'warm' : ''}` },
                  h('span', { class: 'set-tag', 'aria-label': s.warmup ? 'Warm-up set' : `Set ${n}` }, s.warmup ? 'W' : String(n)),
                  h('span', {}, s.weight > 0 ? `${fmtW(s.weight)} ${workout.unit} × ${s.reps}` : `${s.reps} reps`));
              })));
          }),
        ];
      },
    ));
}

function viewHistoryDetail(id) {
  return h('main', { class: 'page' }, backOr('history', 'History'),
    asyncSection(
      () => api.get('workout', `&id=${encodeURIComponent(id)}`),
      ({ workout, calories, strava, strava_export: stravaExport, recap }) => {
        let dirty = false;
        const save = h('button', { class: 'btn primary block', type: 'button', disabled: true }, 'Save changes');
        const touch = () => {
          dirty = true;
          save.disabled = false;
        };
        const box = h('div', { class: 'stack' });
        const paint = () => {
          box.replaceChildren(...workout.exercises.map((e) => {
            let n = 0;
            return h('section', { class: 'card lift' },
              h('header', { class: 'lift-head' }, h('div', {}, h('h2', {}, e.name)), h('a', { class: 'trend-link', href: `#/exercises/${e.exercise_id}`, onclick: () => (S.backTo = { to: `exercises/${e.exercise_id}`, path: `history/${id}`, label: 'Workout History', y: window.scrollY }) }, 'Trend')),
              isStretch(e) && h('div', { class: 'set-head stretch history', 'aria-hidden': 'true' }, h('span', {}, perSideStretch(e) ? 'Side' : 'Hold'), h('span', {}, 'Seconds'), h('span', {}, '')),
              isCardio(e) && h('div', { class: 'set-head cardio history', 'aria-hidden': 'true' }, h('span', {}, ''), h('span', {}, 'Min'), h('span', {}, distUnit(workout.unit)), h('span', {}, 'Level'), h('span', {}, '')),
              h('ol', { class: 'sets' }, e.sets.map((s, si) => {
                if (isStretch(e)) {
                  return h('li', { class: 'set stretch done' },
                    h('span', { class: 'set-tag', 'aria-hidden': 'true' }, holdTag(e, si)),
                    secondsInput(s, (v) => { s.duration_s = v; touch(); }),
                    h('button', { type: 'button', class: 'btn square ghost', 'aria-label': 'Delete', onclick: () => { e.sets.splice(si, 1); touch(); paint(); } }, icon('trash', 20)));
                }
                if (isCardio(e)) {
                  return h('li', { class: 'set cardio done' },
                    h('span', { class: 'set-tag', 'aria-hidden': 'true' }, String(si + 1)),
                    ...cardioInputs(s, workout.unit, (field, v) => { s[field] = v; touch(); }),
                    h('button', { type: 'button', class: 'btn square ghost', 'aria-label': 'Delete', onclick: () => { e.sets.splice(si, 1); touch(); paint(); } }, icon('trash', 20)));
                }
                if (!s.warmup) n += 1;
                return h('li', { class: `set done ${s.warmup ? 'warm' : ''}` },
                  h('button', { type: 'button', class: 'set-tag', 'aria-label': s.warmup ? 'Warm-up set. Tap to make it a working set' : 'Working set. Tap to mark as warm-up', onclick: () => { s.warmup = !s.warmup; touch(); paint(); } }, s.warmup ? 'W' : String(n)),
                  h('input', { class: 'num', type: 'text', inputmode: 'decimal', 'aria-label': `Weight in ${workout.unit}`, value: fmtW(s.weight), oninput: (ev) => { s.weight = parseNum(ev.target.value) ?? 0; touch(); } }),
                  h('span', { class: 'times', 'aria-hidden': 'true' }, '×'),
                  h('input', { class: 'num', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', 'aria-label': 'Reps', value: s.reps == null ? '' : String(s.reps), oninput: (ev) => { const v = parseNum(ev.target.value); s.reps = v == null ? null : Math.round(v); touch(); } }),
                  h('button', { type: 'button', class: 'btn square ghost', 'aria-label': 'Delete set', onclick: () => { e.sets.splice(si, 1); touch(); paint(); } }, icon('trash', 20)),
                );
              })),
              h('div', { class: 'set-actions' }, h('button', { type: 'button', class: 'btn small', onclick: () => {
                const last = e.sets[e.sets.length - 1];
                e.sets.push(isStretch(e)
                  ? { ...stretchSet(last ? last.duration_s : 30), done: true, done_at: workout.completed_at }
                  : isCardio(e)
                  ? { ...cardioSet(last ? last.duration_s : 600, null), level: last ? last.level : null, done: true, done_at: workout.completed_at }
                  : { id: uuid(), weight: last ? last.weight : 0, reps: last ? last.reps : null, warmup: false, done: true, done_at: workout.completed_at });
                touch();
                paint();
              } }, icon('plus', 18), 'Add set')),
            );
          }));
        };
        paint();
        // Estimated calories (#38). Changing how hard it felt is saved with the other edits.
        const caloriesLine = h('p', { class: 'calories' });
        const showCalories = () => fill(caloriesLine, calories != null
          ? [h('strong', {}, `About ${calories.toLocaleString()} calories`), h('span', { class: 'muted' }, ' (estimated)')]
          : h('span', { class: 'muted small' }, S.user.body_weight == null ? 'Add your body weight in Settings to see estimated calories.' : 'No estimated calories: this workout is under a minute or has no recorded duration.'));
        showCalories();
        // Choosing here counts as a rating for planning (#198); an unrated workout shows nothing chosen.
        const effortBox = workout.status === 'completed' && field('How hard was it?',
          choices(EFFORTS, workout.effort_rated ? workout.effort : null, (v) => { workout.effort = v; workout.effort_rated = true; touch(); }, { columns: 3 }));
        save.onclick = () => act(async () => {
          const bad = workout.exercises.some((e) => e.sets.some((s) => (isTimed(e) ? !(s.duration_s > 0) : s.reps == null || s.reps <= 0)));
          if (bad) {
            toast('Every set needs its reps (or time, for cardio and stretches) filled in.', 'bad');
            return;
          }
          workout.rev += 1;
          workout.exercises = workout.exercises.filter((e) => e.sets.length);
          const res = await api.post('save_workout', { workout });
          if (res.conflict) {
            toast('This workout changed on another device. Reopen it and try again.', 'bad');
            return;
          }
          dirty = false;
          save.disabled = true;
          S.draft = null; // suggestions depend on history
          toast('Changes saved. Future suggestions use the corrected numbers.');
          paint();
          api.get('workout', `&id=${encodeURIComponent(id)}`).then((r) => { calories = r.calories; showCalories(); }, () => {});
        }, save);
        return [
          h('header', { class: 'page-head' }, h('h1', {}, `${dayLabel(workout.day_type)} at ${workout.gym_name}`), h('p', { class: 'muted' }, `${fmtDate(workout.started_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, ${fmtTime(workout.started_at)}. Weights in ${workout.unit}.`), workout.notes && h('p', { class: 'muted', 'data-notes': '' }, workout.notes)),
          recap && h('section', { class: 'card stack' }, h('h2', {}, 'Recap'), recapBody(recap, `history/${id}`, 'Workout History'),
            h('button', { class: 'btn block', type: 'button', onclick: () => shareWorkoutSheet(workout, recap) }, icon('share', 18), 'Share workout')),
          h('section', { class: 'card stack' }, caloriesLine, effortBox),
          box,
          save,
          workout.status === 'completed' && workoutStrava(workout, strava, stravaExport, () => dirty),
          h('button', { class: 'btn block', type: 'button', onclick: () => routineSheet(`${dayLabel(workout.day_type)} at ${workout.gym_name}`, planOf(workout.day_type, workout.exercises, (e) => e.sets.filter((s) => !s.warmup).length || e.target_sets)) }, icon('plus', 18), 'Save as routine'),
          h('button', { class: 'btn danger block', type: 'button', onclick: async () => {
            if (!(await confirmSheet('Delete this workout?', 'It is removed from history and from future suggestions. This cannot be undone.', 'Delete workout', true))) return;
            await act(async () => {
              await api.post('delete_workout', { id: workout.id });
              S.draft = null;
              toast('Workout deleted.');
              go('history');
            });
          } }, 'Delete workout'),
        ];
      },
    ));
}

function workoutStrava(workout, connection, exported, hasUnsavedChanges) {
  if (!exported && !connection?.connected) return null;
  const panel = h('div', { class: 'stack' });
  let checking = false;
  let statusMessage = '';
  const checkUpload = async (automatic = false) => {
    if (checking || !connection?.connected) return;
    checking = true;
    statusMessage = '';
    paint();
    try {
      for (let attempt = 0; attempt < (automatic ? 5 : 1); attempt++) {
        if (automatic) await new Promise((resolve) => setTimeout(resolve, 2200));
        if (!panel.isConnected) return;
        const result = await api.post('strava_check_export', { id: workout.id });
        if (!panel.isConnected) return;
        exported = result.export;
        if (!exported) statusMessage = 'Strava couldn’t process this upload. You can try sending it again.';
        if (exported?.activity_id) toast('Workout sent to Strava.');
        if (!exported?.processing) break;
      }
    } catch (e) {
      statusMessage = e.offline ? 'Reconnect to check the Strava upload.' : e.message;
    } finally {
      checking = false;
      if (panel.isConnected) paint();
    }
  };
  const paint = () => {
    const status = statusMessage && h('p', { class: 'muted small', role: 'status' }, statusMessage);
    if (exported?.processing) {
      fill(panel,
        status || h('p', { class: 'muted small', role: 'status' }, 'Strava is processing this workout.'),
        connection?.connected
          ? h('button', { class: 'btn block', type: 'button', disabled: checking, onclick: () => checkUpload() }, 'Check Strava upload')
          : h('a', { class: 'btn block', href: '#/settings' }, 'Reconnect Strava in Settings'),
      );
      return;
    }
    if (exported) {
      fill(panel, exported.activity_id
        ? h('a', { class: 'btn block', href: `https://www.strava.com/activities/${exported.activity_id}`, target: '_blank', rel: 'noopener noreferrer' }, 'View on Strava')
        : h('p', { class: 'muted small', role: 'status' }, 'This export is pending or could not be confirmed. Check your Strava activities. ThoeneFit won’t send it again to avoid a duplicate.'));
      return;
    }
    if (!(Date.parse(workout.completed_at) > Date.parse(workout.started_at))) {
      fill(panel, h('p', { class: 'muted small' }, 'This workout has no recorded duration to send to Strava.'));
      return;
    }
    fill(panel, status, h('button', { class: 'btn block', type: 'button', onclick: () => {
      if (hasUnsavedChanges()) {
        toast('Save your workout changes first.', 'bad');
        return;
      }
      const summary = h('input', { type: 'checkbox' });
      const calories = h('input', { type: 'checkbox', checked: stravaOnFinish().calories });
      const send = h('button', { class: 'btn primary block', type: 'button', onclick: () => act(async () => {
        exported = await api.post('strava_export', {
          id: workout.id,
          include_summary: summary.checked,
          include_calories: S.user.body_weight != null && calories.checked,
          utc_offset: -new Date(workout.started_at).getTimezoneOffset() * 60,
        });
        statusMessage = '';
        close();
        paint();
        if (exported.activity_id) toast('Workout sent to Strava.');
        else if (exported.processing) checkUpload(true);
      }, send) }, 'Send workout');
      const close = sheet('Send to Strava', h('div', { class: 'stack' },
        h('p', {}, 'Send this workout as a Weight Training activity. Your Strava activity visibility settings apply.'),
        h('label', { class: 'check' }, summary, 'Include exercises, sets, reps, and weights'),
        S.user.body_weight != null && h('label', { class: 'check' }, calories, 'Include estimated calories'),
        send,
      ));
    } }, 'Send to Strava'));
  };
  paint();
  if (exported?.processing) checkUpload(true);
  return panel;
}

// ---------------------------------------------------------------- exercises

function viewExercises() {
  const results = h('div', { class: 'stack' });
  // How many exercises the list shows, under the title; follows the search and muscle filter.
  const count = h('span', { class: 'ex-count' });
  const search = h('input', { type: 'search', placeholder: 'Search exercises', 'aria-label': 'Search exercises', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', value: S.exSearch || '', oninput: () => paint() });
  const muscle = h('select', { 'aria-label': 'Muscle', onchange: () => paint() }, h('option', { value: '' }, 'All muscles'), Object.entries(S.vocab.muscles).map(([k, v]) => h('option', { value: k, selected: S.exMuscle === k }, v)));
  const row = (x) => h('li', {}, h('a', { class: 'log-row', href: `#/exercises/${x.id}` },
    h('span', { class: 'log-title' }, x.name, x.custom && h('span', { class: 'badge' }, 'Yours'), x.archived && h('span', { class: 'badge' }, 'Archived')),
    h('span', { class: 'log-meta' }, [S.vocab.kinds[x.kind], x.muscles_main.map((m) => S.vocab.muscles[m]).join(' and ')].filter(Boolean).join(', '))));
  const paint = () => {
    S.exSearch = search.value;
    S.exMuscle = muscle.value;
    const q = search.value.trim();
    const pool = S.exercises.filter((x) => !muscle.value || x.muscles_main.includes(muscle.value) || x.muscles_assist.includes(muscle.value));
    const r = searchExercises(pool, q, S.vocab, { limit: q ? 60 : pool.length, similarLimit: 8 });
    const n = r.closest ? 0 : r.matches.length;
    // The header on screen is kept across tabs (#187), so update whichever count is showing.
    const shown = count.isConnected ? count : document.querySelector('main > .top-head .ex-count') || count;
    shown.textContent = `${n.toLocaleString()} exercise${n === 1 ? '' : 's'}`;
    fill(results,
      r.closest && h('p', { class: 'muted' }, `No exercise matches "${q}" exactly. Closest:`),
      r.matches.length > 0 && h('ul', { class: 'log', 'data-list': 'matches' }, r.matches.map(row)),
      r.similar.length > 0 && h('h2', { class: 'list-head' }, 'Similar exercises'),
      r.similar.length > 0 && h('ul', { class: 'log', 'data-list': 'similar' }, r.similar.map(row)),
      !r.matches.length && h('p', { class: 'muted pad' }, q ? `No exercises match "${q}".` : 'No exercises here yet.'),
    );
  };
  paint();
  return h('main', { class: 'page' }, topHead('Exercises', { sub: count }), h('div', { class: 'filters' }, search, muscle), h('a', { class: 'btn block', href: '#/exercises/new' }, icon('plus', 18), 'Add your own exercise'), results);
}

function equipLabel(key) {
  for (const g of S.vocab.equipment) if (g.items[key]) return g.items[key];
  return key;
}

function viewExercise(id) {
  const ex = S.exById.get(id);
  if (!ex) return page('Exercise not found', backLink('exercises', 'Exercises'));
  const tags = [
    ['Equipment', ex.equipment.length ? ex.equipment.map(equipLabel).join(', ') : 'None needed'],
    ['Movement', S.vocab.patterns[ex.pattern]],
    ['Primary muscles', ex.muscles_main.map((m) => S.vocab.muscles[m]).join(', ')],
    ['Secondary muscles', ex.muscles_assist.map((m) => S.vocab.muscles[m]).join(', ') || 'None'],
  ];
  const history = api.get('exercise_history', `&id=${id}`);
  // P1RM (#202): the estimated 1-rep max (#162) from the latest eligible session of the
  // current setup, dated with that workout. Filled in once the history arrives; no row without one.
  const p1rm = h('div', { class: 'facts-row', hidden: true });
  history.then(({ sessions }) => {
    if (!sessions.length) return;
    const key = sessions[sessions.length - 1].variant_key;
    const latest = [...sessions].reverse().find((s) => s.variant_key === key && bestEstimate(s.sets, ex));
    if (!latest) return;
    const est = bestEstimate(latest.sets, ex);
    fill(p1rm,
      h('dt', {}, 'P1RM as of:', h('span', { class: 'p1rm-date' }, fmtDate(latest.date, { month: 'short', day: 'numeric', year: 'numeric' }))),
      h('dd', { class: 'p1rm-value' }, `${roundEstimate(convertWeight(est.value, latest.unit, S.user.unit)).toLocaleString()} ${S.user.unit}`));
    p1rm.hidden = false;
  }, () => {});
  const trend = asyncSection(
    () => history,
    ({ sessions }) => {
      if (!sessions.length) return h('p', { class: 'muted' }, 'No logged sets yet. Trends appear after your first finished workout with this exercise.');
      const variants = [...new Set(sessions.map((s) => s.variant_key))];
      const box = h('div', { class: 'stack' });
      const DAY = 86400000;
      const RANGES = [['3m', '3 months', 91], ['6m', '6 months', 183], ['1y', '1 year', 365], ['all', 'All', null]];
      let key = sessions[sessions.length - 1].variant_key;
      // A history longer than a year starts on the last year, so the line is readable (#11).
      const spanDays = (new Date(sessions[sessions.length - 1].date) - new Date(sessions[0].date)) / DAY;
      let range = S.exRange || (spanDays > 365 ? '1y' : 'all');
      const rangeHere = h('div', { class: 'range' });
      const fullDate = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
      const show = () => {
        const all = sessions.filter((s) => s.variant_key === key);
        const days = RANGES.find((r) => r[0] === range)[2];
        const from = days ? Date.now() - days * DAY : -Infinity;
        const mine = all.filter((s) => new Date(s.date).getTime() >= from);
        fill(rangeHere, choices(RANGES.map(([k, l]) => [k, l]), range, (v) => {
          range = v;
          S.exRange = v; // kept while the app is open, across exercises
          show();
        }, { columns: 4 }));
        if (!mine.length) {
          fill(box, h('p', { class: 'muted' }, `No sessions in this range. The last one was ${fmtDate(all[all.length - 1].date, fullDate)}.`));
          return;
        }
        const unit = mine[mine.length - 1].unit;
        const oneYear = new Date(mine[0].date).getFullYear() === new Date(mine[mine.length - 1].date).getFullYear();
        const pts = mine.map((s) => {
          const top = Math.max(...s.sets.map((x) => x.weight));
          const best = Math.max(...s.sets.filter((x) => x.weight === top).map((x) => x.reps));
          return {
            label: fmtDate(s.date, oneYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' }),
            t: new Date(s.date).getTime(),
            title: fmtDate(s.date, fullDate),
            href: `#/history/${s.workout_id}`,
            top,
            best,
            s,
          };
        });
        // Opening a workout from the chart comes back to this exercise.
        const onOpen = (p) => (S.backTo = { to: `history/${p.s.workout_id}`, path: `exercises/${id}`, label: ex.name, y: window.scrollY });
        const where = (s) => (variants.length > 1 ? [] : [s.gym_name]);
        // Estimated 1-rep max (#162): the best from each session's working sets, in the lifter's unit.
        const prefUnit = S.user.unit;
        const estOf = (s) => bestEstimate(s.sets, ex);
        const estLine = (s) => {
          const e = estOf(s);
          return e && `${estimateLabel(e, s.unit, prefUnit)} from ${fmtW(e.weight)} ${s.unit} × ${e.reps}`;
        };
        const sessionList = () => [
          h('h3', { class: 'session-count' }, mine.length > 30 ? `Latest 30 of ${mine.length} sessions` : `${mine.length} session${mine.length === 1 ? '' : 's'}`),
          h('ul', { class: 'log' }, [...mine].reverse().slice(0, 30).map((s) => h('li', {}, h('a', { class: 'log-row', href: `#/history/${s.workout_id}`, onclick: () => onOpen({ s }) }, h('span', { class: 'log-date' }, fmtDate(s.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })), h('span', { class: 'log-title' }, fmtSets(s.sets, s.unit)), estLine(s) && h('span', { class: 'log-est' }, estLine(s)), h('span', { class: 'log-meta' }, s.gym_name))))),
        ];
        const estChart = () => {
          const epts = pts.map((p) => ({ ...p, est: estOf(p.s) })).filter((p) => p.est);
          if (!epts.length) return [];
          return [
            chartCard('Estimated 1-rep max', lineChart(epts.map((p) => ({ ...p, value: roundEstimate(convertWeight(p.est.value, p.s.unit, prefUnit)), lines: [`From ${fmtW(p.est.weight)} ${p.s.unit} × ${p.est.reps}`, ...where(p.s)] })), { unit: prefUnit, onOpen, hint: 'Estimated from your best working set of 10 reps or fewer.' })),
          ];
        };
        if (isStretch(ex)) {
          // Stretches (#138): seconds held per session.
          const spts = mine.map((s) => ({
            label: fmtDate(s.date, oneYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' }),
            t: new Date(s.date).getTime(),
            title: fmtDate(s.date, fullDate),
            href: `#/history/${s.workout_id}`,
            value: s.sets.reduce((n, x) => n + (x.duration_s || 0), 0),
            lines: [fmtSets(s.sets, s.unit), ...where(s)],
            s,
          }));
          fill(box,
            chartCard('Seconds held', lineChart(spts, { unit: 's', format: (v) => String(Math.round(v)), onOpen, hint: 'Tap a point to see that session.' })),
            ...sessionList(),
          );
          return;
        }
        if (isCardio(ex)) {
          // Cardio (#18): minutes, and distance when it was recorded.
          const total = (s, f) => s.sets.reduce((n, x) => n + (x[f] || 0), 0);
          const cpts = mine.map((s) => ({
            label: fmtDate(s.date, oneYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' }),
            t: new Date(s.date).getTime(),
            title: fmtDate(s.date, fullDate),
            href: `#/history/${s.workout_id}`,
            minutes: Math.round(total(s, 'duration_s') / 6) / 10,
            distance: total(s, 'distance_m') ? Math.round(metresTo(total(s, 'distance_m'), unit) * 100) / 100 : null,
            lines: [fmtSets(s.sets, s.unit), ...where(s)],
            s,
          }));
          const withDistance = cpts.filter((p) => p.distance != null);
          fill(box,
            chartCard('Minutes', lineChart(cpts.map((p) => ({ ...p, value: p.minutes })), { unit: 'min', onOpen, hint: 'Tap a point to see that session.' })),
            withDistance.length > 0 && chartCard('Distance', lineChart(withDistance.map((p) => ({ ...p, value: p.distance })), { unit: distUnit(unit), onOpen, hint: 'Tap a point to see that session.' })),
            ...sessionList(),
          );
          return;
        }
        fill(box,
          chartCard('Top weight', lineChart(pts.map((p) => ({ ...p, value: p.top, lines: [`Sets: ${fmtSets(p.s.sets, p.s.unit)}`, ...where(p.s)] })), { unit, onOpen, hint: 'Tap a point to see that session.' })),
          chartCard('Best reps at top weight', lineChart(pts.map((p) => ({ ...p, value: p.best, lines: [`At ${fmtW(p.top)} ${p.s.unit}`, `Sets: ${fmtSets(p.s.sets, p.s.unit)}`] })), { unit: 'reps', onOpen, hint: 'Tap a point to see that session.' })),
          ...estChart(),
          ...sessionList(),
        );
      };
      show();
      if (variants.length < 2) return [rangeHere, box];
      const picker = h('select', { 'aria-label': 'Gym', onchange: (e) => {
        key = e.target.value;
        show();
      } }, variants.map((v) => h('option', { value: v, selected: v === key }, [...sessions].reverse().find((s) => s.variant_key === v).gym_name)));
      return [field('Machine history is kept per gym', picker), rangeHere, box];
    },
  );
  const art = muscleArt(ex.id);
  return h('main', { class: 'page exercise-page' }, detailHead(backOr('exercises', 'Exercises'), ex.name),
    h('div', { class: `exercise-head${art ? ' has-art' : ''}` },
      art,
      h('dl', { class: 'facts' }, tags.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]), p1rm)),
    ex.cues && section('Form cues', h('p', { class: 'cues' }, ex.cues)),
    section('Setup notes', exerciseNotesSection(ex)),
    section('History', trend),
    ex.shared && h('p', { class: 'muted small' }, S.user.role === 'admin' ? 'This is in the default library for everyone. As the admin you can still edit or archive it; archiving hides it from suggestions for all accounts.' : 'Added to the default library by the admin.'),
    (ex.custom || (ex.shared && S.user.role === 'admin')) && h('div', { class: 'stack' },
      h('a', { class: 'btn block', href: `#/exercises/edit/${ex.id}` }, 'Edit exercise'),
      h('button', { class: 'btn block', type: 'button', onclick: (e) => act(async () => {
        await api.post('archive_exercise', { id: ex.id, archived: !ex.archived });
        ex.archived = !ex.archived;
        S.draft = null;
        toast(ex.archived ? 'Archived. It will not be suggested, and its history stays.' : 'Restored.');
        render();
      }, e.currentTarget) }, ex.archived ? 'Restore exercise' : 'Archive exercise')),
  );
}

function viewExerciseForm(id) {
  const ex = id ? S.exById.get(id) : null;
  const v = ex ? { ...ex, equipment: [...ex.equipment], muscles_main: [...ex.muscles_main], muscles_assist: [...ex.muscles_assist] } : { name: '', kind: 'dumbbell', pattern: 'horizontal_push', equipment: [], muscles_main: [], muscles_assist: [], cues: '' };
  const name = h('input', { type: 'text', value: v.name, maxlength: 120, required: true });
  const kind = h('select', { onchange: (e) => (v.kind = e.target.value) }, Object.entries(S.vocab.kinds).map(([k, l]) => h('option', { value: k, selected: k === v.kind }, l)));
  const pattern = h('select', { onchange: (e) => (v.pattern = e.target.value) }, Object.entries(S.vocab.patterns).map(([k, l]) => h('option', { value: k, selected: k === v.pattern }, l)));
  const cues = h('textarea', { rows: 4, maxlength: 1000 }, v.cues);
  const multi = (keyed, target) => h('div', { class: 'checks tight' }, Object.entries(keyed).map(([k, l]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: target.includes(k), onchange: (e) => {
    const i = target.indexOf(k);
    if (e.target.checked && i < 0) target.push(k);
    if (!e.target.checked && i >= 0) target.splice(i, 1);
  } }), h('span', {}, l))));
  const allEquip = Object.assign({}, ...S.vocab.equipment.map((g) => g.items));
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, ex ? 'Save exercise' : 'Add exercise');
  return h('main', { class: 'page' }, backLink(ex ? `exercises/${ex.id}` : 'exercises', ex ? ex.name : 'Exercises'),
    h('h1', {}, ex ? 'Edit exercise' : 'Add your own exercise'),
    h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      await act(async () => {
        const res = await api.post('save_exercise', { id: ex ? ex.id : undefined, name: name.value, kind: v.kind, pattern: v.pattern, equipment: v.equipment, muscles_main: v.muscles_main, muscles_assist: v.muscles_assist, cues: cues.value });
        setExercises([...S.exercises.filter((x) => x.id !== res.exercise.id), res.exercise].sort((a, b) => a.name.localeCompare(b.name)));
        S.draft = null;
        toast(ex ? 'Exercise saved.' : 'Exercise added.');
        go(`exercises/${res.exercise.id}`);
      }, btn);
    } },
      field('Name', name),
      field('Loaded with', kind, 'Machines and cables keep separate history for each gym.'),
      field('Movement', pattern, 'Decides which slot in a workout this exercise can fill.'),
      field('Equipment it needs', multi(allEquip, v.equipment), 'It is only suggested at gyms that have all of these.'),
      field('Primary muscles', multi(S.vocab.muscles, v.muscles_main)),
      field('Secondary muscles', multi(S.vocab.muscles, v.muscles_assist)),
      field('Form cues', cues),
      btn,
    ));
}

// ---------------------------------------------------------------- settings

/** Optional body weight (#38), only used to estimate calories. Saves when you leave the field. */
function bodyWeightField() {
  const input = h('input', {
    class: 'num',
    type: 'text',
    inputmode: 'decimal',
    'aria-label': `Body weight in ${S.user.unit}`,
    placeholder: S.user.unit,
    value: S.user.body_weight == null ? '' : fmtW(S.user.body_weight),
    onchange: (e) => act(async () => {
      const v = parseNum(e.target.value);
      try {
        const r = await api.post('save_profile', { body_weight: v == null ? null : v });
        S.user = r.user;
        toast(v == null ? 'Body weight removed.' : 'Body weight saved.');
      } catch (err) {
        e.target.value = S.user.body_weight == null ? '' : fmtW(S.user.body_weight);
        throw err;
      }
    }),
  });
  return field(`Body weight (${S.user.unit})`, input, 'Optional. Only used to estimate the calories a workout burned.');
}

const EFFORTS = [['light', 'Light'], ['moderate', 'Moderate'], ['hard', 'Hard']];

/** Rows that each open another screen: [href, title, meta, extra attributes]. */
function linkList(...rows) {
  return h('ul', { class: 'log link-list' }, rows.filter(Boolean).map(([href, title, meta, extra]) => h('li', {},
    h('a', { class: 'log-row link-row', href, ...(extra || {}) },
      h('span', { class: 'log-title' }, ...[title].flat()),
      meta && h('span', { class: 'log-meta' }, meta),
      h('span', { class: 'chevron', 'aria-hidden': 'true' }, icon('back', 20))))));
}

/** Saved routines: view, rename and delete (#103 moved them here from the main Settings page). */
function viewRoutines() {
  return h('main', { class: 'page' }, backLink('settings', 'Settings'), h('h1', {}, 'Routines'),
    h('p', { class: 'muted' }, 'Start a routine from the workout picker on Today.'),
    routinesList());
}

function viewStrava() {
  const head = [backLink('settings', 'Settings'), h('h1', {}, 'Strava')];
  if (!S.strava?.enabled) return h('main', { class: 'page' }, ...head, h('p', { class: 'muted' }, 'Strava is not set up on this server.'));
  return h('main', { class: 'page' }, ...head,
    h('p', {}, S.strava.connected ? 'Connected. Send a finished workout from History, or tick Send to Strava when you finish one.' : 'Connect to send finished workouts to Strava, with their exercises, sets, reps and weights if you like.'),
    S.strava.connected
      ? h('button', { class: 'btn block', type: 'button', onclick: async (e) => {
        const button = e.currentTarget;
        if (!(await confirmSheet('Disconnect Strava?', 'Workouts you already sent stay on Strava.', 'Disconnect'))) return;
        await act(async () => {
          const result = await api.post('strava_disconnect');
          S.strava = result.strava;
          render();
          toast('Strava disconnected.');
        }, button);
      } }, 'Disconnect Strava')
      : h('button', { class: 'btn primary block', type: 'button', onclick: (e) => act(async () => {
        const { url } = await api.post('strava_authorize');
        location.assign(url);
      }, e.currentTarget) }, 'Connect to Strava'));
}

function viewPassword() {
  const current = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const next = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
  const pwBtn = h('button', { class: 'btn primary block', type: 'submit' }, 'Change password');
  return h('main', { class: 'page' }, backLink('settings', 'Settings'), h('h1', {}, 'Change password'),
    h('p', { class: 'muted' }, 'Your other phones and computers are signed out. This one stays signed in.'),
      h('form', { class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        await act(async () => {
          const result = await api.post('change_password', { current: current.value, next: next.value });
          // The server signed out every other device and gave this one a new session and token.
          if (result.csrf) api.csrf = result.csrf;
          current.value = '';
          next.value = '';
          toast('Password changed. Other devices are signed out.');
        }, pwBtn);
      } }, field('Current password', current), field('New password', next, 'At least 10 characters.'), pwBtn));
}

const FEEDBACK_KINDS = [['idea', 'Idea'], ['problem', 'Problem'], ['other', 'Other']];
const FEEDBACK_STATUS = { sent: 'Sent', done: 'Done', closed: 'Closed' };

/** Sent feedback with its GitHub status. withNames is for the admin's list only. */
function feedbackList(items, withNames = false) {
  const kindLabel = Object.fromEntries(FEEDBACK_KINDS);
  return h('ul', { class: 'log feedback-list' }, items.map((f) => h('li', { class: 'feedback-row' },
    h('div', { class: 'feedback-head' },
      h('span', { class: 'log-title' }, f.title),
      h('span', { class: `status-pill ${f.status}` }, FEEDBACK_STATUS[f.status] || f.status)),
    h('span', { class: 'log-meta' },
      [kindLabel[f.kind] || f.kind, withNames && f.from, fmtDate(f.created_at, { month: 'short', day: 'numeric', year: 'numeric' })].filter(Boolean).join(' · '),
      f.issue_url && [' · ', h('a', { href: f.issue_url, target: '_blank', rel: 'noopener' }, `#${f.issue_number}`)]))));
}

/** Send feedback (#20): it becomes a public GitHub issue, without the sender's name. */
function viewFeedback() {
  const head = [backLink('settings', 'Settings'), h('h1', {}, 'Send feedback')];
  if (!S.feedbackEnabled) return h('main', { class: 'page' }, ...head, h('p', { class: 'muted' }, 'Feedback is not set up on this server.'));
  let kind = 'idea';
  const title = h('input', { type: 'text', name: 'feedback_title', maxlength: 120, required: true, autocomplete: 'off', placeholder: 'For example: Add a plate calculator' });
  const body = h('textarea', { name: 'feedback_body', rows: 6, maxlength: 4000, required: true, placeholder: 'What would help, or what went wrong and what you expected instead.' });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Send feedback');
  const sent = h('div', { class: 'stack' });
  const showSent = (items) => fill(sent, items.length ? feedbackList(items) : h('p', { class: 'muted' }, 'Nothing yet. What you send shows up here, with whether it has been done.'));
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    error.textContent = '';
    btn.disabled = true;
    try {
      const res = await api.post('send_feedback', { kind, title: title.value, body: body.value });
      // Clear only once it is sent; on an error everything typed stays put.
      title.value = '';
      body.value = '';
      showSent(res.feedback);
      toast('Thanks, your feedback was sent.');
    } catch (err) {
      error.textContent = err.offline ? 'No connection. Your feedback was not sent; try again when you are back online.' : err.message;
    }
    btn.disabled = false;
  } },
    field('Type', choices(FEEDBACK_KINDS, kind, (v) => (kind = v), { columns: 3 })),
    field('Title', title),
    field('Details', body),
    error,
    btn,
    h('p', { class: 'muted small public-note' }, "Feedback is posted publicly on GitHub. Don't include personal details."));
  showSent([]);
  sent.replaceChildren(h('p', { class: 'muted' }, 'Loading'));
  api.get('feedback').then(({ feedback }) => showSent(feedback), (e) => fill(sent, h('p', { class: 'muted' }, e.offline ? 'This needs a connection.' : e.message)));
  return h('main', { class: 'page' }, ...head,
    h('p', { class: 'muted' }, 'Ideas and problems go straight onto the ThoeneFit to-do list.'),
    form,
    section('What you have sent', sent));
}

function viewInstallHelp() {
  return h('main', { class: 'page' }, backLink('settings', 'Settings'), h('h1', {}, 'Add to your Home Screen'),
    h('div', { class: 'stack install-help' },
      h('p', {}, install.isInstalled() ? 'You are using the installed app.' : 'Installed, ThoeneFit opens full screen like an app and keeps working when the gym has no signal.'),
      (() => {
        // This browser's steps first, then everyone else's (#89).
        const mine = install.detect();
        return [
          h('h3', {}, mine.key === 'other' ? 'This browser' : mine.name),
          installPrompt && h('button', { class: 'btn primary block', type: 'button', onclick: (e) => promptInstall(e.currentTarget) }, 'Install'),
          installSteps(mine),
          h('details', { class: 'fold' }, h('summary', {}, 'Other browsers and phones'),
            install.GUIDES.filter((g) => g.key !== mine.key && g.key !== 'other').map((g) => [h('h3', {}, g.name), installSteps(g)])),
        ];
      })(),
      h('p', { class: 'muted small' }, 'The app updates itself when you open it. The Home Screen icon does not: the phone keeps the picture from when the app was added. To get a new icon, remove ThoeneFit from the Home Screen and add it again. Your workouts are kept on the server.')));
}

function viewSettings() {
  const saveProfile = (key, value) => act(async () => {
    const r = await api.post('save_profile', { [key]: value });
    S.user = r.user;
    S.draft = null;
    S.draftOpts = { day_type: null, minutes: null, bodyweight_only: false, warm_up: null, stretches: null };
  });
  const routineCount = (S.routines || []).length;
  // Headings are mint so the sections are easy to pick out (#103). What affects
  // the next workout comes first; setup and maintenance are one-line links.
  return h('main', { class: 'page settings-main' }, topHead('Settings', { sub: h('a', { class: 'app-version', href: '#/settings/whats-new' }, `Version ${APP_VERSION}`) }),
    section('Training', trainingFields(S.user, saveProfile), bodyWeightField(), h('p', { class: 'muted small' }, 'Changes save as you make them. Past workouts keep the unit they were logged in; suggestions convert to your current unit.')),
    section('Gyms', linkList(
      ...S.gyms.map((g) => [`#/settings/gym/${g.id}`, [g.name, g.id === S.user.active_gym_id && h('span', { class: 'badge' }, 'Selected')], g.equipment.length ? `${g.equipment.length} kinds of equipment` : 'Bodyweight only']),
      ['#/settings/gym/new', h('span', { class: 'add-row' }, icon('plus', 18), 'Add a gym')])),
    section('Routines', linkList(['#/settings/routines', 'Manage routines', routineCount ? `${routineCount} saved` : 'None saved yet'])),
    section('Who can see your history',
      choices([
        ['private', 'Only me', 'Nobody else can see your workouts'],
        ['members', 'All signed-in users', 'Anyone with an account here can see your finished workouts, read-only'],
      ], S.user.history_visibility || 'private', (v) => saveProfile('history_visibility', v).then((ok) => ok !== null && toast(v === 'members' ? 'Your history is now visible to signed-in users.' : 'Your history is now private.'))),
      h('p', { class: 'muted small' }, 'Workouts in progress are never shown. Others see what you logged, not your gyms, routines or settings.')),
    section('Your data', linkList(
      ['api.php?a=export', 'Export all sets as CSV', 'One row per set, including warm-ups, with dates in UTC', { download: '' }],
      ['#/settings/import', 'Import from Fitbod', 'Bring in workouts from a Fitbod CSV'])),
    S.strava?.enabled && section('Integrations', linkList(['#/settings/strava', 'Strava', S.strava.connected ? 'Connected' : 'Not connected'])),
    section('Help', linkList(
      ['#/settings/install', 'Add to your Home Screen', install.isInstalled() ? 'You are using the installed app' : 'Open full screen and keep working with no signal'],
      S.feedbackEnabled && ['#/settings/feedback', 'Send feedback', 'Ideas, problems or anything else'],
      ['#/settings/whats-new', "What's new", `Version ${APP_VERSION}`])),
    S.user.role === 'admin' && section('Users', linkList(
      ['#/settings/users', ['Manage users', S.pendingRequests > 0 && h('span', { class: 'badge alert' }, `${S.pendingRequests} waiting`)], 'Create accounts, approve requests, reset passwords'])),
    section('Account',
      h('p', { class: 'muted' }, `Signed in as ${S.user.username}${S.user.role === 'admin' ? ' (admin)' : ''}.`),
      linkList(['#/settings/password', 'Change password', 'Signs you out on your other devices']),
      h('button', { class: 'btn block', type: 'button', onclick: async (e) => {
        if (sync.status() !== 'saved' && !(await confirmSheet('Sign out with unsynced changes?', 'Some workout changes are still only on this phone. They stay here and upload the next time you sign in on it.', 'Sign out anyway'))) return;
        await act(async () => {
          await api.post('logout');
          S.user = null;
          localStorage.removeItem('tf.boot');
          render();
        }, e.currentTarget);
      } }, 'Sign out'),
      // For a shared phone or computer (#23).
      h('button', { class: 'btn danger block', type: 'button', onclick: async (e) => {
        const button = e.currentTarget;
        const unsynced = sync.status() !== 'saved';
        if (!(await confirmSheet(
          unsynced ? 'Discard changes that have not synced?' : 'Sign out and clear this device?',
          unsynced
            ? 'Some workout changes are only on this device and have not reached the server. Clearing deletes them for good. To keep them, close this, connect, and wait until the status shows Saved.'
            : 'Your workouts, profile and rest timer are removed from this device. Everything you have synced stays on the server, ready the next time you sign in.',
          unsynced ? 'Discard changes, sign out and clear' : 'Sign out and clear',
          unsynced,
        ))) return;
        await act(async () => {
          await api.post('logout');
          const uid = S.user.id;
          sync.close();
          sync = null;
          stopRest();
          clearLocalData(localStorage, uid);
          S.user = null;
          S.draft = null;
          S.offlineBoot = false;
          render();
          toast('Signed out. Your workout data was removed from this device.');
        }, button);
      } }, 'Sign out and clear this device'),
      h('p', { class: 'muted small' }, 'On a shared phone or computer, use Sign out and clear this device. It also removes your saved workouts, profile and rest timer from it.')),
    brandWide(),
  );
}

/** Release notes, built by the deploy from the pull requests each release brought in. */
async function loadChangelog() {
  let res;
  try {
    res = await fetch('changelog.json', { cache: 'no-cache' });
  } catch (e) {
    throw Object.assign(new Error('This needs a connection.'), { offline: true });
  }
  if (res.status === 404) return { upcoming: null, releases: [] };
  if (!res.ok) throw new Error('Could not load the release notes.');
  return res.json();
}

function viewWhatsNew() {
  const list = (label, items) => items.length > 0 && h('div', { class: 'stack' },
    h('h3', { class: 'small muted' }, label),
    h('ul', { class: 'notes' }, items.map((c) => h('li', {}, c.title))));
  const release = (r, heading) => h('section', { class: 'card stack' },
    h('h2', {}, heading),
    list('New', r.new),
    list('Improved', r.improved || []),
    list('Fixed', r.fixed));
  const content = asyncSection(loadChangelog, ({ upcoming, releases }) => {
    const out = [];
    if (upcoming) out.push(release(upcoming, `Coming next · ${upcoming.version}`));
    for (const r of releases) {
      out.push(release(r, `${r.version} · ${fmtDate(r.date + 'T12:00:00', { month: 'short', day: 'numeric', year: 'numeric' })}`));
    }
    if (!out.length) out.push(h('p', { class: 'muted pad' }, APP_VERSION === 'dev' ? 'Release notes are added when the app is deployed.' : 'No release notes yet.'));
    return out;
  });
  // Same pinned header as exercise pages (#202): back to Settings on the left, the title on the right.
  return h('main', { class: 'page' }, detailHead(backLink('settings', 'Settings'), "What's new"), h('p', { class: 'muted' }, `You have version ${APP_VERSION}.`), content);
}

function viewImport() {
  const gym = activeGym();
  if (!gym) return page('Import from Fitbod', backLink('settings', 'Settings'), h('p', { class: 'muted' }, 'Add a gym first. Imported workouts are filed under one gym.'));
  const st = { csv: null, gymId: gym.id, choices: {} };
  const file = h('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'Fitbod export file' });
  const gymSelect = h('select', { onchange: (e) => (st.gymId = Number(e.target.value)) }, S.gyms.map((g) => h('option', { value: g.id, selected: g.id === gym.id }, g.name)));
  const result = h('div', { class: 'stack' });
  const checkBtn = h('button', { class: 'btn primary block', type: 'button' }, 'Check file');
  const describe = (g) => `${S.vocab.kinds[g.kind]}, ${S.vocab.patterns[g.pattern].replace(/ \(.*/, '')}`.toLowerCase();

  const show = (data) => {
    const sum = data.summary;
    const skippedNames = Object.keys(sum.not_importable);
    const importBtn = h('button', { class: 'btn primary block', type: 'button' }, `Import ${sum.workouts.toLocaleString()} workouts`);
    const recount = () => {
      const skip = new Set(Object.entries(st.choices).filter(([, v]) => v === 'skip').map(([k]) => k));
      const sets = data.exercises.reduce((n, x) => n + (skip.has(x.name) ? 0 : x.sets), 0);
      importBtn.textContent = `Import ${sets.toLocaleString()} sets`;
      importBtn.disabled = sets === 0;
    };
    importBtn.onclick = () => act(async () => {
      const res = await api.post('import_fitbod', { csv: st.csv, gym_id: st.gymId, choices: st.choices, commit: true });
      setExercises(res.catalog);
      S.draft = null;
      toast(`Imported ${res.imported.workouts.toLocaleString()} workouts and ${res.imported.sets.toLocaleString()} sets.`);
      go('history');
    }, importBtn);
    const rows = data.exercises.map((x) => {
      const builtIn = x.suggested_id ? S.exById.get(x.suggested_id) : null;
      const sel = h('select', { 'aria-label': `What to do with ${x.name}` },
        builtIn && h('option', { value: 'default' }, `Use ${builtIn.name}`),
        h('option', { value: builtIn ? 'new' : 'default' }, `Add as my own exercise (${describe(x.guess)})`),
        h('option', { value: 'skip' }, 'Leave out'),
        h('option', { value: 'more' }, 'Use another exercise…'),
      );
      sel.onchange = () => {
        if (sel.value === 'more') {
          sel.lastChild.remove();
          const group = h('optgroup', { label: 'Exercise library' }, S.exercises.filter((e) => !e.archived).map((e) => h('option', { value: e.id }, e.name)));
          sel.append(group);
          sel.value = String(group.firstChild.value);
        }
        if (sel.value === 'default') delete st.choices[x.name];
        else st.choices[x.name] = sel.value;
        recount();
      };
      return h('li', { class: 'map-row' }, h('span', { class: 'log-title' }, x.name), h('span', { class: 'log-meta' }, `${x.sets} sets`), sel);
    });
    const matched = data.exercises.filter((x) => x.suggested_id).length;
    result.replaceChildren(
      h('section', { class: 'card' },
        h('h2', {}, `${sum.workouts.toLocaleString()} workouts, ${sum.sets.toLocaleString()} sets`),
        h('p', { class: 'muted' }, `From ${fmtDate(sum.from, { month: 'short', year: 'numeric' })} to ${fmtDate(sum.to, { month: 'short', year: 'numeric' })}. Weights are converted from Fitbod's kilograms to ${S.user.unit}.`),
        sum.not_importable_rows > 0 && h('p', { class: 'muted' }, `${sum.not_importable_rows.toLocaleString()} rows have no reps (cardio and timed holds such as ${skippedNames.slice(0, 3).join(', ')}) and are left out.`)),
      h('h2', {}, `${data.exercises.length} exercises`),
      h('p', { class: 'muted' }, `${matched} match an exercise already in the library. The rest are added as your own exercises with tags guessed from their names; you can edit those afterwards under Exercises. Change any row before importing.`),
      h('ul', { class: 'log' }, rows),
      importBtn,
      h('p', { class: 'muted small' }, 'Importing the same file again replaces the earlier import rather than doubling it.'),
    );
  };

  checkBtn.onclick = () => act(async () => {
    const f = file.files[0];
    if (!f) {
      toast('Choose your Fitbod export file first.', 'bad');
      return;
    }
    st.csv = await f.text();
    st.choices = {};
    result.replaceChildren(h('p', { class: 'muted' }, 'Reading the file'));
    try {
      show(await api.post('import_fitbod', { csv: st.csv, gym_id: st.gymId }));
    } catch (e) {
      result.replaceChildren();
      throw e;
    }
  }, checkBtn);

  return h('main', { class: 'page' }, backLink('settings', 'Settings'),
    h('h1', {}, 'Import from Fitbod'),
    h('p', { class: 'muted' }, 'Use Export Workout Data in Fitbod\'s settings, save the CSV file to this phone or computer, and choose it here. Nothing is saved until you press Import.'),
    field('Fitbod export file', file),
    field('File the workouts under', gymSelect, 'Fitbod does not record where a set was done. This matters for machines and cables, whose history is kept per gym.'),
    checkBtn,
    result,
    section('Undo an import',
      h('button', { class: 'btn danger block', type: 'button', onclick: async (e) => {
        if (!(await confirmSheet('Remove imported workouts?', 'Every workout that came from a Fitbod import is deleted. Workouts logged in ThoeneFit and the exercises the import added are kept.', 'Remove imported workouts', true))) return;
        await act(async () => {
          const r = await api.post('remove_fitbod');
          S.draft = null;
          toast(r.removed ? `Removed ${r.removed.toLocaleString()} imported workouts.` : 'There were no imported workouts.');
        }, e.currentTarget);
      } }, 'Remove imported workouts')),
  );
}

function viewUsers() {
  if (S.user.role !== 'admin') return page('Manage users', backLink('settings', 'Settings'), h('p', { class: 'muted' }, 'Only the admin can manage accounts.'));
  const when = (iso) => fmtDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });
  const accounts = h('ul', { class: 'log' });
  const inactive = h('ul', { class: 'log', 'data-list': 'inactive' });
  const inactiveSection = section('Deactivated accounts', h('p', { class: 'muted' }, 'They cannot sign in. Their workouts are kept, and turning an account back on lets them sign in with the same password.'), inactive);
  const requests = h('div', { class: 'stack', 'data-list': 'requests' });
  const inviteState = h('p', { class: 'muted', 'data-invite': '' });
  const turnOff = h('button', { class: 'btn danger block', type: 'button' }, 'Stop taking requests');

  // One painter for everything the server sends back, so every action leaves the page in step.
  const paint = (data) => {
    S.pendingRequests = data.requests.length;
    fill(accounts, data.users.map((u) => h('li', { class: 'log-row account-row' },
      h('span', { class: 'log-title' }, u.display_name, u.role === 'admin' && h('span', { class: 'badge' }, 'Admin'), u.id === S.user.id && h('span', { class: 'badge' }, 'You')),
      h('span', { class: 'log-meta' }, `${u.username}, added ${when(u.created_at)}`),
      // The admin manages other people here (#21); their own account is under Settings.
      u.id !== S.user.id && h('div', { class: 'plan-actions' },
        h('button', { class: 'btn small', type: 'button', onclick: () => resetPassword(u) }, 'Reset password'),
        u.role !== 'admin' && h('button', { class: 'btn small', type: 'button', onclick: async (e) => {
          const btn = e.currentTarget;
          if (await confirmSheet(`Deactivate ${u.username}?`, 'They are signed out on every device and cannot sign in. Their workouts are kept, and you can turn the account back on later.', 'Deactivate account', true)) decide('deactivate_user', u, `${u.username} is deactivated.`, btn);
        } }, 'Deactivate')))));
    const off = data.inactive || [];
    inactiveSection.hidden = !off.length;
    fill(inactive, off.map((u) => h('li', { class: 'log-row account-row' },
      h('span', { class: 'log-title' }, u.display_name, h('span', { class: 'badge' }, 'Deactivated')),
      h('span', { class: 'log-meta' }, `${u.username}, added ${when(u.created_at)}`),
      h('div', { class: 'plan-actions' },
        h('button', { class: 'btn small primary', type: 'button', onclick: (e) => decide('reactivate_user', u, `${u.username} can sign in again.`, e.currentTarget) }, 'Turn back on'),
        h('button', { class: 'btn small', type: 'button', onclick: () => resetPassword(u) }, 'Reset password')))));
    fill(requests,
      !data.requests.length && h('p', { class: 'muted' }, data.invite.set ? 'No requests waiting.' : 'No requests waiting. Set an invite token below to let people ask for an account.'),
      data.requests.map((r) => h('div', { class: 'card request' },
        h('div', {}, h('h3', {}, r.display_name), h('p', { class: 'muted small' }, `Wants the username ${r.username}. Asked ${when(r.created_at)}.`)),
        h('div', { class: 'plan-actions' },
          h('button', { class: 'btn small primary', type: 'button', onclick: (e) => decide('approve_request', r, `${r.username} can sign in now.`, e.currentTarget) }, 'Approve'),
          h('button', { class: 'btn small', type: 'button', onclick: async (e) => {
            const btn = e.currentTarget;
            if (await confirmSheet(`Decline ${r.username}?`, 'The request is deleted. They can ask again if they still have the invite token.', 'Decline request', true)) decide('decline_request', r, `Declined ${r.username}.`, btn);
          } }, 'Decline')))));
    inviteState.textContent = data.invite.set
      ? `Requests are open. The token was last set ${when(data.invite.updated_at)}. It is stored scrambled, so it cannot be shown again; set a new one if you have lost it.`
      : 'Requests are closed. Set a token to open them.';
    turnOff.hidden = !data.invite.set;
  };
  const decide = (action, r, done, btn) => act(async () => {
    paint(await api.post(action, { id: r.id }));
    toast(done);
  }, btn);
  const makeUp = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
    return [...bytes].map((b, n) => (n && n % 4 === 0 ? '-' : '') + letters[b % letters.length]).join('');
  };
  // A new password the admin passes on (#21). It signs that person out everywhere.
  const resetPassword = (u) => {
    const input = h('input', { type: 'text', name: 'reset_password', minlength: 10, required: true, autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
    const err = h('p', { class: 'form-error', role: 'alert' });
    const go = h('button', { class: 'btn primary block', type: 'submit' }, 'Set new password');
    const close = sheet(`Reset ${u.username}'s password`, h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      go.disabled = true;
      try {
        paint(await api.post('admin_reset_password', { id: u.id, password: input.value }));
        close();
        toast(`Password reset. ${u.username} is signed out everywhere.`);
      } catch (ex) {
        err.textContent = ex.offline ? 'No connection to the server.' : ex.message;
      }
      go.disabled = false;
    } },
      h('p', { class: 'muted' }, 'They are signed out on every device and sign in again with the new password. Pass it on to them; they can change it under Settings.'),
      field('New password', input, 'At least 10 characters.'),
      h('button', { class: 'btn block', type: 'button', onclick: () => { input.value = makeUp(); input.focus(); input.select(); } }, 'Make one up for me'),
      err,
      go));
    input.focus();
  };

  // Invite token
  const token = h('input', { type: 'text', name: 'invite_token', minlength: 8, maxlength: 100, required: true, autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
  const tokenError = h('p', { class: 'form-error', role: 'alert' });
  const tokenBtn = h('button', { class: 'btn primary block', type: 'submit' }, 'Save invite token');
  const saveToken = async (value, done, btn) => {
    tokenError.textContent = '';
    btn.disabled = true;
    try {
      paint(await api.post('set_invite_token', { token: value }));
      token.value = '';
      toast(done);
    } catch (err) {
      tokenError.textContent = err.offline ? 'No connection to the server.' : err.message;
    }
    btn.disabled = false;
  };
  turnOff.onclick = async () => {
    if (await confirmSheet('Stop taking requests?', 'The invite token stops working. Requests already waiting stay in the list.', 'Stop taking requests', true)) saveToken('', 'Account requests are closed.', turnOff);
  };
  const tokenForm = h('form', { class: 'stack', onsubmit: (e) => {
    e.preventDefault();
    saveToken(token.value, 'Invite token saved. Share it with the people you want to invite.', tokenBtn);
  } },
    field('New invite token', token, 'At least 8 characters. Everyone you invite uses the same one, and it is not anyone\'s sign-in password.'),
    h('button', { class: 'btn block', type: 'button', onclick: () => {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
      token.value = [...bytes].map((b, n) => (n && n % 4 === 0 ? '-' : '') + letters[b % letters.length]).join('');
      token.focus();
      token.select();
    } }, 'Make one up for me'),
    tokenError,
    tokenBtn,
    turnOff);

  // Create an account directly
  const error = h('p', { class: 'form-error', role: 'alert' });
  const name = h('input', { type: 'text', name: 'display_name', maxlength: 100, autocomplete: 'off', placeholder: 'For example: Sam' });
  const username = h('input', { type: 'text', name: 'new_username', maxlength: 64, required: true, autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
  const password = h('input', { type: 'text', name: 'new_password', minlength: 10, required: true, autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Create account');
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    error.textContent = '';
    btn.disabled = true;
    try {
      paint(await api.post('create_user', { username: username.value, display_name: name.value, password: password.value }));
      toast(`Account created for ${username.value.trim().toLowerCase()}.`);
      form.reset();
    } catch (err) {
      error.textContent = err.offline ? 'No connection to the server.' : err.message;
    }
    btn.disabled = false;
  } },
    field('Name', name, 'Shown in the app. Leave empty to use the username.'),
    field('Username', username, 'What they sign in with: 2-64 letters, numbers, dots, dashes or underscores.'),
    field('Starting password', password, 'At least 10 characters. Shown here so you can pass it on; they can change it under Settings once signed in.'),
    error,
    btn);

  const loaded = asyncSection(() => api.get('users'), (data) => {
    paint(data);
    return [
      section('Requests waiting', requests),
      section('Accounts', accounts),
      inactiveSection,
      section('Invite token', h('p', { class: 'muted' }, 'With the token, someone can ask for an account from the sign-in screen, choosing their own username and password. Nobody gets in until you approve them here.'), inviteState, tokenForm),
      section('Add a person yourself', h('p', { class: 'muted' }, 'New accounts are regular users with their own gyms, workouts and exercises. They set those up the first time they sign in.'), form),
      // Who sent which feedback (#20). Only shown here; names never go to GitHub.
      S.feedbackEnabled && section('Feedback', h('p', { class: 'muted' }, 'Everything people have sent from the app, with who sent it. The GitHub issues themselves have no names.'),
        asyncSection(() => api.get('all_feedback'), ({ feedback }) => (feedback.length
          ? feedbackList(feedback, true)
          : h('p', { class: 'muted' }, 'Nothing sent yet.')))),
    ];
  });
  return h('main', { class: 'page' }, backLink('settings', 'Settings'), h('h1', {}, 'Manage users'), loaded);
}

/** Sign-in screen's "Request an account": needs the admin's invite token, creates nothing usable until approved. */
function viewRequest() {
  const error = h('p', { class: 'form-error', role: 'alert' });
  const token = h('input', { type: 'text', name: 'invite_token', required: true, autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
  const name = h('input', { type: 'text', name: 'display_name', maxlength: 100, autocomplete: 'name' });
  const username = h('input', { type: 'text', name: 'username', maxlength: 64, required: true, autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
  const password = h('input', { type: 'password', name: 'password', minlength: 10, required: true, autocomplete: 'new-password' });
  const again = h('input', { type: 'password', name: 'password_again', minlength: 10, required: true, autocomplete: 'new-password' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Send request');
  const backToSignIn = () => {
    S.authView = null;
    render();
  };
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    error.textContent = '';
    if (password.value !== again.value) {
      error.textContent = 'The two passwords do not match.';
      return;
    }
    btn.disabled = true;
    try {
      await api.post('request_account', { token: token.value, username: username.value, display_name: name.value, password: password.value });
      fill(box,
        h('h1', {}, 'Request sent'),
        h('p', {}, `The admin has to approve it before you can sign in. When they have, sign in as ${username.value.trim().toLowerCase()} with the password you just chose.`),
        h('button', { class: 'btn primary block', type: 'button', onclick: backToSignIn }, 'Back to sign in'));
    } catch (err) {
      error.textContent = err.offline ? 'No connection to the server.' : err.message;
      btn.disabled = false;
    }
  } },
    field('Invite code', token, 'Ask the person who runs this ThoeneFit site for an invite code.'),
    field('Your name', name, 'Shown in the app. Optional.'),
    field('Username', username, '2-64 letters, numbers, dots, dashes or underscores.'),
    field('Password', password, 'At least 10 characters. This is your own sign-in password, not the invite code.'),
    field('Password again', again),
    error,
    btn,
    h('button', { class: 'btn ghost block', type: 'button', onclick: backToSignIn }, 'Back to sign in'));
  const box = h('div', { class: 'stack' }, h('h1', {}, 'Request an account'), form);
  return h('main', { class: 'page narrow request-page' }, brandWide('lead'), box);
}

function viewGymForm(id) {
  const existing = id ? S.gyms.find((g) => g.id === id) : null;
  if (id && !existing) return page('Gym not found', backLink('settings', 'Settings'));
  const unit = S.user.unit;
  const gym = existing ? { ...existing, equipment: [...existing.equipment], increments: { ...existing.increments } } : { name: '', equipment: [], increments: {} };
  const name = h('input', { type: 'text', value: gym.name, maxlength: 100, required: true, placeholder: 'For example: Home' });
  const defaults = S.vocab.increments[unit];
  const incs = Object.entries(S.vocab.kinds).filter(([k]) => !['band', 'cardio', 'stretch'].includes(k)).map(([k, label]) =>
    field(`${label}${k === 'dumbbell' ? ' (each)' : k === 'bodyweight' ? ' (added weight)' : ''}`, h('input', { class: 'num', type: 'text', inputmode: 'decimal', value: fmtW(gym.increments[k] ?? defaults[k]), oninput: (e) => {
      const n = parseNum(e.target.value);
      if (n == null) delete gym.increments[k];
      else gym.increments[k] = n;
    } })));
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, existing ? 'Save gym' : 'Add gym');
  return h('main', { class: 'page' }, backLink('settings', 'Settings'),
    h('h1', {}, existing ? existing.name : 'Add a gym'),
    h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      await act(async () => {
        const r = await api.post('save_gym', { id: existing ? existing.id : undefined, name: name.value, equipment: gym.equipment, increments: gym.increments });
        S.gyms = r.gyms;
        if (!S.user.active_gym_id) S.user.active_gym_id = r.gym.id;
        S.draft = null;
        toast('Gym saved.');
        go('settings');
      }, btn);
    } },
      field('Name', name),
      equipmentPicker(gym),
      h('details', { class: 'card fold' }, h('summary', {}, `Smallest weight jump (${unit})`), h('p', { class: 'muted small' }, 'When you reach the top of the rep range on every set, the next suggestion goes up by this much. Set it to what this gym can actually load.'), h('div', { class: 'grid2' }, incs)),
      btn,
      existing && h('button', { class: 'btn danger block', type: 'button', onclick: async () => {
        if (!(await confirmSheet(`Delete ${existing.name}?`, 'Past workouts logged there stay in your history.', 'Delete gym', true))) return;
        await act(async () => {
          const r = await api.post('delete_gym', { id: existing.id });
          S.gyms = r.gyms;
          S.user = r.user;
          S.draft = null;
          go('settings');
        });
      } }, 'Delete gym'),
    ));
}

boot();
