// Offline queue checks for the phone-side workout store:
//   node tests/sync.test.mjs

import { WorkoutSync, uuid, clearLocalData } from '../web/js/store.js';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok   ' : 'FAIL '} ${name}${ok || !detail ? '' : `  (${detail})`}`);
};

class Offline extends Error {
  constructor() {
    super('offline');
    this.status = 0;
  }
}

// Stand-in for the server: replaces a workout by id when the revision is not older, like save_workout.
function fakeServer() {
  const s = { online: true, workouts: new Map(), calls: 0, dropReplyOnce: false };
  s.send = async (doc) => {
    s.calls++;
    if (!s.online) throw new Offline();
    const have = s.workouts.get(doc.id);
    if (have && have.rev > doc.rev) return { ok: false, conflict: true, workout: have };
    s.workouts.set(doc.id, JSON.parse(JSON.stringify(doc)));
    if (s.dropReplyOnce) {
      s.dropReplyOnce = false;
      throw new Offline(); // the save landed but the reply was lost
    }
    return { ok: true, rev: doc.rev };
  };
  s.remove = async (id) => {
    if (!s.online) throw new Offline();
    s.workouts.delete(id);
  };
  return s;
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), _m: m };
}

function make(server, storage) {
  const timers = [];
  const sync = new WorkoutSync({
    storage,
    key: 'tf.docs.1',
    send: server.send,
    remove: server.remove,
    schedule: (fn) => {
      timers.push(fn);
      return timers.length;
    },
  });
  // Run queued timers until the store settles (or gives up after a few rounds while offline).
  sync.settle = async (rounds = 6) => {
    for (let i = 0; i < rounds && timers.length; i++) {
      const fn = timers.pop();
      timers.length = 0;
      await fn();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return sync;
}

const newDoc = () => ({
  id: uuid(),
  status: 'active',
  unit: 'lb',
  exercises: [{ id: uuid(), exercise_id: 1, previous: { sets: [] }, sets: [{ id: uuid(), weight: 135, reps: 8, done: false }] }],
});
const setIds = (w) => w.exercises.flatMap((e) => e.sets.map((s) => s.id));

console.log('Offline queue');

{
  const server = fakeServer();
  const storage = memoryStorage();
  const sync = make(server, storage);
  const doc = newDoc();
  sync.start(doc);
  await sync.settle();
  check('a new workout reaches the server', server.workouts.has(doc.id) && sync.status() === 'saved');
  check('local-only fields are not sent', !('_dirty' in server.workouts.get(doc.id)) && !('previous' in server.workouts.get(doc.id).exercises[0]));

  server.online = false;
  sync.edit(doc.id, (d) => (d.exercises[0].sets[0].done = true));
  sync.edit(doc.id, (d) => d.exercises[0].sets.push({ id: uuid(), weight: 135, reps: 7, done: true }));
  sync.edit(doc.id, (d) => d.exercises[0].sets.push({ id: uuid(), weight: 135, reps: 6, done: true }));
  await sync.settle();
  check('edits made offline are kept and shown as pending', sync.status() === 'pending' && sync.active.exercises[0].sets.length === 3);
  check('the server has not changed while offline', server.workouts.get(doc.id).exercises[0].sets.length === 1);

  // Closing and reopening the app while still offline.
  const reopened = make(server, storage);
  reopened.load();
  check('an in-progress workout survives closing the app offline', reopened.active && reopened.active.id === doc.id && reopened.active.exercises[0].sets.length === 3 && reopened.status() === 'pending');

  server.online = true;
  server.dropReplyOnce = true; // first retry lands but the phone never hears back
  await reopened.flush();
  await reopened.settle();
  const saved = server.workouts.get(doc.id);
  const ids = setIds(saved);
  check('after reconnecting, queued edits arrive', saved.exercises[0].sets.length === 3 && reopened.status() === 'saved');
  check('a save that is retried after a lost reply creates no duplicate sets', new Set(ids).size === ids.length && ids.length === 3, `${ids.length} sets`);
  check('the retry really happened', server.calls >= 4);

  reopened.edit(doc.id, (d) => {
    d.status = 'completed';
  });
  await reopened.settle();
  check('a finished workout leaves the device once the server has it', reopened.docs.size === 0 && server.workouts.get(doc.id).status === 'completed' && reopened.active === null);
}

{
  const server = fakeServer();
  const sync = make(server, memoryStorage());
  const doc = newDoc();
  server.online = false;
  sync.start(doc);
  sync.edit(doc.id, (d) => (d.status = 'completed'));
  await sync.settle();
  check('a workout started and finished entirely offline waits on the device', sync.waiting === 1 && sync.active === null);
  server.online = true;
  await sync.flush();
  await sync.settle();
  check('and is delivered once when the connection returns', server.workouts.size === 1 && sync.waiting === 0);
}

{
  const server = fakeServer();
  const sync = make(server, memoryStorage());
  const doc = newDoc();
  sync.start(doc);
  await sync.settle();
  // Another device pushed a much newer revision.
  server.workouts.get(doc.id).rev = 50;
  sync.edit(doc.id, (d) => (d.exercises[0].sets[0].reps = 12));
  await sync.settle();
  check('this phone wins over an older copy from another device', server.workouts.get(doc.id).exercises[0].sets[0].reps === 12 && sync.status() === 'saved');
}

{
  const server = fakeServer();
  const sync = make(server, memoryStorage());
  const doc = newDoc();
  sync.start(doc);
  await sync.settle();
  server.online = false;
  sync.discard(doc.id);
  await sync.settle();
  check('a discard made offline is remembered', sync.status() === 'pending' && server.workouts.has(doc.id));
  server.online = true;
  await sync.flush();
  check('and removes the workout from the server on reconnect', !server.workouts.has(doc.id) && sync.status() === 'saved');
}

console.log('Sign out and clear local data (#23)');
{
  const server = fakeServer();
  const storage = memoryStorage();
  const sync = make(server, storage);
  server.online = false;
  const doc = newDoc();
  sync.start(doc);
  await sync.settle();
  storage.setItem('tf.boot', '{"user":{"id":1}}');
  storage.setItem('tf.rest', '{"endsAt":1}');
  storage.setItem('tf.stravaOnFinish', '{"send":true}');
  storage.setItem('tf.docs.2', '{"docs":[]}');
  storage.setItem('tf.install', '{"never":true}');
  check('an offline workout is waiting on the device', sync.status() === 'pending' && storage.getItem('tf.docs.1') !== null);
  sync.close();
  const removed = clearLocalData(storage, 1);
  check("clearing removes this account's workouts, cached profile, rest timer and Strava choice", ['tf.docs.1', 'tf.boot', 'tf.rest', 'tf.stravaOnFinish'].every((k) => storage.getItem(k) === null) && removed.length === 4, removed.join());
  check("another account's unsynced workouts and device-wide choices are kept", storage.getItem('tf.docs.2') !== null && storage.getItem('tf.install') !== null);
  sync.edit(doc.id, (d) => { d.notes = 'after sign-out'; });
  server.online = true;
  await sync.flush();
  check('a closed store writes nothing back and sends nothing', storage.getItem('tf.docs.1') === null && !server.workouts.has(doc.id));
  check('clearing twice is harmless', clearLocalData(storage, 1).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
