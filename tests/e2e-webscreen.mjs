// Webinhalte mit zwei echten virtuellen Chromium-Bildschirmen, auch ohne Fensterverwaltung.
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
const browser = await chromium.launch({ ignoreDefaultArgs: ['--disable-popup-blocking'] });
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
const checkScreen = async (p) => {
  const { bounds: rect } = await bounds(p);
  assert.equal(rect.left, 1440, 'Browserfenster liegt auf dem Beamer-Bildschirm');
  assert.equal(rect.top, 0);
  assert.ok(rect.width >= 1800 && rect.height >= 900, 'Browserinhalt fuellt den Praesentationsbildschirm');
};
try {
  await setupSeminar(page, { mode: 'dual', dwell: 0 });
  await page.waitForFunction(() => window.app.launcher.screens?.screens.length === 2);
  await page.evaluate((url) => {
    const app = window.app;
    app.store.seminar('sem1').links = [{ id: 'web', name: 'Meine Website', url }];
    app.renderContent();
  }, targetUrl);
  const [ref] = await Promise.all([ctx.waitForEvent('page'), page.getByRole('button', { name: '▶ Präsentieren', exact: true }).click()]);
  await ref.waitForSelector('.presenter');
  await page.waitForFunction(() => !window.app.show.loading);
  await ref.keyboard.press('ArrowRight');
  await ref.locator('.pv-thumb').nth(3).click();
  const before = await position();
  const [web] = await Promise.all([ctx.waitForEvent('page'), ref.locator('.link-target').click()]);
  await web.waitForURL(targetUrl);
  await web.waitForFunction(() => document.hasFocus());
  await checkScreen(web);
  assert.equal(await web.evaluate(() => window.opener), null, 'Website kann die App nicht navigieren');
  assert.equal(await web.evaluate(() => window.frameElement), null, 'echtes Browserfenster, keine Einbettung');
  assert.deepEqual(await position(), before);
  assert.equal(await page.evaluate(() => window.app.show.visibleKey()), null, 'verdeckte Folien werden nicht weiter gezaehlt');
  assert.match(await ref.locator('.pv-label.live').textContent(), /Hintergrund/);
  await ref.screenshot({ path: SHOTS + '/42-webscreen-referent.png' });
  await web.getByRole('link', { name: 'Zum Modell' }).click();
  await web.getByLabel('Arbeitsstand').fill('Nicht verlieren');
  await ref.getByRole('button', { name: 'Zurück zu Folien', exact: true }).click();
  await page.waitForFunction(() => document.hasFocus());
  assert.deepEqual(await position(), before);
  assert.ok(await page.evaluate(() => window.app.show.visibleKey()), 'PDF-Protokoll wird fortgesetzt');
  assert.equal(web.isClosed(), false, 'Website bleibt mit ihrem Arbeitsstand offen');
  const count = ctx.pages().length;
  await ref.locator('.link-target').click();
  assert.equal(ctx.pages().length, count, 'erneuter Klick verwendet dasselbe Fenster');
  assert.equal(await web.getByLabel('Arbeitsstand').inputValue(), 'Nicht verlieren');
  assert.equal(new URL(web.url()).pathname, '/model', 'Navigation innerhalb der Website bleibt erhalten');
  await ref.getByRole('button', { name: 'Zurück zu Folien', exact: true }).click();

  // Kein Rueckfall in einen neuen Laptop-Tab bei blockierten Pop-ups.
  await page.evaluate(() => {
    const launcher = window.app.launcher;
    launcher.realOpen = window.open;
    window.open = () => null;
  });
  // Die Linkdarstellung bleibt dieselbe; neuer Eintrag prueft den Blockierungsfall.
  await ref.getByRole('button', { name: '+ Link hinzufügen', exact: true }).click();
  await ref.getByLabel('Name', { exact: true }).fill('Blockierter Link');
  await ref.getByLabel('Link', { exact: true }).fill(targetUrl + '?blockiert');
  await ref.getByRole('button', { name: 'Speichern', exact: true }).click();
  await ref.locator('.link-target').last().click();
  assert.equal(ctx.pages().length, count);
  assert.match(await ref.locator('.sd-toasts').textContent(), /blockiert/);
  assert.equal(await page.evaluate(() => window.app.show.webLink), null);
  await page.evaluate(() => { window.open = window.app.launcher.realOpen; });
  await page.evaluate(() => window.app.show.stop());
  await web.close();

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
  await webB.waitForLoadState();
  await checkScreen(webB);
  await page.getByRole('button', { name: 'Zurück zu Folien', exact: true }).click();
  assert.equal(await page.evaluate(() => window.app.show.webLink), null);
  await page.evaluate(() => window.app.show.stop());
  await webB.close();
  assert.deepEqual(errors, []);
  console.log('ALLES OK: Website auf Bildschirm 2, beide Modi, fremde Origin, Navigation erhalten, PDF-Rueckkehr und Pop-up-Blockierung');
} catch (error) {
  process.exitCode = 1;
  console.error('FEHLER', error.stack);
  console.error('Fenster:', await Promise.all(ctx.pages().map(async (p) => ({ url: p.url(), ...(await bounds(p)).bounds }))));
} finally {
  await browser.close(); srv.kill();
  await new Promise((resolve) => site.close(resolve));
}
