/**
 * Mirrors the page templates into ko/ so the Korean routes are backed by
 * real files.
 *
 * Rewrites in vercel.json turned out not to serve /ko, and the filesystem
 * is checked before any rewrite rule, so a real ko/index.html removes the
 * routing question entirely: it resolves exactly the way the root pages do
 * (index.html -> /, case-study.html -> /case-study, with cleanUrls).
 *
 * The copies are byte-identical - the language is read from the URL at
 * runtime by i18n/locale.js, not baked into the file - so there is nothing
 * to translate here and nothing that can drift in behaviour. Every asset
 * they reference is root-absolute, which is what lets one file work from
 * two directories.
 *
 *   node tools/sync-locale-pages.mjs          regenerate ko/
 *   node tools/sync-locale-pages.mjs --check  fail if ko/ is stale
 *
 * Run the check before committing a change to either template.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['index.html', 'case-study.html'];
const OUT = 'ko';

const check = process.argv.includes('--check');
const outDir = path.join(root, OUT);
if (!check) fs.mkdirSync(outDir, { recursive: true });

let stale = [];
for (const page of PAGES) {
  const src = fs.readFileSync(path.join(root, page));
  const dstPath = path.join(outDir, page);
  const same = fs.existsSync(dstPath) && fs.readFileSync(dstPath).equals(src);
  if (check) {
    if (!same) stale.push(`${OUT}/${page}`);
  } else if (!same) {
    fs.writeFileSync(dstPath, src);
    console.log(`updated ${OUT}/${page}`);
  }
}

if (check) {
  if (stale.length) {
    console.error(
      'Locale pages are out of date: ' + stale.join(', ') +
      '\nRun: node tools/sync-locale-pages.mjs'
    );
    process.exit(1);
  }
  console.log(`${OUT}/ matches the root templates`);
} else {
  console.log(`${OUT}/ in sync (${PAGES.length} pages)`);
}
