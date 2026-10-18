// Startet und beendet Praesentationen: Vollbild, Bildschirmerkennung und Zusatzfenster.
//
// Gespiegelt:          Hauptfenster wird Buehne im Vollbild (Windows dupliziert das Bild).
// Zwei Bildschirme A:  Mit Erlaubnis zur Fensterverwaltung geht das Hauptfenster als Buehne
//                      ins Vollbild auf den Beamer, die Referentenansicht oeffnet sich auf dem Laptop.
//                      Liegt das Hauptfenster schon vor dem Start auf dem Beamer, bleibt es dort das
//                      einzige Praesentationsfenster: Websites oeffnen als Tabs in diesem Fenster.
// Zwei Bildschirme B:  Ohne diese Erlaubnis bleibt das Hauptfenster Referentenansicht und ein
//                      Beamerfenster oeffnet sich, das man auf den Beamer zieht.

import { StageView, PresenterView } from './views.js';
import { webUrl } from './links.js';

const POPUP_URL = new URL('../fenster.html', import.meta.url).href;
const STAGE_NAME = 'slidedesk-praesentation';
const FULLSCREEN_MSG = 'slidedesk-vollbild';
// Das Blocker-Symbol erscheint im Fenster, das oeffnen wollte; im Vollbild ist es nicht zu sehen.
const POPUP_HELP = 'Pop-ups für SlideDESK freigeben: in der Referentenansicht oder im SlideDESK-Fenster links neben der Adresse auf das Symbol klicken, „Website-Einstellungen“ öffnen und „Pop-ups und Weiterleitungen“ auf „Zulassen“ stellen.';

export class Launcher {
  constructor(app) {
    this.app = app;
    this.screens = null;
    this.screenPerm = 'unsupported';
    this.views = {};
    this.popups = {};
    this.ready = new Map();
    this.webWindows = new Map();
    this.webCount = 0;
    this.webTabs = false;
    window.addEventListener('message', (e) => {
      if (e.origin === location.origin && e.data === FULLSCREEN_MSG) this.onFullscreenDelegated();
    });
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
    this.screens.addEventListener('currentscreenchange', () => this.app.onScreensChanged?.());
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

  /**
   * Aufteilung im Zwei-Bildschirm-Modus mit Bildschirmerkennung, sonst null (Variante B).
   * 'window': dieses Fenster liegt auf dem Beamer und bleibt dort; 'move': es geht im Vollbild hinueber.
   */
  dualLayout() {
    const sd = this.screens;
    const cur = sd?.currentScreen;
    const others = sd ? sd.screens.filter((s) => s !== cur) : [];
    if (!sd || !others.length) return null;
    const laptop = others.find((s) => s.isInternal);
    if (cur && !cur.isInternal && laptop) return { kind: 'window', stage: cur, presenter: laptop };
    return { kind: 'move', stage: others.find((s) => !s.isInternal) || others[0], presenter: cur };
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
    const layout = this.dualLayout();
    if (layout) {
      // Variante A: Hauptfenster als Buehne auf dem Beamer, Referentenansicht auf dem Laptop.
      this.presentationScreen = layout.stage;
      this.webTabs = layout.kind === 'window';
      this.show.start(sem, 'dual', prepPromise);
      // Mit Bildschirmangabe verbraucht das Vollbild den Klick nicht; die Referentenansicht darf danach aufgehen.
      const stage = new StageView(document, this.show, this.lib, { fsOpts: { screen: layout.stage } });
      this.views = { stage };
      stage.goFullscreen();
      const p = layout.presenter;
      const feat = `popup=yes,left=${p.availLeft},top=${p.availTop},width=${p.availWidth},height=${p.availHeight}`;
      const pop = window.open(POPUP_URL + '#referent', 'slidedesk-referent', feat);
      if (!pop) {
        this.cleanup();
        this.show.active = false;
        return `Das Fenster für die Referentenansicht wurde blockiert. ${POPUP_HELP} Dann noch einmal starten.`;
      }
      this.popups.referent = pop;
      this.hookCommon();
      if (this.webTabs) this.watchStageTab();
      this.waitReady(pop).then((w) => {
        if (!this.show.active) return;
        // Die Groesse beim Oeffnen gilt dem Inhalt; das ganze Fenster soll in den Arbeitsbereich passen.
        try { w.moveTo(p.availLeft, p.availTop); w.resizeTo(p.availWidth, p.availHeight); } catch {}
        this.views.presenter = new PresenterView(w.document, this.show, this.lib, {
          stageNote: () => this.stageNote(), onOpenLink: (link, source) => this.openWebLink(link, source),
        });
        w.addEventListener('pagehide', () => this.onPresenterClosed());
        w.focus();
      }).catch(() => this.onPresenterClosed());
      return null;
    }
    // Variante B: Beamerfenster zum Hinueberziehen.
    this.presentationScreen = null;
    this.show.start(sem, 'dual', prepPromise);
    const presenter = new PresenterView(document, this.show, this.lib, {
      stageNote: () => this.stageNote(), onOpenLink: (link, source) => this.openWebLink(link, source),
    });
    this.views = { presenter };
    this.hookCommon();
    this.openStagePopup();
    return null;
  }

  openStagePopup() {
    const pop = window.open(POPUP_URL + '#buehne', 'slidedesk-buehne', 'popup=yes,width=1280,height=720');
    if (!pop) { this.show.emit('notice', `Das Beamerfenster wurde blockiert. ${POPUP_HELP}`); return; }
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
    if (this.show.webLink) return {
      text: `„${this.show.webLink}“ wird auf dem Präsentationsbildschirm gezeigt.`,
      action: { label: 'Zurück zu Folien', fn: () => this.returnToSlides() },
    };
    const st = this.views.stage;
    if (!st) return { text: 'Das Beamerfenster ist geschlossen.', action: { label: 'Beamerfenster öffnen', fn: () => this.openStagePopup() } };
    if (!st.isFullscreen()) {
      if (this.webTabs) return {
        text: 'Die Folien sind auf dem Beamer nicht im Vollbild.',
        action: { label: 'Vollbild', fn: () => this.returnToSlides() },
      };
      return {
        text: st.popup
          ? 'Beamerfenster auf den Beamer ziehen und dort auf „Vollbild“ klicken.'
          : 'Der Beamer zeigt kein Vollbild. Das SlideDESK-Hauptfenster anklicken und dort F drücken.',
      };
    }
    return null;
  }

  /** Webinhalt auf dem Bildschirm der PDF-Buehne zeigen: als Tab im Praesentationsfenster oder als eigenes Fenster. */
  openWebLink(link, source = window) {
    const url = webUrl(link.url);
    if (!url || !this.show.active || this.show.mode !== 'dual') return;
    if (this.webTabs) { this.openWebTab(link, url, source); return; }
    const stageWindow = this.views.stage?.doc.defaultView;
    if (!stageWindow || stageWindow.closed) {
      this.show.emit('notice', 'Bitte zuerst das Beamerfenster öffnen und auf den Präsentationsbildschirm ziehen.');
      return;
    }
    const key = link.id || url;
    const existing = this.webWindows.get(key);
    if (existing?.url === url && !existing.window.closed) {
      existing.window.focus();
      this.show.setWebLink(link.name);
      return;
    }
    // Bei manuell verschobenem Beamerfenster kommt die Bildschirmgeometrie aus diesem Fenster.
    const screen = this.presentationScreen;
    const left = Number.isFinite(screen?.availLeft) ? screen.availLeft : stageWindow.screenX;
    const top = Number.isFinite(screen?.availTop) ? screen.availTop : stageWindow.screenY;
    const width = screen?.availWidth || stageWindow.outerWidth;
    const height = screen?.availHeight || stageWindow.outerHeight;
    const features = `popup=yes,left=${left},top=${top},width=${width},height=${height}`;
    // Die Buehne ist der Oeffner: auch ohne Bildschirmerkennung liegt das neue Fenster bei ihr.
    const popup = stageWindow.open('about:blank', '_blank', features);
    if (!popup) {
      this.show.emit('notice', `Das Browserfenster wurde blockiert. ${POPUP_HELP} Dann den Link erneut anklicken.`);
      return;
    }
    try {
      popup.moveTo(left, top);
      popup.resizeTo(width, height);
      // Fremde Seiten erhalten keinen Zugriff auf das SlideDesk-Fenster.
      popup.opener = null;
      popup.location.replace(url);
      popup.focus();
    } catch {
      popup.close();
      this.show.emit('notice', 'Die Website konnte nicht auf dem Präsentationsbildschirm geöffnet werden.');
      return;
    }
    this.webWindows.set(key, { window: popup, url });
    this.show.setWebLink(link.name);
    if (this.presentationScreen && !this.tabHintShown) {
      this.tabHintShown = true;
      this.show.emit('notice', 'Tipp: Liegt das SlideDesk-Fenster schon vor dem Start auf dem Beamer, öffnen Websites dort als Tab im selben Fenster.');
    }
    this.offWebFocus?.();
    const returned = () => { if (this.show.active && this.show.webLink) this.show.setWebLink(null); };
    stageWindow.addEventListener('focus', returned);
    this.offWebFocus = () => stageWindow.removeEventListener('focus', returned);
  }

  /**
   * Website als Tab im Praesentationsfenster. Der Tab behaelt seinen Oeffner, damit ihn ein erneuter
   * Klick ueber seinen Namen ohne Neuladen nach vorn holen kann.
   */
  openWebTab(link, url, source) {
    const key = link.id || url;
    const existing = this.webWindows.get(key);
    if (existing?.url === url && !existing.window.closed) {
      // Der benannte Aufruf aus der angeklickten Referentenansicht holt den Tab nach vorn.
      const found = source.open('', existing.name);
      if (found === existing.window) { this.show.setWebLink(link.name); return; }
      try { found?.close(); } catch {}
    }
    const name = `slidedesk-web-${++this.webCount}`;
    // Ohne Fensterangaben oeffnet der Browser einen Tab im Fenster der Buehne. Ohne Pop-up-Freigabe
    // oeffnet die angeklickte Referentenansicht; der Tab landet dann im zuletzt aktiven Browserfenster.
    const tab = window.open(url, name) || (source !== window ? source.open(url, name) : null);
    if (!tab) {
      this.show.emit('notice', `Der Tab wurde blockiert. ${POPUP_HELP} Dann den Link erneut anklicken.`);
      return;
    }
    this.webWindows.set(key, { window: tab, url, name });
    this.show.setWebLink(link.name);
  }

  /** Solange der SlideDesk-Tab verdeckt ist, zeigt das Praesentationsfenster etwas anderes. */
  watchStageTab() {
    this.prevName = window.name;
    window.name = STAGE_NAME;
    const onVisibility = () => {
      if (!this.show.active) return;
      if (document.hidden) { if (!this.show.webLink) this.show.setWebLink('Anderer Browser-Tab'); }
      else if (this.show.webLink) this.show.setWebLink(null);
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.offStageTab = () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.name = this.prevName;
    };
  }

  /** Vollbild-Erlaubnis aus einem Klick in der Referentenansicht; wartet, bis der Tab sichtbar ist. */
  onFullscreenDelegated() {
    const stage = this.views.stage;
    if (!this.show.active || stage?.doc !== document) return;
    if (!document.hidden) { stage.goFullscreen(); return; }
    const done = () => { clearTimeout(timer); document.removeEventListener('visibilitychange', done); stage.goFullscreen(); };
    const timer = setTimeout(done, 1500);
    document.addEventListener('visibilitychange', done);
  }

  returnToSlides() {
    const stage = this.views.stage;
    if (!stage) { this.show.setWebLink(null); this.openStagePopup(); return; }
    if (this.webTabs) {
      // Nur die angeklickte Referentenansicht darf den SlideDesk-Tab nach vorn holen und das Vollbild uebergeben.
      const presenter = this.views.presenter?.doc.defaultView;
      if (presenter && !presenter.closed) {
        presenter.open('', STAGE_NAME);
        presenter.__slidedeskFullscreen?.(window);
      }
      // Bleibt der Tab verdeckt, setzt der Sichtbarkeitswechsel die Rueckkehr spaeter.
      if (!document.hidden) this.show.setWebLink(null);
      return;
    }
    stage.doc.defaultView.focus();
    this.show.setWebLink(null);
    stage.goFullscreen();
  }

  onPresenterClosed() {
    if (!this.show.active || !this.views.presenter && !this.popups.referent) return;
    try { this.views.presenter?.destroy(); } catch {}
    if (this.show.webLink) this.returnToSlides();
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
      else if (this.webTabs) this.returnToSlides();
      else this.show.emit('notice', 'Vollbild für den Beamer: das Beamer- bzw. Hauptfenster anklicken und dort F drücken.');
    });
  }

  cleanup() {
    this.offWebFocus?.(); this.offWebFocus = null;
    this.offStageTab?.(); this.offStageTab = null;
    this.webTabs = false;
    this.presentationScreen = null;
    // Websites offen lassen, damit dort bearbeitete Inhalte erhalten bleiben.
    this.webWindows.clear();
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
