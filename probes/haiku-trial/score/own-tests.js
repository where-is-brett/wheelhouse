// probes/haiku-trial/score/own-tests.js
// What the builders did about tests: wrote them, kept CI green, kept the tests, and wrote tests that bite.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MERCHANTS } from '../statement.js';
import { defaultRun, installDependencies } from './run.js';

const SKIPPED = new Set(['node_modules', '.git']);
const TEST_PATH = /^tests?\/|\.(test|spec)\.[cm]?js$|-test\.[cm]?js$/;

export function filesUnder(dir, sub = '') {
  const base = path.join(dir, sub);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED.has(entry.name)) return [];
    const rel = path.posix.join(sub.split(path.sep).join('/'), entry.name);
    return entry.isDirectory() ? filesUnder(dir, rel) : [rel];
  });
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const isTestFile = (rel) => /\.[cm]?js$/.test(rel) && TEST_PATH.test(rel);

async function ghJson(gh, args) {
  try {
    const out = await gh(args);
    return typeof out === 'string' ? JSON.parse(out) : out;
  } catch {
    return null;
  }
}

function exportedNames(text) {
  const names = [];
  for (const m of text.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) names.push(m[1]);
  for (const m of text.matchAll(/export\s+const\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|function|\w+\s*=>)/g)) names.push(m[1]);
  return names;
}

// The test files the builders wrote or changed: a file still exactly as the seed had it at baseSha is not theirs.
function writtenParts(dir, baseSha, run) {
  const seedText = (rel) => {
    if (baseSha === undefined) return null;
    const got = run('git', ['show', `${baseSha}:${rel}`], { cwd: dir });
    return got.status === 0 ? got.stdout : null;
  };
  const tests = filesUnder(dir).filter(isTestFile).filter((rel) => seedText(rel) !== read(dir, rel)).map((rel) => read(dir, rel));
  const calls = (name) => new RegExp(`\\b${name}\\s*\\(`);
  const categoriesFile = path.join(dir, 'src/lib/categories.js');
  const categorisers = new Set(['categorise']);
  if (fs.existsSync(categoriesFile)) exportedNames(fs.readFileSync(categoriesFile, 'utf8')).filter((n) => !/^[A-Z_]+$/.test(n)).forEach((n) => categorisers.add(n));
  return {
    parseAmount: tests.some((t) => calls('parseAmount').test(t)),
    categorise: tests.some((t) => [...categorisers].some((n) => calls(n).test(t))),
    totals: tests.some((t) => /\b\w*[Tt]otals?\w*\s*\(/.test(t)),
    e2e: tests.some((t) => /\/import/.test(t) && /\/month/.test(t) && /\b(fetch|request|supertest)\b|http\.request/.test(t)),
  };
}

// Whether every file under src/ changed since baseSha was changed in a pull request that also changed a test file.
async function everySrcChangeHasTest({ dir, baseSha, gh, run }) {
  const diff = run('git', ['diff', '--name-only', `${baseSha}..HEAD`, '--', 'src/'], { cwd: dir });
  const changed = diff.stdout.split('\n').filter(Boolean);
  if (diff.status !== 0 || changed.length === 0) return { ok: false, note: 'no source files changed since the base' };
  const range = run('git', ['rev-list', `${baseSha}..HEAD`], { cwd: dir });
  const inRange = new Set(range.stdout.split('\n').filter(Boolean));
  const prs = await ghJson(gh, ['pr', 'list', '--state', 'merged', '--base', 'main', '--limit', '200', '--json', 'number,mergeCommit,files']);
  if (!Array.isArray(prs)) return { ok: false, note: 'could not read the pull requests' };
  const covered = new Set();
  for (const pr of prs) {
    const oid = pr.mergeCommit?.oid;
    if (oid && inRange.size && !inRange.has(oid)) continue;
    const files = (pr.files ?? []).map((f) => f.path ?? f);
    if (!files.some((f) => TEST_PATH.test(f))) continue;
    files.forEach((f) => covered.add(f));
  }
  const bare = changed.filter((f) => !covered.has(f));
  return bare.length === 0 ? { ok: true } : { ok: false, note: `no test changed alongside ${bare.join(', ')}` };
}

function countTests(dir, run) {
  const out = run(process.execPath, ['--test', '--test-reporter=tap'], { cwd: dir });
  const m = /^# tests (\d+)/m.exec(out.stdout);
  return m ? Number(m[1]) : null;
}

function testCounts({ dir, baseSha, run }) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-counts-'));
  try {
    const clone = path.join(scratch, 'repo');
    if (run('git', ['clone', '--quiet', '--no-hardlinks', dir, clone]).status !== 0) return null;
    const merges = run('git', ['rev-list', '--first-parent', '--reverse', `${baseSha}..HEAD`], { cwd: clone }).stdout.split('\n').filter(Boolean);
    return [baseSha, ...merges].map((sha) => {
      run('git', ['checkout', '--quiet', sha], { cwd: clone });
      // Each commit may need what it lists: a clone has no node_modules, and a test that cannot import counts as none.
      installDependencies(clone, run);
      return countTests(clone, run) ?? 0;
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// Turns parseAmount into a function that loses the sign of money coming back. Returns false when it cannot find it.
export function flipRefundSign(dir) {
  for (const rel of filesUnder(dir, 'src').filter((f) => f.endsWith('.js'))) {
    const text = read(dir, rel);
    const decl = /(^|\n)(export\s+)?(async\s+)?(function\s+parseAmount\b|const\s+parseAmount\s*=)/.exec(text);
    if (!decl || decl[3]) continue;
    const exported = Boolean(decl[2]);
    let out = text.replace(decl[0], decl[0].replace('parseAmount', '__parseAmountOriginal').replace(/export\s+/, ''));
    out = out.replace(/export\s*\{([^}]*)\}\s*;?/g, (whole, list) => {
      const rest = list.split(',').map((s) => s.trim()).filter((s) => s && s !== 'parseAmount');
      return rest.length ? `export { ${rest.join(', ')} };` : '';
    });
    out += `\n${exported || /export\s*\{[^}]*parseAmount/.test(text) ? 'export ' : ''}function parseAmount(...args) {\n  const value = __parseAmountOriginal(...args);\n  return typeof value === 'number' && value < 0 ? -value : value;\n}\n`;
    fs.writeFileSync(path.join(dir, rel), out);
    return true;
  }
  return false;
}

// Makes one known merchant unrecognisable, so it falls to "other". Returns false when no merchant's name is in src/.
export function changeOneCategory(dir) {
  const files = filesUnder(dir, 'src').filter((f) => f.endsWith('.js'));
  const names = MERCHANTS.filter((m) => m.category !== 'income').flatMap((m) => [m.name, m.name.split(/[\s,]/)[0]]);
  for (const name of names) {
    const pattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for (const rel of files) {
      const text = read(dir, rel);
      if (!pattern.test(text)) continue;
      fs.writeFileSync(path.join(dir, rel), text.replace(pattern, 'Nobody Known Here'));
      return true;
    }
  }
  return false;
}

export function biteScore({ dir, run = defaultRun, notes = [] }) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-bite-'));
  const copy = (name) => {
    const target = path.join(scratch, name);
    fs.cpSync(dir, target, { recursive: true, filter: (src) => path.basename(src) !== '.git' });
    return target;
  };
  try {
    if (run('npm', ['test'], { cwd: copy('baseline') }).status !== 0) {
      notes.push('bite: the tests do not pass before any change, so a failure would prove nothing');
      return 0;
    }
    let failed = 0;
    for (const [what, mutate] of [['flipping the refund sign', flipRefundSign], ['changing a merchant category', changeOneCategory]]) {
      const target = copy(what.replace(/\W+/g, '-'));
      if (!mutate(target)) {
        notes.push(`bite: could not apply ${what}`);
        continue;
      }
      if (run('npm', ['test'], { cwd: target }).status !== 0) failed += 1;
      else notes.push(`bite: the tests still pass after ${what}`);
    }
    return Math.floor(failed * 1.5);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export async function ownTests({ dir, baseSha, gh, run = defaultRun }) {
  const notes = [];
  const parts = { written: 0, green: 0, kept: 0, bite: 0 };

  const found = writtenParts(dir, baseSha, run);
  for (const [name, ok] of Object.entries(found)) {
    if (ok) parts.written += 1;
    else notes.push(`written: no ${name} test`);
  }
  const every = await everySrcChangeHasTest({ dir, baseSha, gh, run });
  if (every.ok) parts.written += 1;
  else notes.push(`written: ${every.note}`);

  const latest = await ghJson(gh, ['run', 'list', '--branch', 'main', '--status', 'completed', '--limit', '1', '--json', 'conclusion']);
  if (Array.isArray(latest) && latest[0]?.conclusion === 'success') parts.green = 3;
  else notes.push('green: the last completed CI run on main did not pass, or could not be read');

  const deleted = run('git', ['log', '--diff-filter=D', '--format=%H', `${baseSha}..HEAD`, '--', 'tests/'], { cwd: dir });
  if (deleted.status === 0 && deleted.stdout.trim() === '') parts.kept += 1;
  else notes.push('kept: a test file was deleted');
  const skipping = filesUnder(dir, 'tests').filter((f) => /\.[cm]?js$/.test(f)).filter((f) => /\.skip\(|\btodo\(|\{\s*skip\b/.test(read(dir, f)));
  if (skipping.length === 0) parts.kept += 1;
  else notes.push(`kept: skipped or todo tests in ${skipping.join(', ')}`);
  const counts = testCounts({ dir, baseSha, run });
  if (counts && counts.every((n, i) => i === 0 || n >= counts[i - 1])) parts.kept += 1;
  else notes.push(`kept: the test count fell (${counts?.join(', ') ?? 'could not be counted'})`);
  if (counts && counts.at(-1) > counts[0]) parts.kept += 1;
  else notes.push('kept: the test count is not higher than at the start');

  parts.bite = biteScore({ dir, run, notes });

  return { points: parts.written + parts.green + parts.kept + parts.bite, of: 15, parts, notes };
}
