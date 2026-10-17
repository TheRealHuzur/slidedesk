// Erzeugt assets.json: Liste aller Dateien, die der Service Worker fuer den Offline-Betrieb vorhaelt.
// Die Versionskennung ergibt sich aus dem Inhalt, damit Updates zuverlaessig ankommen.
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const include = ['index.html', 'fenster.html', 'hilfe.html', 'manifest.webmanifest', 'css', 'js', 'icons', 'vendor'];
const files = [];
const walk = (p) => {
  const st = statSync(p);
  if (st.isDirectory()) for (const n of readdirSync(p)) walk(join(p, n));
  else if (!/(LICENSE|\.map)$/.test(p) && !p.includes('/cmaps/')) files.push(relative(root, p));
};
for (const i of include) walk(join(root, i));
files.sort();
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(root, f)));
const version = hash.digest('hex').slice(0, 12);
writeFileSync(join(root, 'assets.json'), JSON.stringify({ version, files: ['./', ...files] }, null, 1) + '\n');
// Auch der Worker muss sich aendern, damit bereits installierte Apps den neuen Cache laden.
const worker = join(root, 'sw.js');
const source = readFileSync(worker, 'utf8').replace(/^\/\/ App-Stand: .*\n/m, '');
writeFileSync(worker, `// App-Stand: ${version}\n${source}`);
console.log(`assets.json: ${files.length} Dateien, Version ${version}`);
