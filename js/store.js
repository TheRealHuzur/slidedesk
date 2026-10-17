// Ablage und Speicherdatei.
// Die App bekommt einmal einen Oberordner freigegeben (z. B. "Operatives Geschäft").
// PDFs werden nur ueber relative Pfade in diesem Ordner referenziert.
// Einstellungen und Seminare liegen in <Oberordner>/SlideDESK/slidedesk.json.

import { debounce, uid } from './util.js';

const DB = 'slidedesk';
const DATA_DIR = 'SlideDESK';
const DATA_FILE = 'slidedesk.json';
export const DATA_VERSION = 1;

// ---------- IndexedDB fuer den Ordner-Handle (nur auf diesem Geraet) ----------
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kv(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}
export const kvGet = (k) => kv('readonly', (s) => s.get(k));
export const kvSet = (k, v) => kv('readwrite', (s) => s.put(v, k));
export const kvDel = (k) => kv('readwrite', (s) => s.delete(k));

export const fsSupported = () => typeof window.showDirectoryPicker === 'function';

/** Demo-Ablage im Browserspeicher (fuer Tests und zum Ausprobieren ohne Freigabe). */
export const isDemo = () => new URLSearchParams(location.search).get('ablage') === 'demo';

async function demoRoot() {
  const opfs = await navigator.storage.getDirectory();
  return opfs.getDirectoryHandle('demo-ablage', { create: true });
}

export async function storedRoot() {
  if (isDemo()) return demoRoot();
  try { return (await kvGet('root')) || null; } catch { return null; }
}

/** 'granted' | 'prompt' | 'denied' */
export async function permissionState(handle) {
  if (!handle.queryPermission) return 'granted'; // OPFS
  return handle.queryPermission({ mode: 'readwrite' });
}

/** Muss aus einer Nutzeraktion heraus aufgerufen werden. */
export async function requestPermission(handle) {
  if (!handle.requestPermission) return 'granted';
  return handle.requestPermission({ mode: 'readwrite' });
}

export async function pickRoot() {
  const handle = await window.showDirectoryPicker({ id: 'slidedesk-ablage', mode: 'readwrite' });
  await kvSet('root', handle);
  return handle;
}

export async function forgetRoot() { await kvDel('root'); }

// ---------- Pfade ----------
export async function fileByPath(root, path) {
  const parts = path.split('/').filter(Boolean);
  let dir = root;
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  return dir.getFileHandle(parts[parts.length - 1]);
}

/** Relativer Pfad eines Handles innerhalb der Ablage, oder null wenn ausserhalb. */
export async function relPath(root, handle) {
  try {
    const parts = await root.resolve(handle);
    return parts ? parts.join('/') : null;
  } catch { return null; }
}

/** Inhalt eines Ordners: Unterordner und PDFs, sortiert. */
export async function listDir(root, path = '') {
  let dir = root;
  for (const p of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(p);
  const dirs = [];
  const files = [];
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith('.') || name.startsWith('~$')) continue;
    if (handle.kind === 'directory') dirs.push(name);
    else if (/\.pdf$/i.test(name)) files.push(name);
  }
  const cmp = (a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });
  return { dirs: dirs.sort(cmp), files: files.sort(cmp) };
}

/** Rekursive Suche nach PDFs (begrenzt, damit grosse Drive-Ordner nicht ewig laufen). */
export async function findPdfs(root, query, { maxDepth = 7, limit = 300, signal } = {}) {
  const q = query.toLowerCase();
  const out = [];
  async function walk(dir, prefix, depth) {
    if (depth > maxDepth || out.length >= limit || signal?.aborted) return;
    const subs = [];
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith('.') || name.startsWith('~$')) continue;
      const p = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') { if (name !== DATA_DIR) subs.push([handle, p]); }
      else if (/\.pdf$/i.test(name) && p.toLowerCase().includes(q)) out.push(p);
      if (out.length >= limit) return;
    }
    for (const [h, p] of subs) await walk(h, p, depth + 1);
  }
  await walk(root, '', 0);
  return out.sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
}

// ---------- Speicherdatei ----------
export function emptyData() {
  return {
    version: DATA_VERSION,
    seminars: [],
    pause: { slides: [], interval: 15 },
    settings: { dwell: 5, mode: 'mirror' },
  };
}

export function newSeminar(name) {
  return { id: uid(), name, items: [], links: [], hotkeys: {}, pause: null, protocols: [], created: Date.now(), updated: Date.now() };
}

function normalizeData(d) {
  const e = emptyData();
  const out = { ...e, ...d, pause: { ...e.pause, ...(d.pause || {}) }, settings: { ...e.settings, ...(d.settings || {}) } };
  out.seminars = (out.seminars || []).map((s) => ({ hotkeys: {}, pause: null, protocols: [], items: [], ...s, links: Array.isArray(s.links) ? s.links : [] }));
  return out;
}

export class Store {
  constructor(root) {
    this.root = root;
    this.data = emptyData();
    this.lastWrite = 0;
    this.saveSoon = debounce(() => this.save(), 400);
    this.saving = Promise.resolve();
  }

  async dataFile(create) {
    const dir = await this.root.getDirectoryHandle(DATA_DIR, { create });
    return dir.getFileHandle(DATA_FILE, { create });
  }

  async load() {
    try {
      const fh = await this.dataFile(false);
      const file = await fh.getFile();
      this.fileModified = file.lastModified;
      const text = await file.text();
      this.lastText = text;
      this.data = normalizeData(JSON.parse(text || '{}'));
    } catch (e) {
      if (e.name === 'NotFoundError') this.data = emptyData();
      else if (e instanceof SyntaxError) {
        // Defekte Datei nicht ueberschreiben, sondern zur Seite legen.
        await this.backupBroken();
        this.data = emptyData();
        this.loadWarning = 'Die Speicherdatei war beschädigt und wurde als Sicherung abgelegt.';
      } else throw e;
    }
    return this.data;
  }

  async backupBroken() {
    try {
      const dir = await this.root.getDirectoryHandle(DATA_DIR);
      const src = await (await dir.getFileHandle(DATA_FILE)).getFile();
      const bak = await dir.getFileHandle(`slidedesk-defekt-${Date.now()}.json`, { create: true });
      const w = await bak.createWritable();
      await w.write(await src.text());
      await w.close();
    } catch (e) { console.warn(e); }
  }

  /** Prueft, ob die Datei inzwischen von einem anderen Geraet geaendert wurde (Drive-Sync). */
  async changedElsewhere() {
    try {
      await this.saving;
      const file = await (await this.dataFile(false)).getFile();
      if (file.lastModified === this.fileModified) return false;
      return (await file.text()) !== this.lastText;
    } catch { return false; }
  }

  save() {
    this.saving = this.saving.then(async () => {
      const fh = await this.dataFile(true);
      const text = JSON.stringify(this.data, null, 2);
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
      this.lastText = text;
      this.lastWrite = Date.now();
      try { this.fileModified = (await fh.getFile()).lastModified; } catch {}
    }).catch((e) => {
      console.error('Speichern fehlgeschlagen', e);
      this.onError?.(e);
    });
    return this.saving;
  }

  seminar(id) { return this.data.seminars.find((s) => s.id === id); }

  touch(sem) {
    if (sem) sem.updated = Date.now();
    this.saveSoon();
  }
}
