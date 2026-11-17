// Exercise search: forgiving about spacing, hyphens, plurals, common
// abbreviations and typos. No DOM code, so it is tested in Node
// (tests/search.test.mjs).
//
// searchExercises(list, query, vocab) returns
//   matches  exercises whose name (or tags) match every word typed, best first
//   similar  related movements that are not already in matches
//   closest  true when nothing matched every word and matches holds the
//            nearest partial matches instead
//
// Callers pass in the list they want searched, so a picker that has already
// filtered by gym equipment only ever gets results from that filtered list.

/** Shorthand people type -> the words used in exercise names. Keys and values are already normalised. */
const ALIASES = [
  ['rdl', 'romanian deadlift'],
  ['rdls', 'romanian deadlift'],
  ['sldl', 'romanian deadlift'],
  ['stiff leg deadlift', 'romanian deadlift'],
  ['stiff legged deadlift', 'romanian deadlift'],
  ['ohp', 'overhead press'],
  ['military press', 'overhead press'],
  ['cgbp', 'close grip bench press'],
  ['bss', 'bulgarian split squat'],
  ['db', 'dumbbell'],
  ['dbs', 'dumbbell'],
  ['bb', 'barbell'],
  ['kb', 'kettlebell'],
  ['bw', 'bodyweight'],
  ['press up', 'push up'],
  ['pressup', 'push up'],
  ['skullcrusher', 'skull crusher'],
  ['skullcrushers', 'skull crusher'],
  ['nosebreaker', 'skull crusher'],
  ['pull down', 'pulldown'],
  ['lat pull', 'lat pulldown'],
  ['push down', 'pushdown'],
  ['hamstring curl', 'leg curl'],
  ['ham curl', 'leg curl'],
  ['quad extension', 'leg extension'],
  ['flye', 'fly'],
  ['flyes', 'fly'],
  ['flies', 'fly'],
  ['flys', 'fly'],
  ['pec fly', 'fly'],
  ['calves', 'calf'],
  ['chinup', 'chin up'],
  ['situp', 'sit up'],
  ['stepup', 'step up'],
  ['ez', 'ez bar'],
  ['tri', 'triceps'],
  ['bi', 'biceps'],
  ['delt', 'shoulders'],
  ['delts', 'shoulders'],
  ['pecs', 'chest'],
  ['pec', 'chest'],
  ['hams', 'hamstrings'],
  ['hammies', 'hamstrings'],
  ['traps', 'upper back'],
  ['ab', 'abs'],
].map(([from, to]) => [from.split(' '), to.split(' ')]);

/** Lower-case, strip accents, turn hyphens and punctuation into spaces. */
export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Light plural stripping so "curls" finds "curl" and "raises" finds "raise". */
function stem(word) {
  if (word.length > 4 && word.endsWith('sses')) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function words(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/** Query words, stemmed. With `expand`, shorthand is replaced first (longest phrase wins). */
export function queryTokens(query, expand = true) {
  const raw = words(query);
  if (!expand) return raw.map(stem);
  const out = [];
  for (let i = 0; i < raw.length; ) {
    let hit = null;
    for (const [from, to] of ALIASES) {
      if (from.length <= raw.length - i && from.every((w, k) => raw[i + k] === w) && (!hit || from.length > hit[0].length)) hit = [from, to];
    }
    if (hit) {
      out.push(...hit[1]);
      i += hit[0].length;
    } else {
      out.push(raw[i]);
      i += 1;
    }
  }
  return out.map(stem);
}

/** Edit distance where swapping two neighbouring letters counts as one mistake. Gives up past `max`. */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev2 = null;
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[cols - 1];
}

/** How many typos to forgive in a word of this length. */
function allowance(len) {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  return 2;
}

const cache = new WeakMap();

/** Searchable terms for an exercise: name words, neighbouring name words joined ("push"+"up"), and tag words. */
function termsFor(ex, vocab) {
  let t = cache.get(ex);
  if (t && t.name === ex.name) return t;
  const nameWords = words(ex.name).map(stem);
  const joined = [];
  for (let i = 0; i < nameWords.length - 1; i++) joined.push(nameWords[i] + nameWords[i + 1]);
  const label = (group, key) => String((vocab && vocab[group] && vocab[group][key]) || key || '').replace(/\(.*\)/, '').replace(/_/g, ' ');
  const tagWords = (texts) => [...new Set(texts.flatMap((x) => words(x).map(stem)))];
  t = {
    name: ex.name,
    nameWords,
    joined,
    compact: nameWords.join(''),
    // Primary muscles, equipment type and movement group, then secondary muscles.
    tags: tagWords([...(ex.muscles_main || []).map((m) => label('muscles', m)), label('kinds', ex.kind), label('patterns', ex.pattern)]),
    minorTags: tagWords((ex.muscles_assist || []).map((m) => label('muscles', m))),
  };
  cache.set(ex, t);
  return t;
}

// Per-word match quality, lower is better.
const EXACT = 0;
const PREFIX = 1;
const TYPO = 2;
const TAG = 4;
const MINOR_TAG = 5;
const NONE = 9;

function matchWord(q, t, isLast) {
  let best = NONE;
  for (const w of t.nameWords) {
    if (w === q) return EXACT;
    if (w.startsWith(q) && (isLast || q.length >= 3)) best = Math.min(best, PREFIX);
  }
  for (const w of t.joined) {
    if (w === q) return EXACT; // "pushup" for "Push-Up"
  }
  if (best <= PREFIX) return best;
  const allow = allowance(q.length);
  if (allow > 0) {
    const candidates = [...t.nameWords.map((w) => [w, allow]), ...t.joined.map((w) => [w, 1])];
    for (const [w, max] of candidates) {
      // The first letter is almost never the typo; requiring it (or a swap of
      // the first two) keeps "pull" from matching "bull" style noise. Joined
      // words get one mistake at most, so "pushup" does not reach "pullup".
      if (w[0] !== q[0] && !(w[0] === q[1] && w[1] === q[0])) continue;
      const d = editDistance(q, w, max);
      if (d <= max) best = Math.min(best, TYPO + d / 10);
      else if (isLast && q.length >= 5 && w.length > q.length) {
        // Still typing: compare against the same-length start of the word.
        const dp = editDistance(q, w.slice(0, q.length), 1);
        if (dp <= 1) best = Math.min(best, TYPO + 0.5);
      }
    }
  }
  if (best < NONE) return best;
  const tagHit = (w) => w === q || (q.length >= 3 && w.startsWith(q));
  if (t.tags.some(tagHit)) return TAG;
  if (t.minorTags.some(tagHit)) return MINOR_TAG;
  return NONE;
}

function score(ex, tokens, compactQuery, vocab) {
  const t = termsFor(ex, vocab);
  let worst = 0;
  let sum = 0;
  let hits = 0;
  tokens.forEach((q, i) => {
    const m = matchWord(q, t, i === tokens.length - 1);
    if (m < NONE) {
      hits += 1;
      worst = Math.max(worst, m);
      sum += m;
    }
  });
  let tier;
  if (hits === tokens.length) {
    tier = worst; // every word matched: ranked by the weakest word
  } else if (compactQuery.length >= 4 && t.compact.includes(compactQuery)) {
    tier = PREFIX; // "dumb bell" inside "dumbbell..."
    hits = tokens.length;
    sum = tokens.length;
  } else {
    tier = NONE;
  }
  const exactName = t.compact === compactQuery;
  const starts = t.compact.startsWith(compactQuery);
  return {
    ex,
    hits,
    tier,
    // exact name, then names that begin with what was typed, then fewer extra words, then catalog order
    key: [tier === NONE ? 1 : 0, exactName ? 0 : 1, Math.floor(tier), starts ? 0 : 1, sum, Math.max(0, t.nameWords.length - tokens.length), ex.priority ?? 5, ex.name],
  };
}

function compare(a, b) {
  for (let i = 0; i < a.key.length; i++) {
    if (a.key[i] < b.key[i]) return -1;
    if (a.key[i] > b.key[i]) return 1;
  }
  return 0;
}

/** Related movements for the best few results: same movement first, then same main muscle. */
function similarTo(base, list, taken, limit) {
  if (!base.length) return [];
  const patterns = [...new Set(base.map((e) => e.pattern).filter((p) => p && p !== 'other'))];
  const lead = base[0];
  const muscles = new Set(lead.muscles_main || []);
  const ranked = [];
  for (const ex of list) {
    if (taken.has(ex.id)) continue;
    const p = patterns.indexOf(ex.pattern);
    if (p >= 0) ranked.push([0, p, ex.priority ?? 5, ex.name, ex]);
    else if ((ex.muscles_main || []).some((m) => muscles.has(m)) && !!ex.compound === !!lead.compound) ranked.push([1, 0, ex.priority ?? 5, ex.name, ex]);
  }
  ranked.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3].localeCompare(b[3]));
  return ranked.slice(0, limit).map((r) => r[4]);
}

/**
 * Most-performed first (#174): by how many finished workouts include each
 * exercise, then alphabetically. Exercises never done follow, alphabetically.
 */
export function byUsage(list, counts = {}) {
  const n = (x) => counts[x.id] || 0;
  return list.slice().sort((a, b) => n(b) - n(a) || a.name.localeCompare(b.name));
}

export function searchExercises(list, query, vocab, { limit = 40, similarLimit = 8 } = {}) {
  const tokens = queryTokens(query);
  if (!tokens.length) return { matches: list.slice(0, limit), similar: [], closest: false };
  // Shorthand is tried both expanded ("rdl" -> "romanian deadlift") and as
  // typed, so an exercise that really is named "... Delt Raise" still matches "delt".
  const asTyped = queryTokens(query, false);
  const sets = asTyped.join(' ') === tokens.join(' ') ? [tokens] : [tokens, asTyped];
  const scored = list.map((ex) => {
    let best = null;
    for (const set of sets) {
      const sc = score(ex, set, set.join(''), vocab);
      if (!best || compare(sc, best) < 0) best = sc;
    }
    return best;
  });

  let hits = scored.filter((s) => s.tier < NONE).sort(compare);
  let closest = false;
  if (!hits.length) {
    // Nothing matched every word. Offer whatever matched the most words, by name only.
    const most = Math.max(0, ...scored.map((s) => s.hits));
    if (most > 0) {
      hits = scored.filter((s) => s.hits === most).sort(compare).slice(0, 8);
      closest = true;
    }
  }
  const matches = hits.slice(0, limit).map((s) => s.ex);
  const taken = new Set(hits.map((s) => s.ex.id));
  // Base the "similar" list on the strongest name matches, not on tag-only hits.
  const strong = hits.filter((s) => s.tier < TAG || closest).slice(0, 3).map((s) => s.ex);
  const similar = strong.length && hits.length <= 15 ? similarTo(strong, list, taken, similarLimit) : [];
  return { matches, similar, closest };
}
