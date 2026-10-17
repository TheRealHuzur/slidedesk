// Ansichten der laufenden Praesentation: Buehne (Beamer) und Referentenansicht (Laptop).
// Beide lassen sich in ein beliebiges Fenster einhaengen (Hauptfenster oder Zusatzfenster).

import { h, debounce, fmtDuration, fileTitle, toast } from './util.js';
import { OverlayManager } from './overlays.js';
import { linksPanel } from './links.js';

const Z1 = { z: 1, x: 0.5, y: 0.5 };
const sameZoom = (a, b) => a && b && Math.abs(a.z - b.z) < 1e-4 && Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4;

/** Eine Leinwand, die eine Folie eingepasst zeigt und scharf nachzoomt. */
export class SlideCanvas {
  constructor(doc, lib, { bg = '#000', interactive = null, cls = '' } = {}) {
    this.doc = doc;
    this.lib = lib;
    this.bg = bg;
    this.el = h(doc, 'div.slide-box' + (cls ? '.' + cls : ''));
    this.canvas = h(doc, 'canvas.slide-canvas');
    this.el.append(this.canvas);
    this.ref = null;
    this.zoom = { ...Z1 };
    this.rendered = null;
    this.seq = 0;
    this.crisp = debounce(() => this.renderNow(), 150);
    const W = doc.defaultView;
    this.ro = new W.ResizeObserver(debounce(() => { this.rendered = null; this.renderNow(); }, 60));
    this.ro.observe(this.el);
    if (interactive) this.bindInteraction(interactive);
  }

  destroy() { this.ro.disconnect(); this.seq++; }

  box() {
    const r = this.el.getBoundingClientRect();
    return { w: r.width, h: r.height, dpr: this.doc.defaultView.devicePixelRatio || 1 };
  }
  devSize() { const b = this.box(); return { w: Math.round(b.w * b.dpr), h: Math.round(b.h * b.dpr) }; }

  /** Seitengeometrie in CSS-Pixeln bei Zoom 1. */
  geometry() {
    if (!this.ref) return null;
    const s = this.lib.size(this.ref.path, this.ref.page);
    const b = this.box();
    if (!s || b.w < 2) return null;
    const fit = Math.min(b.w / s.w, b.h / s.h);
    return { boxW: b.w, boxH: b.h, pageW: s.w * fit, pageH: s.h * fit };
  }

  show(ref, zoom = Z1) {
    const same = ref && this.ref && ref.path === this.ref.path && ref.page === this.ref.page;
    this.ref = ref ? { path: ref.path, page: ref.page } : null;
    this.zoom = { ...zoom };
    if (!ref) {
      this.seq++;
      this.rendered = null;
      const c = this.canvas;
      c.getContext('2d').clearRect(0, 0, c.width, c.height);
      c.style.transform = '';
      this.el.classList.add('empty');
      return;
    }
    this.el.classList.remove('empty');
    if (same && this.rendered) {
      if (sameZoom(this.rendered, zoom)) return;
      this.applyTransform();
      this.crisp();
      return;
    }
    this.renderNow();
  }

  applyTransform() {
    const g = this.geometry();
    const r = this.rendered;
    if (!g || !r) return;
    const t = this.zoom;
    const a = t.z / r.z;
    const bx = (g.boxW / 2) * (1 - a) + g.pageW * t.z * (r.x - t.x);
    const by = (g.boxH / 2) * (1 - a) + g.pageH * t.z * (r.y - t.y);
    this.canvas.style.transformOrigin = '0 0';
    this.canvas.style.transform = `translate(${bx}px, ${by}px) scale(${a})`;
  }

  async renderNow() {
    const seq = ++this.seq;
    const ref = this.ref;
    const zoom = { ...this.zoom };
    if (!ref) return;
    const b = this.box();
    if (b.w < 2 || b.h < 2) return;
    const W = Math.round(b.w * b.dpr);
    const H = Math.round(b.h * b.dpr);
    try {
      if (zoom.z <= 1.0001) {
        const frame = await this.lib.frame(ref.path, ref.page, W, H);
        if (seq !== this.seq) return;
        const c = this.canvas;
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.fillStyle = this.bg;
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(frame, Math.round((W - frame.width) / 2), Math.round((H - frame.height) / 2));
      } else {
        const self = this;
        const ok = await this.lib.renderZoomed(this.canvas, ref.path, ref.page, b.w, b.h, b.dpr, zoom, { get cancelled() { return seq !== self.seq; } }, this.bg);
        if (!ok || seq !== this.seq) return;
      }
      this.rendered = { ...ref, ...zoom };
      this.canvas.style.transform = '';
      this.el.classList.remove('error');
      if (!sameZoom(this.rendered, this.zoom)) { this.applyTransform(); this.crisp(); }
      this.onRendered?.();
    } catch (e) {
      if (seq !== this.seq) return;
      console.error(e);
      this.el.classList.add('error');
    }
  }

  pointToPage(clientX, clientY) {
    const g = this.geometry();
    if (!g) return null;
    const r = this.el.getBoundingClientRect();
    const mx = clientX - r.left - g.boxW / 2;
    const my = clientY - r.top - g.boxH / 2;
    return { u: this.zoom.x + mx / (g.pageW * this.zoom.z), v: this.zoom.y + my / (g.pageH * this.zoom.z) };
  }

  bindInteraction({ onZoom, onPan }) {
    const el = this.el;
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this.pointToPage(e.clientX, e.clientY);
      if (!p) return;
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
      onZoom(p.u, p.v, f);
    }, { passive: false });
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.zoom.z <= 1) return;
      drag = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const g = this.geometry();
      if (!g) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      onPan(-dx / (g.pageW * this.zoom.z), -dy / (g.pageH * this.zoom.z));
    });
    const end = () => { drag = null; el.classList.remove('dragging'); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => onZoom(0.5, 0.5, 0)); // doppelklick setzt zurueck
  }
}

function keyHandler(show) {
  return (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !show.overlay) return;
    show.handleKey(e);
  };
}

/** Die Buehne: nur die Folie, schwarz, kein Mauszeiger. */
export class StageView {
  constructor(doc, show, lib, { popup = false, overlays = false, notices = false, fsOpts = null } = {}) {
    this.fsOpts = fsOpts;
    this.doc = doc;
    this.show = show;
    this.lib = lib;
    this.popup = popup;
    const zoomCb = {
      onZoom: (u, v, f) => (f === 0 ? show.resetZoom() : show.zoomAround(u, v, f)),
      onPan: (du, dv) => show.pan(du, dv),
    };
    this.slide = new SlideCanvas(doc, lib, { bg: '#000', interactive: zoomCb, cls: 'stage-slide' });
    this.loadingEl = h(doc, 'div.stage-loading', h(doc, 'span.sd-logo', 'Slide', h(doc, 'b', 'DESK')), h(doc, 'span', 'Folien werden geladen'));
    this.hint = h(doc, 'div.stage-hint',
      h(doc, 'div.stage-hint-box',
        h(doc, 'strong', 'Beamerfenster'),
        h(doc, 'p', 'Dieses Fenster auf den Beamer ziehen und dann hier klicken oder F drücken.'),
        h(doc, 'button.btn.primary', { onclick: () => this.goFullscreen() }, 'Vollbild')));
    this.cornerHint = h(doc, 'div.stage-corner', 'F: Vollbild');
    this.root = h(doc, 'div.stage', this.slide.el, this.loadingEl, this.hint, this.cornerHint);
    this.root.addEventListener('click', (e) => {
      if (!this.isFullscreen() && !this.popup && !e.target.closest('.overlay-host')) this.goFullscreen();
    });
    this.overlayHost = h(doc, 'div.overlay-host.dark');
    this.root.append(this.overlayHost);
    doc.body.append(this.root);
    doc.body.classList.add('presenting', 'stage-doc');

    this.onKey = keyHandler(show);
    doc.addEventListener('keydown', this.onKey);
    this.onFs = () => this.show.emit('update');
    doc.addEventListener('fullscreenchange', this.onFs);

    // Mauszeiger nach kurzer Ruhe ausblenden
    let t;
    this.onMove = () => {
      this.root.classList.remove('nocursor');
      clearTimeout(t);
      t = setTimeout(() => this.root.classList.add('nocursor'), 1500);
    };
    this.root.addEventListener('pointermove', this.onMove);
    this.onMove();

    this.off = show.on('update', () => this.update());
    this.offSize = show.addSize(() => this.slide.devSize());
    show.stageGeometry = () => this.slide.geometry();
    if (notices) this.enableNotices();
    if (overlays) this.overlays = new OverlayManager(doc, this.overlayHost, show, lib);
    this.update();
  }

  isFullscreen() { return !!this.doc.fullscreenElement; }

  /** Wird gebraucht, wenn keine Referentenansicht (mehr) da ist. */
  enableOverlays() {
    if (!this.overlays) this.overlays = new OverlayManager(this.doc, this.overlayHost, this.show, this.lib);
  }
  enableNotices() {
    if (!this.offNote) this.offNote = this.show.on('notice', (t) => toast(this.doc, t, 3200));
  }

  goFullscreen(opts = this.fsOpts) {
    if (this.isFullscreen()) return Promise.resolve();
    return this.doc.documentElement.requestFullscreen(opts || undefined).catch((e) => console.warn('Vollbild nicht möglich', e));
  }

  update() {
    const s = this.show;
    if (!s.active) return;
    this.root.classList.toggle('is-loading', !!s.loading);
    this.root.classList.toggle('paused', !!s.paused);
    const fs = this.isFullscreen();
    s.stageFullscreen = fs;
    this.hint.hidden = fs || !(this.popup || s.mode === 'dual');
    this.cornerHint.hidden = fs || this.popup || s.mode === 'dual';
    this.slide.show(s.loading ? null : s.live(), s.paused ? Z1 : s.zoom);
  }

  destroy() {
    this.off();
    this.offSize();
    this.offNote?.();
    this.overlays?.destroy();
    this.slide.destroy();
    this.doc.removeEventListener('keydown', this.onKey);
    this.doc.removeEventListener('fullscreenchange', this.onFs);
    this.root.remove();
    this.doc.body.classList.remove('presenting', 'stage-doc');
  }
}

/** Referentenansicht fuer den Laptop im Zwei-Bildschirm-Modus. */
export class PresenterView {
  constructor(doc, show, lib, { onEnd, stageNote } = {}) {
    this.doc = doc;
    this.show = show;
    this.lib = lib;
    this.stageNote = stageNote;
    const zoomCb = {
      onZoom: (u, v, f) => (f === 0 ? show.resetZoom() : show.zoomAround(u, v, f)),
      onPan: (du, dv) => show.pan(du, dv),
    };
    const bg = getComputedStyle(doc.documentElement).getPropertyValue('--panel').trim() || '#111827';
    this.live = new SlideCanvas(doc, lib, { bg, interactive: zoomCb, cls: 'pv-live' });
    this.preview = new SlideCanvas(doc, lib, { bg, cls: 'pv-preview' });
    this.preview.el.addEventListener('click', () => show.sendCue());

    const btn = (label, key, fn, title) => h(doc, 'button.btn.ghost', { onclick: fn, title }, label, key ? h(doc, 'kbd', key) : null);
    this.clock = h(doc, 'span.pv-clock');
    this.elapsed = h(doc, 'span.pv-elapsed');
    this.badge = h(doc, 'span.pv-badge');
    this.pauseBadge = h(doc, 'span.pv-badge.pause', 'PAUSE');
    this.liveInfo = h(doc, 'div.pv-info');
    this.prevLabel = h(doc, 'div.pv-label');
    this.prevInfo = h(doc, 'div.pv-info');
    this.stageWarn = h(doc, 'div.pv-warn');
    this.hotkeysEl = h(doc, 'div.pv-hotkeys');
    this.strip = h(doc, 'div.pv-strip');
    this.overlayHost = h(doc, 'div.overlay-host');

    this.root = h(doc, 'div.presenter',
      h(doc, 'header.pv-head',
        h(doc, 'span.sd-logo', 'Slide', h(doc, 'b', 'DESK')),
        h(doc, 'span.pv-title', show.sem.name),
        this.badge, this.pauseBadge,
        h(doc, 'span.spacer'),
        this.elapsed, this.clock,
        btn('Hilfe', 'H', () => show.openOverlay('help')),
        h(doc, 'button.btn.danger', { onclick: () => show.openOverlay('confirm-end') }, 'Beenden', h(doc, 'kbd', 'X'))),
      this.stageWarn,
      h(doc, 'main.pv-main',
        h(doc, 'section.pv-col.pv-col-live',
          h(doc, 'div.pv-label.live', h(doc, 'span.dot'), 'Auf dem Beamer'),
          this.live.el,
          this.liveInfo),
        h(doc, 'section.pv-col.pv-col-next',
          this.prevLabel,
          this.preview.el,
          this.prevInfo,
          h(doc, 'div.pv-tools',
            btn('Übersicht', 'O', () => show.openOverlay('overview')),
            btn('Suche', 'S', () => show.openOverlay('search')),
            btn('Gehe zu', 'G', () => show.openOverlay('goto')),
            btn('Pause', 'P', () => show.togglePause()),
            btn('Zurück', '⌫', () => show.back(), 'Zurück zur Stelle vor dem letzten Sprung')),
          this.hotkeysEl,
          linksPanel(doc, show.sem, () => show.store.touch(show.sem)))),
      this.strip,
      this.overlayHost);
    doc.body.append(this.root);
    doc.body.classList.add('presenting', 'presenter-doc');

    this.onKey = keyHandler(show);
    doc.addEventListener('keydown', this.onKey);
    this.off = show.on('update', () => this.update());
    this.offNote = show.on('notice', (t) => toast(doc, t, 3200));
    this.offSizes = [show.addSize(() => this.live.devSize()), show.addSize(() => this.preview.devSize())];
    this.overlays = new OverlayManager(doc, this.overlayHost, show, lib);
    this.tick = setInterval(() => this.updateClock(), 1000);
    this.stripFor = null;
    this.thumbIO = new doc.defaultView.IntersectionObserver((ents) => {
      for (const en of ents) {
        if (!en.isIntersecting) continue;
        const img = en.target;
        this.thumbIO.unobserve(img);
        lib.thumb(img.dataset.path, Number(img.dataset.page)).then((u) => { img.src = u; }).catch(() => {});
      }
    }, { root: this.strip, rootMargin: '0px 400px' });
    this.update();
    this.updateClock();
  }

  updateClock() {
    const now = new Date();
    this.clock.textContent = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    this.elapsed.textContent = fmtDuration((Date.now() - this.show.startedAt) / 1000);
  }

  update() {
    const s = this.show;
    const d = this.doc;
    if (!s.active) return;
    this.badge.textContent = 'Zwei Bildschirme';
    this.pauseBadge.hidden = !s.paused;
    this.root.classList.toggle('paused', !!s.paused);
    const note = this.stageNote?.();
    this.stageWarn.replaceChildren();
    if (note) {
      this.stageWarn.append(note.text);
      if (note.action) this.stageWarn.append(h(d, 'button.btn.small', { onclick: note.action.fn }, note.action.label));
    }
    this.stageWarn.hidden = !note;
    if (s.loading) {
      this.liveInfo.textContent = 'Folien werden geladen';
      return;
    }
    this.live.show(s.live(), s.paused ? Z1 : s.zoom);
    const it = s.item();
    if (s.paused) {
      const n = s.pauseSlides.length;
      this.liveInfo.textContent = n ? `Pausenfolie ${(s.pauseIdx % n) + 1} von ${n} · P beendet die Pause` : 'Pause: schwarzer Bildschirm · P beendet die Pause';
    } else if (it) {
      this.liveInfo.textContent = `${it.title} · Folie ${s.pos.p} von ${it.pages} · gesamt ${s.globalIndex()} von ${s.totalSlides()}${s.zoom.z > 1 ? ` · Zoom ${Math.round(s.zoom.z * 100)} %` : ''}`;
    }
    const pv = s.preview();
    this.preview.show(pv.ref);
    this.preview.el.classList.toggle('cued', pv.cued);
    this.prevLabel.className = 'pv-label' + (pv.cued ? ' cued' : '');
    this.prevLabel.replaceChildren(pv.cued ? 'Vorgehört: Enter zeigt sie, Esc verwirft' : 'Nächste Folie');
    if (pv.ref) {
      const pit = s.items[pv.pos.i];
      this.prevInfo.textContent = `${pit.title} · Folie ${pv.pos.p} von ${pit.pages}`;
    } else this.prevInfo.textContent = 'Ende des Seminars';

    // Schnelltasten
    const hk = s.sem.hotkeys || {};
    this.hotkeysEl.replaceChildren(
      h(d, 'div.pv-hk-head', 'Schnelltasten', h(d, 'small', 'Umschalt + Ziffer belegt')),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
        const r = hk[n];
        return h(d, 'button.pv-hk' + (r ? '' : '.free'), { onclick: () => r && s.hotkey(String(n)), disabled: !r },
          h(d, 'kbd', String(n)), r ? `${fileTitle(r.path)} · ${r.page}` : 'frei');
      }));

    this.updateStrip();
  }

  updateStrip() {
    const s = this.show;
    const d = this.doc;
    const it = s.item();
    if (!it) return;
    if (this.stripFor !== it.path) {
      this.stripFor = it.path;
      const cells = [];
      for (let p = 1; p <= it.pages; p++) {
        const img = h(d, 'img', { alt: '', dataset: { path: it.path, page: p } });
        this.thumbIO.observe(img);
        cells.push(h(d, 'button.pv-thumb', { dataset: { p }, onclick: () => s.choose({ i: s.pos.i, p }) }, img, h(d, 'span', String(p))));
      }
      this.strip.replaceChildren(h(d, 'div.pv-strip-title', it.title), ...cells);
    }
    for (const c of this.strip.querySelectorAll('.pv-thumb')) {
      const p = Number(c.dataset.p);
      c.classList.toggle('current', p === s.pos.p && !s.paused);
      c.classList.toggle('cued', !!s.cue && s.cue.i === s.pos.i && s.cue.p === p);
      c.classList.toggle('shown', s.shownNow(it.path, p));
    }
    const cur = this.strip.querySelector('.pv-thumb.current');
    if (cur && this.lastScrolled !== s.pos.p) {
      this.lastScrolled = s.pos.p;
      cur.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  }

  destroy() {
    clearInterval(this.tick);
    this.off(); this.offNote();
    this.offSizes.forEach((f) => f());
    this.overlays.destroy();
    this.thumbIO.disconnect();
    this.live.destroy(); this.preview.destroy();
    this.doc.removeEventListener('keydown', this.onKey);
    this.root.remove();
    this.doc.body.classList.remove('presenting', 'presenter-doc');
  }
}
