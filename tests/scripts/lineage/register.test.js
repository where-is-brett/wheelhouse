// tests/scripts/lineage/register.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyChange, readConfig } from '../../../scripts/gate/guardrails.js';
import { run } from '../../../scripts/lib/run.js';
import { fingerprintFile } from '../../../scripts/lineage/fingerprint.js';
import { UPSTREAMS } from '../../../scripts/lineage/manifest.js';
import {
  OVERRIDE_PATH, checkAnchors, checkCarried, checkOverrideText, readRegister,
} from '../../../scripts/lineage/register.js';
import { tempFolder } from '../../helpers/homes.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const register = readRegister(repo);
const overrideText = fs.readFileSync(path.join(repo, OVERRIDE_PATH), 'utf8');

function write(dir, relative, content) {
  const file = path.join(dir, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// A folder per upstream holding only the anchor lines, each in the file it is anchored in.
function anchorFolders() {
  const roots = {};
  for (const override of register.overrides) {
    roots[override.upstream] ??= tempFolder(`wh-anchors-${override.upstream}-`);
    for (const { file, text } of override.anchors) {
      const at = path.join(roots[override.upstream], ...file.split('/'));
      const before = fs.existsSync(at) ? fs.readFileSync(at, 'utf8') : '';
      write(roots[override.upstream], file, `${before}Some words before. ${text}\nAnd some after.\n`);
    }
  }
  return roots;
}

test('every anchor is found in a folder that holds it', () => {
  assert.deepEqual(checkAnchors({ register, roots: anchorFolders() }), []);
});

test('an anchor sentence that has gone is named', () => {
  const roots = anchorFolders();
  const { text } = register.overrides.find((o) => o.id === 'models').anchors[0];
  const file = path.join(roots.superpowers, 'skills', 'subagent-driven-development', 'SKILL.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(text, 'Choose whichever model suits.'));
  assert.deepEqual(checkAnchors({ register, roots }), [{ id: 'models', file: 'skills/subagent-driven-development/SKILL.md', text }]);
});

test('an anchor whose file has gone is named, and a path leaving the folder is never read', () => {
  const roots = anchorFolders();
  fs.rmSync(path.join(roots.superpowers, 'skills', 'writing-plans'), { recursive: true });
  assert.deepEqual(checkAnchors({ register, roots }).map((b) => b.id), ['nothing-waits']);
  const outside = { ...register, overrides: [{ ...register.overrides[0], anchors: [{ file: '../x.md', text: 'x' }] }] };
  const outer = tempFolder('wh-outer-');
  write(outer, 'x.md', 'x');
  fs.mkdirSync(path.join(outer, 'inner'));
  assert.equal(checkAnchors({ register: outside, roots: { superpowers: path.join(outer, 'inner') } }).length, 1);
});

test('an upstream with no folder given is skipped', () => {
  const roots = anchorFolders();
  fs.rmSync(roots.superpowers, { recursive: true });
  assert.deepEqual(checkAnchors({ register, roots: { 'mattpocock-skills': roots.superpowers } }), []);
  assert.deepEqual(checkAnchors({ register, roots: {} }), []);
  assert.deepEqual(checkCarried({ register, roots: {} }), []);
});

test('a changed carried-text source is named', () => {
  const dir = tempFolder('wh-carried-');
  const [carried] = register.carried;
  write(dir, carried.file, 'made-up source\n');
  const held = { ...register, carried: [{ ...carried, hash: fingerprintFile(path.join(dir, ...carried.file.split('/'))).hash }] };
  const roots = { [carried.upstream]: dir };
  assert.deepEqual(checkCarried({ register: held, roots }), []);
  write(dir, carried.file, 'made-up source, changed\n');
  assert.deepEqual(checkCarried({ register: held, roots }), [carried.id]);
  fs.rmSync(path.join(dir, 'skills'), { recursive: true });
  assert.deepEqual(checkCarried({ register: held, roots }), [carried.id]);
});

test('each override has its rule in override.md and a scenario from 20 to 35', () => {
  assert.deepEqual(checkOverrideText({ register, overrideText }), []);
  assert.deepEqual(register.overrides.map((o) => o.id), ['fix-rounds', 're-review', 'no-rulings-at-3-4', 'nothing-waits', 'front-desk', 'models', 'reviewers']);
  for (const override of register.overrides) {
    assert.ok(override.scenario >= 20 && override.scenario <= 35, override.id);
    assert.equal(override.upstream, 'superpowers');
  }
  assert.deepEqual(checkOverrideText({ register, overrideText: overrideText.replace(register.overrides[2].rule, '') }), ['no-rulings-at-3-4']);
});

test('every assumption names a check and says whether a person must re-test it', () => {
  assert.equal(register.assumptions.length, 9);
  for (const assumption of register.assumptions) {
    assert.ok(Number.isInteger(assumption.check) && assumption.check > 0, assumption.id);
    assert.ok(['script', 'person'].includes(assumption.retest), assumption.id);
    assert.ok(assumption.feature.length > 0 && assumption.says.length > 0, assumption.id);
  }
  assert.equal(new Set(register.assumptions.map((a) => a.id)).size, 9);
});

test('the carried text is what the quick-lane brief carries, and names a file of a pinned upstream', () => {
  const quick = fs.readFileSync(path.join(repo, 'templates', 'brief', 'lanes', 'quick.md'), 'utf8');
  const between = quick.split('<!-- implement:begin -->\n')[1].split('\n<!-- implement:end -->')[0];
  const [carried] = register.carried;
  assert.equal(register.carried.length, 1);
  assert.equal(carried.text, between);
  assert.equal(carried.text.split('\n').filter((line) => line !== '').length, 5);
  assert.ok(UPSTREAMS.some((u) => u.name === carried.upstream));
});

test('every override and carried text names a pinned upstream, and the anchored skills are ones Wheelhouse fingerprints', () => {
  const names = UPSTREAMS.map((u) => u.name);
  for (const item of [...register.overrides, ...register.carried]) assert.ok(names.includes(item.upstream), item.id);
  const folders = UPSTREAMS.find((u) => u.name === 'superpowers').folders;
  for (const override of register.overrides) {
    for (const { file } of override.anchors) assert.ok(folders.some((folder) => file.startsWith(`${folder}/`)), `${override.id}: ${file}`);
  }
});

test('the command line checks folders given as name=folder, and refuses anything else', async () => {
  const script = path.join(repo, 'scripts', 'lineage', 'register.js');
  const roots = anchorFolders();
  const ok = await run('node', [script, 'check', `superpowers=${roots.superpowers}`], { cwd: repo });
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /register ok/);
  assert.match(ok.stdout, /not checked, no folder given: mattpocock-skills/);
  fs.writeFileSync(path.join(roots.superpowers, 'skills', 'brainstorming', 'SKILL.md'), 'nothing\n');
  const broken = await run('node', [script, 'check', `superpowers=${roots.superpowers}`], { cwd: repo });
  assert.equal(broken.code, 1);
  assert.match(broken.stdout, /anchor gone: front-desk/);
  for (const args of [[], ['check'], ['check', 'superpowers'], ['check', '=x'], ['write', 'a=b']]) {
    assert.equal((await run('node', [script, ...args], { cwd: repo })).code, 2, args.join(' '));
  }
});

test("Wheelhouse's own configuration makes the register, the marketplace and the override page guardrail files", () => {
  const config = readConfig(fs.readFileSync(path.join(repo, '.claude', 'wheelhouse.json'), 'utf8'));
  const area = config.criticalAreas.find((a) => a.name === 'lineage');
  assert.deepEqual(area.checks, ['lineage/**', '.claude-plugin/marketplace.json', 'templates/brief/override.md']);
  for (const file of ['lineage/register.json', 'lineage/manifest.json', '.claude-plugin/marketplace.json', 'templates/brief/override.md']) {
    const found = classifyChange({ paths: [file], config });
    assert.equal(found.touchesGuardrails, true, file);
    assert.deepEqual(found.criticalAreas, ['lineage'], file);
  }
  assert.equal(classifyChange({ paths: ['README.md'], config }).touchesGuardrails, false);
});
