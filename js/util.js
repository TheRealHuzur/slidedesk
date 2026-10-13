// Kleine Helfer, die von allen Modulen genutzt werden.

/**
 * Erzeugt ein Element in einem beliebigen Dokument (Hauptfenster oder Zusatzfenster).
 * h(doc, 'div.klasse#id', {onclick, title, ...}, kind1, kind2, ...)
 */
export function h(doc, spec, attrs, ...children) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
  const el = doc.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || isNode(attrs) || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(isNode(c) ? c : String(c));
  }
}

/** Fensteruebergreifend: Elemente aus Zusatzfenstern haben ein eigenes Node. */
const isNode = (x) => x != null && typeof x === 'object' && typeof x.nodeType === 'number';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function debounce(fn, ms) {
  let t;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return d;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Text fuer die Suche vereinheitlichen: Kleinschreibung, Akzente weg, ß zu ss. */
export function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

export const fileTitle = (path) => (path.split('/').pop() || path).replace(/\.pdf$/i, '');

export const slideKey = (path, page) => `${path}#${page}`;

/** Kleine Ereignisquelle fuer Zustandsaenderungen. */
export class Emitter {
  constructor() { this.l = new Map(); }
  on(ev, fn) {
    if (!this.l.has(ev)) this.l.set(ev, new Set());
    this.l.get(ev).add(fn);
    return () => this.l.get(ev)?.delete(fn);
  }
  emit(ev, ...a) {
    for (const fn of this.l.get(ev) || []) {
      try { fn(...a); } catch (e) { console.error(e); }
    }
  }
}

/** Kurze Einblendung unten in einem Dokument. */
export function toast(doc, text, ms = 2200) {
  let box = doc.querySelector('.sd-toasts');
  if (!box) {
    box = h(doc, 'div.sd-toasts');
    doc.body.append(box);
  }
  const t = h(doc, 'div.sd-toast', text);
  box.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
