// Gespiegelter Modus: Navigation, PDF-Wechsel, Uebersicht, Suche, Schnelltasten, Zoom, Pause, Protokoll.
import { chromium, server, watch, SHOTS, sleep, canvasHasContent, readData } from './helpers.mjs';
import { setupSeminar } from './setup.mjs';
const srv = await server();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = []; watch(page, errors);
const step = (s) => console.log('·', s);
const state = () => page.evaluate(() => { const s = window.app.show; return { i: s.pos.i, p: s.pos.p, paused: s.paused, zoom: +s.zoom.z.toFixed(2), overlay: s.overlay?.type || null, active: s.active, loading: s.loading }; });
const key = async (k, wait = 250) => { await page.keyboard.press(k); await sleep(wait); };
const fails = [];
const expect = (cond, msg) => { if (!cond) { fails.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };
try {
  await setupSeminar(page);
  step('Starten');
  await page.click('text=Präsentieren');
  await page.waitForFunction(() => window.app.show.active && !window.app.show.loading, null, { timeout: 10000 });
  await sleep(700);
  expect(await page.evaluate(() => !!document.fullscreenElement), 'Vollbild aktiv');
  expect((await canvasHasContent(page, '.stage .slide-canvas')).ok, 'Folie auf der Bühne gerendert');
  await page.screenshot({ path: SHOTS + '/10-stage.png' });

  step('Navigation');
  await key('ArrowRight'); await key('ArrowRight');
  let s = await state(); expect(s.i === 0 && s.p === 3, `Folie 3 erreicht (${s.i}/${s.p})`);
  await key('ArrowRight'); await key('ArrowRight', 400);
  s = await state(); expect(s.i === 1 && s.p === 1, `Wechsel ins nächste PDF ohne Unterbrechung (${s.i}/${s.p})`);
  expect(await page.evaluate(() => !!document.fullscreenElement), 'Vollbild bleibt beim PDF-Wechsel');
  await key('ArrowLeft'); s = await state(); expect(s.i === 0 && s.p === 4, 'Zurück ins vorige PDF, letzte Folie');
  await key('Shift+ArrowRight'); s = await state(); expect(s.i === 1 && s.p === 1, 'Umschalt+Pfeil springt ins nächste PDF');
  const t0 = Date.now(); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.stage .slide-box')?.dataset, null);
  await sleep(120);
  const pre = await page.evaluate(() => [...window.app.lib.frames.keys()].length);
  expect(pre >= 3, `Vorab gerenderte Folien im Speicher: ${pre}`);

  step('Gehe zu');
  await key('g'); await page.keyboard.type('7'); await key('Enter', 400);
  s = await state(); expect(s.i === 1 && s.p === 7 && !s.overlay, `Gehe zu Folie 7 (${s.p})`);

  step('Schnelltaste und Rücksprung');
  await key('1', 400); s = await state(); expect(s.i === 2 && s.p === 3, 'Taste 1 springt zu BPMN Folie 3');
  await key('Backspace', 400); s = await state(); expect(s.i === 1 && s.p === 7, 'Rücktaste zurück zu Folie 7');
  await key('Shift+Digit5', 300);
  expect(await page.evaluate(() => window.app.store.seminar('sem1').hotkeys[5]?.page === 7), 'Umschalt+5 belegt Taste 5');
  await page.screenshot({ path: SHOTS + '/11-hotkey-toast.png' });

  step('Übersicht');
  await key('o', 800);
  expect((await state()).overlay === 'overview', 'Übersicht offen');
  await page.waitForFunction(() => document.querySelectorAll('.ov-cell img[src]').length > 5, null, { timeout: 8000 });
  await page.screenshot({ path: SHOTS + '/12-overview.png' });
  await key('ArrowRight'); await key('ArrowRight'); await key('Enter', 400);
  s = await state(); expect(s.i === 1 && s.p === 9 && !s.overlay, `Übersicht: zwei weiter und Enter (${s.i}/${s.p})`);

  step('Suche');
  await key('s', 300);
  await page.keyboard.type('Arbeitsplatzmethode');
  await page.waitForFunction(() => document.querySelectorAll('.ov-row').length > 0, null, { timeout: 8000 });
  await sleep(500);
  await page.screenshot({ path: SHOTS + '/13-search.png' });
  await key('Enter', 400);
  s = await state(); expect(s.i === 1 && s.p === 13, `Suche findet Personalbedarfsermittlung auf Folie 13 (${s.p})`);

  step('Zoom');
  await key('c'); // unbelegt
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -600); await sleep(500);
  s = await state(); expect(s.zoom > 1.5, `Mausrad zoomt (${s.zoom})`);
  await page.mouse.down(); await page.mouse.move(500, 300, { steps: 5 }); await page.mouse.up(); await sleep(400);
  await key('+', 600);
  expect((await canvasHasContent(page, '.stage .slide-canvas')).ok, 'Gezoomte Folie scharf neu gerendert');
  await page.screenshot({ path: SHOTS + '/14-zoom.png' });
  await key('0'); s = await state(); expect(s.zoom === 1, 'Taste 0 setzt Zoom zurück');
  await key('ArrowRight'); await key('ArrowRight'); await key('ArrowRight', 300);
  await page.mouse.move(640, 300); await page.mouse.wheel(0, -900); await sleep(900);
  await page.screenshot({ path: SHOTS + '/15-zoom-bpmn.png' });
  await key('Escape', 300); s = await state(); expect(s.zoom === 1, 'Esc setzt Zoom zurück');
  expect(await page.evaluate(() => !!document.fullscreenElement), 'Esc mit Zoom verlässt Vollbild nicht (Browser-abhängig)');

  step('Pause');
  await key('p', 600); s = await state(); expect(s.paused, 'Pause an');
  expect((await canvasHasContent(page, '.stage .slide-canvas')).ok, 'Pausenfolie sichtbar');
  await page.screenshot({ path: SHOTS + '/16-pause.png' });
  const pi0 = await page.evaluate(() => window.app.show.pauseIdx);
  await sleep(3400);
  const pi1 = await page.evaluate(() => window.app.show.pauseIdx);
  expect(pi1 > pi0, 'Pausenfolien wechseln automatisch');
  await key('p', 300); s = await state(); expect(!s.paused && s.i === 2, 'Pause aus, zurück an derselben Stelle');

  step('Hilfe');
  await key('h', 300); expect((await state()).overlay === 'help', 'Hilfe offen');
  await page.screenshot({ path: SHOTS + '/17-help.png' });
  await key('a', 300); expect(!(await state()).overlay, 'Hilfe schließt mit beliebiger Taste');

  step('Vollbild verlassen und mit F zurück');
  await page.evaluate(() => document.exitFullscreen()); await sleep(400);
  await key('f', 600);
  expect(await page.evaluate(() => !!document.fullscreenElement), 'F holt das Vollbild zurück');

  step('Beenden und Protokoll');
  await key('x', 300); await key('Enter', 800);
  s = await state(); expect(!s.active, 'Präsentation beendet');
  await sleep(800);
  const data = await readData(page);
  const proto = data.seminars[0].protocols[0];
  expect(proto && proto.shown.some((x) => x.path.includes('Grundlagen') && x.page === 13), `Protokoll gespeichert mit ${proto?.shown.length} Folien`);
  const fast = proto?.shown.find((x) => x.path.includes('Grundlagen') && x.page === 8);
  expect(!fast, 'Kurz durchgeblätterte Folie zählt nicht (Grundlagen 8)');
  await page.waitForSelector('.proto-out .thumb-cell', { timeout: 8000 });
  await sleep(800);
  await page.screenshot({ path: SHOTS + '/18-protocol.png', fullPage: true });
} catch (e) { fails.push(e.message); console.log('FEHLER', e.message); await page.screenshot({ path: SHOTS + '/err-mirror.png' }); }
console.log(errors.join('\n') || 'keine Konsolenfehler');
console.log(fails.length ? `${fails.length} FEHLGESCHLAGEN` : 'ALLES OK');
await browser.close(); srv.kill();
