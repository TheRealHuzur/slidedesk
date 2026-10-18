// Websites im Zwei-Bildschirm-Modus: Fenster auf dem Laptop, Live-Bild auf dem Beamer, auch ohne Fensterverwaltung.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium, server, BASE, SHOTS } from './helpers.mjs';
import { setupSeminar } from './setup.mjs';

const site = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" });
  res.end(req.url === '/model'
    ? '<!doctype html><title>Modell</title><h1>Modell</h1><label>Arbeitsstand <input></label>'
    : '<!doctype html><title>Website</title><h1>Website</h1><a href="/model">Zum Modell</a>');
});
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
const targetUrl = `http://127.0.0.1:${site.address().port}/`;
const srv = await server();
// Die Bildschirmauswahl bestaetigt Chromium selbst und liefert ein Testbild als Bildschirm.
const browser = await chromium.launch({
  ignoreDefaultArgs: ['--disable-popup-blocking'],
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const ctx = await browser.newContext({ viewport: null });
ctx.setDefaultTimeout(10000);
const page = await ctx.newPage();
const devtools = await ctx.newCDPSession(page);
const { screenInfos } = await devtools.send('Emulation.getScreenInfos');
await devtools.send('Emulation.updateScreen', { screenId: screenInfos[0].id, width: 1440, height: 1000 });
const { targetInfo } = await devtools.send('Target.getTargetInfo');
await devtools.send('Browser.setPermission', {
  permission: { name: 'window-management' }, setting: 'granted',
  origin: new URL(BASE).origin, browserContextId: targetInfo.browserContextId,
});
await devtools.send('Emulation.addScreen', { left: 1440, top: 0, width: 1920, height: 1080, label: 'Beamer' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
async function bounds(p) {
  const session = await ctx.newCDPSession(p);
  const result = await session.send('Browser.getWindowForTarget');
  await session.detach();
  return result;
}
const position = () => page.evaluate(() => ({ pos: window.app.show.pos, cue: window.app.show.cue }));
const webLink = () => page.evaluate(() => window.app.show.webLink);
const onLaptop = async (p) => {
  const { bounds: rect } = await bounds(p);
  assert.equal(rect.left, 0, 'Website-Fenster liegt auf dem Laptop');
  assert.equal(rect.top, 0);
  assert.ok(rect.width >= 1400 && rect.height >= 900, 'Website-Fenster fuellt den Laptop');
};
const liveImage = (p) => p.waitForFunction(() => {
  const v = document.querySelector('.stage-web');
  return v && !v.hidden && v.videoWidth > 0;
});
const imageHidden = (p) => p.waitForFunction(() => document.querySelector('.stage-web')?.hidden !== false);
// Im echten Browser verliert die Referentenansicht den Fokus an das neue Website-Fenster.
const presenterBack = (p) => p.evaluate(() => { dispatchEvent(new Event('blur')); dispatchEvent(new Event('focus')); });
const presenterAway = (p) => p.evaluate(() => dispatchEvent(new Event('blur')));
try {
  await setupSeminar(page, { mode: 'dual', dwell: 0 });
  await page.waitForFunction(() => window.app.launcher.screens?.screens.length === 2);
  await page.evaluate((url) => {
    const app = window.app;
    app.store.seminar('sem1').links = [{ id: 'web', name: 'Meine Website', url }];
    app.renderContent();
  }, targetUrl);
  assert.match(await page.locator('.start-screens').textContent(), /Live-Bild/);
  const [ref] = await Promise.all([ctx.waitForEvent('page'), page.getByRole('button', { name: '▶ Präsentieren', exact: true }).click()]);
  await ref.waitForSelector('.presenter');
  await page.waitForFunction(() => !window.app.show.loading);
  await ref.keyboard.press('ArrowRight');
  await ref.locator('.pv-thumb').nth(3).click();
  const before = await position();
  const stageFs = () => page.evaluate(() => !!document.fullscreenElement);
  const fsBefore = await stageFs();

  // Erster Link: Bildschirmauswahl, dann Website auf dem Laptop und Live-Bild auf dem Beamer.
  const [web] = await Promise.all([ctx.waitForEvent('page'), ref.locator('.link-target').click()]);
  await presenterAway(ref);
  await web.waitForURL(targetUrl);
  await onLaptop(web);
  assert.equal(await web.evaluate(() => window.frameElement), null, 'echtes Browserfenster, keine Einbettung');
  assert.equal(await webLink(), 'Meine Website');
  await liveImage(page);
  assert.equal(await stageFs(), fsBefore, 'Buehne bleibt unveraendert auf dem Beamer');
  assert.equal(await page.evaluate(() => window.app.show.visibleKey()), null, 'verdeckte Folien werden nicht gezaehlt');
  assert.deepEqual(await position(), before);
  assert.match(await ref.locator('.pv-warn').textContent(), /Laptop/);
  await ref.screenshot({ path: SHOTS + '/42-webscreen-referent.png' });
  await page.screenshot({ path: SHOTS + '/42-webscreen-beamer.png' });
  await web.getByRole('link', { name: 'Zum Modell' }).click();
  await web.getByLabel('Arbeitsstand').fill('Nicht verlieren');

  // Referentenansicht kommt nach vorn: Beamer zeigt wieder die Folie, die Website bleibt offen.
  await presenterBack(ref);
  assert.equal(await webLink(), null);
  await imageHidden(page);
  assert.deepEqual(await position(), before);
  assert.ok(await page.evaluate(() => window.app.show.visibleKey()), 'PDF-Protokoll wird fortgesetzt');
  assert.equal(web.isClosed(), false, 'Website bleibt mit ihrem Arbeitsstand offen');

  // Erneuter Klick: kein neues Fenster, keine neue Auswahl, Arbeitsstand erhalten.
  const count = ctx.pages().length;
  const stream = await page.evaluate(() => window.app.launcher.capture.id);
  await ref.locator('.link-target').click();
  await presenterAway(ref);
  await page.waitForFunction(() => window.app.show.webLink === 'Meine Website');
  assert.equal(ctx.pages().length, count, 'erneuter Klick verwendet dasselbe Fenster');
  assert.equal(await page.evaluate(() => window.app.launcher.capture.id), stream, 'Uebertragung laeuft weiter');
  assert.equal(await web.getByLabel('Arbeitsstand').inputValue(), 'Nicht verlieren');
  assert.equal(new URL(web.url()).pathname, '/model', 'Navigation innerhalb der Website bleibt erhalten');
  await liveImage(page);
  await ref.getByRole('button', { name: 'Zurück zu Folien', exact: true }).click();
  assert.equal(await webLink(), null);

  // Freigabe im Browser beendet: Beamer zeigt die Folie, der naechste Link fragt neu.
  await ref.locator('.link-target').click();
  await presenterAway(ref);
  await page.waitForFunction(() => window.app.show.webLink === 'Meine Website');
  await page.evaluate(() => window.app.launcher.capture.getVideoTracks()[0].dispatchEvent(new Event('ended')));
  assert.equal(await webLink(), null);
  assert.equal(await page.evaluate(() => window.app.launcher.capture), null);
  assert.match(await ref.locator('.sd-toasts').textContent(), /beendet/);
  await ref.locator('.link-target').click();
  await presenterAway(ref);
  await page.waitForFunction(() => window.app.show.webLink === 'Meine Website' && !!window.app.launcher.capture);
  assert.equal(ctx.pages().length, count, 'Website-Fenster wiederverwendet');

  // Website-Fenster geschlossen: Beamer zeigt wieder die Folie.
  await web.close();
  await page.waitForFunction(() => window.app.show.webLink === null);
  await imageHidden(page);

  // Blockiertes Website-Fenster: Hinweis, Beamer bleibt bei der Folie.
  await ref.evaluate(() => {
    const open = window.open;
    window.open = (url, name, ...rest) => (String(name).startsWith('slidedesk-web-') ? null : open.call(window, url, name, ...rest));
  });
  const pagesNow = ctx.pages().length;
  await ref.locator('.link-target').click();
  assert.equal(ctx.pages().length, pagesNow);
  assert.match(await ref.locator('.sd-toasts').textContent(), /blockiert/);
  assert.equal(await webLink(), null);
  const track = await page.evaluateHandle(() => window.app.launcher.capture.getVideoTracks()[0]);
  await page.evaluate(() => window.app.show.stop());
  assert.equal(await track.evaluate((t) => t.readyState), 'ended', 'Uebertragung endet mit der Praesentation');

  // Variante B: Nutzer zieht das Beamerfenster selbst auf den zweiten Monitor.
  await devtools.send('Browser.setPermission', {
    permission: { name: 'window-management' }, setting: 'denied',
    origin: new URL(BASE).origin, browserContextId: targetInfo.browserContextId,
  });
  await page.waitForFunction(() => !document.fullscreenElement);
  const mainWindow = await bounds(page);
  await devtools.send('Browser.setWindowBounds', { windowId: mainWindow.windowId, bounds: { windowState: 'normal' } });
  await devtools.send('Browser.setWindowBounds', { windowId: mainWindow.windowId, bounds: { left: 0, top: 0, width: 1200, height: 900 } });
  await page.evaluate(() => {
    window.app.launcher.screens = { screens: [{}], currentScreen: {} };
    window.app.refreshStartBox();
  });
  await page.getByRole('button', { name: '▶ Präsentieren', exact: true }).click();
  const [stage] = await Promise.all([ctx.waitForEvent('page'), page.getByRole('button', { name: /Mit Beamerfenster/ }).click()]);
  await stage.waitForSelector('.stage');
  const stageWindow = await bounds(stage);
  await devtools.send('Browser.setWindowBounds', { windowId: stageWindow.windowId, bounds: { left: 1440, top: 0, width: 1920, height: 1080 } });
  await page.waitForFunction(() => !window.app.show.loading);
  await stage.waitForFunction(() => window.screenX === 1440);
  const [webB] = await Promise.all([ctx.waitForEvent('page'), page.locator('.presenter .link-target').first().click()]);
  await presenterAway(page);
  await webB.waitForLoadState();
  await onLaptop(webB);
  await liveImage(stage);
  await page.getByRole('button', { name: 'Zurück zu Folien', exact: true }).click();
  assert.equal(await webLink(), null);
  await imageHidden(stage);
  await page.evaluate(() => window.app.show.stop());
  await webB.close();
  assert.deepEqual(errors, []);
  console.log('ALLES OK: Website auf dem Laptop, Live-Bild auf dem Beamer, beide Modi, Rueckkehr per Fokus, Fenster und Freigabe-Ende, Pop-up-Blockierung');
} catch (error) {
  process.exitCode = 1;
  console.error('FEHLER', error.stack);
  console.error('Fenster:', await Promise.all(ctx.pages().map(async (p) => ({ url: p.url(), ...(await bounds(p)).bounds }))));
} finally {
  await browser.close(); srv.kill();
  await new Promise((resolve) => site.close(resolve));
}
