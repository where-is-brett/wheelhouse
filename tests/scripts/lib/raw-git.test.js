// tests/scripts/lib/raw-git.test.js
// Every file in scripts/ that runs git takes the fenced route, or is a listed exception.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RAW_GIT_EXCEPTIONS } from '../../../scripts/lib/safe-git.js';
import { tempFolder } from '../../helpers/homes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// The two files that are the route itself.
const THE_ROUTE = new Set(['scripts/lib/safe-git.js', 'scripts/setup/git.js']);

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : jsFiles(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
}
const runsGit = (text) => /\b\w+\(\s*['"`]git['"`]\s*,/.test(text) || /\b\w+\(\s*gitPath\b/.test(text);
const usesRoute = (text, rel) => {
  const imports = /from\s+['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(imports)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
    if (target === 'scripts/lib/safe-git.js' || target === 'scripts/setup/git.js') return true;
  }
  return false;
};

// The files under `root`/scripts that run git by neither route nor listed exception.
function offenders(root, exceptions) {
  const listed = new Set(exceptions.map((e) => e.file));
  const out = [];
  for (const full of jsFiles(path.join(root, 'scripts'))) {
    const rel = path.relative(root, full).split(path.sep).join('/');
    const text = fs.readFileSync(full, 'utf8');
    if (THE_ROUTE.has(rel) || !runsGit(text) || usesRoute(text, rel) || listed.has(rel)) continue;
    out.push(rel);
  }
  return out;
}

test('every file in scripts/ that runs git imports the fenced route, or is a listed exception', () => {
  assert.deepEqual(offenders(ROOT, RAW_GIT_EXCEPTIONS), []);
});

test('a planted file that runs git without the route fails the check', () => {
  const root = tempFolder('wh-raw-git-');
  fs.mkdirSync(path.join(root, 'scripts/x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts/x/raw.js'), "import { run } from '../lib/run.js';\nawait run('git', ['status']);\n");
  fs.writeFileSync(path.join(root, 'scripts/x/gp.js'), 'await run(gitPath, [\'status\']);\n');
  fs.writeFileSync(path.join(root, 'scripts/x/fenced.js'), "import { safeGit } from '../lib/safe-git.js';\nawait run('git', []);\n");
  fs.writeFileSync(path.join(root, 'scripts/x/quiet.js'), 'export const a = 1;\n');
  assert.deepEqual(offenders(root, []).sort(), ['scripts/x/gp.js', 'scripts/x/raw.js']);
  assert.deepEqual(offenders(root, [{ file: 'scripts/x/raw.js', reason: 'x' }]), ['scripts/x/gp.js']);
});

test('every exception names a reason and a file that exists', () => {
  for (const { file, reason } of RAW_GIT_EXCEPTIONS) {
    assert.ok(typeof reason === 'string' && reason.length > 0, `${file} has a reason`);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} exists`);
    assert.ok(runsGit(fs.readFileSync(path.join(ROOT, file), 'utf8')), `${file} still runs git, or its row goes`);
  }
  assert.ok(Object.isFrozen(RAW_GIT_EXCEPTIONS));
});
