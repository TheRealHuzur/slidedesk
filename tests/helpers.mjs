// Gemeinsame Testhelfer: lokaler Server, Browser, Demo-Ablage im Browserspeicher befuellen.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
const require = createRequire(import.meta.url);
export const { chromium } = require('/opt/npm-tools/node_modules/playwright');

export const ROOT = new URL('..', import.meta.url).pathname;
export const PORT = 8123;
export const BASE = `http://localhost:${PORT}/`;
export const SHOTS = join(ROOT, 'tests/shots');
mkdirSync(SHOTS, { recursive: true });

export async function server() {
  const p = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  return p;
}

export function ablageFiles(dir = join(ROOT, 'tests/ablage')) {
  const out = [];
  const walk = (p) => { for (const n of readdirSync(p)) { const f = join(p, n); if (statSync(f).isDirectory()) walk(f); else out.push([relative(dir, f), readFileSync(f).toString('base64')]); } };
  walk(dir);
  return out;
}

export async function seed(page, files, { reset = true } = {}) {
  await page.evaluate(async ({ files, reset }) => {
    const opfs = await navigator.storage.getDirectory();
    if (reset) { try { await opfs.removeEntry('demo-ablage', { recursive: true }); } catch {} }
    const root = await opfs.getDirectoryHandle('demo-ablage', { create: true });
    for (const [path, b64] of files) {
      const parts = path.split('/');
      let d = root;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
      const fh = await d.getFileHandle(parts.at(-1), { create: true });
      const w = await fh.createWritable();
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await w.write(bin); await w.close();
    }
  }, { files, reset });
}

export async function readData(page) {
  return page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const root = await opfs.getDirectoryHandle('demo-ablage');
    const dir = await root.getDirectoryHandle('SlideDESK');
    const f = await (await dir.getFileHandle('slidedesk.json')).getFile();
    return JSON.parse(await f.text());
  });
}

export function watch(page, errors, label = 'main') {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${label} ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${label} pageerror] ${e.message}\n${e.stack}`));
}

/** Prueft, ob in einer Leinwand sichtbarer, nicht schwarzer Inhalt ist. */
export async function canvasHasContent(page, selector) {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel);
    if (!c || !c.width) return { ok: false, why: 'keine Leinwand' };
    const ctx = c.getContext('2d');
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let bright = 0;
    for (let i = 0; i < data.length; i += 4 * 97) if (data[i] + data[i + 1] + data[i + 2] > 600) bright++;
    return { ok: bright > 20, bright, w: c.width, h: c.height };
  }, selector);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
