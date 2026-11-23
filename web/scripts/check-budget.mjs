// Fails the build when the shipped bundle exceeds its performance budget (gzipped bytes).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = new URL('../dist/', import.meta.url).pathname;
// js: everything a visitor loads for the normal pages; lab: the heating lab view and its simulation worker;
// threeD: the three.js scene, loaded only when the lab opens
const BUDGET = { js: 90 * 1024, lab: 45 * 1024, threeD: 170 * 1024, css: 25 * 1024, snapshot: 60 * 1024 };

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(DIST);
const gz = (p) => gzipSync(readFileSync(p)).length;
const sum = (ext) => files.filter((f) => f.endsWith(ext)).reduce((a, f) => a + gz(f), 0);
const isLab = (f) => /\/(HeatingLab|sim\.worker)-[^/]+\.js$/.test(f);
const is3D = (f) => /\/House3D-[^/]+\.js$/.test(f);
const jsFiles = files.filter((f) => f.endsWith('.js'));
const totals = {
  js: jsFiles.filter((f) => !isLab(f) && !is3D(f)).reduce((a, f) => a + gz(f), 0),
  lab: jsFiles.filter(isLab).reduce((a, f) => a + gz(f), 0),
  threeD: jsFiles.filter(is3D).reduce((a, f) => a + gz(f), 0),
  css: sum('.css'),
  snapshot: files.filter((f) => f.endsWith('snapshot.json')).reduce((a, f) => a + gz(f), 0),
};
let failed = false;
for (const [k, v] of Object.entries(totals)) {
  const ok = v <= BUDGET[k];
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'OVER'} ${k.padEnd(9)} ${(v / 1024).toFixed(1).padStart(6)} KB gz  (budget ${(BUDGET[k] / 1024).toFixed(0)} KB)`);
}
if (failed) process.exit(1);
