// Verwaltung: Seminar anlegen, PDFs aus der Ablage, Schnelltaste, Pausenfolien.
import { chromium, server, BASE, seed, ablageFiles, watch, SHOTS, sleep, readData } from './helpers.mjs';
const srv = await server();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
watch(page, errors);
const step = (s) => console.log('·', s);
try {
  await page.goto(BASE + '?ablage=demo');
  await seed(page, ablageFiles());
  await page.reload();
  await page.waitForSelector('.topbar');

  step('Seminar anlegen');
  await page.click('text=+ Neues Seminar');
  await page.fill('.modal input', 'Prozessmanagement Duisburg');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.sem-name');

  step('PDFs aus der Ablage hinzufügen');
  await page.click('text=+ PDF aus der Ablage');
  await page.waitForSelector('.pk-row');
  await page.click('.pk-row.dir:has-text("Seminarunterlagen")');
  await page.click('.pk-row.dir:has-text("Duisburg")');
  await page.check('.pk-row.file:has-text("Einstieg Duisburg") input');
  await page.click('.crumb:has-text("demo-ablage")');
  await page.waitForSelector('.pk-row.dir:has-text("Module")');
  await page.click('.pk-row.dir:has-text("Module")');
  await page.check('.pk-row.file:has-text("Prozessmanagement Grundlagen") input');
  await page.check('.pk-row.file:has-text("BPMN Diagramme") input');
  await page.screenshot({ path: SHOTS + '/02-picker.png' });
  await page.click('.modal-actions .btn.primary');
  await page.waitForSelector('.pl-row >> nth=2');
  await page.waitForFunction(() => document.querySelectorAll('.pl-row .chip.ok').length === 3, null, { timeout: 10000 });
  console.log('  Status:', await page.textContent('.start-status'));

  step('Suche in der Ablage');
  await page.click('text=+ PDF aus der Ablage');
  await page.fill('.modal input[type=search]', 'pause');
  await page.waitForSelector('.pk-row.file:has-text("Pause Newsletter")');
  await page.keyboard.press('Escape');

  step('Reihenfolge per Knopf');
  await page.click('.pl-row >> nth=2 >> button[title="Nach oben"]');
  console.log('  Reihenfolge:', (await page.$$eval('.pl-title', (els) => els.map((e) => e.textContent))).join(' | '));

  step('Schnelltaste über Folienansicht');
  await page.click('.pl-row >> nth=0 >> button:has-text("Folien")');
  await page.waitForSelector('.pl-expand .thumb-cell');
  await page.click('.pl-expand .thumb-cell >> nth=2');
  await page.click('.popover .btn:has-text("1")');
  await page.waitForSelector('.hk-cell:not(.free)');
  step('Schnelltaste über Auswahl');
  await page.click('.hk-cell >> nth=1 >> text=Festlegen');
  await page.waitForSelector('.modal .thumb-cell');
  await page.click('.modal .sp-group >> nth=1 >> .thumb-cell >> nth=0');
  await sleep(200);
  console.log('  Belegte Tasten:', await page.$$eval('.hk-cell:not(.free) .hk-key', (e) => e.map((x) => x.textContent).join(',')));

  step('Allgemeine Pausenfolien');
  await page.click('.side-item:has-text("Pausenfolien")');
  await page.click('text=+ Folien aus PDF hinzufügen');
  await page.click('.pk-row.dir:has-text("Marketing")').catch(async () => { await page.click('.crumb >> nth=0'); await page.click('.pk-row.dir:has-text("Marketing")'); });
  await page.check('.pk-row.file:has-text("Pause Newsletter") input');
  await page.click('.modal-actions .btn.primary');
  await page.waitForSelector('.modal .thumb-cell.picked');
  await sleep(300);
  await page.click('.modal-actions .btn.primary:has-text("Übernehmen")');
  await page.waitForSelector('.pause-editor .thumb-cell');
  console.log('  Pausenfolien:', await page.$$eval('.pause-editor .thumb-cell', (e) => e.length));
  await sleep(500);
  await page.screenshot({ path: SHOTS + '/03-pause.png' });

  step('Einstellungen: Verweildauer 1 s');
  await page.click('.side-item:has-text("Einstellungen")');
  await page.fill('.content input[type=number]', '1');
  await page.press('.content input[type=number]', 'Enter');
  await page.locator('.content input[type=number]').blur();
  await page.screenshot({ path: SHOTS + '/04-settings.png' });

  await page.click('.side-item:has-text("Prozessmanagement Duisburg")');
  await page.waitForFunction(() => document.querySelectorAll('img.thumb.ok').length >= 3, null, { timeout: 10000 });
  await sleep(600);
  await page.screenshot({ path: SHOTS + '/05-seminar.png', fullPage: true });

  await sleep(800);
  const data = await readData(page);
  console.log('  Gespeichert:', JSON.stringify({ seminars: data.seminars.length, items: data.seminars[0].items.map((i) => i.path), hotkeys: data.seminars[0].hotkeys, pause: data.pause.slides.length, dwell: data.settings.dwell }));
  console.log('ALLES OK');
} catch (e) { console.log('FEHLER', e.message); await page.screenshot({ path: SHOTS + '/err-admin.png' }); }
console.log(errors.join('\n') || 'keine Konsolenfehler');
await browser.close(); srv.kill();
