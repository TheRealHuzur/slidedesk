// Startet und beendet Praesentationen: Vollbild, Bildschirmerkennung und Zusatzfenster.
//
// Gespiegelt:          Hauptfenster wird Buehne im Vollbild (Windows dupliziert das Bild).
// Zwei Bildschirme A:  Mit Erlaubnis zur Fensterverwaltung geht das Hauptfenster als Buehne
//                      ins Vollbild auf den Beamer, die Referentenansicht oeffnet sich auf dem Laptop.
// Zwei Bildschirme B:  Ohne diese Erlaubnis bleibt das Hauptfenster Referentenansicht und ein
//                      Beamerfenster oeffnet sich, das man auf den Beamer zieht.

import { StageView, PresenterView } from './views.js';

const POPUP_URL = new URL('../fenster.html', import.meta.url).href;

export class Launcher {
  constructor(app) {
    this.app = app;
    this.screens = null;
    this.screenPerm = 'unsupported';
    this.views = {};
    this.popups = {};
    this.ready = new Map();
    window.__slidedeskReady = (w) => {
      for (const [win, res] of this.ready) if (win === w) { this.ready.delete(win); res(w); }
    };
    window.addEventListener('pagehide', () => { for (const p of Object.values(this.popups)) try { p.close(); } catch {} });
  }

  get show() { return this.app.show; }
  get lib() { return this.app.lib; }

  async initScreens() {
    if (!('getScreenDetails' in window)) return;
    try {
      const st = await navigator.permissions.query({ name: 'window-management' });
      this.screenPerm = st.state;
      st.onchange = () => { this.screenPerm = st.state; if (st.state === 'granted') this.loadScreens(); this.app.onScreensChanged?.(); };
      if (st.state === 'granted') await this.loadScreens();
    } catch { this.screenPerm = 'unsupported'; }
  }

  async loadScreens() {
    this.screens = await window.getScreenDetails();
    this.screenPerm = 'granted';
    this.screens.addEventListener('screenschange', () => this.app.onScreensChanged?.());
    this.app.onScreensChanged?.();
    return this.screens;
  }

  /** Muss aus einer Nutzeraktion kommen (Erlaubnisabfrage des Browsers). */
  async requestScreens() {
    if (!('getScreenDetails' in window)) return null;
    try { return await this.loadScreens(); } catch (e) { this.screenPerm = 'denied'; return null; }
  }

  screenSummary() {
    if (!('getScreenDetails' in window)) return { known: false, text: 'Dieser Browser kann Bildschirme nicht erkennen.' };
    if (!this.screens) return { known: false, text: this.screenPerm === 'denied' ? 'Bildschirmerkennung wurde abgelehnt.' : 'Bildschirme noch nicht geprüft.' };
    const list = this.screens.screens;
    return {
      known: true,
      count: list.length,
      text: `${list.length} Bildschirm${list.length === 1 ? '' : 'e'} erkannt: ` +
        list.map((s) => `${s.label || (s.isInternal ? 'Laptop' : 'Bildschirm')} ${s.width}×${s.height}`).join(', '),
    };
  }

  waitReady(win) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.ready.delete(win); rej(new Error('Fenster antwortet nicht')); }, 15000);
      this.ready.set(win, (w) => { clearTimeout(t); res(w); });
    });
  }

  /**
   * Startet die Praesentation. Muss synchron im Klick-Handler aufgerufen werden,
   * damit Vollbild und Zusatzfenster erlaubt sind.
   * Rueckgabe: null bei Erfolg, sonst ein Hinweis fuer die Verwaltung.
   */
  start(sem, mode, prepPromise) {
    if (this.show.active) return 'Es läuft bereits eine Präsentation.';
    if (mode === 'dual') return this.startDual(sem, prepPromise);
    this.show.start(sem, 'mirror', prepPromise);
    const stage = new StageView(document, this.show, this.lib, { overlays: true, notices: true });
    this.views = { stage };
    stage.goFullscreen();
    this.hookCommon();
    return null;
  }

  startDual(sem, prepPromise) {
    const sd = this.screens;
    const cur = sd?.currentScreen;
    const others = sd ? sd.screens.filter((s) => s !== cur) : [];
    if (sd && others.length) {
      // Variante A: Hauptfenster als Buehne auf den Beamer, Referentenansicht auf den Laptop.
      const beamer = others.find((s) => !s.isInternal) || others[0];
      this.show.start(sem, 'dual', prepPromise);
      const stage = new StageView(document, this.show, this.lib, { fsOpts: { screen: beamer } });
      this.views = { stage };
      stage.goFullscreen();
      const feat = `popup=yes,left=${cur.availLeft},top=${cur.availTop},width=${cur.availWidth},height=${cur.availHeight}`;
      const pop = window.open(POPUP_URL + '#referent', 'slidedesk-referent', feat);
      if (!pop) {
        this.cleanup();
        this.show.active = false;
        return 'Das Fenster für die Referentenansicht wurde blockiert. Bitte Pop-ups für SlideDESK erlauben (Symbol rechts in der Adressleiste) und noch einmal starten.';
      }
      this.popups.referent = pop;
      this.hookCommon();
      this.waitReady(pop).then((w) => {
        if (!this.show.active) return;
        this.views.presenter = new PresenterView(w.document, this.show, this.lib, { stageNote: () => this.stageNote() });
        w.addEventListener('pagehide', () => this.onPresenterClosed());
        w.focus();
      }).catch(() => this.onPresenterClosed());
      return null;
    }
    // Variante B: Beamerfenster zum Hinueberziehen.
    this.show.start(sem, 'dual', prepPromise);
    const presenter = new PresenterView(document, this.show, this.lib, { stageNote: () => this.stageNote() });
    this.views = { presenter };
    this.hookCommon();
    this.openStagePopup();
    return null;
  }

  openStagePopup() {
    const pop = window.open(POPUP_URL + '#buehne', 'slidedesk-buehne', 'popup=yes,width=1280,height=720');
    if (!pop) { this.show.emit('notice', 'Beamerfenster blockiert. Bitte Pop-ups für SlideDESK erlauben.'); return; }
    this.popups.buehne = pop;
    this.waitReady(pop).then((w) => {
      if (!this.show.active) return;
      this.views.stage?.destroy();
      this.views.stage = new StageView(w.document, this.show, this.lib, { popup: true });
      w.addEventListener('pagehide', () => {
        if (!this.show.active || this.popups.buehne !== pop) return;
        this.views.stage?.destroy();
        this.views.stage = null;
        this.popups.buehne = null;
        this.show.emit('update');
      });
      this.show.emit('update');
    }).catch(() => {});
  }

  /** Hinweis in der Referentenansicht, wenn der Beamer nicht sauber im Vollbild ist. */
  stageNote() {
    const st = this.views.stage;
    if (!st) return { text: 'Das Beamerfenster ist geschlossen.', action: { label: 'Beamerfenster öffnen', fn: () => this.openStagePopup() } };
    if (!st.isFullscreen()) {
      return {
        text: st.popup
          ? 'Beamerfenster auf den Beamer ziehen und dort auf „Vollbild“ klicken.'
          : 'Der Beamer zeigt kein Vollbild. Das SlideDESK-Hauptfenster anklicken und dort F drücken.',
      };
    }
    return null;
  }

  onPresenterClosed() {
    if (!this.show.active || !this.views.presenter && !this.popups.referent) return;
    try { this.views.presenter?.destroy(); } catch {}
    this.views.presenter = null;
    this.popups.referent = null;
    // Ohne Referentenansicht weiter wie im gespiegelten Modus.
    this.show.mode = 'mirror';
    this.show.cue = null;
    this.views.stage?.enableOverlays();
    this.views.stage?.enableNotices();
    this.show.emit('notice', 'Referentenansicht geschlossen. Steuerung jetzt direkt auf dem Beamerbild.');
    this.show.emit('update');
  }

  hookCommon() {
    this.offStop?.();
    this.offFs?.();
    this.offStop = this.show.on('stopped', () => this.cleanup());
    this.offFs = this.show.on('fullscreen-request', (e) => {
      const st = this.views.stage;
      if (!st) return;
      const fromStage = e?.view === st.doc.defaultView || e?.target?.ownerDocument === st.doc;
      if (fromStage) st.goFullscreen();
      else this.show.emit('notice', 'Vollbild für den Beamer: das Beamer- bzw. Hauptfenster anklicken und dort F drücken.');
    });
  }

  cleanup() {
    this.offStop?.(); this.offStop = null;
    this.offFs?.(); this.offFs = null;
    for (const v of Object.values(this.views)) try { v?.destroy(); } catch (e) { console.warn(e); }
    this.views = {};
    for (const p of Object.values(this.popups)) try { p?.close(); } catch {}
    this.popups = {};
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.app.onStopped?.();
  }
}
