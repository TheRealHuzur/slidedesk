// Legt ein Testseminar direkt ueber die App an (schneller als ueber die Oberflaeche).
import { seed, ablageFiles, BASE, sleep } from './helpers.mjs';
export async function setupSeminar(page, { dwell = 1, mode = 'mirror' } = {}) {
  await page.goto(BASE + '?ablage=demo');
  await seed(page, ablageFiles());
  await page.reload();
  await page.waitForSelector('.topbar');
  await page.evaluate(async ({ dwell, mode }) => {
    const app = window.app;
    const s = {
      id: 'sem1', name: 'Prozessmanagement Duisburg', created: Date.now(), updated: Date.now(),
      items: [
        { id: 'a', path: 'Seminarunterlagen/Duisburg/Einstieg Duisburg.pdf' },
        { id: 'b', path: 'Module/Prozessmanagement Grundlagen.pdf' },
        { id: 'c', path: 'Module/BPMN Diagramme.pdf' },
      ],
      hotkeys: { 1: { path: 'Module/BPMN Diagramme.pdf', page: 3 } }, pause: null, protocols: [],
    };
    app.store.data.seminars = [s];
    app.store.data.pause.slides = [{ path: 'Marketing/Pause Newsletter.pdf', page: 1 }, { path: 'Marketing/Pause Newsletter.pdf', page: 2 }];
    app.store.data.pause.interval = 3;
    app.store.data.settings.dwell = dwell;
    app.store.data.settings.mode = mode;
    await app.store.save();
    app.go({ type: 'seminar', id: 'sem1' });
  }, { dwell, mode });
  await page.waitForFunction(() => /bereit/.test(document.querySelector('.start-status')?.textContent || ''), null, { timeout: 15000 });
}
