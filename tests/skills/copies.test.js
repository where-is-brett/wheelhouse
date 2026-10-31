// tests/skills/copies.test.js
// The pinned, adapted skill copies the build steps use (Archon design, section 7.1): each carries its licence and a
// note of its source, none asks a person or starts a helper, each says it is for Wheelhouse's build steps, and each
// source is pinned at the version the manifest names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { skillCopyNames, readCopies, changedCopies } from '../../scripts/lineage/copies.js';
import { PACK_DIR, checkPack } from '../../scripts/engine/pack-check.js';
import { PLUGIN_FILES, importClosure } from '../../scripts/eval/front-desk.js';
import { COPY_SOURCES, UPSTREAMS } from '../../scripts/lineage/manifest.js';
import { tempFolder } from '../helpers/homes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const copies = readCopies(ROOT);
const textOf = (name) => fs.readdirSync(path.join(ROOT, 'skills', name)).filter((f) => f.endsWith('.md') && f !== 'SOURCE.md')
  .map((f) => fs.readFileSync(path.join(ROOT, 'skills', name, f), 'utf8')).join('\n');

test('the copies are the folders with a SOURCE.md, and the build steps\' own skills are among them', () => {
  const names = skillCopyNames();
  assert.deepEqual([...names].sort(), copies.map((c) => c.name).sort());
  for (const name of ['codebase-design', 'pr', 'review-standards', 'review-spec', 'frontend-design']) assert.ok(names.includes(name), name);
  for (const own of ['foreman', 'front-desk', 'intake', 'setup']) assert.ok(!names.includes(own), own);
});

// A plugin whose skills can't be read: a copy's SOURCE.md with no SKILL.md beside it, which fails on any computer and
// for any user, as a folder the sandbox denies does (EPERM) on the Mac. `entries`, what they import and the tool sheets are copied in.
function pluginWithUnreadableCopy(entries) {
  const root = tempFolder('wh-copies-');
  for (const file of ['package.json', ...importClosure(entries), ...PLUGIN_FILES.filter((f) => f.startsWith('adapters/') && f.endsWith('.md'))]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), path.join(root, file));
  }
  fs.mkdirSync(path.join(root, 'skills', 'broken'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'broken', 'SOURCE.md'), '- Upstream: kit\n');
  return root;
}

test('the commands and hooks start when the skills can\'t be read: the copies are read when asked for, not on import', () => {
  const entries = ['scripts/frontdesk/cli.js', 'scripts/feature/cli.js', 'scripts/hooks/stop-guard.js'];
  const root = pluginWithUnreadableCopy(entries);
  for (const entry of entries) {
    const url = pathToFileURL(path.join(root, entry)).href;
    execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)});`], { stdio: 'pipe', input: '' });
  }
});

test('a pack check and the copies\' names fail when the skills can\'t be read, never passing on an empty list', async () => {
  const root = pluginWithUnreadableCopy(['scripts/engine/pack-check.js']);
  const copiesFile = pathToFileURL(path.join(root, 'scripts', 'lineage', 'copies.js')).href;
  const packFile = pathToFileURL(path.join(root, 'scripts', 'engine', 'pack-check.js')).href;
  const { skillCopyNames: namesThere } = await import(copiesFile);
  const { checkPack: checkThere } = await import(packFile);
  assert.throws(() => namesThere(), /SKILL\.md/);
  assert.throws(() => checkThere(PACK_DIR), /SKILL\.md/);
  assert.deepEqual(checkPack(PACK_DIR, { skillCopies: skillCopyNames() }), []);
});

test('every copy carries its licence and a SOURCE.md naming a version', () => {
  for (const copy of copies) {
    const dir = path.join(ROOT, 'skills', copy.name);
    assert.ok(fs.readdirSync(dir).some((f) => /^LICEN[CS]E/.test(f)), `${copy.name} has no licence`);
    assert.ok(copy.sources.length > 0, `${copy.name} names no source`);
    for (const source of copy.sources) {
      assert.match(source.version, /\S/, `${copy.name}: ${source.upstream} has no version`);
      assert.match(source.commit, /^[0-9a-f]{40}$/, `${copy.name}: ${source.upstream} has no commit`);
      assert.ok(source.files.length > 0 && source.files.every((f) => /^[0-9a-f]{64}$/.test(f.hash)), `${copy.name}: ${source.upstream}'s files have no fingerprints`);
    }
  }
});

test('no copy says to ask the user or a human partner', () => {
  for (const { name } of copies) {
    const text = textOf(name);
    assert.doesNotMatch(text, /human partner/i, name);
    assert.doesNotMatch(text, /\b(ask|confirm with|tell|check with)\s+(the|your)\s+(user|client|human|person)\b/i, name);
    assert.doesNotMatch(text, /\bask (them|the user) (for|where|which)\b/i, name);
  }
});

test('no copy names subagent-driven-development or a helper agent', () => {
  for (const { name } of copies) {
    const text = textOf(name);
    assert.doesNotMatch(text, /subagent-driven-development|dispatching-parallel-agents/i, name);
    assert.doesNotMatch(text, /\b(spawn|dispatch|spin up)\b[^.\n]*\bsub-?agents?\b/i, name);
    assert.doesNotMatch(text, /DESIGN-IT-TWICE/, name);
  }
});

test('every copy\'s description begins For Wheelhouse\'s build steps', () => {
  for (const { name, description } of copies) assert.match(description, /^For Wheelhouse's build steps:/, name);
});

test('the manifest pins each copy\'s upstream version', () => {
  for (const copy of copies) {
    for (const source of copy.sources) {
      const kit = UPSTREAMS.find((u) => u.name === source.upstream);
      const other = COPY_SOURCES.find((s) => s.name === source.upstream);
      const pin = kit ? { repo: kit.repo, version: kit.ref, commit: kit.sha } : other && { repo: other.repo, version: other.ref, commit: other.sha };
      assert.ok(pin, `${copy.name}: ${source.upstream} is pinned nowhere`);
      assert.deepEqual({ repo: source.repo, version: source.version, commit: source.commit }, pin, `${copy.name}: ${source.upstream}`);
    }
  }
});

test('the pull request copy keeps private records out', () => {
  assert.match(textOf('pr'), /Keep every private record out/);
});

test('changedCopies lists a copy whose source changed in a candidate, and leaves the copy alone', () => {
  const dir = tempFolder('wh-copies-');
  const source = 'skills/engineering/pr/SKILL.md';
  fs.mkdirSync(path.join(dir, 'skills', 'engineering', 'pr'), { recursive: true });
  fs.writeFileSync(path.join(dir, source), 'a new upstream text\n');
  const pr = copies.find((c) => c.name === 'pr');
  const before = textOf('pr');
  const changed = changedCopies({ copies: [pr], candidates: { 'mattpocock-skills': { dir } } });
  assert.deepEqual(changed, [{ copy: 'pr', upstream: 'mattpocock-skills', path: source }, { copy: 'pr', upstream: 'mattpocock-skills', path: 'skills/engineering/pr/CREDITS.md' }]);
  assert.equal(textOf('pr'), before);
  assert.deepEqual(changedCopies({ copies: [pr], candidates: {} }), []);
});
