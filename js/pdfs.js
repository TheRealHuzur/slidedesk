// PDF laden, rendern, Miniaturen und Volltext. Alles laeuft lokal mit PDF.js.

import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import { fileByPath } from './store.js';
import { slideKey } from './util.js';

const V = new URL('../vendor/pdfjs/', import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = V + 'pdf.worker.min.mjs';

const DOC_OPTS = {
  cMapUrl: V + 'cmaps/',
  cMapPacked: true,
  standardFontDataUrl: V + 'standard_fonts/',
  wasmUrl: V + 'wasm/',
  iccUrl: V + 'iccs/',
  isEvalSupported: false,
  enableXfa: false,
};

/** Hintergrund-Warteschlange: eine Aufgabe nach der anderen, niedrige Zahl zuerst. */
class Queue {
  constructor() { this.items = []; this.keys = new Map(); this.running = false; }
  add(prio, key, fn) {
    if (key && this.keys.has(key)) {
      const t = this.keys.get(key);
      if (prio < t.prio) { t.prio = prio; this.sort(); }
      return t.promise;
    }
    if (!fn) return Promise.resolve();
    const t = { prio, key, fn, seq: Queue.seq++ };
    t.promise = new Promise((res, rej) => { t.res = res; t.rej = rej; });
    this.items.push(t);
    if (key) this.keys.set(key, t);
    this.sort();
    this.pump();
    return t.promise;
  }
  sort() { this.items.sort((a, b) => a.prio - b.prio || a.seq - b.seq); }
  drop(pred) {
    this.items = this.items.filter((t) => {
      if (!pred(t)) return true;
      if (t.key) this.keys.delete(t.key);
      t.rej(new DOMException('abgebrochen', 'AbortError'));
      return false;
    });
  }
  async pump() {
    if (this.running) return;
    this.running = true;
    while (this.items.length) {
      const t = this.items.shift();
      try { t.res(await t.fn()); } catch (e) { t.rej(e); }
      if (t.key) this.keys.delete(t.key);
      await new Promise((r) => setTimeout(r, 0));
    }
    this.running = false;
  }
}
Queue.seq = 0;

export const PRIO = { prerender: 1, thumb: 2, text: 3 };

export class PdfLibrary {
  constructor(root) {
    this.root = root;
    this.entries = new Map(); // path -> { status, doc, pages, modified, promise, error }
    this.frames = new Map(); // LRU: key -> canvas
    this.thumbs = new Map(); // slideKey -> objectURL
    this.texts = new Map(); // path -> Promise<string[]>
    this.sizes = new Map(); // slideKey -> {w,h}
    this.queue = new Queue();
    this.maxFrames = 18;
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed(path) { for (const fn of this.listeners) fn(path); }

  entry(path) { return this.entries.get(path); }

  /** Oeffnet ein PDF (oder liefert es aus dem Speicher). Prueft dabei, ob die Datei neuer ist. */
  async open(path, { check = false } = {}) {
    let e = this.entries.get(path);
    if (e && check && e.status !== 'loading') {
      const mod = await this.modified(path);
      if (e.status === 'ok' && mod === e.modified) return e;
      if (e.status !== 'ok' && mod == null) return e;
      this.forget(path);
      e = null;
    }
    if (e) return e.promise;
    e = { status: 'loading', path };
    this.entries.set(path, e);
    e.promise = (async () => {
      try {
        const fh = await fileByPath(this.root, path);
        const file = await fh.getFile();
        e.modified = file.lastModified;
        e.size = file.size;
        const data = new Uint8Array(await file.arrayBuffer());
        e.task = pdfjs.getDocument({ ...DOC_OPTS, data });
        e.doc = await e.task.promise;
        e.pages = e.doc.numPages;
        e.status = 'ok';
      } catch (err) {
        e.status = err?.name === 'NotFoundError' || err?.name === 'TypeMismatchError' ? 'missing' : 'error';
        e.error = err;
        console.warn('PDF nicht geladen', path, err);
      }
      this.changed(path);
      return e;
    })();
    return e.promise;
  }

  async modified(path) {
    try { return (await (await fileByPath(this.root, path)).getFile()).lastModified; } catch { return null; }
  }

  /** Alles zu einem Pfad verwerfen (z. B. wenn eine neue Version exportiert wurde). */
  forget(path) {
    const e = this.entries.get(path);
    if (e?.task) Promise.resolve().then(() => e.task.destroy()).catch(() => {});
    this.entries.delete(path);
    this.texts.delete(path);
    for (const k of [...this.frames.keys()]) if (k.startsWith(path + '#')) this.frames.delete(k);
    for (const [k, url] of [...this.thumbs]) if (k.startsWith(path + '#')) { URL.revokeObjectURL(url); this.thumbs.delete(k); }
    for (const k of [...this.sizes.keys()]) if (k.startsWith(path + '#')) this.sizes.delete(k);
    this.queue.drop((t) => t.key?.includes(path + '#') || t.key === 'text:' + path);
  }

  async page(path, n) {
    const e = await this.open(path);
    if (e.status !== 'ok') throw e.error || new Error('PDF nicht verfügbar');
    const page = await e.doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    this.sizes.set(slideKey(path, n), { w: vp.width, h: vp.height });
    return page;
  }

  size(path, n) { return this.sizes.get(slideKey(path, n)); }

  /**
   * Fertig gerenderte Folie in Bildschirmgroesse (ohne Zoom), mit Zwischenspeicher.
   * Liefert eine Leinwand, die nur die Seite enthaelt, eingepasst in w x h Pixel.
   */
  frame(path, n, w, h, { background = false } = {}) {
    w = Math.round(w); h = Math.round(h);
    const key = `${slideKey(path, n)}@${w}x${h}`;
    const hit = this.frames.get(key);
    if (hit) {
      this.frames.delete(key); this.frames.set(key, hit); // LRU nach vorne
      if (hit.queued && !background) { hit.queued = false; this.queue.add(-1, 'frame:' + key); }
      return hit.promise;
    }
    const job = async () => {
      const page = await this.page(path, n);
      const vp1 = page.getViewport({ scale: 1 });
      const s = Math.min(w / vp1.width, h / vp1.height);
      const vp = page.getViewport({ scale: s });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(vp.width));
      c.height = Math.max(1, Math.floor(vp.height));
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      return c;
    };
    const entry = { queued: background };
    entry.promise = background
      ? this.queue.add(PRIO.prerender, 'frame:' + key, job)
      : job();
    entry.promise.catch(() => this.frames.delete(key));
    this.frames.set(key, entry);
    while (this.frames.size > this.maxFrames) this.frames.delete(this.frames.keys().next().value);
    return entry.promise;
  }

  /**
   * Gezoomter Ausschnitt direkt in eine Leinwand rendern.
   * zoom: { z, x, y } mit z = Vergroesserung (1 = eingepasst), x/y = Mittelpunkt in Seitenanteilen (0..1).
   */
  async renderZoomed(canvas, path, n, cssW, cssH, dpr, zoom, token, bg = '#000') {
    const page = await this.page(path, n);
    const vp1 = page.getViewport({ scale: 1 });
    const fit = Math.min(cssW / vp1.width, cssH / vp1.height);
    const scale = fit * zoom.z * dpr;
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    const offsetX = W / 2 - zoom.x * vp1.width * scale;
    const offsetY = H / 2 - zoom.y * vp1.height * scale;
    const vp = page.getViewport({ scale, offsetX, offsetY });
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const ctx = tmp.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(offsetX, offsetY, vp1.width * scale, vp1.height * scale);
    await page.render({ canvasContext: ctx, viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
    if (token && token.cancelled) return false;
    canvas.width = W; canvas.height = H;
    canvas.getContext('2d').drawImage(tmp, 0, 0);
    return true;
  }

  /** Vorab im Hintergrund rendern, damit der naechste Folienwechsel sofort klappt. */
  prerender(path, n, w, h) {
    this.frame(path, n, w, h, { background: true }).catch(() => {});
  }

  /** Miniatur als Bild-URL (JPEG), in der Hintergrundwarteschlange erzeugt. */
  thumb(path, n, prio = PRIO.thumb) {
    const k = slideKey(path, n);
    if (this.thumbs.has(k)) return Promise.resolve(this.thumbs.get(k));
    return this.queue.add(prio, 'thumb:' + k, async () => {
      if (this.thumbs.has(k)) return this.thumbs.get(k);
      const page = await this.page(path, n);
      const vp1 = page.getViewport({ scale: 1 });
      const s = Math.min(1.5, 480 / vp1.width);
      const vp = page.getViewport({ scale: s });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.84));
      const url = URL.createObjectURL(blob);
      this.thumbs.set(k, url);
      return url;
    });
  }

  /** Volltext aller Seiten eines PDFs (Array, Index 0 = Seite 1). */
  text(path) {
    if (this.texts.has(path)) return this.texts.get(path);
    const p = this.queue.add(PRIO.text, 'text:' + path, async () => {
      const e = await this.open(path);
      if (e.status !== 'ok') return [];
      const out = [];
      for (let i = 1; i <= e.pages; i++) {
        const page = await e.doc.getPage(i);
        const tc = await page.getTextContent();
        out.push(tc.items.map((it) => (it.str || '') + (it.hasEOL ? ' ' : '')).join(' ').replace(/\s+/g, ' ').trim());
      }
      return out;
    });
    p.catch(() => this.texts.delete(path));
    this.texts.set(path, p);
    return p;
  }
}
