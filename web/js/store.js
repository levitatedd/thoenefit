// Server calls and the offline-safe workout store. No DOM code in here, so the
// sync logic can be tested in Node (tests/sync.test.mjs).

export function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status; // 0 = could not reach the server
  }
  get offline() {
    return this.status === 0;
  }
}

export class Api {
  constructor(base = 'api.php') {
    this.base = base;
    this.csrf = null;
    this.onUnauthorized = null;
  }

  /** Fetches a fresh security token (needed after the app was opened offline). */
  async refreshToken() {
    const data = await this.request('bootstrap');
    this.csrf = data.csrf || null;
    if (!data.user && this.onUnauthorized) this.onUnauthorized();
    if (!data.user) throw new ApiError(401, 'Sign in to continue.');
  }

  async call(action, body, query = '') {
    const write = body !== undefined && action !== 'login';
    if (write && !this.csrf) await this.refreshToken();
    try {
      return await this.request(action, body, query);
    } catch (e) {
      if (write && e.status === 403 && /token/i.test(e.message)) {
        await this.refreshToken();
        return this.request(action, body, query);
      }
      throw e;
    }
  }

  async request(action, body, query = '') {
    const opts = { credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      if (this.csrf) opts.headers['X-CSRF-Token'] = this.csrf;
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(`${this.base}?a=${action}${query}`, opts);
    } catch (e) {
      throw new ApiError(0, 'No connection to the server.');
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // A captive portal or a server error page: treat as unreachable so queued edits keep waiting.
      throw new ApiError(res.ok ? 0 : res.status, 'The server sent something unexpected.');
    }
    if (!res.ok) {
      if (res.status === 401 && action !== 'login' && this.onUnauthorized) this.onUnauthorized();
      throw new ApiError(res.status, (data && data.error) || 'Request failed.');
    }
    return data;
  }

  get(action, query = '') {
    return this.call(action, undefined, query);
  }

  post(action, body = {}) {
    return this.call(action, body);
  }
}

/** What goes to the server: the workout without local-only bookkeeping. */
export function wire(doc) {
  const { _dirty, ...rest } = doc;
  return {
    ...rest,
    exercises: doc.exercises.map(({ previous, ...e }) => e),
  };
}

/**
 * Keeps in-progress and not-yet-synced workouts on the device.
 *
 * Every edit is written to local storage first, then pushed to the server as
 * a whole document with a rising revision number. The server replaces what it
 * has for that workout id, so a push that is retried after a dropped
 * connection (or delivered twice) cannot create duplicate sets.
 */
export class WorkoutSync {
  constructor({ storage, key, send, remove, onChange, schedule, now }) {
    this.storage = storage;
    this.key = key;
    this.send = send; // async (doc) => {ok, rev} | {conflict, workout}
    this.remove = remove; // async (id) => void
    this.onChange = onChange || (() => {});
    this.schedule = schedule || ((fn, ms) => setTimeout(fn, ms));
    this.now = now || (() => new Date().toISOString());
    this.docs = new Map();
    this.deletes = [];
    this.activeId = null;
    this.busy = false;
    this.again = false;
    this.failures = 0;
    this.offline = false;
    this.error = null;
    this.timer = null;
  }

  load() {
    try {
      const raw = JSON.parse(this.storage.getItem(this.key) || 'null');
      if (raw) {
        this.docs = new Map(raw.docs.map((d) => [d.id, d]));
        this.deletes = raw.deletes || [];
        this.activeId = raw.activeId || null;
      }
    } catch (e) {
      // Unreadable storage: start clean rather than crash at the gym.
    }
    if (this.activeId && !this.docs.has(this.activeId)) this.activeId = null;
  }

  persist() {
    try {
      this.storage.setItem(this.key, JSON.stringify({ docs: [...this.docs.values()], deletes: this.deletes, activeId: this.activeId }));
    } catch (e) {
      this.error = 'This device is out of storage, so changes are not being kept offline.';
    }
  }

  get active() {
    const d = this.activeId ? this.docs.get(this.activeId) : null;
    return d && d.status === 'active' ? d : null;
  }

  /** Workouts finished on this device that the server has not confirmed yet. */
  get waiting() {
    return [...this.docs.values()].filter((d) => d._dirty && d.status === 'completed').length;
  }

  /** Take a copy from the server as-is (nothing to push). */
  adopt(doc, makeActive = true) {
    this.docs.set(doc.id, { ...doc, _dirty: false });
    if (makeActive && doc.status === 'active') this.activeId = doc.id;
    this.persist();
    this.onChange();
  }

  /** Forget a clean local copy (the server no longer has it in progress). */
  drop(id) {
    this.docs.delete(id);
    if (this.activeId === id) this.activeId = null;
    this.persist();
    this.onChange();
  }

  start(doc) {
    doc.rev = 1;
    doc._dirty = true;
    this.docs.set(doc.id, doc);
    this.activeId = doc.id;
    this.persist();
    this.queue(0);
  }

  /** Apply a change to a workout, save it locally, and queue the push. */
  edit(id, mutate, delay = 700) {
    const doc = this.docs.get(id);
    if (!doc) return null;
    mutate(doc);
    doc.rev = (doc.rev || 1) + 1;
    doc.updated_at = this.now();
    doc._dirty = true;
    this.error = null;
    if (doc.status !== 'active' && this.activeId === id) this.activeId = null;
    this.persist();
    this.queue(delay);
    return doc;
  }

  discard(id) {
    this.docs.delete(id);
    if (this.activeId === id) this.activeId = null;
    if (!this.deletes.includes(id)) this.deletes.push(id);
    this.persist();
    this.queue(0);
  }

  status() {
    const pending = this.deletes.length > 0 || [...this.docs.values()].some((d) => d._dirty);
    if (!pending) return 'saved';
    if (this.busy && !this.offline) return 'saving';
    return 'pending';
  }

  queue(delay) {
    this.onChange();
    if (this.timer) clearTimeout(this.timer);
    this.timer = this.schedule(() => {
      this.timer = null;
      this.flush();
    }, delay);
  }

  async flush() {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    this.onChange();
    let retry = false;
    try {
      for (const id of [...this.deletes]) {
        await this.remove(id);
        this.deletes = this.deletes.filter((x) => x !== id);
        this.persist();
      }
      for (const id of [...this.docs.keys()]) {
        let doc = this.docs.get(id);
        if (!doc || !doc._dirty) continue;
        const sentRev = doc.rev;
        const res = await this.send(wire(doc));
        doc = this.docs.get(id);
        if (!doc) continue; // discarded while the request was in flight
        if (res && res.conflict) {
          // Another device saved a newer copy. The phone in your hand wins:
          // move past the server's revision and send again.
          doc.rev = Math.max(doc.rev, (res.workout && res.workout.rev) || 0) + 1;
          this.persist();
          retry = true;
          continue;
        }
        if (doc.rev === sentRev) {
          doc._dirty = false;
          if (doc.status !== 'active') {
            this.docs.delete(id);
            if (this.activeId === id) this.activeId = null;
          }
        } else {
          retry = true; // edited again while saving
        }
        this.persist();
      }
      this.failures = 0;
      this.offline = false;
    } catch (e) {
      const status = e && typeof e.status === 'number' ? e.status : 0;
      if (status === 0 || status >= 500 || status === 401 || status === 403 || status === 429) {
        // Connection or sign-in trouble: keep everything queued and try again.
        this.offline = status === 0 || status >= 500;
        this.failures += 1;
        const wait = Math.min(30000, 1500 * 2 ** Math.min(this.failures, 5));
        if (this.timer) clearTimeout(this.timer);
        this.timer = this.schedule(() => {
          this.timer = null;
          this.flush();
        }, wait);
      } else {
        this.error = (e && e.message) || 'The server refused this workout.';
      }
    } finally {
      this.busy = false;
      if (this.again || retry) {
        this.again = false;
        this.queue(retry ? 200 : 0);
      }
      this.onChange();
    }
  }
}
