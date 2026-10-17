// Ablaufsteuerung einer laufenden Praesentation: Position, Vorhoeren, Pause, Zoom,
// Schnelltasten, Ruecksprung und Gezeigt-Protokoll. Die Ansichten hoeren auf 'update'.

import { Emitter, clamp, fileTitle, slideKey, uid } from './util.js';

const MAX_HISTORY = 50;
const MAX_PROTOCOLS = 30;
const ZOOM_MAX = 8;

export class Show extends Emitter {
  constructor(app) {
    super();
    this.app = app; // { store, lib }
    this.active = false;
    this.sizes = new Set();
  }

  get lib() { return this.app.lib; }
  get store() { return this.app.store; }

  /** PDFs eines Seminars laden und pruefen. Darf vor dem Start schon laufen. */
  async prepare(sem) {
    const results = await Promise.all(sem.items.map((it) => this.lib.open(it.path, { check: true })));
    const items = [];
    const missing = [];
    sem.items.forEach((it, idx) => {
      const e = results[idx];
      if (e.status === 'ok' && e.pages > 0) items.push({ id: it.id, path: it.path, title: fileTitle(it.path), pages: e.pages });
      else missing.push(it.path);
    });
    const pauseRefs = (sem.pause?.slides ?? this.store.data.pause.slides) || [];
    const pauseEntries = await Promise.all([...new Set(pauseRefs.map((r) => r.path))].map((p) => this.lib.open(p, { check: true })));
    const okPaths = new Set(pauseEntries.filter((e) => e.status === 'ok').map((e) => e.path));
    const pauseSlides = pauseRefs.filter((r) => okPaths.has(r.path) && r.page <= (this.lib.entry(r.path)?.pages || 0));
    return { items, missing, pauseSlides };
  }

  /** Startet die Praesentation. prep kann ein Promise sein (dann zeigt die Buehne kurz "Lade"). */
  async start(sem, mode, prepPromise) {
    this.active = true;
    this.sem = sem;
    this.mode = mode; // 'mirror' | 'dual'
    this.webLink = null;
    this.items = [];
    this.loading = true;
    this.pos = { i: 0, p: 1 };
    this.cue = null;
    this.paused = false;
    this.pauseIdx = 0;
    this.pauseSlides = [];
    this.zoom = { z: 1, x: 0.5, y: 0.5 };
    this.overlay = null;
    this.history = [];
    this.startedAt = Date.now();
    this.stageFullscreen = false;
    this.session = { id: uid(), start: Date.now(), dwell: this.store.data.settings.dwell, shown: new Map() };
    this.track = { key: null, since: Date.now() };
    this.emit('update');
    const prep = await prepPromise;
    if (!this.active) return;
    this.items = prep.items;
    this.missing = prep.missing;
    this.pauseSlides = prep.pauseSlides;
    this.loading = false;
    if (this.missing.length) this.emit('notice', `${this.missing.length} PDF${this.missing.length > 1 ? 's fehlen' : ' fehlt'} und ${this.missing.length > 1 ? 'werden' : 'wird'} übersprungen.`);
    if (!this.items.length) this.emit('notice', 'Keine PDFs verfügbar.');
    this.changed();
    // Volltext im Hintergrund vorbereiten, damit die Suche sofort Ergebnisse hat.
    for (const it of this.items) this.lib.text(it.path).catch(() => {});
  }

  stop() {
    if (!this.active) return;
    this.flushTrack(true);
    this.saveProtocol();
    clearInterval(this.pauseTimer);
    this.active = false;
    this.overlay = null;
    this.emit('stopped');
  }

  // ---------- Hilfen ----------
  item(i = this.pos.i) { return this.items[i]; }
  slideRef(pos = this.pos) { const it = this.items[pos.i]; return it ? { path: it.path, page: pos.p } : null; }
  live() {
    if (this.paused) return this.pauseSlides.length ? this.pauseSlides[this.pauseIdx % this.pauseSlides.length] : null;
    return this.slideRef();
  }
  nextPos(pos = this.pos) {
    const it = this.items[pos.i];
    if (!it) return null;
    if (pos.p < it.pages) return { i: pos.i, p: pos.p + 1 };
    if (pos.i + 1 < this.items.length) return { i: pos.i + 1, p: 1 };
    return null;
  }
  prevPos(pos = this.pos) {
    if (pos.p > 1) return { i: pos.i, p: pos.p - 1 };
    if (pos.i > 0) return { i: pos.i - 1, p: this.items[pos.i - 1].pages };
    return null;
  }
  /** Was die Vorschau zeigt: Vorgehoerte Folie oder die naechste. */
  preview() {
    if (this.cue) return { ref: this.slideRef(this.cue), cued: true, pos: this.cue };
    const n = this.nextPos();
    return { ref: n ? this.slideRef(n) : null, cued: false, pos: n };
  }
  /** Position (Index in der Gesamtfolge) fuer Anzeigen wie "Folie 14 von 60". */
  globalIndex(pos = this.pos) {
    let n = 0;
    for (let i = 0; i < pos.i; i++) n += this.items[i].pages;
    return n + pos.p;
  }
  totalSlides() { return this.items.reduce((a, it) => a + it.pages, 0); }
  samePos(a, b) { return a && b && a.i === b.i && a.p === b.p; }

  changed() {
    this.updateTrack();
    this.emit('update');
    this.prerenderNeighbors();
  }

  /** Ansichten melden hier ihre Leinwandgroessen an, damit vorab passend gerendert wird. */
  addSize(fn) { this.sizes.add(fn); return () => this.sizes.delete(fn); }

  prerenderNeighbors() {
    if (this.loading || !this.items.length) return;
    const n1 = this.nextPos();
    const around = [n1, this.prevPos(), n1 && this.nextPos(n1), this.cue].filter(Boolean);
    for (const fn of this.sizes) {
      const sz = fn();
      if (!sz || sz.w < 2) continue;
      for (const pos of around) {
        const r = this.slideRef(pos);
        if (r) this.lib.prerender(r.path, r.page, sz.w, sz.h);
      }
    }
  }

  // ---------- Navigation ----------
  go(pos, { jump = false } = {}) {
    if (!pos || !this.items[pos.i]) return;
    pos = { i: pos.i, p: clamp(pos.p, 1, this.items[pos.i].pages) };
    if (jump && !this.samePos(pos, this.pos)) {
      this.history.push(this.pos);
      if (this.history.length > MAX_HISTORY) this.history.shift();
    }
    if (jump && this.paused) { this.paused = false; clearInterval(this.pauseTimer); }
    this.pos = pos;
    this.resetZoom(false);
    if (this.samePos(this.cue, pos)) this.cue = null;
    this.changed();
  }
  next() { const n = this.nextPos(); if (n) this.go(n); }
  prev() { const p = this.prevPos(); if (p) this.go(p); }
  nextPdf() { if (this.pos.i + 1 < this.items.length) this.go({ i: this.pos.i + 1, p: 1 }, { jump: true }); }
  prevPdf() {
    if (this.pos.p > 1) this.go({ i: this.pos.i, p: 1 }, { jump: true });
    else if (this.pos.i > 0) this.go({ i: this.pos.i - 1, p: 1 }, { jump: true });
  }
  back() {
    const p = this.history.pop();
    if (!p) { this.emit('notice', 'Kein Rücksprung vorhanden.'); return; }
    this.pos = p;
    this.resetZoom(false);
    this.changed();
  }

  /** Auswahl aus Uebersicht, Suche, Filmstreifen oder "Gehe zu". Im Zwei-Bildschirm-Modus wird vorgehoert. */
  choose(pos) {
    if (this.mode === 'dual') { this.setCue(pos); }
    else this.go(pos, { jump: true });
  }
  setCue(pos) {
    if (!pos || this.samePos(pos, this.pos)) { this.cue = null; }
    else this.cue = { i: pos.i, p: clamp(pos.p, 1, this.items[pos.i].pages) };
    this.changed();
  }
  sendCue() {
    if (!this.cue) return false;
    const c = this.cue;
    this.cue = null;
    if (this.paused) this.setPause(false);
    this.go(c, { jump: true });
    return true;
  }
  clearCue() { if (this.cue) { this.cue = null; this.changed(); return true; } return false; }
  /** Vorgehoerte Folie mit Pfeiltasten verschieben (Alt + Pfeil). */
  moveCue(dir) {
    const base = this.cue || this.pos;
    const n = dir > 0 ? this.nextPos(base) : this.prevPos(base);
    if (n) this.setCue(n);
  }

  // ---------- Schnelltasten ----------
  hotkeyPos(digit) {
    const ref = this.sem.hotkeys?.[digit];
    if (!ref) return null;
    const i = this.items.findIndex((it) => it.path === ref.path);
    if (i < 0) return null;
    return { i, p: clamp(ref.page, 1, this.items[i].pages) };
  }
  hotkey(digit) {
    const ref = this.sem.hotkeys?.[digit];
    if (!ref) { this.emit('notice', `Taste ${digit} ist nicht belegt. Umschalt + ${digit} legt die aktuelle Folie darauf.`); return; }
    const pos = this.hotkeyPos(digit);
    if (!pos) { this.emit('notice', `Die Folie auf Taste ${digit} ist nicht in diesem Seminar verfügbar.`); return; }
    if (this.paused) this.setPause(false);
    this.go(pos, { jump: true });
  }
  assignHotkey(digit) {
    const ref = this.slideRef(this.cue || this.pos);
    if (!ref) return;
    this.sem.hotkeys = { ...(this.sem.hotkeys || {}), [digit]: ref };
    this.store.touch(this.sem);
    this.emit('notice', `Folie ${ref.page} aus „${fileTitle(ref.path)}“ liegt jetzt auf Taste ${digit}.`);
    this.emit('update');
  }

  // ---------- Pause ----------
  setPause(on) {
    on = !!on;
    if (on === this.paused) return;
    this.paused = on;
    clearInterval(this.pauseTimer);
    if (on) {
      this.pauseIdx = 0;
      const sec = Math.max(3, Number(this.store.data.pause.interval) || 15);
      if (this.pauseSlides.length > 1) this.pauseTimer = setInterval(() => { this.pauseIdx++; this.changed(); }, sec * 1000);
    }
    this.resetZoom(false);
    this.changed();
  }
  togglePause() { this.setPause(!this.paused); }
  stepPause(dir) {
    if (!this.pauseSlides.length) return;
    this.pauseIdx = (this.pauseIdx + dir + this.pauseSlides.length) % this.pauseSlides.length;
    this.setPause(true); // Zeitgeber neu starten
    clearInterval(this.pauseTimer);
    const sec = Math.max(3, Number(this.store.data.pause.interval) || 15);
    if (this.pauseSlides.length > 1) this.pauseTimer = setInterval(() => { this.pauseIdx++; this.changed(); }, sec * 1000);
    this.changed();
  }

  // ---------- Zoom ----------
  resetZoom(emit = true) {
    this.zoom = { z: 1, x: 0.5, y: 0.5 };
    if (emit) this.emit('update');
  }
  clampZoom(z) {
    const g = this.stageGeometry?.();
    z.z = clamp(z.z, 1, ZOOM_MAX);
    if (z.z <= 1.001) return { z: 1, x: 0.5, y: 0.5 };
    if (g) {
      const hx = g.boxW / 2 / (g.pageW * z.z); // halbe sichtbare Breite in Seitenanteilen
      const hy = g.boxH / 2 / (g.pageH * z.z);
      z.x = hx >= 0.5 ? 0.5 : clamp(z.x, hx, 1 - hx);
      z.y = hy >= 0.5 ? 0.5 : clamp(z.y, hy, 1 - hy);
    }
    return z;
  }
  /** Zoomen um einen Punkt (u, v in Seitenanteilen); dieser Punkt bleibt an seiner Stelle. */
  zoomAround(u, v, factor) {
    const z0 = this.zoom.z;
    const z1 = clamp(z0 * factor, 1, ZOOM_MAX);
    const x = u - (u - this.zoom.x) * (z0 / z1);
    const y = v - (v - this.zoom.y) * (z0 / z1);
    this.zoom = this.clampZoom({ z: z1, x, y });
    this.emit('update');
  }
  zoomBy(factor) { this.zoomAround(this.zoom.x, this.zoom.y, factor); }
  pan(du, dv) {
    if (this.zoom.z <= 1) return;
    this.zoom = this.clampZoom({ ...this.zoom, x: this.zoom.x + du, y: this.zoom.y + dv });
    this.emit('update');
  }

  // ---------- Ueberlagerungen (Uebersicht, Suche, ...) ----------
  openOverlay(type, opts = {}) {
    this.overlay = { type, ...opts };
    this.changed();
  }
  closeOverlay() {
    if (!this.overlay) return;
    this.overlay = null;
    this.changed();
  }

  // ---------- Gezeigt-Protokoll ----------
  setWebLink(name) {
    this.webLink = name;
    this.changed();
  }

  /** Welche Folie das Publikum gerade wirklich sieht (oder null). */
  visibleKey() {
    if (!this.active || this.loading || this.paused || this.webLink) return null;
    if (this.mode === 'mirror' && this.overlay && this.overlay.type !== 'help') return null;
    const r = this.slideRef();
    return r ? slideKey(r.path, r.page) : null;
  }
  updateTrack() {
    const key = this.visibleKey();
    if (key === this.track.key) return;
    this.flushTrack();
    this.track = { key, since: Date.now() };
  }
  flushTrack(final = false) {
    const { key, since } = this.track;
    if (!key) return;
    const sec = (Date.now() - since) / 1000;
    const min = Number(this.session.dwell) || 0;
    if (sec >= min) {
      const cur = this.session.shown.get(key) || { sec: 0, visits: 0 };
      cur.sec += sec;
      cur.visits += 1;
      this.session.shown.set(key, cur);
    }
    if (final) this.track = { key: null, since: Date.now() };
  }
  saveProtocol() {
    const shown = [...this.session.shown].map(([k, v]) => {
      const idx = k.lastIndexOf('#');
      return { path: k.slice(0, idx), page: Number(k.slice(idx + 1)), sec: Math.round(v.sec), visits: v.visits };
    });
    if (!shown.length) return;
    const entry = {
      id: this.session.id,
      start: this.session.start,
      end: Date.now(),
      dwell: this.session.dwell,
      shown,
      items: this.items.map((it) => ({ path: it.path, pages: it.pages })),
    };
    this.sem.protocols = [entry, ...(this.sem.protocols || [])].slice(0, MAX_PROTOCOLS);
    this.store.touch(this.sem);
  }
  /** Fuer Anzeigen: gilt diese Folie in der laufenden Sitzung schon als gezeigt? */
  shownNow(path, page) { return this.session?.shown.has(slideKey(path, page)); }

  // ---------- Tastatur ----------
  handleKey(e) {
    if (!this.active) return false;
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); this.openOverlay('search'); return true; }
      return false;
    }
    if (this.overlay && this.overlayHandler && this.overlayHandler(e)) return true;
    const k = e.key;
    const code = e.code;
    const done = () => { e.preventDefault(); return true; };

    if (this.loading) {
      if (code === 'KeyX') { this.openOverlay('confirm-end'); return done(); }
      return false;
    }
    if (/^Digit[1-9]$/.test(code) || /^Numpad[1-9]$/.test(code)) {
      const d = code.slice(-1);
      if (e.shiftKey) this.assignHotkey(d); else this.hotkey(d);
      return done();
    }
    if (this.paused) {
      if (k === 'ArrowRight' || k === 'PageDown') { this.stepPause(1); return done(); }
      if (k === 'ArrowLeft' || k === 'PageUp') { this.stepPause(-1); return done(); }
    }
    if (e.altKey && (k === 'ArrowRight' || k === 'ArrowLeft')) { this.moveCue(k === 'ArrowRight' ? 1 : -1); return done(); }
    switch (k) {
      case 'ArrowRight': case 'PageDown': case 'ArrowDown': case ' ':
        if (e.shiftKey && k === 'ArrowRight') this.nextPdf(); else this.next();
        return done();
      case 'ArrowLeft': case 'PageUp': case 'ArrowUp':
        if (e.shiftKey && k === 'ArrowLeft') this.prevPdf(); else this.prev();
        return done();
      case 'Home': this.go({ i: this.pos.i, p: 1 }, { jump: true }); return done();
      case 'End': this.go({ i: this.pos.i, p: this.item().pages }, { jump: true }); return done();
      case 'Backspace': this.back(); return done();
      case 'Enter': if (this.sendCue()) return done(); return false;
      case 'Escape':
        if (this.clearCue()) return done();
        if (this.zoom.z > 1) { this.resetZoom(); return done(); }
        return false; // Browser verlaesst ggf. das Vollbild selbst
      case '+': case '=': this.zoomBy(1.25); return done();
      case '-': case '_': this.zoomBy(0.8); return done();
      case '?': this.openOverlay('help'); return done();
    }
    switch (code) {
      case 'Digit0': case 'Numpad0': this.resetZoom(); return done();
      case 'NumpadAdd': this.zoomBy(1.25); return done();
      case 'NumpadSubtract': this.zoomBy(0.8); return done();
      case 'KeyO': this.openOverlay('overview'); return done();
      case 'KeyS': this.openOverlay('search'); return done();
      case 'KeyG': this.openOverlay('goto'); return done();
      case 'KeyP': this.togglePause(); return done();
      case 'KeyH': this.openOverlay('help'); return done();
      case 'KeyX': this.openOverlay('confirm-end'); return done();
      case 'KeyF': this.emit('fullscreen-request', e); return done();
    }
    return false;
  }
}
