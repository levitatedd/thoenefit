import { Api, WorkoutSync, uuid } from './store.js';
import { searchExercises } from './search.js';
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
  draftOpts: { day_type: null, minutes: null },
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
  root.replaceChildren(h('div', { class: 'splash' }, h('p', { class: 'wordmark' }, 'ThoeneFit'), h('p', { class: 'muted' }, 'Loading')));
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
          h('p', { class: 'wordmark' }, 'ThoeneFit'),
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
}

function applyBoot(data) {
  S.user = data.user;
  S.gyms = data.gyms;
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
  }
});
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
    root.replaceChildren(viewLogin());
    return;
  }
  if (!S.user.onboarded) {
    root.replaceChildren(viewOnboarding());
    return;
  }
  const [tab, arg, arg2] = route();
  let view;
  if (tab === 'workout') view = viewWorkout();
  else if (tab === 'history') view = arg ? viewHistoryDetail(arg) : viewHistory();
  else if (tab === 'exercises') view = arg === 'new' ? viewExerciseForm(null) : arg === 'edit' ? viewExerciseForm(Number(arg2)) : arg ? viewExercise(Number(arg)) : viewExercises();
  else if (tab === 'settings') view = arg === 'gym' ? viewGymForm(arg2 === 'new' ? null : Number(arg2)) : arg === 'import' ? viewImport() : viewSettings();
  else view = viewToday();
  const current = tab === 'workout' ? 'today' : tab;
  const nav = h(
    'nav',
    { class: 'tabs', 'aria-label': 'Main' },
    [
      ['today', 'Today', 'today'],
      ['history', 'History', 'history'],
      ['exercises', 'Exercises', 'list'],
      ['settings', 'Settings', 'gear'],
    ].map(([key, label, ic]) => h('a', { href: `#/${key}`, class: 'tab', 'aria-current': current === key ? 'page' : null }, icon(ic, 24), h('span', {}, label))),
  );
  root.replaceChildren(view, restDock(), nav);
  window.scrollTo(0, tab === S.lastTab ? window.scrollY : 0);
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
  return h('main', { class: 'page narrow' }, h('p', { class: 'wordmark big' }, 'ThoeneFit'), h('p', { class: 'muted' }, 'Accounts are created by whoever runs this server.'), form);
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
  return h('div', { class: 'stack' }, field('Start from a preset', presets, 'Then tick or untick anything below. Bodyweight exercises are always available.'), groups);
}

function viewOnboarding() {
  const profile = { unit: S.user.unit, goal: S.user.goal, experience: S.user.experience, minutes: S.user.minutes, split_type: S.user.split_type };
  const gym = { name: 'My gym', equipment: S.vocab.presets[0].equipment.slice(), increments: {} };
  const name = h('input', { type: 'text', value: gym.name, maxlength: 100, required: true });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Save and build my first workout');
  return h(
    'main',
    { class: 'page' },
    h('p', { class: 'wordmark' }, 'ThoeneFit'),
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
  const body = { gym_id: gym.id };
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
    const res = await api.post('generate', body);
    S.draft = res.workout;
    S.draftOpts.day_type = res.workout.day_type;
    S.draftOpts.minutes = res.workout.minutes;
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
    notes: null,
    exercises: d.exercises.map(blockToEntry),
  });
  S.draft = null;
  primeAudio();
  go('workout');
}

function viewToday() {
  const gym = activeGym();
  const active = sync.active;
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
    );
  }

  if (!gym) {
    return h('main', { class: 'page' }, head, h('section', { class: 'card' }, h('h2', {}, 'Add a gym first'), h('p', { class: 'muted' }, 'A workout is built from the equipment at a gym profile.'), h('a', { class: 'btn primary block', href: '#/settings/gym/new' }, 'Add a gym')));
  }

  if (!S.draft && !S.draftLoading && !S.draftError) loadDraft();

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
  const controls = h(
    'section',
    { class: 'controls' },
    field('Gym', gymSelect),
    field('Workout', daySelect),
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
      h('p', { class: 'summary' }, `${d.exercises.length} exercises, about ${d.est_minutes} minutes`),
      d.skipped.map((s) => h('p', { class: 'notice' }, s)),
      h(
        'ol',
        { class: 'plan' },
        d.exercises.map((b) => planRow(b, gym)),
      ),
      recoveryPanel(d.recovery),
    );
  }

  return h(
    'main',
    { class: 'page has-bar' },
    head,
    waiting,
    controls,
    body,
    h(
      'div',
      { class: 'action-bar' },
      h('button', { class: 'btn', type: 'button', disabled: !S.draft || S.draftLoading, onclick: () => loadDraft({ regenerate: true }) }, 'Regenerate'),
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
    h('div', { class: 'plan-main' }, h('h3', {}, b.name), h('p', { class: 'target' }, targetLine(b, S.draft.unit)), h('p', { class: 'last' }, lastLine(b.previous)), h('p', { class: 'why' }, b.reason)),
    h(
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
        render();
      }) }, icon('swap', 18), 'Swap'),
    ),
  );
}

function recoveryPanel(recovery) {
  const rows = Object.values(recovery).map((m) => {
    const bar = h('span', { class: 'meter-fill' });
    bar.style.width = `${m.recovery}%`;
    return h('li', { class: 'meter' }, h('span', { class: 'meter-name' }, m.label), h('span', { class: `meter-track ${m.recovery < 50 ? 'low' : ''}` }, bar), h('span', { class: 'meter-num' }, `${m.recovery}%`), h('span', { class: 'meter-sets' }, `${fmtW(m.weekly_sets)} sets`));
  });
  return h('details', { class: 'card fold' }, h('summary', {}, 'Recovery estimate'), h('p', { class: 'muted small' }, 'Estimated only from sets logged here in the last 7 days. It cannot see sleep, soreness or other activity, so treat it as a rough guide.'), h('ul', { class: 'meters' }, rows));
}

async function swapSheet(gymId, exerciseId, exclude, onPick) {
  const list = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Finding options'));
  const close = sheet('Swap exercise', list);
  try {
    const res = await api.post('alternatives', { gym_id: gymId, exercise_id: exerciseId, exclude });
    if (!res.alternatives.length) {
      list.replaceChildren(h('p', { class: 'muted' }, 'Nothing else fits the equipment at this gym.'));
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
              const block = await act(async () => (await api.post('suggest', { gym_id: gymId, exercise_id: a.exercise_id })).block, e.currentTarget);
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

  const menu = () => {
    const close = sheet(e.name, h(
      'div',
      { class: 'stack' },
      ex && ex.cues && h('p', { class: 'cues' }, ex.cues),
      h('button', { type: 'button', class: 'btn block', disabled: idx === 0, onclick: () => { close(); edit((d) => move(d.exercises, idx, idx - 1)); } }, icon('up', 18), 'Move earlier'),
      h('button', { type: 'button', class: 'btn block', disabled: idx === doc.exercises.length - 1, onclick: () => { close(); edit((d) => move(d.exercises, idx, idx + 1)); } }, icon('down', 18), 'Move later'),
      h('button', { type: 'button', class: 'btn block', disabled: !doc.gym_id, onclick: () => {
        close();
        swapSheet(doc.gym_id, e.exercise_id, doc.exercises.map((x) => x.exercise_id), (block) => edit((d) => {
          d.exercises[idx] = blockToEntry({ ...block, reason: `You swapped this in. ${block.reason}` });
        }));
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
      h('div', {}, h('h2', {}, e.name), h('p', { class: 'target' }, targetLine(e, doc.unit)), h('p', { class: 'last' }, lastLine(e.previous))),
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
  const pool = S.exercises.filter((x) => !x.archived && !used.has(x.id) && x.equipment.every((k) => have.has(k)));
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

function finishSheet(doc) {
  const done = doc.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const open = doc.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
  let close = null;
  const body = done
    ? h('div', { class: 'stack' },
        h('p', {}, `${done} set${done === 1 ? '' : 's'} logged over ${fmtClock((Date.now() - new Date(doc.started_at).getTime()) / 1000)}.`),
        open > 0 && h('p', { class: 'muted' }, `${open} set${open === 1 ? ' was' : 's were'} not marked done and will be left out.`),
        h('button', { class: 'btn primary block', type: 'button', onclick: () => {
          close();
          sync.edit(doc.id, (d) => {
            for (const e of d.exercises) e.sets = e.sets.filter((s) => s.done);
            d.exercises = d.exercises.filter((e) => e.sets.length);
            d.status = 'completed';
            d.completed_at = new Date().toISOString();
          }, 0);
          stopRest();
          S.draft = null;
          S.draftOpts.day_type = null;
          toast('Workout saved.');
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
  return h('main', { class: 'page' }, backLink('history', 'History'),
    asyncSection(
      () => api.get('workout', `&id=${encodeURIComponent(id)}`),
      ({ workout }) => {
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
              h('header', { class: 'lift-head' }, h('div', {}, h('h2', {}, e.name)), h('a', { class: 'btn small ghost', href: `#/exercises/${e.exercise_id}` }, 'Trend')),
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
          h('header', { class: 'page-head' }, h('h1', {}, `${dayLabel(workout.day_type)} at ${workout.gym_name}`), h('p', { class: 'muted' }, `${fmtDate(workout.started_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, ${fmtTime(workout.started_at)}. Weights in ${workout.unit}.`)),
          box,
          save,
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
      const show = (key) => {
        const mine = sessions.filter((s) => s.variant_key === key);
        const unit = mine[mine.length - 1].unit;
        const oneYear = new Date(mine[0].date).getFullYear() === new Date(mine[mine.length - 1].date).getFullYear();
        const pts = mine.map((s) => {
          const top = Math.max(...s.sets.map((x) => x.weight));
          const best = Math.max(...s.sets.filter((x) => x.weight === top).map((x) => x.reps));
          return { label: fmtDate(s.date, oneYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' }), top, best, s };
        });
        box.replaceChildren(
          h('h3', {}, 'Top weight'),
          lineChart(pts.map((p) => ({ label: p.label, value: p.top })), { unit }),
          h('h3', {}, 'Best reps at top weight'),
          lineChart(pts.map((p) => ({ label: p.label, value: p.best })), { unit: 'reps' }),
          h('h3', {}, mine.length > 30 ? `Latest 30 of ${mine.length} sessions` : 'Sessions'),
          h('ul', { class: 'log' }, [...mine].reverse().slice(0, 30).map((s) => h('li', {}, h('a', { class: 'log-row', href: `#/history/${s.workout_id}` }, h('span', { class: 'log-date' }, fmtDate(s.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })), h('span', { class: 'log-title' }, fmtSets(s.sets, s.unit)), h('span', { class: 'log-meta' }, s.gym_name))))),
        );
      };
      const last = sessions[sessions.length - 1].variant_key;
      show(last);
      if (variants.length < 2) return box;
      const picker = h('select', { 'aria-label': 'Gym', onchange: (e) => show(e.target.value) }, variants.map((v) => h('option', { value: v, selected: v === last }, [...sessions].reverse().find((s) => s.variant_key === v).gym_name)));
      return [field('Machine history is kept per gym', picker), box];
    },
  );
  return h('main', { class: 'page' }, backLink('exercises', 'Exercises'),
    h('h1', {}, ex.name),
    h('dl', { class: 'facts' }, tags.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    ex.cues && section('Form cues', h('p', { class: 'cues' }, ex.cues)),
    section('Trend', trend),
    ex.custom && h('div', { class: 'stack' },
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
    S.draftOpts = { day_type: null, minutes: null };
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
      h('ol', { class: 'steps' }, h('li', {}, 'Open this page in Chrome.'), h('li', {}, 'Tap the three-dot menu at the top right.'), h('li', {}, 'Tap Add to Home screen (or Install app), then Install.'))),
    section('Account',
      h('p', { class: 'muted' }, `Signed in as ${S.user.username}.`),
      h('form', { class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        await act(async () => {
          await api.post('change_password', { current: current.value, next: next.value });
          current.value = '';
          next.value = '';
          toast('Password changed.');
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
    h('p', { class: 'muted small center' }, 'ThoeneFit'),
  );
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
