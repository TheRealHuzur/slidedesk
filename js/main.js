// SlideDESK Verwaltung: Ablage freigeben, Seminare pflegen, Praesentation starten.

import { h, toast, fmtDate, fmtDuration, fileTitle, slideKey, debounce } from './util.js';
import {
  Store, newSeminar, storedRoot, permissionState, requestPermission, pickRoot, fsSupported, isDemo,
  relPath, listDir, findPdfs,
} from './store.js';
import { PdfLibrary } from './pdfs.js';
import { Show } from './show.js';
import { Launcher } from './present.js';
import { linksPanel } from './links.js';

const d = document;
const $app = d.getElementById('app');
const VERSION = '1.1.0';

// ---------- Theme ----------
function getTheme() { try { return localStorage.getItem('sd-theme') || 'dark'; } catch { return 'dark'; } }
function setTheme(t) {
  d.documentElement.dataset.theme = t;
  try { localStorage.setItem('sd-theme', t); } catch {}
}
setTheme(getTheme());

// ---------- Kleine Bausteine ----------
const btn = (label, onclick, cls = '', attrs = {}) => h(d, 'button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { onclick, type: 'button', ...attrs }, label);

function modal(title, body, { wide = false, onClose } = {}) {
  const box = h(d, 'div.modal' + (wide ? '.wide' : ''), h(d, 'div.modal-head', h(d, 'strong', title), btn('×', () => close(), 'icon ghost', { title: 'Schließen' })), body);
  const back = h(d, 'div.modal-back', box);
  const close = () => { back.remove(); d.removeEventListener('keydown', onKey, true); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  d.addEventListener('keydown', onKey, true);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  d.body.append(back);
  return { close, box };
}

function confirmBox(title, text, okLabel = 'OK', cls = 'primary') {
  return new Promise((res) => {
    let done = false;
    const m = modal(title, h(d, 'div.modal-body', h(d, 'p', text),
      h(d, 'div.modal-actions', btn('Abbrechen', () => m.close(), 'ghost'), btn(okLabel, () => { done = true; m.close(); res(true); }, cls))),
    { onClose: () => { if (!done) res(false); } });
    m.box.querySelector('.modal-actions .btn:last-child').focus();
  });
}

/** Miniaturen erst laden, wenn sie sichtbar werden. */
const thumbIO = new IntersectionObserver((ents) => {
  for (const en of ents) {
    if (!en.isIntersecting) continue;
    const img = en.target;
    thumbIO.unobserve(img);
    app.lib?.thumb(img.dataset.path, Number(img.dataset.page)).then((u) => { img.src = u; img.classList.add('ok'); }).catch(() => img.classList.add('broken'));
  }
}, { rootMargin: '200px' });

function thumb(path, page, cls = '') {
  const img = h(d, 'img.thumb' + (cls ? '.' + cls : ''), { alt: '', dataset: { path, page }, draggable: false });
  thumbIO.observe(img);
  return img;
}

function logo() { return h(d, 'span.sd-logo', 'Slide', h(d, 'b', 'DESK')); }

// ---------- App ----------
class App {
  constructor() {
    this.view = { type: 'home' };
    this.checks = new Map(); // path -> Promise<entry>
  }

  async boot() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker', e));
    }
    if (!fsSupported() && !isDemo()) return this.renderUnsupported();
    const root = await storedRoot();
    if (!root) return this.renderWelcome();
    const perm = await permissionState(root).catch(() => 'prompt');
    if (perm === 'granted') return this.open(root);
    this.renderReconnect(root);
  }

  // ----- Startbildschirme -----
  renderShellless(...content) {
    $app.replaceChildren(h(d, 'div.welcome', h(d, 'div.welcome-box', h(d, 'div.welcome-logo', logo()), ...content)));
  }

  renderUnsupported() {
    this.renderShellless(
      h(d, 'h1', 'Bitte Edge oder Chrome verwenden'),
      h(d, 'p', 'SlideDESK braucht Zugriff auf deine lokalen Ordner. Das können unter Windows Microsoft Edge und Google Chrome.'));
  }

  renderWelcome(err) {
    this.renderShellless(
      h(d, 'h1', 'PDFs präsentieren, wie sie in deiner Ablage liegen'),
      h(d, 'p', 'Gib SlideDESK einmal den Oberordner frei, in dem deine Seminarunterlagen liegen, zum Beispiel „Operatives Geschäft“ in deinem Google Drive. Alle Unterordner bleiben, wie sie sind.'),
      h(d, 'p.muted', 'SlideDESK legt darin einen kleinen Ordner „SlideDESK“ mit einer Speicherdatei für Seminare und Einstellungen an. PDFs werden nur gelesen, nie verändert.'),
      err ? h(d, 'p.error', err) : null,
      h(d, 'div.welcome-actions', btn('Ablage freigeben', () => this.choose(), 'primary big'),
        h(d, 'a.btn.big.ghost', { href: 'hilfe.html', target: '_blank', rel: 'noopener' }, 'Anleitung lesen')));
  }

  renderReconnect(root) {
    this.renderShellless(
      h(d, 'h1', 'Willkommen zurück'),
      h(d, 'p', `Bitte den Zugriff auf deine Ablage „${root.name}“ bestätigen.`),
      h(d, 'p.muted', 'Tipp: Wenn der Browser „Bei jedem Besuch zulassen“ anbietet, entfällt dieser Schritt künftig.'),
      h(d, 'div.welcome-actions',
        btn('Zugriff bestätigen', async () => {
          const p = await requestPermission(root).catch(() => 'denied');
          if (p === 'granted') this.open(root); else this.renderReconnect(root);
        }, 'primary big'),
        btn('Andere Ablage wählen', () => this.choose(), 'ghost')));
  }

  async choose() {
    try {
      const root = await pickRoot();
      await this.open(root);
    } catch (e) {
      if (e.name !== 'AbortError') this.renderWelcome('Die Ablage konnte nicht geöffnet werden: ' + e.message);
    }
  }

  async open(root) {
    this.root = root;
    this.store = new Store(root);
    this.store.onError = (e) => toast(d, 'Speichern fehlgeschlagen: ' + e.message, 5000);
    try { await this.store.load(); } catch (e) {
      return this.renderWelcome('Die Speicherdatei konnte nicht gelesen werden: ' + e.message);
    }
    this.lib = new PdfLibrary(root);
    this.show = new Show({ store: this.store, lib: this.lib });
    this.launcher = new Launcher(this);
    this.launcher.initScreens().then(() => this.refreshStartBox());
    this.checks.clear();
    const s = this.store.data.seminars;
    this.view = s.length ? { type: 'seminar', id: this.store.data.settings.lastSeminar && this.store.seminar(this.store.data.settings.lastSeminar) ? this.store.data.settings.lastSeminar : s[0].id } : { type: 'home' };
    this.renderShell();
    if (this.store.loadWarning) toast(d, this.store.loadWarning, 6000);
    window.addEventListener('focus', () => this.checkExternal());
    window.app = this; // fuer Tests und Fehlersuche
  }

  /** Daten neu laden, wenn ein anderes Geraet die Speicherdatei geaendert hat (Drive-Sync). */
  async checkExternal() {
    if (!this.store || this.show?.active) return;
    // Neue PDF-Versionen (z. B. frisch aus PowerPoint exportiert) erkennen
    const sem = this.view.type === 'seminar' ? this.store.seminar(this.view.id) : null;
    if (sem && !d.querySelector('.modal-back')) {
      const stale = await Promise.all(sem.items.map(async (it) => {
        const e = this.lib.entry(it.path);
        if (!e || e.status === 'loading') return false;
        const mod = await this.lib.modified(it.path);
        return e.status === 'ok' ? mod !== e.modified : mod != null;
      }));
      if (stale.some(Boolean)) {
        this.checks.clear();
        this.renderSeminar(sem);
        toast(d, 'Geänderte PDFs neu eingelesen.');
      }
    }
    if (await this.store.changedElsewhere()) {
      await this.store.load();
      this.checks.clear();
      if (this.view.type === 'seminar' && !this.store.seminar(this.view.id)) this.view = { type: 'home' };
      this.renderShell();
      toast(d, 'Änderungen von einem anderen Gerät geladen.');
    }
  }

  // ----- Grundgeruest -----
  renderShell() {
    this.sideEl = h(d, 'aside.side');
    this.contentEl = h(d, 'main.content');
    $app.replaceChildren(
      h(d, 'header.topbar',
        logo(),
        h(d, 'span.topbar-root', { title: 'Freigegebene Ablage' }, '📁 ', this.root.name, isDemo() ? ' (Demo)' : ''),
        h(d, 'span.spacer'),
        h(d, 'a.btn.small.ghost', { href: 'hilfe.html', target: '_blank', rel: 'noopener', title: 'Anleitung und Funktionsliste' }, 'Hilfe'),
        btn(getTheme() === 'dark' ? '☀' : '☾', (e) => { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); e.target.textContent = getTheme() === 'dark' ? '☀' : '☾'; }, 'icon ghost', { title: 'Hell / Dunkel' })),
      h(d, 'div.layout', this.sideEl, this.contentEl));
    this.renderSide();
    this.renderContent();
  }

  renderSide() {
    const sems = [...this.store.data.seminars].sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
    const item = (label, sub, active, onclick) => h(d, 'button.side-item' + (active ? '.active' : ''), { onclick, type: 'button' }, h(d, 'span', label), sub ? h(d, 'small', sub) : null);
    this.sideEl.replaceChildren(
      h(d, 'div.side-head', h(d, 'span', 'Seminare'), btn('+ Neu', () => this.createSeminar(), 'small primary')),
      h(d, 'nav.side-list', sems.length ? sems.map((s) => item(s.name, `${s.items.length} PDF${s.items.length === 1 ? '' : 's'}`, this.view.type === 'seminar' && this.view.id === s.id, () => this.go({ type: 'seminar', id: s.id })))
        : h(d, 'p.side-empty', 'Noch kein Seminar.')),
      h(d, 'div.side-foot',
        item('Pausenfolien', `${this.store.data.pause.slides.length} Folien`, this.view.type === 'pause', () => this.go({ type: 'pause' })),
        item('Einstellungen', null, this.view.type === 'settings', () => this.go({ type: 'settings' }))));
  }

  go(view) {
    this.view = view;
    this.checks.clear(); // beim Oeffnen einer Ansicht Dateien frisch pruefen
    if (view.type === 'seminar') { this.store.data.settings.lastSeminar = view.id; this.store.saveSoon(); }
    this.renderSide();
    this.renderContent();
  }

  renderContent() {
    const v = this.view;
    this.startBox = null;
    if (v.type === 'seminar' && this.store.seminar(v.id)) return this.renderSeminar(this.store.seminar(v.id));
    if (v.type === 'pause') return this.renderPause();
    if (v.type === 'settings') return this.renderSettings();
    this.contentEl.replaceChildren(h(d, 'div.empty-state',
      h(d, 'h2', 'Lege dein erstes Seminar an'),
      h(d, 'p', 'Ein Seminar ist eine Playlist aus PDFs. Die PDFs dürfen in verschiedenen Ordnern deiner Ablage liegen.'),
      btn('+ Neues Seminar', () => this.createSeminar(), 'primary big')));
  }

  async createSeminar() {
    const name = await this.askText('Neues Seminar', 'Name des Seminars', '');
    if (!name) return;
    const s = newSeminar(name);
    this.store.data.seminars.push(s);
    this.store.touch(s);
    this.go({ type: 'seminar', id: s.id });
  }

  askText(title, label, value) {
    return new Promise((res) => {
      let result = null;
      const input = h(d, 'input.input', { value, placeholder: label });
      const m = modal(title, h(d, 'form.modal-body', { onsubmit: (e) => { e.preventDefault(); result = input.value.trim(); m.close(); } },
        h(d, 'label.field', h(d, 'span', label), input),
        h(d, 'div.modal-actions', btn('Abbrechen', () => m.close(), 'ghost'), h(d, 'button.btn.primary', { type: 'submit' }, 'OK'))),
      { onClose: () => res(result) });
      setTimeout(() => input.focus(), 0);
    });
  }

  // ---------- PDF-Status ----------
  check(path) {
    if (!this.checks.has(path)) this.checks.set(path, this.lib.open(path, { check: true }));
    return this.checks.get(path);
  }

  // ---------- Seminar ----------
  renderSeminar(sem) {
    const nameIn = h(d, 'input.sem-name', { value: sem.name, title: 'Seminar umbenennen' });
    nameIn.addEventListener('change', () => {
      const v = nameIn.value.trim();
      if (!v) { nameIn.value = sem.name; return; }
      sem.name = v; this.store.touch(sem); this.renderSide();
    });

    this.startBox = h(d, 'div.start-box');
    this.refreshStartBox(sem);

    this.contentEl.replaceChildren(
      h(d, 'div.sem-head', nameIn, this.startBox),
      this.playlistCard(sem),
      linksPanel(d, sem, () => this.store.touch(sem)),
      this.hotkeyCard(sem),
      this.seminarPauseCard(sem),
      this.protocolCard(sem),
      h(d, 'div.sem-foot',
        btn('Seminar duplizieren', () => this.duplicate(sem), 'ghost small'),
        btn('Seminar löschen', () => this.removeSeminar(sem), 'ghost small danger-text')));
  }

  refreshStartBox(sem = this.view.type === 'seminar' ? this.store?.seminar(this.view.id) : null) {
    const box = this.startBox;
    if (!box || !sem) return;
    const mode = this.store.data.settings.mode || 'mirror';
    const seg = (val, label, title) => h(d, 'button.seg-btn' + (mode === val ? '.on' : ''), {
      type: 'button', title,
      onclick: () => { this.store.data.settings.mode = val; this.store.saveSoon(); this.refreshStartBox(sem); },
    }, label);
    const status = h(d, 'div.start-status');
    const scr = h(d, 'div.start-screens');
    if (mode === 'dual') {
      const sum = this.launcher.screenSummary();
      scr.append(sum.text);
      if (!sum.known && 'getScreenDetails' in window && this.launcher.screenPerm !== 'denied') {
        scr.append(' ', btn('Bildschirme prüfen', async () => { await this.launcher.requestScreens(); this.refreshStartBox(sem); }, 'small ghost'));
      }
    }
    box.replaceChildren(
      h(d, 'div.seg', seg('mirror', 'Gespiegelt', 'Überall dasselbe Bild (Windows: Win + P, Duplizieren)'), seg('dual', 'Zwei Bildschirme', 'Beamer zeigt die Folie, der Laptop die Referentenansicht (Windows: Win + P, Erweitern)')),
      btn('▶ Präsentieren', () => this.present(sem), 'primary big', { disabled: !sem.items.length }),
      status, scr);
    if (!sem.items.length) { status.textContent = 'Füge zuerst PDFs hinzu.'; return; }
    status.textContent = 'PDFs werden geprüft';
    Promise.all(sem.items.map((it) => this.check(it.path))).then((ents) => {
      const ok = ents.filter((e) => e.status === 'ok');
      const missing = ents.length - ok.length;
      const slides = ok.reduce((a, e) => a + e.pages, 0);
      status.replaceChildren(...[
        h(d, 'span.chip.ok', `${ok.length} PDF${ok.length === 1 ? '' : 's'} bereit, ${slides} Folien`),
        missing ? h(d, 'span.chip.err', `${missing} fehlt`) : null].filter(Boolean));
    });
  }

  present(sem) {
    const mode = this.store.data.settings.mode || 'mirror';
    if (mode === 'dual') {
      const L = this.launcher;
      if ('getScreenDetails' in window && !L.screens && L.screenPerm !== 'denied') {
        // Erst die Erlaubnis holen; der zweite Klick startet dann.
        L.requestScreens().then((sd) => {
          this.refreshStartBox(sem);
          if (sd) toast(d, sd.screens.length > 1 ? 'Bildschirme erkannt. Jetzt noch einmal auf „Präsentieren“ klicken.' : 'Nur ein Bildschirm erkannt. Beamer anschließen und Windows auf „Erweitern“ stellen (Win + P).', 6000);
        });
        return;
      }
      if (L.screens && L.screens.screens.length < 2) {
        this.singleScreenDialog(sem);
        return;
      }
    }
    const prep = this.show.prepare(sem);
    const err = this.launcher.start(sem, mode, prep);
    if (err) toast(d, err, 7000);
  }

  singleScreenDialog(sem) {
    const m = modal('Nur ein Bildschirm erkannt', h(d, 'div.modal-body',
      h(d, 'p', 'Ist der Beamer angeschlossen und unter Windows auf „Erweitern“ gestellt? Das geht mit Win + P.'),
      h(d, 'div.modal-actions',
        btn('Gespiegelt präsentieren', () => { m.close(); const e = this.launcher.start(sem, 'mirror', this.show.prepare(sem)); if (e) toast(d, e); }, 'ghost'),
        btn('Mit Beamerfenster', () => {
          m.close();
          const saved = this.launcher.screens; this.launcher.screens = null; // Variante B erzwingen
          const e = this.launcher.start(sem, 'dual', this.show.prepare(sem));
          this.launcher.screens = saved;
          if (e) toast(d, e);
        }, 'primary'))));
  }

  onStopped() {
    this.checks.clear();
    this.renderSide();
    this.renderContent();
  }

  onScreensChanged() { this.refreshStartBox(); }

  // ----- Playlist -----
  playlistCard(sem) {
    const list = h(d, 'div.pl-list');
    const card = h(d, 'section.card',
      h(d, 'div.card-head', h(d, 'h3', 'Ablauf'), h(d, 'span.muted', 'Reihenfolge per Ziehen am Griff ändern'), h(d, 'span.spacer'),
        btn('+ PDF aus der Ablage', () => this.pickPdfs(sem), 'primary small')),
      list,
      h(d, 'div.dropzone', 'PDFs aus dem Explorer hierher ziehen. Auf eine Zeile gezogen, ersetzt das PDF den Eintrag.'));
    this.fillPlaylist(sem, list);

    // Dateien aus dem Explorer
    card.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      card.classList.add('dropping');
      const row = e.target.closest?.('.pl-row');
      list.querySelectorAll('.pl-row.replace').forEach((r) => r !== row && r.classList.remove('replace'));
      row?.classList.add('replace');
    });
    card.addEventListener('dragleave', (e) => { if (!card.contains(e.relatedTarget)) { card.classList.remove('dropping'); list.querySelectorAll('.replace').forEach((r) => r.classList.remove('replace')); } });
    card.addEventListener('drop', (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      card.classList.remove('dropping');
      const row = e.target.closest?.('.pl-row');
      list.querySelectorAll('.replace').forEach((r) => r.classList.remove('replace'));
      const handles = [...e.dataTransfer.items].filter((i) => i.kind === 'file').map((i) => i.getAsFileSystemHandle?.());
      this.dropFiles(sem, handles, row?.dataset.id);
    });
    return card;
  }

  async dropFiles(sem, handlePromises, replaceId) {
    const handles = (await Promise.all(handlePromises.map((p) => p?.catch?.(() => null) ?? p))).filter(Boolean);
    const paths = [];
    const outside = [];
    for (const hd of handles) {
      if (hd.kind !== 'file' || !/\.pdf$/i.test(hd.name)) { if (hd.kind === 'file') outside.push(hd.name + ' (kein PDF)'); continue; }
      const p = await relPath(this.root, hd);
      if (p) paths.push(p); else outside.push(hd.name);
    }
    if (outside.length) toast(d, `Nicht übernommen, liegt nicht in der Ablage „${this.root.name}“: ${outside.join(', ')}`, 6000);
    if (!paths.length) return;
    if (replaceId && paths.length === 1) this.replaceItem(sem, replaceId, paths[0]);
    else this.addPaths(sem, paths);
  }

  addPaths(sem, paths) {
    const before = sem.items.length;
    for (const p of paths) sem.items.push({ id: Math.random().toString(36).slice(2, 10), path: p });
    this.store.touch(sem);
    toast(d, `${sem.items.length - before} PDF${paths.length === 1 ? '' : 's'} hinzugefügt.`);
    this.renderSeminar(sem);
    this.renderSide();
  }

  replaceItem(sem, id, path) {
    const it = sem.items.find((x) => x.id === id);
    if (!it) return;
    const old = it.path;
    it.path = path;
    // Schnelltasten und eigene Pausenfolien mitziehen
    for (const [k, r] of Object.entries(sem.hotkeys || {})) if (r.path === old) sem.hotkeys[k] = { ...r, path };
    this.lib.forget(old); this.checks.delete(old); this.checks.delete(path);
    this.store.touch(sem);
    toast(d, `„${fileTitle(old)}“ ersetzt durch „${fileTitle(path)}“.`);
    this.renderSeminar(sem);
  }

  fillPlaylist(sem, list) {
    if (!sem.items.length) {
      list.replaceChildren(h(d, 'p.muted.pl-empty', 'Noch keine PDFs. Über „PDF aus der Ablage“ oder per Ziehen aus dem Explorer hinzufügen.'));
      return;
    }
    let dragId = null;
    const rows = sem.items.map((it, idx) => {
      const chip = h(d, 'span.chip', 'prüfe');
      const pages = h(d, 'span.pl-pages');
      const expand = h(d, 'div.pl-expand', { hidden: true });
      const handle = h(d, 'span.pl-handle', { title: 'Ziehen zum Verschieben' }, '⋮⋮');
      const row = h(d, 'div.pl-row', { dataset: { id: it.id } },
        handle,
        h(d, 'span.pl-idx', String(idx + 1)),
        h(d, 'div.pl-thumbbox', thumb(it.path, 1, 'pl-thumb')),
        h(d, 'div.pl-text', h(d, 'div.pl-title', fileTitle(it.path)), h(d, 'div.pl-path', it.path)),
        pages, chip,
        h(d, 'div.pl-actions',
          btn('Folien', () => this.toggleExpand(sem, it, expand), 'small ghost', { title: 'Folien anzeigen, Schnelltasten belegen' }),
          btn('Ersetzen', () => this.pickPdfs(sem, it.id), 'small ghost', { title: 'Durch eine andere Datei ersetzen' }),
          btn('↑', () => this.move(sem, idx, -1), 'small ghost icon', { disabled: idx === 0, title: 'Nach oben' }),
          btn('↓', () => this.move(sem, idx, 1), 'small ghost icon', { disabled: idx === sem.items.length - 1, title: 'Nach unten' }),
          btn('×', () => this.removeItem(sem, it), 'small ghost icon', { title: 'Aus dem Ablauf entfernen' })));
      // Umsortieren per Ziehen (nur am Griff)
      handle.addEventListener('pointerdown', () => { row.draggable = true; });
      row.addEventListener('dragstart', (e) => { dragId = it.id; e.dataTransfer.setData('application/x-slidedesk-row', it.id); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => { row.draggable = false; row.classList.remove('dragging'); list.querySelectorAll('.before,.after').forEach((r) => r.classList.remove('before', 'after')); });
      row.addEventListener('dragover', (e) => {
        if (!dragId || ![...e.dataTransfer.types].includes('application/x-slidedesk-row')) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const after = e.clientY > r.top + r.height / 2;
        row.classList.toggle('after', after); row.classList.toggle('before', !after);
      });
      row.addEventListener('dragleave', () => row.classList.remove('before', 'after'));
      row.addEventListener('drop', (e) => {
        if (!dragId || ![...e.dataTransfer.types].includes('application/x-slidedesk-row')) return;
        e.preventDefault(); e.stopPropagation();
        const after = row.classList.contains('after');
        row.classList.remove('before', 'after');
        const from = sem.items.findIndex((x) => x.id === dragId);
        dragId = null;
        if (from < 0) return;
        const [moved] = sem.items.splice(from, 1);
        let to = sem.items.findIndex((x) => x.id === it.id);
        if (after) to++;
        sem.items.splice(to, 0, moved);
        this.store.touch(sem);
        this.renderSeminar(sem);
      });
      this.check(it.path).then((e) => {
        if (e.status === 'ok') { chip.className = 'chip ok'; chip.textContent = 'bereit'; pages.textContent = `${e.pages} Folien`; }
        else if (e.status === 'missing') { chip.className = 'chip err'; chip.textContent = 'fehlt'; chip.title = 'Datei nicht gefunden. Ersetzen oder entfernen.'; row.classList.add('missing'); }
        else { chip.className = 'chip err'; chip.textContent = 'Fehler'; chip.title = String(e.error?.message || e.error); }
      });
      return [row, expand];
    });
    list.replaceChildren(...rows.flat());
  }

  move(sem, idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= sem.items.length) return;
    [sem.items[idx], sem.items[j]] = [sem.items[j], sem.items[idx]];
    this.store.touch(sem);
    this.renderSeminar(sem);
  }

  async removeItem(sem, it) {
    if (!(await confirmBox('Aus dem Ablauf entfernen?', `„${fileTitle(it.path)}“ wird aus diesem Seminar entfernt. Die Datei selbst bleibt unverändert.`, 'Entfernen', 'danger'))) return;
    sem.items = sem.items.filter((x) => x.id !== it.id);
    this.store.touch(sem);
    this.renderSeminar(sem);
    this.renderSide();
  }

  async toggleExpand(sem, it, box) {
    if (!box.hidden) { box.hidden = true; box.replaceChildren(); return; }
    box.hidden = false;
    const e = await this.check(it.path);
    if (e.status !== 'ok') { box.replaceChildren(h(d, 'p.muted', 'Datei nicht verfügbar.')); return; }
    const hk = sem.hotkeys || {};
    const keyOf = (p) => Object.entries(hk).find(([, r]) => r.path === it.path && r.page === p)?.[0];
    const cells = [];
    for (let p = 1; p <= e.pages; p++) {
      const k = keyOf(p);
      cells.push(h(d, 'button.thumb-cell', { type: 'button', title: 'Auf eine Schnelltaste legen', onclick: (ev) => this.hotkeyMenu(sem, { path: it.path, page: p }, ev.currentTarget) },
        thumb(it.path, p), h(d, 'span.thumb-num', String(p)), k ? h(d, 'span.thumb-key', k) : null));
    }
    box.replaceChildren(h(d, 'p.muted.small', 'Klick auf eine Folie legt sie auf eine Schnelltaste.'), h(d, 'div.thumbs-grid', cells));
  }

  hotkeyMenu(sem, ref, anchor) {
    d.querySelector('.popover')?.remove();
    const pop = h(d, 'div.popover',
      h(d, 'div.popover-title', 'Schnelltaste wählen'),
      h(d, 'div.popover-keys', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
        const cur = sem.hotkeys?.[n];
        return btn(String(n), () => { sem.hotkeys = { ...(sem.hotkeys || {}), [n]: ref }; this.store.touch(sem); pop.remove(); this.renderSeminar(sem); toast(d, `Folie ${ref.page} liegt auf Taste ${n}.`); },
          cur ? 'key used' : 'key', { title: cur ? `belegt: ${fileTitle(cur.path)}, Folie ${cur.page}` : 'frei' });
      })));
    d.body.append(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(innerWidth - 240, Math.max(8, r.left)) + 'px';
    pop.style.top = (r.bottom + 6 + scrollY) + 'px';
    setTimeout(() => d.addEventListener('mousedown', function off(e) { if (!pop.contains(e.target)) { pop.remove(); d.removeEventListener('mousedown', off); } }), 0);
  }

  // ----- Ablage-Auswahl -----
  pickPdfs(sem, replaceId = null) {
    const single = !!replaceId;
    return this.ablagePicker({ single, title: single ? 'PDF zum Ersetzen wählen' : 'PDFs aus der Ablage hinzufügen' }).then((paths) => {
      if (!paths?.length) return;
      if (single) this.replaceItem(sem, replaceId, paths[0]);
      else this.addPaths(sem, paths);
    });
  }

  ablagePicker({ single = false, title = 'PDFs wählen' } = {}) {
    return new Promise((resolve) => {
      let dir = this.store.data.settings.lastDir || '';
      const chosen = new Set();
      const crumbs = h(d, 'div.pk-crumbs');
      const listEl = h(d, 'div.pk-list');
      const search = h(d, 'input.input', { type: 'search', placeholder: 'In der ganzen Ablage nach Dateinamen suchen' });
      const okBtn = btn('Hinzufügen', () => finish(), 'primary', { disabled: true });
      let result = null;
      const finish = () => { result = [...chosen]; m.close(); };
      const update = () => { okBtn.disabled = !chosen.size; okBtn.textContent = single ? 'Übernehmen' : `Hinzufügen${chosen.size ? ` (${chosen.size})` : ''}`; };
      const fileRow = (path, label) => {
        const cb = h(d, 'input', { type: single ? 'radio' : 'checkbox', name: 'pk', checked: chosen.has(path) });
        const row = h(d, 'label.pk-row.file', cb, h(d, 'span.pk-icon', '📄'), h(d, 'span.pk-name', label), label !== path ? h(d, 'small.pk-sub', path) : null);
        cb.addEventListener('change', () => {
          if (single) chosen.clear();
          if (cb.checked) chosen.add(path); else chosen.delete(path);
          update();
        });
        row.addEventListener('dblclick', () => { chosen.add(path); finish(); });
        return row;
      };
      const show = async (path) => {
        dir = path;
        this.store.data.settings.lastDir = path;
        const parts = path.split('/').filter(Boolean);
        crumbs.replaceChildren(
          h(d, 'button.crumb', { type: 'button', onclick: () => show('') }, this.root.name),
          ...parts.flatMap((p, i) => [h(d, 'span.crumb-sep', '›'), h(d, 'button.crumb', { type: 'button', onclick: () => show(parts.slice(0, i + 1).join('/')) }, p)]));
        listEl.replaceChildren(h(d, 'p.muted', 'Lade Ordner'));
        try {
          const { dirs, files } = await listDir(this.root, path);
          if (dir !== path) return;
          const rows = [
            ...dirs.filter((n) => !(path === '' && n === 'SlideDESK')).map((n) => h(d, 'button.pk-row.dir', { type: 'button', onclick: () => show(path ? `${path}/${n}` : n) }, h(d, 'span.pk-icon', '📁'), h(d, 'span.pk-name', n))),
            ...files.map((n) => fileRow(path ? `${path}/${n}` : n, n)),
          ];
          listEl.replaceChildren(...(rows.length ? rows : [h(d, 'p.muted', 'Keine Unterordner oder PDFs.')]));
        } catch (e) {
          // Ordner existiert nicht mehr: zurueck zur Wurzel
          if (path) show(''); else listEl.replaceChildren(h(d, 'p.error', e.message));
        }
      };
      let abort;
      const doSearch = debounce(async () => {
        const q = search.value.trim();
        abort?.abort();
        if (q.length < 2) { show(dir); return; }
        abort = new AbortController();
        const my = abort;
        listEl.replaceChildren(h(d, 'p.muted', 'Suche in der Ablage'));
        const found = await findPdfs(this.root, q, { signal: my.signal });
        if (my.signal.aborted) return;
        crumbs.replaceChildren(h(d, 'span.muted', `Suchergebnisse für „${q}“`));
        listEl.replaceChildren(...(found.length ? found.map((p) => fileRow(p, p.split('/').pop())) : [h(d, 'p.muted', 'Nichts gefunden.')]));
      }, 300);
      search.addEventListener('input', doSearch);
      const m = modal(title, h(d, 'div.modal-body.picker', search, crumbs, listEl,
        h(d, 'div.modal-actions', h(d, 'span.muted.small', single ? 'Doppelklick übernimmt direkt.' : 'Mehrere PDFs auswählbar.'), h(d, 'span.spacer'), btn('Abbrechen', () => m.close(), 'ghost'), okBtn)),
      { wide: true, onClose: () => { abort?.abort(); this.store.saveSoon(); resolve(result); } });
      update();
      show(dir);
      setTimeout(() => search.focus(), 0);
    });
  }

  // ----- Schnelltasten -----
  hotkeyCard(sem) {
    const hk = sem.hotkeys || {};
    const cells = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
      const r = hk[n];
      return h(d, 'div.hk-cell' + (r ? '' : '.free'),
        h(d, 'kbd.hk-key', String(n)),
        r ? thumb(r.path, r.page, 'hk-thumb') : h(d, 'div.hk-thumb.blank'),
        h(d, 'div.hk-text', r ? [h(d, 'div.hk-title', fileTitle(r.path)), h(d, 'small', `Folie ${r.page}`)] : h(d, 'small.muted', 'frei')),
        h(d, 'div.hk-actions',
          btn(r ? 'Ändern' : 'Festlegen', () => this.pickSlideFor(sem, n), 'small ghost'),
          r ? btn('×', () => { delete sem.hotkeys[n]; this.store.touch(sem); this.renderSeminar(sem); }, 'small ghost icon', { title: 'Taste freigeben' }) : null));
    });
    return h(d, 'section.card',
      h(d, 'div.card-head', h(d, 'h3', 'Schnelltasten'), h(d, 'span.muted', 'Ziffer drücken springt hin, Rücktaste zurück. Beim Präsentieren belegt Umschalt + Ziffer die aktuelle Folie.')),
      h(d, 'div.hk-grid', cells));
  }

  async pickSlideFor(sem, n) {
    const ref = await this.slidePicker(sem.items.map((i) => i.path), { title: `Folie für Taste ${n} wählen` });
    if (!ref) return;
    sem.hotkeys = { ...(sem.hotkeys || {}), [n]: ref[0] };
    this.store.touch(sem);
    this.renderSeminar(sem);
  }

  /** Folien aus PDFs auswaehlen. multi = Mehrfachauswahl, Rueckgabe: [{path, page}] */
  slidePicker(paths, { title = 'Folie wählen', multi = false, preselect = false } = {}) {
    return new Promise((resolve) => {
      let result = null;
      const sel = new Map();
      const body = h(d, 'div.modal-body.slidepick');
      const okBtn = multi ? btn('Übernehmen', () => { result = [...sel.values()]; m.close(); }, 'primary') : null;
      const m = modal(title, h(d, 'div', body, multi ? h(d, 'div.modal-actions', h(d, 'span.spacer'), btn('Abbrechen', () => m.close(), 'ghost'), okBtn) : null), { wide: true, onClose: () => resolve(result) });
      const uniq = [...new Set(paths)];
      if (!uniq.length) body.append(h(d, 'p.muted', 'Keine PDFs vorhanden.'));
      for (const path of uniq) {
        const grid = h(d, 'div.thumbs-grid');
        body.append(h(d, 'div.sp-group', h(d, 'div.sp-title', fileTitle(path), h(d, 'small', path)), grid));
        this.check(path).then((e) => {
          if (e.status !== 'ok') { grid.append(h(d, 'p.muted', 'Datei nicht verfügbar.')); return; }
          for (let p = 1; p <= e.pages; p++) {
            const ref = { path, page: p };
            const cell = h(d, 'button.thumb-cell', { type: 'button' }, thumb(path, p), h(d, 'span.thumb-num', String(p)));
            if (multi && preselect) { sel.set(slideKey(path, p), ref); cell.classList.add('picked'); }
            cell.addEventListener('click', () => {
              if (!multi) { result = [ref]; m.close(); return; }
              const k = slideKey(path, p);
              if (sel.has(k)) { sel.delete(k); cell.classList.remove('picked'); } else { sel.set(k, ref); cell.classList.add('picked'); }
            });
            grid.append(cell);
          }
        });
      }
    });
  }

  // ----- Pausenfolien -----
  pauseEditor(slides, onChange) {
    const wrap = h(d, 'div.pause-editor');
    const render = () => {
      wrap.replaceChildren(
        slides.length
          ? h(d, 'div.thumbs-grid', slides.map((r, i) => h(d, 'div.thumb-cell.static', thumb(r.path, r.page),
            h(d, 'span.thumb-num', `${i + 1}`),
            h(d, 'div.thumb-tools',
              btn('←', () => { if (i > 0) { [slides[i - 1], slides[i]] = [slides[i], slides[i - 1]]; onChange(); render(); } }, 'icon small', { title: 'Nach vorne', disabled: i === 0 }),
              btn('×', () => { slides.splice(i, 1); onChange(); render(); }, 'icon small', { title: 'Entfernen' })),
            h(d, 'small.thumb-cap', `${fileTitle(r.path)} · ${r.page}`))))
          : h(d, 'p.muted', 'Noch keine Pausenfolien. Ohne Pausenfolien zeigt der Beamer in der Pause ein schwarzes Bild.'),
        h(d, 'div.row', btn('+ Folien aus PDF hinzufügen', async () => {
          const paths = await this.ablagePicker({ title: 'PDF mit Pausenfolien wählen' });
          if (!paths?.length) return;
          const refs = await this.slidePicker(paths, { title: 'Welche Folien sollen in der Pause laufen?', multi: true, preselect: true });
          if (!refs?.length) return;
          slides.push(...refs);
          onChange(); render();
        }, 'small primary')));
    };
    render();
    return wrap;
  }

  seminarPauseCard(sem) {
    const own = !!sem.pause;
    const body = h(d, 'div');
    const radio = (val, label) => {
      const r = h(d, 'input', { type: 'radio', name: 'pausemode', checked: own === val });
      r.addEventListener('change', () => {
        sem.pause = val ? { slides: [...this.store.data.pause.slides] } : null;
        this.store.touch(sem);
        this.renderSeminar(sem);
      });
      return h(d, 'label.radio', r, label);
    };
    if (own) body.append(this.pauseEditor(sem.pause.slides, () => this.store.touch(sem)));
    else body.append(h(d, 'p.muted', `Es laufen die allgemeinen Pausenfolien (${this.store.data.pause.slides.length}). Taste P startet und beendet die Pause.`));
    return h(d, 'section.card',
      h(d, 'div.card-head', h(d, 'h3', 'Pausenfolien'), h(d, 'span.spacer'), radio(false, 'Allgemeine'), radio(true, 'Eigene für dieses Seminar')),
      body);
  }

  renderPause() {
    const p = this.store.data.pause;
    const iv = h(d, 'input.input.num', { type: 'number', min: 3, max: 600, value: p.interval });
    iv.addEventListener('change', () => { p.interval = Math.max(3, Number(iv.value) || 15); iv.value = p.interval; this.store.saveSoon(); });
    this.contentEl.replaceChildren(
      h(d, 'div.page-head', h(d, 'h2', 'Pausenfolien'), h(d, 'p.muted', 'Laufen in der Pause auf dem Beamer, zum Beispiel ein Hinweis auf deinen Newsletter mit QR-Code. Mehrere Folien wechseln automatisch.')),
      h(d, 'section.card',
        h(d, 'div.card-head', h(d, 'h3', 'Allgemeine Pausenfolien'), h(d, 'span.muted', 'gelten für alle Seminare ohne eigene Auswahl')),
        this.pauseEditor(p.slides, () => { this.store.saveSoon(); this.renderSide(); })),
      h(d, 'section.card',
        h(d, 'div.card-head', h(d, 'h3', 'Wechsel')),
        h(d, 'label.field.inline', h(d, 'span', 'Nächste Pausenfolie nach'), iv, h(d, 'span', 'Sekunden'))));
  }

  // ----- Gezeigt-Protokoll -----
  protocolCard(sem) {
    const protos = sem.protocols || [];
    const dwell = this.store.data.settings.dwell;
    const card = h(d, 'section.card',
      h(d, 'div.card-head', h(d, 'h3', 'Gezeigt-Protokoll'), h(d, 'span.muted', `Eine Folie zählt als gezeigt, wenn sie mindestens ${dwell} Sekunden auf dem Beamer stand.`)));
    if (!protos.length) {
      card.append(h(d, 'p.muted', 'Noch keine Aufzeichnung. Sie entsteht automatisch beim Präsentieren.'));
      return card;
    }
    const select = h(d, 'select.input',
      h(d, 'option', { value: 'all' }, `Alle ${protos.length} Sitzungen`),
      ...protos.map((p) => h(d, 'option', { value: p.id }, `${fmtDate(p.start)} · ${fmtDuration((p.end - p.start) / 1000)} · ${p.shown.length} Folien`)));
    const out = h(d, 'div.proto-out');
    const render = () => {
      const chosen = select.value === 'all' ? protos : protos.filter((p) => p.id === select.value);
      const count = new Map();
      const secs = new Map();
      for (const p of chosen) for (const s of p.shown) {
        const k = slideKey(s.path, s.page);
        count.set(k, (count.get(k) || 0) + 1);
        secs.set(k, (secs.get(k) || 0) + s.sec);
      }
      const groups = [];
      let total = 0, shownN = 0;
      for (const it of sem.items) {
        const e = this.lib.entry(it.path);
        const pages = e?.status === 'ok' ? e.pages : (chosen.flatMap((p) => p.items || []).find((x) => x.path === it.path)?.pages || 0);
        if (!pages) continue;
        const cells = [];
        for (let pg = 1; pg <= pages; pg++) {
          const k = slideKey(it.path, pg);
          const c = count.get(k) || 0;
          total++; if (c) shownN++;
          cells.push(h(d, 'div.thumb-cell.static' + (c ? '.was-shown' : '.not-shown'), { title: c ? `${c}× gezeigt, zusammen ${fmtDuration(secs.get(k))}` : 'nicht gezeigt' },
            thumb(it.path, pg), h(d, 'span.thumb-num', String(pg)), c ? h(d, 'span.thumb-key', select.value === 'all' ? `${c}×` : fmtDuration(secs.get(k))) : null));
        }
        groups.push(h(d, 'div.sp-group', h(d, 'div.sp-title', fileTitle(it.path)), h(d, 'div.thumbs-grid.small', cells)));
      }
      out.replaceChildren(
        h(d, 'p.proto-sum', `${shownN} von ${total} Folien gezeigt` + (select.value === 'all' ? ' (in mindestens einer Sitzung)' : '') + '. Blasse Folien wurden nicht gezeigt.'),
        ...groups);
    };
    select.addEventListener('change', render);
    card.append(h(d, 'div.row', select, h(d, 'span.spacer'), btn('Protokolle löschen', async () => {
      if (!(await confirmBox('Protokolle löschen?', 'Alle Aufzeichnungen dieses Seminars werden entfernt.', 'Löschen', 'danger'))) return;
      sem.protocols = []; this.store.touch(sem); this.renderSeminar(sem);
    }, 'small ghost danger-text')), out);
    Promise.all(sem.items.map((it) => this.check(it.path))).then(render);
    return card;
  }

  async duplicate(sem) {
    const name = await this.askText('Seminar duplizieren', 'Name der Kopie', sem.name + ' (Kopie)');
    if (!name) return;
    const copy = { ...JSON.parse(JSON.stringify(sem)), ...newSeminar(name) };
    copy.items = sem.items.map((it) => ({ ...it, id: Math.random().toString(36).slice(2, 10) }));
    copy.hotkeys = JSON.parse(JSON.stringify(sem.hotkeys || {}));
    copy.links = (sem.links || []).map((link) => ({ ...link, id: crypto.randomUUID() }));
    copy.pause = sem.pause ? JSON.parse(JSON.stringify(sem.pause)) : null;
    copy.protocols = [];
    this.store.data.seminars.push(copy);
    this.store.touch(copy);
    this.go({ type: 'seminar', id: copy.id });
  }

  async removeSeminar(sem) {
    if (!(await confirmBox('Seminar löschen?', `„${sem.name}“ wird mit Ablauf, Schnelltasten und Protokollen gelöscht. Die PDFs bleiben unverändert.`, 'Löschen', 'danger'))) return;
    this.store.data.seminars = this.store.data.seminars.filter((s) => s.id !== sem.id);
    this.store.saveSoon();
    this.go({ type: 'home' });
  }

  // ----- Einstellungen -----
  renderSettings() {
    const st = this.store.data.settings;
    const dwell = h(d, 'input.input.num', { type: 'number', min: 1, max: 120, value: st.dwell });
    dwell.addEventListener('change', () => { st.dwell = Math.max(1, Number(dwell.value) || 5); dwell.value = st.dwell; this.store.saveSoon(); });
    const scr = h(d, 'p.muted');
    const updScr = () => { scr.textContent = this.launcher.screenSummary().text; };
    updScr();
    this.contentEl.replaceChildren(
      h(d, 'div.page-head', h(d, 'h2', 'Einstellungen')),
      h(d, 'section.card',
        h(d, 'div.card-head', h(d, 'h3', 'Gezeigt-Protokoll')),
        h(d, 'label.field.inline', h(d, 'span', 'Folie zählt als gezeigt ab'), dwell, h(d, 'span', 'Sekunden auf dem Beamer')),
        h(d, 'p.muted.small', 'Schnelles Durchblättern zählt damit nicht. Pausenfolien und geöffnete Übersichten zählen nie.')),
      h(d, 'section.card',
        h(d, 'div.card-head', h(d, 'h3', 'Bildschirme')),
        scr,
        h(d, 'div.row', btn('Bildschirme prüfen', async () => { await this.launcher.requestScreens(); updScr(); }, 'small ghost')),
        h(d, 'p.muted.small', 'Für „Zwei Bildschirme“ den Beamer unter Windows auf „Erweitern“ stellen (Win + P). SlideDESK legt die Folie dann selbst auf den Beamer und die Referentenansicht auf den Laptop. Beim ersten Mal fragt der Browser nach der Erlaubnis zur Fensterverwaltung und eventuell nach Pop-ups.')),
      h(d, 'section.card',
        h(d, 'div.card-head', h(d, 'h3', 'Ablage')),
        h(d, 'p', `Freigegeben: „${this.root.name}“. Speicherdatei: ${this.root.name}/SlideDESK/slidedesk.json`),
        h(d, 'p.muted.small', 'Liegt die Ablage in Google Drive für Desktop, ist die Speicherdatei automatisch auf allen Geräten gleich. Die Ordner mit Seminar-PDFs sollten offline verfügbar sein.'),
        isDemo() ? null : h(d, 'div.row', btn('Andere Ablage wählen', () => this.choose(), 'small ghost'))),
      h(d, 'section.card',
        h(d, 'div.card-head', h(d, 'h3', 'Offline und Installation')),
        h(d, 'p.muted.small', 'SlideDESK läuft nach dem ersten Aufruf auch ohne Internet. Optional lässt es sich über das Menü des Browsers als App installieren.'),
        h(d, 'p.muted.small', `Version ${VERSION}`),
        h(d, 'div.row', h(d, 'a.btn.small.ghost', { href: 'hilfe.html', target: '_blank', rel: 'noopener' }, 'Anleitung und Funktionsliste öffnen'))));
  }
}

const app = new App();
app.boot();
