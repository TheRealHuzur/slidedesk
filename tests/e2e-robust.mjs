// Robustheit: neue PDF-Version, fehlende Datei, Offline-Betrieb, Aenderung von anderem Geraet.
import { chromium, server, watch, SHOTS, sleep, BASE, canvasHasContent } from './helpers.mjs';
import { setupSeminar } from './setup.mjs';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const srv = await server();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = []; watch(page, errors);
const fails = [];
const expect = (c, m) => { if (!c) { fails.push(m); console.log('  ✗', m); } else console.log('  ✓', m); };
const step = (s) => console.log('·', s);
const writeOpfs = (path, b64) => page.evaluate(async ({ path, b64 }) => {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('demo-ablage');
  const parts = path.split('/'); let d = root;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
  const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
  if (b64 === null) { await w.close(); return; }
  await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); await w.close();
}, { path, b64 });
try {
  await setupSeminar(page);
  step('Neue PDF-Version wird automatisch übernommen');
  execSync(`python3 - <<'PY'
from reportlab.pdfgen import canvas
c = canvas.Canvas('/tmp/claude-0/neu.pdf', pagesize=(960,540))
for i in range(1,3):
    c.setFont('Helvetica-Bold', 40); c.drawString(60, 300, f'Neue Version Folie {i}'); c.showPage()
c.save()
PY`);
  await sleep(1100); // lastModified muss sich unterscheiden
  await writeOpfs('Seminarunterlagen/Duisburg/Einstieg Duisburg.pdf', readFileSync('/tmp/claude-0/neu.pdf').toString('base64'));
  await page.click('.side-item:has-text("Einstellungen")');
  await page.click('.side-item:has-text("Prozessmanagement Duisburg")');
  await page.waitForFunction(() => /bereit/.test(document.querySelector('.start-status')?.textContent || ''));
  const pages = await page.textContent('.pl-row >> nth=0 >> .pl-pages');
  expect(pages.trim() === '2 Folien', `Ablauf zeigt neue Seitenzahl (${pages.trim()})`);
  await page.click('text=Präsentieren');
  await page.waitForFunction(() => window.app.show.active && !window.app.show.loading);
  expect(await page.evaluate(() => window.app.show.items[0].pages === 2), 'Präsentation nutzt die neue Version');
  const txt = await page.evaluate(() => window.app.lib.text('Seminarunterlagen/Duisburg/Einstieg Duisburg.pdf'));
  expect(/Neue Version/.test(txt[0]), 'Suche kennt den neuen Text');
  await page.keyboard.press('x'); await page.keyboard.press('Enter'); await sleep(400);

  step('Fehlende Datei');
  await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('demo-ablage');
    await (await root.getDirectoryHandle('Module')).removeEntry('BPMN Diagramme.pdf');
    window.app.checks.clear(); window.app.renderContent();
  });
  await page.waitForSelector('.pl-row.missing');
  expect(await page.isVisible('.start-status .chip.err'), 'Fehlende Datei wird vor dem Start angezeigt');
  await page.screenshot({ path: SHOTS + '/30-missing.png' });
  await page.click('text=Präsentieren');
  await page.waitForFunction(() => window.app.show.active && !window.app.show.loading);
  expect(await page.evaluate(() => window.app.show.items.length === 2), 'Präsentation überspringt die fehlende Datei');
  await page.keyboard.press('1'); await sleep(300);
  expect(await page.evaluate(() => window.app.show.pos.i === 0), 'Schnelltaste auf fehlende Datei springt nicht ins Leere');
  await page.keyboard.press('x'); await page.keyboard.press('Enter'); await sleep(400);

  step('PDF ersetzen über Auswahl');
  await page.click('.pl-row.missing >> button:has-text("Ersetzen")');
  await page.waitForSelector('.pk-row');
  await page.fill('.modal input[type=search]', 'newsletter');
  await page.waitForSelector('.pk-row.file');
  await page.dblclick('.pk-row.file');
  await page.waitForFunction(() => !document.querySelector('.pl-row.missing'));
  expect(await page.evaluate(() => window.app.store.seminar('sem1').items[2].path === 'Marketing/Pause Newsletter.pdf'), 'Eintrag ersetzt, Position bleibt');
  expect(await page.evaluate(() => window.app.store.seminar('sem1').hotkeys[1].path === 'Marketing/Pause Newsletter.pdf'), 'Schnelltaste zieht mit');

  step('Änderung von anderem Gerät (Drive-Sync)');
  await sleep(1200);
  await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('demo-ablage');
    const fh = await (await root.getDirectoryHandle('SlideDESK')).getFileHandle('slidedesk.json');
    const data = JSON.parse(await (await fh.getFile()).text());
    data.seminars.push({ id: 'sem2', name: 'Vom PC zu Hause', items: [], hotkeys: {}, pause: null, protocols: [] });
    const w = await fh.createWritable(); await w.write(JSON.stringify(data)); await w.close();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForSelector('.side-item:has-text("Vom PC zu Hause")', { timeout: 5000 });
  expect(true, 'Seminar vom anderen Gerät erscheint nach Rückkehr ins Fenster');

  step('Offline');
  await page.goto(BASE + '?ablage=demo');
  await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true), null, { timeout: 10000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await sleep(1500);
  await page.reload(); await sleep(800);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller), 'Service Worker aktiv');
  srv.kill(); await sleep(400);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.topbar', { timeout: 8000 });
  await page.click('.side-item:has-text("Prozessmanagement Duisburg")');
  await page.waitForFunction(() => /bereit/.test(document.querySelector('.start-status')?.textContent || ''), null, { timeout: 10000 });
  await page.click('text=Präsentieren');
  await page.waitForFunction(() => window.app.show.active && !window.app.show.loading);
  await sleep(800);
  expect((await canvasHasContent(page, '.stage .slide-canvas')).ok, 'Präsentieren ohne Server und ohne Netz');
} catch (e) { fails.push(e.message); console.log('FEHLER', e.message); await page.screenshot({ path: SHOTS + '/err-robust.png' }); }
console.log(errors.filter((e) => !/willReadFrequently|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)).join('\n') || 'keine Konsolenfehler');
console.log(fails.length ? `${fails.length} FEHLGESCHLAGEN` : 'ALLES OK');
await browser.close(); try { srv.kill(); } catch {}
