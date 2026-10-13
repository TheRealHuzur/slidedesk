// Zwei-Bildschirm-Modus. Variante B (Beamerfenster) echt, Variante A mit simulierten Bildschirmen.
import { chromium, server, watch, SHOTS, sleep, canvasHasContent } from './helpers.mjs';
import { setupSeminar } from './setup.mjs';
const srv = await server();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = []; watch(page, errors);
ctx.on('page', (p) => watch(p, errors, 'popup'));
const fails = [];
const expect = (c, m) => { if (!c) { fails.push(m); console.log('  ✗', m); } else console.log('  ✓', m); };
const step = (s) => console.log('·', s);
const st = () => page.evaluate(() => { const s = window.app.show; return { i: s.pos.i, p: s.pos.p, cue: s.cue, paused: s.paused, mode: s.mode, overlay: s.overlay?.type || null, active: s.active }; });
try {
  // ---------- Variante B ----------
  await setupSeminar(page, { mode: 'dual' });
  step('Variante B: ein Bildschirm erkannt, Beamerfenster');
  await page.evaluate(() => { window.app.launcher.screens = { screens: [{}], currentScreen: {} }; window.app.refreshStartBox(); });
  await page.click('text=Präsentieren');
  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }), page.click('text=Mit Beamerfenster')]);
  await popup.waitForSelector('.stage', { timeout: 8000 });
  await page.waitForSelector('.presenter');
  await page.waitForFunction(() => !window.app.show.loading);
  await sleep(1200);
  expect((await canvasHasContent(popup, '.stage .slide-canvas')).ok, 'Beamerfenster zeigt die Folie');
  expect(await popup.isVisible('.stage-hint'), 'Beamerfenster bittet um Vollbild');
  expect(await page.isVisible('.pv-warn'), 'Referentenansicht warnt: Beamer nicht im Vollbild');
  await page.screenshot({ path: SHOTS + '/20-presenter.png' });
  await popup.screenshot({ path: SHOTS + '/21-beamer-window.png' });

  step('Vorhören');
  await page.keyboard.press('s'); await sleep(200);
  await page.keyboard.type('BPMN Diagramm 4');
  await page.waitForFunction(() => document.querySelectorAll('.ov-row').length > 0, null, { timeout: 8000 });
  await page.keyboard.press('Enter'); await sleep(700);
  let s = await st();
  expect(s.cue && s.cue.i === 2 && s.cue.p === 4 && s.i === 0 && s.p === 1, 'Suche hört vor, Beamer bleibt auf Folie 1');
  expect(await popup.evaluate(() => window.opener.app.show.live().page === 1), 'Beamer zeigt weiter die alte Folie');
  await page.screenshot({ path: SHOTS + '/22-cued.png' });
  await page.keyboard.press('Alt+ArrowRight'); await sleep(200);
  s = await st(); expect(s.cue.p === 5, 'Alt+Pfeil blättert in der Vorschau weiter');
  await page.keyboard.press('Enter'); await sleep(600);
  s = await st(); expect(!s.cue && s.i === 2 && s.p === 5, 'Enter schickt die Folie auf den Beamer');
  await page.keyboard.press('Backspace'); await sleep(300);
  s = await st(); expect(s.i === 0 && s.p === 1, 'Rücktaste: zurück zum Ausgangspunkt');
  await page.click('.pv-strip .pv-thumb >> nth=2'); await sleep(300);
  s = await st(); expect(s.cue && s.cue.p === 3 && s.p === 1, 'Klick im Filmstreifen hört vor');
  await page.keyboard.press('Escape'); await sleep(200);
  s = await st(); expect(!s.cue, 'Esc verwirft das Vorhören');
  await page.keyboard.press('o'); await sleep(500);
  expect(await popup.evaluate(() => !document.querySelector('.ov-wrap')), 'Übersicht erscheint nicht auf dem Beamer');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowRight'); await sleep(300);
  s = await st(); expect(s.p === 2, 'Pfeiltaste auf dem Laptop blättert direkt');
  await popup.keyboard.press('ArrowRight'); await sleep(300);
  s = await st(); expect(s.p === 3, 'Pfeiltaste im Beamerfenster blättert ebenfalls');
  await page.keyboard.press('p'); await sleep(500);
  expect(await page.isVisible('.pv-badge.pause'), 'Referentenansicht zeigt PAUSE');
  await page.screenshot({ path: SHOTS + '/23-presenter-pause.png' });
  await page.keyboard.press('p');

  step('Beamerfenster schließen und wieder öffnen');
  await popup.close(); await sleep(500);
  expect(await page.isVisible('.pv-warn button'), 'Knopf „Beamerfenster öffnen“ erscheint');
  const [pop2] = await Promise.all([ctx.waitForEvent('page'), page.click('.pv-warn button')]);
  await pop2.waitForSelector('.stage'); await sleep(800);
  expect((await canvasHasContent(pop2, '.stage .slide-canvas')).ok, 'Neues Beamerfenster zeigt die aktuelle Folie');

  step('Beenden');
  await page.keyboard.press('x'); await page.keyboard.press('Enter'); await sleep(600);
  s = await st(); expect(!s.active && pop2.isClosed(), 'Beendet, Beamerfenster geschlossen');
  expect(await page.isVisible('.sem-name'), 'Zurück in der Verwaltung');

  // ---------- Variante A (simuliert) ----------
  step('Variante A: zwei Bildschirme (simuliert)');
  await page.evaluate(() => {
    const laptop = { isInternal: true, label: 'Laptop', width: 1440, height: 900, availLeft: 0, availTop: 0, availWidth: 1440, availHeight: 900 };
    const beamer = { isInternal: false, label: 'Beamer', width: 1920, height: 1080, availLeft: 1440, availTop: 0, availWidth: 1920, availHeight: 1080 };
    window.app.launcher.screens = { screens: [laptop, beamer], currentScreen: laptop, addEventListener() {} };
    window.app.refreshStartBox();
  });
  const [refPop] = await Promise.all([ctx.waitForEvent('page'), page.click('text=Präsentieren')]);
  await refPop.waitForSelector('.presenter', { timeout: 8000 });
  await page.waitForSelector('.stage');
  await sleep(1200);
  expect((await canvasHasContent(page, '.stage .slide-canvas')).ok, 'Hauptfenster ist die Bühne');
  expect(await refPop.isVisible('.pv-live'), 'Referentenansicht im eigenen Fenster');
  await refPop.keyboard.press('ArrowRight'); await sleep(300);
  s = await st(); expect(s.p === 2, 'Steuerung aus der Referentenansicht');
  await refPop.screenshot({ path: SHOTS + '/24-presenter-popup.png' });
  step('Referentenansicht schließen: weiter im Spiegelbetrieb');
  await refPop.close(); await sleep(600);
  s = await st(); expect(s.active && s.mode === 'mirror', 'Präsentation läuft weiter, Steuerung auf der Bühne');
  await page.keyboard.press('o'); await sleep(400);
  expect(await page.isVisible('.ov-wrap'), 'Übersicht jetzt auf der Bühne');
  await page.keyboard.press('Escape'); await page.keyboard.press('x'); await page.keyboard.press('Enter'); await sleep(500);
  s = await st(); expect(!s.active, 'Beendet');
} catch (e) { fails.push(e.message); console.log('FEHLER', e.message); await page.screenshot({ path: SHOTS + '/err-dual.png' }); }
console.log(errors.filter((e) => !/willReadFrequently|Vollbild nicht möglich/.test(e)).join('\n') || 'keine Konsolenfehler');
console.log(fails.length ? `${fails.length} FEHLGESCHLAGEN` : 'ALLES OK');
await browser.close(); srv.kill();
