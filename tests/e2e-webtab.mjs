// Ein Praesentationsfenster: SlideDesk liegt vor dem Start auf dem Beamer, Websites oeffnen dort als Tab.
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
// Vollstaendiges Chromium: nur dort landen Tabs wie im Desktop-Browser im selben Fenster.
const browser = await chromium.launch({ channel: 'chromium', ignoreDefaultArgs: ['--disable-popup-blocking', '--hide-scrollbars'] });
const ctx = await browser.newContext({ viewport: null });
ctx.setDefaultTimeout(10000);
const page = await ctx.newPage();
const devtools = await ctx.newCDPSession(page);
const { screenInfos } = await devtools.send('Emulation.getScreenInfos');
await devtools.send('Emulation.updateScreen', { screenId: screenInfos[0].id, width: 1440, height: 900, isInternal: true, label: 'Laptop' });
const { targetInfo } = await devtools.send('Target.getTargetInfo');
await devtools.send('Browser.setPermission', {
  permission: { name: 'window-management' }, setting: 'granted',
  origin: new URL(BASE).origin, browserContextId: targetInfo.browserContextId,
});
await devtools.send('Emulation.addScreen', { left: 1440, top: 0, width: 1920, height: 1080, label: 'Beamer', isInternal: false });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
async function windowOf(p) {
  const session = await ctx.newCDPSession(p);
  const result = await session.send('Browser.getWindowForTarget');
  await session.detach();
  return result;
}
const position = () => page.evaluate(() => ({ pos: window.app.show.pos, cue: window.app.show.cue }));
const fullscreen = () => page.evaluate(() => !!document.fullscreenElement);
try {
  await setupSeminar(page, { mode: 'dual', dwell: 0 });
  await page.waitForFunction(() => window.app.launcher.screens?.screens.length === 2);
  // Vor dem Start: SlideDesk-Fenster auf den Beamer ziehen.
  const main = await windowOf(page);
  await devtools.send('Browser.setWindowBounds', { windowId: main.windowId, bounds: { windowState: 'normal' } });
  await devtools.send('Browser.setWindowBounds', { windowId: main.windowId, bounds: { left: 1440, top: 0, width: 1920, height: 1080 } });
  await page.waitForFunction(() => window.app.launcher.dualLayout()?.kind === 'window');
  await page.evaluate((url) => {
    const s = window.app.store.seminar('sem1');
    s.links = [{ id: 'web', name: 'Meine Website', url }];
    s.hotkeys[2] = { path: 'Module/BPMN Diagramme.pdf', page: 1 };
    s.hotkeys[3] = { path: 'Module/BPMN Diagramme.pdf', page: 2 };
    window.app.renderContent();
  }, targetUrl);
  assert.match(await page.locator('.start-hint').textContent(), /Präsentationsfenster/);

  const [ref] = await Promise.all([ctx.waitForEvent('page'), page.getByRole('button', { name: '▶ Präsentieren', exact: true }).click()]);
  await ref.waitForSelector('.presenter');
  await page.waitForFunction(() => !window.app.show.loading);
  assert.ok(await fullscreen(), 'Folien im Vollbild im Praesentationsfenster');
  const refWindow = await windowOf(ref);
  assert.equal(refWindow.bounds.left, 0, 'Referentenansicht liegt auf dem Laptop');
  assert.ok(refWindow.bounds.height <= 900, 'Referentenfenster passt in den Arbeitsbereich');

  // Filmstreifen bleibt ohne Warnleiste und mit Linkbereich vollstaendig sichtbar.
  await ref.waitForFunction(() => document.querySelector('.pv-warn').hidden && document.querySelector('.pv-thumb img'));
  const strip = await ref.evaluate(() => {
    const s = document.querySelector('.pv-strip').getBoundingClientRect();
    const t = document.querySelector('.pv-thumb').getBoundingClientRect();
    return { stripBottom: s.bottom, thumbTop: t.top, thumbBottom: t.bottom, stripTop: s.top, vh: innerHeight };
  });
  assert.ok(strip.stripBottom <= strip.vh + 0.5, 'Filmstreifen endet im Fenster');
  assert.ok(strip.thumbTop >= strip.stripTop && strip.thumbBottom <= strip.stripBottom, 'Miniaturen vollstaendig sichtbar');
  await ref.screenshot({ path: SHOTS + '/43-webtab-referent.png' });

  await ref.keyboard.press('ArrowRight');
  await ref.locator('.pv-thumb').nth(3).click();
  const before = await position();
  const [web] = await Promise.all([ctx.waitForEvent('page'), ref.locator('.link-target').click()]);
  await web.waitForURL(targetUrl);
  assert.equal((await windowOf(web)).windowId, main.windowId, 'Website ist ein Tab im Praesentationsfenster');
  assert.equal(await web.evaluate(() => window.frameElement), null, 'keine Einbettung');
  assert.equal(await page.evaluate(() => window.app.show.webLink), 'Meine Website');
  assert.equal(await page.evaluate(() => window.app.show.visibleKey()), null, 'verdeckte Folien werden nicht gezaehlt');
  assert.match(await ref.locator('.pv-label.live').textContent(), /Hintergrund/);
  await web.getByRole('link', { name: 'Zum Modell' }).click();
  await web.getByLabel('Arbeitsstand').fill('Nicht verlieren');

  // Der Tabwechsel beendet im Browser das Vollbild; die Rueckkehr holt es ueber die Referentenansicht zurueck.
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await ref.getByRole('button', { name: 'Zurück zu Folien', exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  assert.equal(await page.evaluate(() => window.app.show.webLink), null);
  assert.deepEqual(await position(), before);
  assert.ok(await page.evaluate(() => window.app.show.visibleKey()), 'PDF-Protokoll wird fortgesetzt');

  const count = ctx.pages().length;
  await ref.locator('.link-target').click();
  await page.waitForFunction(() => window.app.show.webLink === 'Meine Website');
  assert.equal(ctx.pages().length, count, 'erneuter Klick holt denselben Tab');
  assert.equal(await web.getByLabel('Arbeitsstand').inputValue(), 'Nicht verlieren');
  assert.equal(new URL(web.url()).pathname, '/model', 'Navigation innerhalb der Website bleibt erhalten');

  // F in der Referentenansicht bringt ebenfalls das Vollbild zurueck.
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await ref.locator('.pv-head').click();
  await ref.keyboard.press('f');
  await page.waitForFunction(() => !!document.fullscreenElement);

  // Geaenderter Link oeffnet einen neuen Tab im selben Fenster; der alte bleibt offen.
  // Ohne Pop-up-Freigabe blockiert das Hauptfenster, dann oeffnet die angeklickte Referentenansicht.
  await page.evaluate(() => {
    const open = window.open;
    window.open = (url, name, ...rest) => (String(name).startsWith('slidedesk-web-') ? null : open.call(window, url, name, ...rest));
  });
  await ref.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await ref.getByLabel('Link', { exact: true }).fill(targetUrl + '?neu');
  await ref.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  const [web2] = await Promise.all([ctx.waitForEvent('page'), ref.locator('.link-target').click()]);
  await web2.waitForURL(targetUrl + '?neu');
  assert.equal((await windowOf(web2)).windowId, main.windowId);
  assert.equal(web.isClosed(), false);

  await page.evaluate(() => window.app.show.stop());
  assert.equal(await page.evaluate(() => window.name), '', 'Fenstername nach dem Ende zurueckgesetzt');
  assert.deepEqual(errors, []);
  console.log('ALLES OK: ein Praesentationsfenster, Website als Tab, Rueckkehr mit Vollbild, Tab ohne Neuladen, Filmstreifen sichtbar');
} catch (error) {
  process.exitCode = 1;
  console.error('FEHLER', error.stack);
  console.error('Fenster:', await Promise.all(ctx.pages().map(async (p) => ({ url: p.url(), ...(await windowOf(p)) }))));
} finally {
  await browser.close(); srv.kill();
  await new Promise((resolve) => site.close(resolve));
}
