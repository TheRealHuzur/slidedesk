// Bereits installierte Cache-Version auf die neue App aktualisieren und offline neu starten.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, ROOT, seed, readData } from './helpers.mjs';

let upgraded = false;
const previous = 'slidedesk-before-links';
const oldWorker = `
self.addEventListener('install', e => e.waitUntil((async () => {
  const cache = await caches.open('${previous}');
  await cache.addAll(['./', 'index.html']); await self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => e.respondWith((async () =>
  (await caches.match(e.request, {ignoreSearch: true})) || fetch(e.request))()));
`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/') path = '/index.html';
    const filename = resolve(ROOT, '.' + path);
    if (!filename.startsWith(resolve(ROOT) + '/')) { res.writeHead(403).end(); return; }
    let body;
    if (!upgraded && path === '/sw.js') body = oldWorker;
    else if (!upgraded && path === '/index.html') body = '<!doctype html><title>Vorherige Version</title><h1>Vorherige Version</h1>';
    else body = await readFile(filename);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${srv.address().port}/`;
let browser;
let page;
const errors = [];
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext();
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + '?ablage=demo');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
  });
  const data = {
    version: 1,
    seminars: [{ id: 'old', name: 'Bestehendes Seminar', items: [], hotkeys: {}, pause: null, protocols: [], custom: 'behalten' }],
    pause: { slides: [], interval: 15 }, settings: { dwell: 5, mode: 'mirror' },
  };
  await seed(page, [['SlideDESK/slidedesk.json', Buffer.from(JSON.stringify(data)).toString('base64')]]);
  await page.reload();
  assert.match(await page.title(), /Vorherige/);
  assert.ok(await page.evaluate((key) => caches.has(key), previous));
  upgraded = true;
  const assets = JSON.parse(await readFile(resolve(ROOT, 'assets.json'), 'utf8'));
  await page.evaluate(async () => {
    const old = navigator.serviceWorker.controller;
    const changed = new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    await (await navigator.serviceWorker.getRegistration()).update();
    if (navigator.serviceWorker.controller === old) await changed;
  });
  await page.waitForFunction(async ({ current, previous }) =>
    (await caches.has(current)) && !(await caches.has(previous)),
  { current: 'slidedesk-' + assets.version, previous }, { timeout: 20000 });
  await page.reload();
  await page.waitForSelector('.seminar-links', { timeout: 5000 });
  assert.equal(await page.locator('.sem-name').inputValue(), 'Bestehendes Seminar');
  await page.evaluate(() => window.app.store.save());
  const after = await readData(page);
  assert.equal(after.seminars[0].custom, 'behalten');
  assert.deepEqual(after.seminars[0].links, []);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.seminar-links');
  assert.equal(await page.locator('.sem-name').inputValue(), 'Bestehendes Seminar');
  console.log('ALLES OK: bestehender Offline-Cache aktualisiert, Seminar erhalten, neue App offline gestartet');
} catch (error) {
  console.error('FEHLER', error.stack);
  if (page) console.error('Diagnose:', await page.evaluate(async () => ({
    url: location.href, title: document.title, text: document.body.innerText.slice(0, 1000),
    caches: await caches.keys(), worker: navigator.serviceWorker.controller?.scriptURL,
    html: await (await caches.match(new URL('./', location.href)))?.text(),
  })).catch(() => null), errors);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolve) => srv.close(resolve));
}
