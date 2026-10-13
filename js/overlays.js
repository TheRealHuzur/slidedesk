// Ueberlagerungen waehrend der Praesentation: Uebersicht, Suche, Gehe zu, Hilfe, Beenden.
// Im gespiegelten Modus erscheinen sie auf der Buehne, im Zwei-Bildschirm-Modus nur auf dem Laptop.

import { h, debounce, norm, escapeHtml } from './util.js';

export class OverlayManager {
  constructor(doc, host, show, lib) {
    this.doc = doc;
    this.host = host;
    this.show = show;
    this.lib = lib;
    this.cur = null;
    this.off = show.on('update', () => this.sync());
    this.sync();
  }

  sync() {
    const want = this.show.active ? this.show.overlay : null;
    const type = want?.type || null;
    if (this.cur && this.cur.type === type) { this.cur.update?.(); return; }
    if (this.cur) { this.cur.destroy?.(); this.cur = null; this.host.replaceChildren(); }
    this.host.classList.toggle('open', !!type);
    if (!type) { if (this.show.overlayOwner === this) { this.show.overlayHandler = null; this.show.overlayOwner = null; } return; }
    const C = { overview: Overview, search: Search, goto: Goto, help: Help, 'confirm-end': ConfirmEnd }[type];
    if (!C) return;
    this.cur = new C(this.doc, this.show, this.lib, () => this.show.closeOverlay());
    this.cur.type = type;
    this.host.append(this.cur.el);
    this.show.overlayHandler = (e) => this.cur?.handleKey(e) ?? false;
    this.show.overlayOwner = this;
    this.cur.focus?.();
  }

  destroy() {
    this.off();
    this.cur?.destroy?.();
    this.host.replaceChildren();
    if (this.show.overlayOwner === this) { this.show.overlayHandler = null; this.show.overlayOwner = null; }
  }
}

function lazyThumbs(doc, lib, rootEl) {
  const io = new doc.defaultView.IntersectionObserver((ents) => {
    for (const en of ents) {
      if (!en.isIntersecting) continue;
      const img = en.target;
      io.unobserve(img);
      lib.thumb(img.dataset.path, Number(img.dataset.page)).then((u) => { img.src = u; }).catch(() => img.classList.add('broken'));
    }
  }, { root: rootEl, rootMargin: '300px' });
  return io;
}

function panel(doc, title, hint, ...body) {
  return h(doc, 'div.ov-panel',
    h(doc, 'div.ov-head', h(doc, 'strong', title), hint ? h(doc, 'span.ov-hint', hint) : null),
    ...body);
}

/** Alle Folien des Seminars als Miniaturen, gruppiert nach PDF. */
class Overview {
  constructor(doc, show, lib, close) {
    this.doc = doc; this.show = show; this.lib = lib; this.close = close;
    this.grid = h(doc, 'div.ov-scroll');
    const dual = show.mode === 'dual';
    this.el = h(doc, 'div.ov-wrap', panel(doc, 'Übersicht', dual ? 'Pfeiltasten wählen, Enter hört vor, Esc schließt' : 'Pfeiltasten wählen, Enter zeigt, Esc schließt', this.grid));
    this.el.addEventListener('click', (e) => { if (e.target === this.el) close(); });
    this.io = lazyThumbs(doc, lib, this.grid);
    this.cells = [];
    show.items.forEach((it, i) => {
      const row = h(doc, 'div.ov-grid');
      for (let p = 1; p <= it.pages; p++) {
        const img = h(doc, 'img', { alt: '', dataset: { path: it.path, page: p } });
        this.io.observe(img);
        const cell = h(doc, 'button.ov-cell', { onclick: () => this.pick({ i, p }) }, img, h(doc, 'span.ov-num', String(p)));
        cell.pos = { i, p };
        if (show.shownNow(it.path, p)) cell.classList.add('shown');
        this.cells.push(cell);
        row.append(cell);
      }
      this.grid.append(h(doc, 'div.ov-group', h(doc, 'div.ov-group-title', it.title, h(doc, 'small', `${it.pages} Folien`)), row));
    });
    const start = show.cue || show.pos;
    this.sel = Math.max(0, this.cells.findIndex((c) => c.pos.i === start.i && c.pos.p === start.p));
    this.markCurrent();
  }
  markCurrent() {
    for (const c of this.cells) c.classList.toggle('current', this.show.samePos(c.pos, this.show.pos));
    this.select(this.sel, false);
  }
  select(n, smooth = true) {
    n = Math.max(0, Math.min(this.cells.length - 1, n));
    this.cells[this.sel]?.classList.remove('sel');
    this.sel = n;
    const c = this.cells[n];
    if (!c) return;
    c.classList.add('sel');
    c.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  }
  focus() { this.doc.defaultView.focus(); }
  pick(pos) { this.close(); this.show.choose(pos); }
  rowStep(dir) {
    const c = this.cells[this.sel];
    if (!c) return;
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    let best = -1, bestD = Infinity;
    for (let k = this.sel + dir; k >= 0 && k < this.cells.length; k += dir) {
      const q = this.cells[k].getBoundingClientRect();
      if (dir > 0 ? q.top <= r.top + 2 : q.top >= r.top - 2) continue;
      const rowTop = q.top;
      // erste Zeile in Richtung gefunden: naechste Zelle nach x suchen
      for (let m = k; m >= 0 && m < this.cells.length; m += dir) {
        const z = this.cells[m].getBoundingClientRect();
        if (Math.abs(z.top - rowTop) > 2) break;
        const d = Math.abs(z.left + z.width / 2 - cx);
        if (d < bestD) { bestD = d; best = m; }
      }
      break;
    }
    if (best >= 0) this.select(best);
  }
  handleKey(e) {
    const k = e.key;
    const done = () => { e.preventDefault(); return true; };
    if (k === 'Escape' || e.code === 'KeyO') { this.close(); return done(); }
    if (k === 'ArrowRight') { this.select(this.sel + 1); return done(); }
    if (k === 'ArrowLeft') { this.select(this.sel - 1); return done(); }
    if (k === 'ArrowDown') { this.rowStep(1); return done(); }
    if (k === 'ArrowUp') { this.rowStep(-1); return done(); }
    if (k === 'Home') { this.select(0); return done(); }
    if (k === 'End') { this.select(this.cells.length - 1); return done(); }
    if (k === 'Enter' || k === ' ') { const c = this.cells[this.sel]; if (c) this.pick(c.pos); return done(); }
    return true; // modal: keine anderen Kuerzel
  }
  destroy() { this.io.disconnect(); }
}

/** Volltextsuche ueber alle PDFs des Seminars. */
class Search {
  constructor(doc, show, lib, close) {
    this.doc = doc; this.show = show; this.lib = lib; this.close = close;
    this.input = h(doc, 'input.ov-input', { type: 'search', placeholder: 'Stichwort, z. B. Prozesslandkarte', autocomplete: 'off', spellcheck: false });
    this.status = h(doc, 'div.ov-status');
    this.list = h(doc, 'div.ov-results');
    const dual = show.mode === 'dual';
    this.el = h(doc, 'div.ov-wrap', panel(doc, 'Suche', dual ? 'Enter hört die Fundstelle vor' : 'Enter zeigt die Fundstelle', this.input, this.status, this.list));
    this.el.addEventListener('click', (e) => { if (e.target === this.el) close(); });
    this.io = lazyThumbs(doc, lib, this.list);
    this.results = [];
    this.sel = 0;
    this.run = debounce(() => this.search(), 120);
    this.input.addEventListener('input', () => this.run());
    if (show.lastSearch) { this.input.value = show.lastSearch; this.run(); }
    else this.status.textContent = 'Durchsucht den Text aller Folien dieses Seminars.';
  }
  focus() { setTimeout(() => { this.input.focus(); this.input.select(); }, 0); }
  async search() {
    const q = this.input.value.trim();
    this.show.lastSearch = q;
    const terms = norm(q).split(' ').filter(Boolean);
    this.rawTerms = q.split(/\s+/).filter(Boolean);
    const my = (this.token = {});
    if (!terms.length) { this.list.replaceChildren(); this.results = []; this.status.textContent = ''; return; }
    this.status.textContent = 'Suche läuft';
    const out = [];
    for (const [i, it] of this.show.items.entries()) {
      let texts;
      try { texts = await this.lib.text(it.path); } catch { texts = []; }
      if (my !== this.token) return;
      texts.forEach((t, idx) => {
        const n = norm(t);
        if (terms.every((term) => n.includes(term))) {
          // Ganze Phrase zaehlt am meisten, dann Haeufigkeit der Begriffe
          const phrase = terms.length > 1 && n.includes(terms.join(' ')) ? 1000 : 0;
          out.push({ i, p: idx + 1, text: t, score: phrase + terms.reduce((a, term) => a + n.split(term).length - 1, 0) });
        }
      });
    }
    if (my !== this.token) return;
    // Phrasentreffer nach vorne, sonst Reihenfolge im Seminar
    out.sort((a, b) => (b.score >= 1000) - (a.score >= 1000) || a.i - b.i || a.p - b.p);
    this.results = out.slice(0, 120);
    this.status.textContent = out.length ? `${out.length} Treffer` : 'Keine Treffer';
    this.list.replaceChildren(...this.results.map((r, k) => this.row(r, k, terms)));
    this.sel = 0;
    this.mark();
  }
  row(r, k, terms) {
    const d = this.doc;
    const it = this.show.items[r.i];
    const img = h(d, 'img', { alt: '', dataset: { path: it.path, page: r.p } });
    this.io.observe(img);
    const snip = h(d, 'div.ov-snippet');
    snip.innerHTML = snippet(r.text, this.rawTerms);
    return h(d, 'button.ov-row', { onclick: () => this.pick(r) }, img,
      h(d, 'div', h(d, 'div.ov-row-title', `${it.title} · Folie ${r.p}`), snip));
  }
  mark() {
    [...this.list.children].forEach((c, k) => c.classList.toggle('sel', k === this.sel));
    this.list.children[this.sel]?.scrollIntoView({ block: 'nearest' });
  }
  pick(r) { this.close(); this.show.choose({ i: r.i, p: r.p }); }
  handleKey(e) {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); this.close(); return true; }
    if (k === 'ArrowDown') { e.preventDefault(); this.sel = Math.min(this.results.length - 1, this.sel + 1); this.mark(); return true; }
    if (k === 'ArrowUp') { e.preventDefault(); this.sel = Math.max(0, this.sel - 1); this.mark(); return true; }
    if (k === 'Enter') { e.preventDefault(); const r = this.results[this.sel]; if (r) this.pick(r); return true; }
    if (e.target !== this.input && k.length === 1) this.input.focus();
    return true;
  }
  destroy() { this.io.disconnect(); this.token = null; }
}

/** Ausschnitt um den ersten Treffer, mit Hervorhebung. */
function snippet(text, rawTerms) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of rawTerms) { const k = lower.indexOf(t.toLowerCase()); if (k >= 0 && (at < 0 || k < at)) at = k; }
  const start = Math.max(0, at - 50);
  const s = text.slice(start, start + 170);
  let html = escapeHtml(s);
  for (const t of rawTerms) {
    if (t.length < 2) continue;
    const re = new RegExp(escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    html = html.replace(re, (m) => `<mark>${m}</mark>`);
  }
  return (start > 0 ? '… ' : '') + html + (start + 170 < text.length ? ' …' : '');
}

/** Gehe zu Foliennummer im aktuellen PDF. */
class Goto {
  constructor(doc, show, lib, close) {
    this.doc = doc; this.show = show; this.close = close;
    const it = show.item();
    this.input = h(doc, 'input.ov-input.num', { type: 'text', inputmode: 'numeric', placeholder: `1 bis ${it?.pages || 1}` });
    this.el = h(doc, 'div.ov-wrap', panel(doc, 'Gehe zu Folie', `im PDF „${it?.title || ''}“, Enter bestätigt`, this.input));
    this.el.addEventListener('click', (e) => { if (e.target === this.el) close(); });
  }
  focus() { setTimeout(() => this.input.focus(), 0); }
  handleKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const n = parseInt(this.input.value, 10);
      this.close();
      if (n > 0) this.show.choose({ i: this.show.pos.i, p: n });
      return true;
    }
    if (e.target !== this.input) this.input.focus();
    return true;
  }
}

class Help {
  constructor(doc, show, lib, close) {
    this.close = close;
    const rows = [
      ['→  Leertaste  Bild ↓', 'nächste Folie'],
      ['←  Bild ↑', 'vorherige Folie'],
      ['Umschalt + → / ←', 'nächstes / vorheriges PDF'],
      ['Pos1 / Ende', 'erste / letzte Folie im PDF'],
      ['O', 'Übersicht aller Folien'],
      ['S  oder  Strg + F', 'Volltextsuche'],
      ['G', 'gehe zu Foliennummer'],
      ['1 bis 9', 'Schnelltaste anspringen'],
      ['Umschalt + 1 bis 9', 'aktuelle Folie auf Schnelltaste legen'],
      ['⌫ Rücktaste', 'zurück zur Stelle vor dem letzten Sprung'],
      ['P', 'Pause mit Pausenfolien an / aus'],
      ['+ / − / 0, Mausrad', 'zoomen, zurücksetzen; mit der Maus verschieben'],
      ['Enter', 'vorgehörte Folie zeigen (zwei Bildschirme)'],
      ['Alt + → / ←', 'vorgehörte Folie weiterblättern'],
      ['Esc', 'Vorhören verwerfen, Zoom zurück, Fenster schließen'],
      ['F', 'zurück ins Vollbild'],
      ['X', 'Präsentation beenden'],
    ];
    this.el = h(doc, 'div.ov-wrap', panel(doc, 'Tasten', 'beliebige Taste schließt',
      h(doc, 'table.ov-keys', ...rows.map(([a, b]) => h(doc, 'tr', h(doc, 'td', h(doc, 'kbd', a)), h(doc, 'td', b))))));
    this.el.addEventListener('click', () => close());
  }
  handleKey(e) {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return true;
    e.preventDefault(); this.close(); return true;
  }
}

class ConfirmEnd {
  constructor(doc, show, lib, close) {
    this.show = show; this.close = close;
    this.el = h(doc, 'div.ov-wrap', panel(doc, 'Präsentation beenden?', 'Enter beendet, Esc bricht ab',
      h(doc, 'div.ov-actions',
        h(doc, 'button.btn', { onclick: () => close() }, 'Weiter präsentieren'),
        h(doc, 'button.btn.danger', { onclick: () => this.end() }, 'Beenden'))));
  }
  end() { this.close(); this.show.stop(); }
  handleKey(e) {
    e.preventDefault();
    if (e.key === 'Enter' || e.code === 'KeyJ' || e.code === 'KeyX') this.end();
    else if (e.key === 'Escape' || e.code === 'KeyN') this.close();
    return true;
  }
}
