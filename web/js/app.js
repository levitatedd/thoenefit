import { Api, WorkoutSync, uuid } from './store.js';
import { searchExercises } from './search.js';
import { APP_VERSION } from './version.js';
import { h, icon, fmtW, parseNum, fmtDate, fmtTime, fmtClock, fmtSets, toast, sheet, confirmSheet, choices, stepper, lineChart } from './ui.js';

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
  draftOpts: { day_type: null, minutes: null, bodyweight_only: false },
  draftError: null,
  draftLoading: false,
  rest: null, // {endsAt, total}
};
let sync = null;
let ticker = null;
let wakeLock = null;
let audio = null;

const GOALS = [
  ['muscle', 'Build muscle', '6-10 reps on big lifts'],
  ['strength', 'Get stronger', '4-6 reps, longer rests'],
  ['general', 'General fitness', '8-12 reps, steady pace'],
  ['endurance', 'Muscular endurance', '12-15 reps, short rests'],
];
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
  S.pendingRequests = data.pending_requests || 0;
  S.gyms = data.gyms;
  S.shares = data.shares || [];
  S.vocab = data.vocab;
  setExercises(data.exercises);
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
  else if (tab === 'trends') view = viewTrends();
  else if (tab === 'exercises') view = arg === 'new' ? viewExerciseForm(null) : arg === 'edit' ? viewExerciseForm(Number(arg2)) : arg ? viewExercise(Number(arg)) : viewExercises();
  else if (tab === 'settings') view = arg === 'gym' ? viewGymForm(arg2 === 'new' ? null : Number(arg2)) : arg === 'import' ? viewImport() : arg === 'users' ? viewUsers() : arg === 'whats-new' ? viewWhatsNew() : viewSettings();
  else view = viewToday();
  const current = tab === 'workout' ? 'today' : tab;
  const nav = h(
    'nav',
    { class: 'tabs', 'aria-label': 'Main' },
    [
      ['history', 'History', 'history'],
      ['trends', 'Trends', 'trends'],
      ['today', 'Today', 'today'],
      ['exercises', 'Exercises', 'list'],
      ['settings', 'Settings', 'gear'],
    ].map(([key, label, ic]) => h('a', { href: `#/${key}`, class: 'tab', 'aria-current': current === key ? 'page' : null }, icon(ic, 24), h('span', {}, label))),
  );
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
  S.lastTab = tab;
  startTicker();
  keepAwake();
}

function page(title, ...kids) {
  return h('main', { class: 'page' }, title && h('h1', {}, title), kids);
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
    field('Goal', choices(GOALS, values.goal, (v) => onChange('goal', v), { columns: 2 })),
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
  const body = { gym_id: gym.id, bodyweight_only: S.draftOpts.bodyweight_only };
  if (S.draftOpts.day_type) body.day_type = S.draftOpts.day_type;
  if (S.draftOpts.minutes) body.minutes = S.draftOpts.minutes;
  if (S.draft && regenerate) {
    body.locked = {};
    body.avoid = [];
    for (const b of S.draft.exercises) {
      if (b.locked) body.locked[b.slot] = b.exercise_id;
      else body.avoid.push(b.exercise_id);
    }
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
    if (!res) {
      res = await api.post('generate', body);
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
    sets: Array.from({ length: b.target_sets }, () => ({ id: uuid(), weight: b.suggested_weight, reps: b.suggested_reps, warmup: false, done: false, done_at: null })),
  };
}

function startWorkout() {
  const d = S.draft;
  sync.start({
    id: uuid(),
    gym_id: d.gym_id,
    gym_name: d.gym_name,
    day_type: d.day_type,
    status: 'active',
    unit: d.unit,
    started_at: new Date().toISOString(),
    completed_at: null,
    notes: d.shared_by ? `Shared by ${d.shared_by}` : null,
    // share_id: this came from someone's shared plan. share_key: this person shared it with others.
    share_id: d.share_id || undefined,
    share_key: S.shareKey || undefined,
    exercises: d.exercises.map(blockToEntry),
  });
  if (d.share_id) S.shares = (S.shares || []).filter((x) => x.id !== d.share_id);
  S.shareKey = null;
  S.draft = null;
  primeAudio();
  go('workout');
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
  const head = h('header', { class: 'page-head' }, h('h1', {}, 'Today'), h('p', { class: 'muted' }, fmtDate(new Date().toISOString(), { weekday: 'long', month: 'long', day: 'numeric' })));
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
        h('a', { class: 'btn primary block', href: '#/workout' }, 'Resume workout'),
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
      brandWide(),
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
        S.draftOpts.day_type = e.target.value;
        S.draft = null;
        loadDraft();
      },
    },
    ordered.map((d) => h('option', { value: d, selected: d === (S.draft ? S.draft.day_type : S.draftOpts.day_type) }, dayLabel(d))),
  );
  const controls = shared
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
          S.draft = null;
          loadDraft();
        },
      }),
      'Bodyweight only',
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
      h('p', { class: 'summary' }, `${d.bodyweight_only ? 'Bodyweight only · ' : ''}${d.exercises.length} exercises, about ${d.est_minutes} minutes`),
      d.skipped.map((s) => h('p', { class: 'notice' }, s)),
      h(
        'ol',
        { class: 'plan' },
        d.exercises.map((b) => planRow(b, gym)),
      ),
      brandWide(),
    );
  }

  return h(
    'main',
    { class: 'page has-bar' },
    head,
    waiting,
    shareCards(),
    controls,
    body,
    h(
      'div',
      { class: 'action-bar' },
      shared
        ? h('button', { class: 'btn', type: 'button', onclick: (e) => respondToShare({ id: shared.share_id, from_name: shared.shared_by }, false, e.currentTarget) }, 'Use my own')
        : h('button', { class: 'btn', type: 'button', disabled: !S.draft || S.draftLoading, onclick: () => loadDraft({ regenerate: true }) }, 'Regenerate'),
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

function targetLine(b, unit) {
  const w = b.suggested_weight != null ? ` at ${fmtW(b.suggested_weight)} ${unit}${b.kind === 'dumbbell' ? ' each' : ''}` : '';
  return `${b.target_sets} sets of ${b.rep_min}-${b.rep_max}${w}`;
}

function lastLine(previous) {
  if (!previous || !previous.sets.length) return 'No history yet';
  const thisYear = new Date(previous.date).getFullYear() === new Date().getFullYear();
  return `Last: ${fmtSets(previous.sets, previous.unit)} on ${fmtDate(previous.date, thisYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function planRow(b, gym) {
  return h(
    'li',
    { class: 'plan-row' },
    h('div', { class: 'plan-main' }, h('h3', {}, historyLink(b.exercise_id, b.name, 'today', 'Today')), h('p', { class: 'target' }, targetLine(b, S.draft.unit)), h('p', { class: 'last' }, lastLine(b.previous)), h('p', { class: 'why' }, b.reason)),
    !S.draft.share_id && h(
      'div',
      { class: 'plan-actions' },
      h(
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
      h('button', { type: 'button', class: 'btn small', onclick: () => swapSheet(gym.id, b.exercise_id, S.draft.exercises.map((x) => x.exercise_id), (block) => {
        Object.assign(b, block, { slot: b.slot, locked: true, reason: `You swapped this in. ${block.reason}` });
        pushSharedPlan();
        render();
      }, S.draft.bodyweight_only) }, icon('swap', 18), 'Swap'),
    ),
  );
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
    if (el && sync.active) el.textContent = fmtClock((Date.now() - new Date(sync.active.started_at).getTime()) / 1000);
    if (route()[0] === 'today' && document.visibilityState === 'visible') refreshShares(); // throttled inside
  }, 500);
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

  const head = h(
    'header',
    { class: 'workout-head' },
    h('div', {}, h('h1', {}, dayLabel(doc.day_type)), h('p', { class: 'muted' }, `${doc.gym_name}, ${doneSets} of ${totalSets} sets`)),
    h('div', { class: 'workout-meta' }, h('output', { id: 'elapsed', class: 'elapsed' }, fmtClock((Date.now() - new Date(doc.started_at).getTime()) / 1000)), h('span', { id: 'sync', class: 'sync', role: 'status' }, 'Saved')),
  );

  const cards = doc.exercises.map((e, idx) => exerciseCard(doc, e, idx, nextSet, edit));

  return h(
    'main',
    { class: 'page workout' },
    head,
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
    h('button', { class: 'btn primary block finish', type: 'button', onclick: () => finishSheet(doc) }, 'Finish workout'),
  );
}

function exerciseCard(doc, e, idx, nextSet, edit) {
  const ex = S.exById.get(e.exercise_id);
  const needsWeight = !['bodyweight', 'band'].includes(e.kind);
  const perSide = e.kind === 'dumbbell' ? `${doc.unit} each` : doc.unit;
  let workingNo = 0;

  const rows = e.sets.map((s) => {
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
      h('div', {}, h('h2', {}, historyLink(e.exercise_id, e.name, 'workout', 'Workout')), h('p', { class: 'target' }, targetLine(e, doc.unit)), h('p', { class: 'last' }, lastLine(e.previous))),
      h('button', { type: 'button', class: 'btn square ghost', 'aria-label': `Options for ${e.name}`, onclick: menu }, icon('more')),
    ),
    e.reason && h('details', { class: 'why-fold' }, h('summary', {}, 'Why this'), h('p', { class: 'why' }, e.reason)),
    h('div', { class: 'set-head', 'aria-hidden': 'true' }, h('span', {}, 'Set'), h('span', {}, perSide), h('span', {}), h('span', {}, 'Reps'), h('span', {}, 'Done')),
    h('ol', { class: 'sets' }, rows),
    h('div', { class: 'set-actions' },
      h('button', { type: 'button', class: 'btn small', onclick: () => edit((d) => {
        const t = d.exercises.find((x) => x.id === e.id);
        const last = t.sets[t.sets.length - 1];
        t.sets.push({ id: uuid(), weight: last ? last.weight : e.suggested_weight, reps: last ? last.reps : null, warmup: false, done: false, done_at: null });
      }) }, icon('plus', 18), 'Add set'),
      h('button', { type: 'button', class: 'btn small', disabled: e.sets.length === 0, onclick: async () => {
        const last = e.sets[e.sets.length - 1];
        if (last.done && !(await confirmSheet('Remove a completed set?', `The last set (${fmtW(last.weight)} × ${last.reps}) is deleted.`, 'Remove set', true))) return;
        edit((d) => d.exercises.find((x) => x.id === e.id).sets.pop());
      } }, icon('minus', 18), 'Remove set'),
      doc.gym_id && e.sets.some((s) => !s.done) && h('button', { type: 'button', class: 'btn small', 'aria-label': `Swap ${e.name} for another exercise`, onclick: swap }, icon('swap', 18), 'Swap'),
    ),
  );
}

function find(doc, exId, setId) {
  return doc.exercises.find((x) => x.id === exId).sets.find((s) => s.id === setId);
}

function move(list, from, to) {
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
}

function addExerciseSheet(doc) {
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
          sync.edit(doc.id, (d) => d.exercises.push(blockToEntry(block)));
          render();
        } }, h('span', { class: 'pick-name' }, x.name), h('span', { class: 'pick-meta' }, x.muscles_main.map((m) => S.vocab.muscles[m]).join(', ')));
  const paint = () => {
    const q = search.value.trim();
    const r = searchExercises(pool, q, S.vocab, { limit: 40, similarLimit: 6 });
    fill(list,
      r.closest && h('p', { class: 'muted' }, `Nothing at this gym matches "${q}" exactly. Closest:`),
      ...r.matches.map(row),
      r.similar.length > 0 && h('h3', { class: 'list-head' }, 'Similar exercises'),
      ...r.similar.map(row),
      !r.matches.length && h('p', { class: 'muted' }, q ? `Nothing matches "${q}" with the equipment at this gym.` : 'Every exercise this gym has equipment for is already in the workout.'),
    );
  };
  close = sheet('Add exercise', h('div', { class: 'stack' }, search, list));
  paint();
}

// "Send to Strava" on the Finish sheet (#87): the choice is remembered on this device.
function stravaOnFinish() {
  try {
    return { send: false, summary: false, ...JSON.parse(localStorage.getItem('tf.stravaOnFinish') || '{}') };
  } catch (e) {
    return { send: false, summary: false };
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
    send.onchange = () => (details.hidden = !send.checked);
    strava = { send, summary, el: h('div', { class: 'stack' }, h('label', { class: 'check' }, send, 'Send to Strava'), details) };
  }
  const body = done
    ? h('div', { class: 'stack' },
        h('p', {}, `${done} set${done === 1 ? '' : 's'} logged over ${fmtClock((Date.now() - new Date(doc.started_at).getTime()) / 1000)}.`),
        open > 0 && h('p', { class: 'muted' }, `${open} set${open === 1 ? ' was' : 's were'} not marked done and will be left out.`),
        strava?.el,
        h('button', { class: 'btn primary block', type: 'button', onclick: () => {
          const toStrava = !!strava?.send.checked;
          if (strava) {
            try {
              localStorage.setItem('tf.stravaOnFinish', JSON.stringify({ send: toStrava, summary: strava.summary.checked }));
            } catch (e) {
              // Private mode: the choice just isn't remembered.
            }
          }
          close();
          sync.edit(doc.id, (d) => {
            for (const e of d.exercises) e.sets = e.sets.filter((s) => s.done);
            d.exercises = d.exercises.filter((e) => e.sets.length);
            d.status = 'completed';
            d.completed_at = new Date().toISOString();
            if (toStrava) d.strava_send = { include_summary: strava.summary.checked, utc_offset: -new Date(d.started_at).getTimezoneOffset() * 60 };
          }, 0);
          stopRest();
          S.draft = null;
          S.draftOpts.day_type = null;
          toast(toStrava ? 'Workout saved. It goes to Strava once it syncs.' : 'Workout saved.');
          go('today');
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

// ---------------------------------------------------------------- history

function asyncSection(load, build) {
  const box = h('div', { class: 'stack' }, h('p', { class: 'muted pad' }, 'Loading'));
  load().then(
    (data) => box.replaceChildren(...[build(data)].flat()),
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
  return page('Trends', h('p', { class: 'muted' }, 'Last 8 weeks, including this week.'), content);
}

function viewHistory() {
  const PAGE = 50;
  const list = h('ul', { class: 'log' });
  const more = h('button', { class: 'btn block', type: 'button', hidden: true }, 'Show older workouts');
  const note = h('p', { class: 'muted pad' }, 'Loading');
  let offset = 0;
  const load = async () => {
    more.disabled = true;
    try {
      const data = await api.get('history', `&limit=${PAGE}&offset=${offset}`);
      note.hidden = true;
      if (!data.workouts.length && offset === 0) {
        list.replaceWith(h('section', { class: 'card' }, h('h2', {}, 'No workouts yet'), h('p', { class: 'muted' }, 'Finished workouts show up here, and you can correct any entry afterwards.'), h('a', { class: 'btn primary block', href: '#/today' }, 'Go to Today')));
        return;
      }
      list.append(...data.workouts.map((w) =>
        h('li', {}, h('a', { class: 'log-row', href: `#/history/${w.id}` },
          h('span', { class: 'log-date' }, fmtDate(w.started_at, offset || new Date(w.started_at).getFullYear() !== new Date().getFullYear() ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } : undefined)),
          h('span', { class: 'log-title' }, `${dayLabel(w.day_type)} at ${w.gym_name}`),
          h('span', { class: 'log-meta' }, `${w.exercises.length} exercises, ${w.sets} sets, ${Number(w.volume).toLocaleString()} ${w.unit} lifted`),
          h('span', { class: 'log-names' }, w.exercises.slice(0, 4).join(', ') + (w.exercises.length > 4 ? ` and ${w.exercises.length - 4} more` : '')),
        ))));
      offset += data.workouts.length;
      more.hidden = data.workouts.length < PAGE;
    } catch (e) {
      note.hidden = false;
      note.textContent = e.offline ? 'History needs a connection.' : e.message;
    }
    more.disabled = false;
  };
  more.onclick = load;
  load();
  return page('History', note, list, more);
}

function viewHistoryDetail(id) {
  return h('main', { class: 'page' }, backOr('history', 'History'),
    asyncSection(
      () => api.get('workout', `&id=${encodeURIComponent(id)}`),
      ({ workout, strava, strava_export: stravaExport }) => {
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
              h('ol', { class: 'sets' }, e.sets.map((s, si) => {
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
                e.sets.push({ id: uuid(), weight: last ? last.weight : 0, reps: last ? last.reps : null, warmup: false, done: true, done_at: workout.completed_at });
                touch();
                paint();
              } }, icon('plus', 18), 'Add set')),
            );
          }));
        };
        paint();
        save.onclick = () => act(async () => {
          const bad = workout.exercises.some((e) => e.sets.some((s) => s.reps == null || s.reps <= 0));
          if (bad) {
            toast('Every set needs its reps filled in.', 'bad');
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
        }, save);
        return [
          h('header', { class: 'page-head' }, h('h1', {}, `${dayLabel(workout.day_type)} at ${workout.gym_name}`), h('p', { class: 'muted' }, `${fmtDate(workout.started_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, ${fmtTime(workout.started_at)}. Weights in ${workout.unit}.`), workout.notes && h('p', { class: 'muted', 'data-notes': '' }, workout.notes)),
          box,
          save,
          workout.status === 'completed' && workoutStrava(workout, strava, stravaExport, () => dirty),
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
      const send = h('button', { class: 'btn primary block', type: 'button', onclick: () => act(async () => {
        exported = await api.post('strava_export', {
          id: workout.id,
          include_summary: summary.checked,
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
    fill(results,
      r.closest && h('p', { class: 'muted' }, `No exercise matches "${q}" exactly. Closest:`),
      r.matches.length > 0 && h('ul', { class: 'log', 'data-list': 'matches' }, r.matches.map(row)),
      r.similar.length > 0 && h('h2', { class: 'list-head' }, 'Similar exercises'),
      r.similar.length > 0 && h('ul', { class: 'log', 'data-list': 'similar' }, r.similar.map(row)),
      !r.matches.length && h('p', { class: 'muted pad' }, q ? `No exercises match "${q}".` : 'No exercises here yet.'),
    );
  };
  paint();
  return page('Exercises', h('div', { class: 'filters' }, search, muscle), h('a', { class: 'btn block', href: '#/exercises/new' }, icon('plus', 18), 'Add your own exercise'), results);
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
  const trend = asyncSection(
    () => api.get('exercise_history', `&id=${id}`),
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
        fill(box,
          h('h3', {}, 'Top weight'),
          lineChart(pts.map((p) => ({ ...p, value: p.top, lines: [`Sets: ${fmtSets(p.s.sets, p.s.unit)}`, ...where(p.s)] })), { unit, onOpen, hint: 'Tap a point to see that session.' }),
          h('h3', {}, 'Best reps at top weight'),
          lineChart(pts.map((p) => ({ ...p, value: p.best, lines: [`At ${fmtW(p.top)} ${p.s.unit}`, `Sets: ${fmtSets(p.s.sets, p.s.unit)}`] })), { unit: 'reps', onOpen, hint: 'Tap a point to see that session.' }),
          h('h3', {}, mine.length > 30 ? `Latest 30 of ${mine.length} sessions` : `${mine.length} session${mine.length === 1 ? '' : 's'}`),
          h('ul', { class: 'log' }, [...mine].reverse().slice(0, 30).map((s) => h('li', {}, h('a', { class: 'log-row', href: `#/history/${s.workout_id}`, onclick: () => onOpen({ s }) }, h('span', { class: 'log-date' }, fmtDate(s.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })), h('span', { class: 'log-title' }, fmtSets(s.sets, s.unit)), h('span', { class: 'log-meta' }, s.gym_name))))),
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
  return h('main', { class: 'page' }, backOr('exercises', 'Exercises'),
    h('h1', {}, ex.name),
    h('dl', { class: 'facts' }, tags.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    ex.cues && section('Form cues', h('p', { class: 'cues' }, ex.cues)),
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

function viewSettings() {
  const saveProfile = (key, value) => act(async () => {
    const r = await api.post('save_profile', { [key]: value });
    S.user = r.user;
    S.draft = null;
    S.draftOpts = { day_type: null, minutes: null, bodyweight_only: false };
  });
  const current = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const next = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
  const pwBtn = h('button', { class: 'btn block', type: 'submit' }, 'Change password');
  return page('Settings',
    section('Training', trainingFields(S.user, saveProfile), h('p', { class: 'muted small' }, 'Changes save as you make them. Past workouts keep the unit they were logged in; suggestions convert to your current unit.')),
    section('Gyms',
      h('ul', { class: 'log' }, S.gyms.map((g) => h('li', {}, h('a', { class: 'log-row', href: `#/settings/gym/${g.id}` }, h('span', { class: 'log-title' }, g.name, g.id === S.user.active_gym_id && h('span', { class: 'badge' }, 'Selected')), h('span', { class: 'log-meta' }, g.equipment.length ? `${g.equipment.length} kinds of equipment` : 'Bodyweight only'))))),
      h('a', { class: 'btn block', href: '#/settings/gym/new' }, icon('plus', 18), 'Add a gym')),
    section('Your data',
      h('a', { class: 'btn block', href: 'api.php?a=export', download: '' }, 'Export all sets as CSV'),
      h('p', { class: 'muted small' }, 'One row per set, including warm-ups, with dates in UTC.'),
      h('a', { class: 'btn block', href: '#/settings/import' }, 'Import from Fitbod')),
    section('Add to your Home Screen',
      h('p', {}, 'Installed, ThoeneFit opens full screen like an app and keeps working when the gym has no signal.'),
      h('h3', {}, 'iPhone'),
      h('ol', { class: 'steps' }, h('li', {}, 'Open this page in Safari.'), h('li', {}, 'Tap the Share button (the square with an arrow pointing up).'), h('li', {}, 'Scroll down and tap Add to Home Screen, then Add.')),
      h('h3', {}, 'Pixel and other Android phones'),
      h('ol', { class: 'steps' }, h('li', {}, 'Open this page in Chrome.'), h('li', {}, 'Tap the three-dot menu at the top right.'), h('li', {}, 'Tap Add to Home screen (or Install app), then Install.')),
      h('p', { class: 'muted small' }, 'The app updates itself when you open it. The Home Screen icon does not: the phone keeps the picture from when the app was added. To get a new icon, remove ThoeneFit from the Home Screen and add it again. Your workouts are kept on the server.')),
    S.user.role === 'admin' && section('Users',
      h('p', { class: 'muted' }, 'You are the admin. There is no public sign-up, so you create accounts for the people you train with.'),
      h('a', { class: 'btn block', href: '#/settings/users' }, 'Manage users', S.pendingRequests > 0 && h('span', { class: 'badge alert' }, `${S.pendingRequests} waiting`))),
    section('Account',
      h('p', { class: 'muted' }, `Signed in as ${S.user.username}${S.user.role === 'admin' ? ' (admin)' : ''}.`),
      S.strava?.enabled && (S.strava.connected
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
        : h('button', { class: 'btn block', type: 'button', onclick: (e) => act(async () => {
          const { url } = await api.post('strava_authorize');
          location.assign(url);
        }, e.currentTarget) }, 'Connect to Strava')),
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
      } }, field('Current password', current), field('New password', next, 'At least 10 characters.'), pwBtn),
      h('button', { class: 'btn block', type: 'button', onclick: async (e) => {
        if (sync.status() !== 'saved' && !(await confirmSheet('Sign out with unsynced changes?', 'Some workout changes are still only on this phone. They stay here and upload the next time you sign in on it.', 'Sign out anyway'))) return;
        await act(async () => {
          await api.post('logout');
          S.user = null;
          localStorage.removeItem('tf.boot');
          render();
        }, e.currentTarget);
      } }, 'Sign out')),
    brandWide(),
    h('p', { class: 'muted small center app-version' }, h('a', { href: '#/settings/whats-new' }, `Version ${APP_VERSION}`)),
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
  return page("What's new", backLink('settings', 'Settings'), h('p', { class: 'muted' }, `You have version ${APP_VERSION}.`), content);
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
  const requests = h('div', { class: 'stack', 'data-list': 'requests' });
  const inviteState = h('p', { class: 'muted', 'data-invite': '' });
  const turnOff = h('button', { class: 'btn danger block', type: 'button' }, 'Stop taking requests');

  // One painter for everything the server sends back, so every action leaves the page in step.
  const paint = (data) => {
    S.pendingRequests = data.requests.length;
    fill(accounts, data.users.map((u) => h('li', { class: 'log-row' },
      h('span', { class: 'log-title' }, u.display_name, u.role === 'admin' && h('span', { class: 'badge' }, 'Admin'), u.id === S.user.id && h('span', { class: 'badge' }, 'You')),
      h('span', { class: 'log-meta' }, `${u.username}, added ${when(u.created_at)}`))));
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
      section('Invite token', h('p', { class: 'muted' }, 'With the token, someone can ask for an account from the sign-in screen, choosing their own username and password. Nobody gets in until you approve them here.'), inviteState, tokenForm),
      section('Add a person yourself', h('p', { class: 'muted' }, 'New accounts are regular users with their own gyms, workouts and exercises. They set those up the first time they sign in.'), form),
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
    field('Invite token', token, 'From the person who runs this ThoeneFit. It is only used to send this request.'),
    field('Your name', name, 'Shown in the app. Optional.'),
    field('Username', username, '2-64 letters, numbers, dots, dashes or underscores.'),
    field('Password', password, 'At least 10 characters. This is your own sign-in password, not the invite token.'),
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
  const incs = Object.entries(S.vocab.kinds).filter(([k]) => k !== 'band').map(([k, label]) =>
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
