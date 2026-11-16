// Small DOM helpers shared by every screen.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const PATHS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  today: '<path d="M3 9v6M6 6v12M18 6v12M21 9v6M6 12h12"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  trends: '<path d="M3 4v16h18M6 15l5-5 4 3 5-6"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  share: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9" r="2.4"/><path d="M16.8 14.3c2.5.4 4.2 2.6 4.2 5.2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
};

export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
  return span;
}

/** 135 -> "135", 137.5 -> "137.5". */
export function fmtW(n) {
  if (n == null || n === '') return '';
  return String(Math.round(Number(n) * 100) / 100);
}

export function parseNum(text) {
  if (text == null) return null;
  const t = String(text).replace(',', '.').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function fmtDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, opts);
}

export function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const trim = (v, places) => String(Number(v.toFixed(places)));

/** Distance for a workout's unit: miles alongside pounds, kilometres alongside kilograms. */
export const distUnit = (unit) => (unit === 'kg' ? 'km' : 'mi');
export const metresTo = (m, unit) => (m == null ? null : m / (unit === 'kg' ? 1000 : 1609.344));
export const toMetres = (v, unit) => (v == null ? null : v * (unit === 'kg' ? 1000 : 1609.344));

/** A cardio set (#18): "10 min · 1.7 mi · level 8". */
export function fmtCardio(set, unit) {
  // Short holds (stretches, #138) read better in seconds.
  const parts = [(set.duration_s || 0) < 120 ? `${Math.round(set.duration_s || 0)} s` : `${trim((set.duration_s || 0) / 60, 1)} min`];
  if (set.distance_m) parts.push(`${trim(metresTo(set.distance_m, unit), 2)} ${distUnit(unit)}`);
  if (set.level != null) parts.push(`level ${trim(set.level, 1)}`);
  return parts.join(' · ');
}

export const isCardioSet = (s) => s && s.duration_s != null && s.reps == null;

/** "135 lb × 10, 10, 8" when every set used one weight, otherwise "135×10, 125×8". */
export function fmtSets(sets, unit) {
  if (!sets || !sets.length) return '';
  if (sets.every(isCardioSet)) return sets.map((s) => fmtCardio(s, unit)).join(', ');
  const same = sets.every((s) => s.weight === sets[0].weight);
  if (same) {
    const reps = sets.map((s) => s.reps).join(', ');
    return sets[0].weight > 0 ? `${fmtW(sets[0].weight)} ${unit} × ${reps}` : `${reps} reps`;
  }
  return sets.map((s) => `${fmtW(s.weight)}×${s.reps}`).join(', ') + ` ${unit}`;
}

let toastTimer = null;
export function toast(message, kind = '', onTap = null) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `toast show ${kind}${onTap ? ' tappable' : ''}`;
  el.onclick = onTap ? () => { el.className = 'toast'; onTap(); } : null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), onTap ? 6000 : 3200);
}

/** Bottom sheet. Returns a close function. */
export function sheet(title, body, { onClose } = {}) {
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const panel = h(
    'div',
    { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Close')),
    h('div', { class: 'sheet-body' }, body),
  );
  const wrap = h('div', { class: 'sheet', onclick: (e) => e.target === wrap && close() }, panel);
  document.body.append(wrap);
  document.addEventListener('keydown', onKey);
  return close;
}

/** Yes/no question in a sheet. Resolves true when confirmed. */
export function confirmSheet(title, message, confirmLabel, danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    const close = sheet(
      title,
      h(
        'div',
        { class: 'stack' },
        h('p', { class: 'muted' }, message),
        h(
          'button',
          {
            class: `btn ${danger ? 'danger' : 'primary'} block`,
            type: 'button',
            onclick: () => {
              answered = true;
              close();
              resolve(true);
            },
          },
          confirmLabel,
        ),
      ),
      { onClose: () => !answered && resolve(false) },
    );
  });
}

/** Row of mutually exclusive buttons. options: [[value, label, hint?]] */
export function choices(options, value, onPick, { columns } = {}) {
  const wrap = h('div', { class: 'choices', role: 'group' });
  if (columns) wrap.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  const paint = (v) => {
    for (const b of wrap.children) b.setAttribute('aria-pressed', String(b.dataset.value === String(v)));
  };
  for (const [val, label, hint] of options) {
    wrap.append(
      h(
        'button',
        {
          type: 'button',
          class: 'choice',
          'data-value': String(val),
          onclick: () => {
            paint(val);
            onPick(val);
          },
        },
        h('span', { class: 'choice-label' }, label),
        hint && h('span', { class: 'choice-hint' }, hint),
      ),
    );
  }
  paint(value);
  return wrap;
}

/** Number with minus/plus buttons. */
export function stepper(value, { min, max, step, suffix, onChange }) {
  let v = value;
  const out = h('output', { class: 'stepper-value' }, `${v}${suffix || ''}`);
  const set = (n) => {
    v = Math.max(min, Math.min(max, n));
    out.textContent = `${v}${suffix || ''}`;
    onChange(v);
  };
  return h(
    'div',
    { class: 'stepper' },
    h('button', { type: 'button', class: 'btn square', 'aria-label': 'Less', onclick: () => set(v - step) }, icon('minus')),
    out,
    h('button', { type: 'button', class: 'btn square', 'aria-label': 'More', onclick: () => set(v + step) }, icon('plus')),
  );
}

/**
 * Line chart drawn as SVG. Each point is {label, value} plus, optionally:
 *   t      time in ms, to space points by date instead of evenly
 *   title  heading shown when the point is selected (defaults to label)
 *   lines  extra lines of detail for the selected point
 *   href   where "Open workout" goes for that point
 * Tapping, hovering or using the arrow keys selects the nearest point and shows
 * its details above the chart (#11). opts.onOpen runs before following href.
 */
export function lineChart(points, { unit = '', format = fmtW, onOpen, openLabel = 'Open workout', hint = 'Tap a point to see its details.' } = {}) {
  const W = 320;
  const H = 120;
  const pad = { l: 10, r: 10, t: 14, b: 10 };
  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const timed = points.length > 1 && points.every((p) => Number.isFinite(p.t)) && points[points.length - 1].t > points[0].t;
  const t0 = timed ? points[0].t : 0;
  const span = timed ? points[points.length - 1].t - t0 : 1;
  const x = (i) => {
    if (points.length === 1) return W / 2;
    const f = timed ? (points[i].t - t0) / span : i / (points.length - 1);
    return pad.l + f * (W - pad.l - pad.r);
  };
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  // With a long history the line alone reads better; only the latest point keeps its dot.
  const dense = points.length > 40;
  const dots = points
    .map((p, i) => (dense && i !== points.length - 1 ? '' : `<circle class="dot${i === points.length - 1 ? ' latest' : ''}" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="${i === points.length - 1 ? 4.5 : 3}"/>`))
    .join('');
  const fig = h('figure', { class: 'chart' });
  const first = points[0];
  const last = points[points.length - 1];
  if (dense) fig.classList.add('dense');
  const summary = `From ${format(first.value)} ${unit} on ${first.label} to ${format(last.value)} ${unit} on ${last.label}`;
  // The details box above the chart keeps one height for every point, so the chart
  // doesn't jump up and down as you drag across it (#75). Each detail line gets one
  // row, or two if it runs long on any point (for example a long list of sets), and
  // is cut off with an ellipsis past that. Open workout still shows everything.
  const clamps = [];
  for (const p of points) (p.lines || []).forEach((line, i) => (clamps[i] = Math.max(clamps[i] || 1, String(line).length > 32 ? 2 : 1)));
  const rows = 2 + clamps.reduce((n, c) => n + c, 0);
  const readout = h('div', { class: 'chart-readout', 'aria-live': 'polite' }, h('span', { class: 'muted small' }, hint));
  // Set through el.style, not a style attribute: the site's Content-Security-Policy
  // blocks inline style attributes (#81).
  readout.style.setProperty('--readout-rows', rows);
  fig.append(readout);
  fig.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="${summary}. Use the arrow keys to step through points."><path d="${d}"/>${dots}<line class="guide" x1="0" x2="0" y1="${pad.t - 6}" y2="${H - pad.b + 6}" visibility="hidden"/><circle class="sel" r="6" visibility="hidden"/></svg>`);
  const svg = fig.querySelector('svg');
  const guide = svg.querySelector('.guide');
  const mark = svg.querySelector('.sel');
  let current = -1;

  const select = (i) => {
    i = Math.max(0, Math.min(points.length - 1, i));
    if (i === current) return;
    current = i;
    const p = points[i];
    const cx = x(i).toFixed(1);
    guide.setAttribute('x1', cx);
    guide.setAttribute('x2', cx);
    mark.setAttribute('cx', cx);
    mark.setAttribute('cy', y(p.value).toFixed(1));
    guide.setAttribute('visibility', 'visible');
    mark.setAttribute('visibility', 'visible');
    const text = h('div', { class: 'chart-readout-text' },
      h('strong', {}, p.title || p.label),
      h('span', {}, `${format(p.value)} ${unit}`.trim()),
      (p.lines || []).map((line, n) => {
        const el = h('span', { class: 'muted', title: line }, line);
        el.style.setProperty('--clamp', clamps[n] || 1);
        return el;
      }));
    // Only points that stand for one workout get a link (Trends' weekly points do not).
    if (p.href) readout.replaceChildren(text, h('a', { class: 'btn small', href: p.href, onclick: () => onOpen && onOpen(p) }, openLabel));
    else readout.replaceChildren(text);
  };
  // Nearest point to where the pointer is across the chart.
  const nearest = (clientX) => {
    const r = svg.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - sx) < Math.abs(x(best) - sx)) best = i;
    return best;
  };
  svg.addEventListener('pointerdown', (e) => select(nearest(e.clientX)));
  svg.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || e.buttons) select(nearest(e.clientX));
  });
  svg.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (step) {
      e.preventDefault();
      select(current < 0 ? points.length - 1 : current + step);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      select(e.key === 'Home' ? 0 : points.length - 1);
    } else if (e.key === 'Enter' && current >= 0 && points[current].href) {
      if (onOpen) onOpen(points[current]);
      location.hash = points[current].href.replace(/^#/, '');
    }
  });
  fig.append(
    h('figcaption', {}, h('span', {}, `${first.label}: ${format(first.value)} ${unit}`), points.length > 2 && h('span', {}, `Best: ${format(Math.max(...vals))} ${unit}`), h('span', {}, `${last.label}: ${format(last.value)} ${unit}`)),
  );
  return fig;
}
