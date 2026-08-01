// Builds the "이미지 에셋 매니저" artifact page entirely from the repo's own
// files — case-study.html (CASES + IMG_MAP) and index.html — so the manager
// can never drift from what's actually wired into the site. Republish the
// emitted asset-manager.html to the existing artifact URL after any change
// to image assignments, case sections, or the images/ folders.
//
// thumbnails.json carries a small base64 JPEG per original image, keyed by
// case folder number ('1'..'7') plus 'idx'. The build fails if it doesn't
// exactly match the images/ folder listings — regenerate entries for any
// added/changed files (downscale to ~300px wide JPEG, then base64).
//
// Usage: node tools/asset-manager/build.mjs
//   → writes tools/asset-manager/asset-manager.html (git-ignored)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(here, '..', '..');
const read = (f) => fs.readFileSync(path.join(repoDir, f), 'utf8');

// ── Parse case-study.html ────────────────────────────────────────────────
const cs = read('case-study.html');

let s = cs.indexOf('const CASES = [');
const CASES = eval(cs.slice(s + 'const CASES = '.length, cs.indexOf('\n];', s) + 3));

s = cs.indexOf('const IMG_MAP = (() => {');
const imgPath = (folder, file) => ({ folder, file });
const IMG_MAP = new Function('imgPath', 'return ' + cs.slice(s + 'const IMG_MAP = '.length, cs.indexOf('})();', s) + 5))(imgPath);

// ── Parse index.html case labels for the IDX group ───────────────────────
const idx = read('index.html');
const idxLabels = {};
for (const m of idx.matchAll(/num:'(0\d)',anchor:'case-(\d)'[^\n]*?label:'([^']+)'/g)) {
  idxLabels[m[2]] = { num: m[1], label: m[3] };
}

// ── Generate CODE_GROUPS from CASES (same logic as the site template) ────
const CODE_GROUPS = [];

CODE_GROUPS.push({
  key: 'idx', title: 'index.html — 홈 케이스 카드',
  rows: CASES.map(c => {
    const n = +c.num;
    const lab = idxLabels[String(n)] || { num: c.num, label: c.short };
    return {
      code: 'IDX-CASE' + n, page: 'index.html',
      location: 'Selected Work → ' + lab.num + '. ' + c.title + ' (카드 이미지)',
      desc: lab.label,
    };
  }),
});

for (const c of CASES) {
  const n = +c.num;
  const rows = [];
  if (c.beforeLabel) {
    rows.push({ code: 'C' + n + '-BEFORE', page: 'case-study.html', location: 'Case ' + n + ' — Before/After', desc: c.beforeLabel });
    rows.push({ code: 'C' + n + '-AFTER', page: 'case-study.html', location: 'Case ' + n + ' — Before/After', desc: c.afterLabel });
  }
  for (const b of (c.apps || c.banners || [])) {
    const K = b.key.toUpperCase();
    const loc = 'Case ' + n + ' — ' + b.name;
    rows.push({ code: 'C' + n + '-' + K + '-BANNER', page: 'case-study.html', location: loc + ' (히어로 회전 배너)', desc: b.name + ' — 배너 이미지' });
    rows.push({ code: 'C' + n + '-' + K + '-MAIN', page: 'case-study.html', location: loc + ' (섹션 메인 이미지)', desc: b.name + ' — 메인 화면' });
    rows.push({ code: 'C' + n + '-' + K + '-D1', page: 'case-study.html', location: loc + ' (섹션 상세 이미지 1)', desc: b.name + ' — 상세 1' });
    rows.push({ code: 'C' + n + '-' + K + '-D2', page: 'case-study.html', location: loc + ' (섹션 상세 이미지 2)', desc: b.name + ' — 상세 2' });
  }
  (c.gallery || []).forEach((label, k) => {
    rows.push({ code: 'C' + n + '-GAL' + (k + 1), page: 'case-study.html', location: 'Case ' + n + ' — Visual Gallery #' + (k + 1), desc: label });
  });
  CODE_GROUPS.push({ key: 'c' + n, title: 'Case ' + n + ' — ' + c.title, rows });
}

// ── SEED_ASSIGNMENTS + CASE_KEY_MAP derived from IMG_MAP ─────────────────
const folderToRawKey = (folder) => {
  const m = /^Case (\d)/.exec(folder);
  return m ? m[1] : 'idx';
};
const SEED_ASSIGNMENTS = {};
const CASE_KEY_MAP = { idx: 'idx' };
for (const [code, { folder, file }] of Object.entries(IMG_MAP)) {
  const groupKey = 'c' + code.match(/^C(\d)-/)[1];
  SEED_ASSIGNMENTS[code] = { file, case: groupKey };
  const rawKey = folderToRawKey(folder);
  if (CASE_KEY_MAP[groupKey] && CASE_KEY_MAP[groupKey] !== rawKey) {
    throw new Error('Conflicting folder for group ' + groupKey);
  }
  CASE_KEY_MAP[groupKey] = rawKey;
}
for (const g of CODE_GROUPS) {
  if (g.key !== 'idx' && !CASE_KEY_MAP[g.key]) CASE_KEY_MAP[g.key] = g.key.slice(1);
}

// Sanity: every SEED code must exist in CODE_GROUPS (catches template drift)
const allCodes = new Set(CODE_GROUPS.flatMap(g => g.rows.map(r => r.code)));
for (const code of Object.keys(SEED_ASSIGNMENTS)) {
  if (!allCodes.has(code)) throw new Error('SEED code not in CODE_GROUPS: ' + code);
}
// Sanity: every SEED file must exist in the mapped folder on disk
const folderOfRaw = { 1: 'Case 1 — AVYCON', 2: 'Case 2 — Starllion', 3: 'Case 3 — Printing', 4: 'Case 4 — Expo', 5: 'Case 5 — SNS', 6: 'Case 6 — AI', 7: 'Case 7 — Asana', idx: 'index.html' };
for (const [code, a] of Object.entries(SEED_ASSIGNMENTS)) {
  const dir = path.join(repoDir, 'images', folderOfRaw[CASE_KEY_MAP[a.case]]);
  if (!fs.existsSync(path.join(dir, a.file))) throw new Error('SEED file missing on disk: ' + code + ' -> ' + a.file);
}

// ── Thumbnails must exactly mirror images/ ───────────────────────────────
const RAW_IMAGES = JSON.parse(fs.readFileSync(path.join(here, 'thumbnails.json'), 'utf8'));
for (const [rawKey, folder] of Object.entries(folderOfRaw)) {
  const disk = new Set(fs.readdirSync(path.join(repoDir, 'images', folder)).filter(f => !f.startsWith('.')));
  const art = new Set((RAW_IMAGES[rawKey] || []).map(im => im.file));
  const onlyDisk = [...disk].filter(f => !art.has(f));
  const onlyThumb = [...art].filter(f => !disk.has(f));
  if (onlyDisk.length || onlyThumb.length) {
    throw new Error('thumbnails.json out of sync with images/' + folder +
      ' — missing thumbs: ' + JSON.stringify(onlyDisk) + ', stale thumbs: ' + JSON.stringify(onlyThumb));
  }
}

const commit = execSync('git rev-parse --short HEAD', { cwd: repoDir }).toString().trim();
const STATE_VERSION = commit + '-' + crypto.createHash('sha256')
  .update(JSON.stringify([CODE_GROUPS, SEED_ASSIGNMENTS])).digest('hex').slice(0, 8);
const builtAt = new Date().toISOString().slice(0, 10);

// ── Emit page ────────────────────────────────────────────────────────────
// String.replace with a function arg so `$`-patterns in JSON can't corrupt output.
const tpl = fs.readFileSync(path.join(here, 'template.html'), 'utf8');
const fill = (html, marker, value) => html.replace(new RegExp(marker, 'g'), () => value);
let out = tpl;
out = fill(out, '__CODE_GROUPS__', JSON.stringify(CODE_GROUPS));
out = fill(out, '__RAW_IMAGES__', JSON.stringify(RAW_IMAGES));
out = fill(out, '__SEED_ASSIGNMENTS__', JSON.stringify(SEED_ASSIGNMENTS));
out = fill(out, '__CASE_KEY_MAP__', JSON.stringify(CASE_KEY_MAP));
out = fill(out, '__STATE_VERSION__', STATE_VERSION);
out = fill(out, '__BUILT_AT__', builtAt);
out = fill(out, '__COMMIT__', commit);
fs.writeFileSync(path.join(here, 'asset-manager.html'), out);

console.log('codes:', [...allCodes].length, '| seeded:', Object.keys(SEED_ASSIGNMENTS).length,
  '| images:', Object.values(RAW_IMAGES).reduce((a, v) => a + v.length, 0),
  '| version:', STATE_VERSION);
