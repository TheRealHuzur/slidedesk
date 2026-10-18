// Linkliste: echte Bedienung, Speicherung, Geraetewechsel und laufende Praesentation.
import assert from 'node:assert/strict';
import { chromium, server, BASE, seed, ablageFiles, readData, SHOTS } from './helpers.mjs';
import { setupSeminar } from './setup.mjs';

const srv = await server();
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
page.on('pageerror', (e) => errors.push(e.message));
const card = () => page.locator('.content .seminar-links');
const names = (panel) => panel.locator('.link-name').allTextContents();
const saved = async () => {
  await page.evaluate(() => window.app.store.save());
  return readData(page);
};
const state = () => page.evaluate(() => {
  const s = window.app.show;
  return { pos: s.pos, cue: s.cue, active: s.active, paused: s.paused };
});
async function add(panel, name, url) {
  await panel.getByRole('button', { name: '+ Link hinzufügen', exact: true }).click();
  await panel.getByLabel('Name', { exact: true }).fill(name);
  await panel.getByLabel('Link', { exact: true }).fill(url);
  await panel.getByRole('button', { name: 'Speichern', exact: true }).click();
}

try {
  await setupSeminar(page);
  const original = (await readData(page)).seminars[0];
  assert.equal(original.links, undefined, 'Test beginnt mit einer alten Seminar-Datei');
  await page.reload();
  await card().waitFor();
  assert.equal(await card().locator('.link-row').count(), 0, 'keine vorgefertigten Links');
  const migrated = await saved();
  assert.deepEqual(migrated.seminars[0].links, []);
  for (const key of ['items', 'hotkeys', 'pause', 'protocols']) {
    assert.deepEqual(migrated.seminars[0][key], original[key], key + ' bleibt erhalten');
  }

  const first = BASE + 'hilfe.html?board=a%2Fb&view=1#vorbereiten';
  const second = BASE + 'hilfe.html?board=zweites#praesentieren';
  await card().getByRole('button', { name: '+ Link hinzufügen', exact: true }).click();
  await card().getByRole('button', { name: 'Speichern', exact: true }).click();
  assert.match(await card().getByRole('alert').textContent(), /Namen/);
  await card().getByLabel('Name', { exact: true }).fill('Arbeitsfläche');
  for (const bad of ['javascript:alert(1)', 'data:text/html,hallo', 'ftp://example.com', '/relative', 'example.com', 'https://']) {
    await card().getByLabel('Link', { exact: true }).fill(bad);
    await card().getByRole('button', { name: 'Speichern', exact: true }).click();
    assert.match(await card().getByRole('alert').textContent(), /vollständigen Link/);
    assert.equal(await card().locator('.link-row').count(), 0, 'ungueltige Adresse wird nicht gespeichert');
  }
  await card().getByLabel('Link', { exact: true }).fill(first);
  await card().getByRole('button', { name: 'Speichern', exact: true }).click();
  assert.deepEqual(await names(card()), ['Arbeitsfläche']);
  const textName = '<img src=x onerror=alert(1)> & Gruppenarbeit';
  await add(card(), textName, second);
  assert.equal(await card().locator('img').count(), 0, 'Name wird als Text dargestellt');
  await card().getByRole('button', { name: 'Nach oben: ' + textName, exact: true }).click();
  assert.deepEqual(await names(card()), [textName, 'Arbeitsfläche']);
  await card().locator('.link-row').first().getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await card().getByLabel('Name', { exact: true }).fill('PICTURE Einstieg');
  await card().getByLabel('Link', { exact: true }).fill(second + '-neu');
  await card().getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await card().getByRole('button', { name: 'Nach unten: PICTURE Einstieg', exact: true }).click();
  assert.deepEqual(await names(card()), ['Arbeitsfläche', 'PICTURE Einstieg']);
  await card().getByRole('button', { name: 'Löschen: Arbeitsfläche', exact: true }).click();
  assert.deepEqual(await names(card()), ['PICTURE Einstieg']);
  await add(card(), 'Board mit Parametern', first);
  const disk = await saved();
  assert.equal(disk.seminars[0].links[1].url, first, 'Parameter und Fragment bleiben erhalten');
  await page.reload();
  await card().waitFor();
  assert.deepEqual(await names(card()), ['PICTURE Einstieg', 'Board mit Parametern']);

  // Eine unabhaengige Browserumgebung bekommt dieselbe Datei wie beim Ablage-Sync.
  const laptop = await browser.newContext();
  const other = await laptop.newPage();
  await other.goto(BASE + '?ablage=demo');
  await seed(other, [...ablageFiles(), ['SlideDESK/slidedesk.json', Buffer.from(JSON.stringify(disk)).toString('base64')]]);
  await other.reload();
  await other.locator('.seminar-links .link-row').first().waitFor();
  assert.deepEqual(await names(other.locator('.seminar-links')), ['PICTURE Einstieg', 'Board mit Parametern']);
  await laptop.close();

  // Die vorhandene Duplizierung muss unabhaengige Eintraege erzeugen.
  await page.getByRole('button', { name: 'Seminar duplizieren', exact: true }).click();
  await page.locator('.modal input').fill('Kopie mit Links');
  await page.locator('.modal button[type=submit]').click();
  const duplicate = (await saved()).seminars.find((s) => s.name === 'Kopie mit Links');
  assert.deepEqual(duplicate.links.map((l) => [l.name, l.url]), disk.seminars[0].links.map((l) => [l.name, l.url]));
  assert.notEqual(duplicate.links[0].id, disk.seminars[0].links[0].id);
  await card().getByRole('button', { name: 'Löschen: PICTURE Einstieg', exact: true }).click();
  assert.equal((await saved()).seminars.find((s) => s.id === 'sem1').links.length, 2, 'Kopie aendert Original nicht');
  await page.locator('.side-item').filter({ hasText: 'Prozessmanagement Duisburg' }).click();

  // Simulierte Aenderung durch das andere Geraet bei bereits geoeffneter App.
  await page.evaluate(async () => {
    const app = window.app;
    await app.store.save();
    const fh = await app.store.dataFile(false);
    const data = JSON.parse(await (await fh.getFile()).text());
    data.seminars.find((s) => s.id === 'sem1').links.push({ id: 'from-pc', name: 'Vom PC ergänzt', url: location.origin + '/hilfe.html' });
    const writer = await fh.createWritable();
    await writer.write(JSON.stringify(data)); await writer.close();
    app.store.fileModified = 0;
    await app.checkExternal();
  });
  assert.deepEqual(await names(card()), ['PICTURE Einstieg', 'Board mit Parametern', 'Vom PC ergänzt']);
  await card().screenshot({ path: SHOTS + '/40-links-verwaltung.png' });

  // Variante B: Referentenansicht im Hauptfenster, echte Buehne im Zusatzfenster.
  await page.evaluate(() => {
    window.app.store.data.settings.mode = 'dual';
    window.app.launcher.screens = { screens: [{}], currentScreen: {} };
    window.app.refreshStartBox();
  });
  await page.getByRole('button', { name: '▶ Präsentieren', exact: true }).click();
  const [stage] = await Promise.all([ctx.waitForEvent('page'), page.getByRole('button', { name: /Mit Beamerfenster/ }).click()]);
  await stage.waitForSelector('.stage');
  await page.waitForSelector('.presenter');
  await page.waitForFunction(() => !window.app.show.loading);
  await page.keyboard.press('ArrowRight');
  await page.locator('.pv-thumb').nth(3).click();
  const before = await state();
  assert.equal(before.pos.p, 2);
  assert.equal(before.cue.p, 4);
  const presenter = page.locator('.presenter .seminar-links');
  await presenter.getByRole('button', { name: '+ Link hinzufügen', exact: true }).click();
  await presenter.getByLabel('Name', { exact: true }).pressSequentially('p x 123');
  await presenter.getByLabel('Link', { exact: true }).fill(BASE + 'hilfe.html?live=1#tasten');
  await presenter.getByLabel('Link', { exact: true }).press('Enter');
  assert.deepEqual(await state(), before, 'Eingaben und Enter aendern weder Folie noch Vorhoeren');
  assert.equal(await stage.locator('.seminar-links').count(), 0, 'Linkliste erscheint nicht auf der Buehne');
  const [target] = await Promise.all([
    ctx.waitForEvent('page'),
    presenter.getByRole('link', { name: /^p x 123/ }).click(),
  ]);
  await target.waitForURL(BASE + 'hilfe.html?live=1#tasten');
  assert.equal(await page.evaluate(() => window.app.show.webLink), 'p x 123', 'Beamer zeigt das Live-Bild der Website');
  await target.close(); await page.bringToFront();
  assert.deepEqual(await state(), before, 'Oeffnen und manueller Rueckwechsel erhalten die Praesentation');
  await presenter.locator('.link-row').last().getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await presenter.getByLabel('Name', { exact: true }).fill('Link aus Referentenansicht');
  await presenter.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await page.screenshot({ path: SHOTS + '/41-links-referentenansicht.png' });
  await page.evaluate(() => window.app.show.stop());
  await page.waitForSelector('.content .seminar-links', { state: 'visible' });
  assert.ok((await names(card())).includes('Link aus Referentenansicht'));

  // Variante A: dieselbe Komponente muss auch im fremden Dokument bedienbar sein.
  await page.evaluate(() => {
    const laptop = { isInternal: true, label: 'Laptop', availLeft: 0, availTop: 0, availWidth: 1440, availHeight: 1000 };
    const beamer = { isInternal: false, label: 'Beamer', availLeft: 1440, availTop: 0, availWidth: 1920, availHeight: 1080 };
    window.app.launcher.screens = { screens: [laptop, beamer], currentScreen: laptop };
    window.app.refreshStartBox();
  });
  const [ref] = await Promise.all([ctx.waitForEvent('page'), page.getByRole('button', { name: '▶ Präsentieren', exact: true }).click()]);
  await ref.waitForSelector('.presenter');
  const popupCard = ref.locator('.presenter .seminar-links');
  await add(popupCard, 'Im Laptopfenster ergänzt', BASE + 'hilfe.html');
  assert.ok((await names(popupCard)).includes('Im Laptopfenster ergänzt'));
  await page.evaluate(() => window.app.show.stop());
  assert.ok((await saved()).seminars.find((s) => s.id === 'sem1').links.some((l) => l.name === 'Im Laptopfenster ergänzt'));
  assert.deepEqual(errors, [], 'keine JavaScript-Fehler');
  console.log('ALLES OK: Links anlegen, validieren, bearbeiten, sortieren, löschen, speichern, kopieren, Gerätewechsel und beide Referentenansichten');
} catch (error) {
  console.error('FEHLER', error.stack);
  process.exitCode = 1;
  await page.screenshot({ path: SHOTS + '/err-links.png' }).catch(() => {});
} finally {
  await browser.close();
  srv.kill();
}
