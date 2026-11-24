// tests/scripts/agents/copilot/setup.test.js
// Setup's copy of Superpowers' brainstorming skill into the person's Copilot skills folder (scripts/agents/copilot/setup.js,
// brainstorming-copy.js): planned only once the kept kit passes its hash check, changed from upstream in two front matter lines
// only, journalled so uninstall takes it out, and copied again when the pin moves. Everything runs in a temporary home; nothing
// is fetched and the real ~/.copilot is never read or written.
import '../../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fingerprintTree } from '../../../../scripts/lineage/fingerprint.js';
import { ensureKits, kitFolder } from '../../../../scripts/agents/copilot/kits.js';
import { brainstormingFiles, plannedBrainstorming, renameBrainstorming } from '../../../../scripts/agents/copilot/brainstorming-copy.js';
import { BRAINSTORMING_LINE, applyComputer, computerChanges, refresh } from '../../../../scripts/agents/copilot/setup.js';
import { fileURLToPath } from 'node:url';
import { withHome, tempFolder } from '../../../helpers/homes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const NOW = () => new Date('2026-11-24T00:00:00Z');
const SKILL = '---\nname: brainstorming\ndescription: "You MUST use this before any creative work."\n---\n\n# Brainstorming\n\nAsk questions one at a time.\n';
const FILES = { 'SKILL.md': SKILL, 'visual-companion.md': 'The visual companion.\n', 'scripts/server.cjs': 'server();\n' };

// A kit holding brainstorming, as upstream has it, in a local folder; the manifest is fingerprinted from it.
function superpowers(files = FILES, sha = 'b'.repeat(40)) {
  const source = tempFolder('wh-sp-source-');
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(source, 'skills', 'brainstorming', file)), { recursive: true });
    fs.writeFileSync(path.join(source, 'skills', 'brainstorming', file), text);
  }
  const upstream = { name: 'superpowers', plugin: 'superpowers', repo: 'https://example.invalid/sp.git', ref: 'v7', sha, folders: [{ path: 'skills/brainstorming', hash: fingerprintTree(path.join(source, 'skills', 'brainstorming')).hash }], files: [] };
  return { manifest: { upstreams: [upstream] }, fetchTo: async (u, dir) => { fs.cpSync(source, dir, { recursive: true }); } };
}

const plan = (home, kits) => computerChanges({ env: { COPILOT_HOME: home }, userHome: home, platform: 'darwin', root: ROOT, brainstorming: () => plannedBrainstorming({ ...kits, now: NOW }) });
const copyOf = (changes) => changes.filter((c) => c.part === 'brainstorming');

test('the copy is planned to the Copilot skills folder, after the kit\'s hash check, and differs from upstream in the name and the description\'s opening only', () => withHome(async () => {
  const kits = superpowers();
  await ensureKits({ ...kits, now: NOW });
  const home = tempFolder('wh-copilot-');
  const copy = copyOf(plan(home, kits));
  assert.deepEqual(copy.map((c) => path.relative(home, c.target).split(path.sep).join('/')), [
    'skills/wheelhouse-brainstorming/SKILL.md', 'skills/wheelhouse-brainstorming/scripts/server.cjs', 'skills/wheelhouse-brainstorming/visual-companion.md',
  ]);
  assert.equal(copy[0].line, BRAINSTORMING_LINE);
  assert.ok(copy.slice(1).every((c) => c.line === null), 'one line on the plan');
  assert.ok(copy.every((c) => c.kind === 'file' && c.what === 'agent'));
  const byRel = Object.fromEntries(copy.map((c) => [path.relative(path.join(home, 'skills', 'wheelhouse-brainstorming'), c.target).split(path.sep).join('/'), c.content]));
  assert.equal(byRel['visual-companion.md'], FILES['visual-companion.md']);
  assert.equal(byRel['scripts/server.cjs'], FILES['scripts/server.cjs']);
  assert.equal(byRel['SKILL.md'], '---\nname: wheelhouse-brainstorming\ndescription: "In a Wheelhouse project only: You MUST use this before any creative work."\n---\n\n# Brainstorming\n\nAsk questions one at a time.\n');
  // Word for word apart from those two lines.
  assert.equal(byRel['SKILL.md'].split('\n').slice(4).join('\n'), SKILL.split('\n').slice(4).join('\n'));
}));

test('a kit that doesn\'t match the manifest plans nothing, and brainstormingFiles refuses with the hold\'s record', () => withHome(async () => {
  const kits = superpowers();
  await ensureKits({ ...kits, now: NOW });
  fs.appendFileSync(path.join(kitFolder(kits.manifest.upstreams[0]), 'skills', 'brainstorming', 'SKILL.md'), 'edited\n');
  assert.throws(() => brainstormingFiles({ ...kits, now: NOW }), (error) => error.records?.[0]?.kind === 'lineage-hold');
  assert.deepEqual(plannedBrainstorming({ ...kits, now: NOW }), []);
  assert.deepEqual(copyOf(plan(tempFolder('wh-copilot-'), kits)).length, 0, 'planned only when the check passes');
  // And a kit that was never kept plans nothing either.
  assert.deepEqual(copyOf(plan(tempFolder('wh-copilot-'), superpowers(FILES, 'c'.repeat(40)))), []);
}));

test('a copy already in place is not planned again', () => withHome(async () => {
  const kits = superpowers();
  await ensureKits({ ...kits, now: NOW });
  const home = tempFolder('wh-copilot-');
  const first = copyOf(plan(home, kits));
  applyComputer(first, { record: () => {}, newId: () => 'x' });
  assert.deepEqual(copyOf(plan(home, kits)), []);
}));

test('the journal holds each file with what it held before, so uninstall can take it out', () => withHome(async () => {
  const kits = superpowers();
  await ensureKits({ ...kits, now: NOW });
  const home = tempFolder('wh-copilot-');
  const mine = path.join(home, 'skills', 'wheelhouse-brainstorming', 'visual-companion.md');
  fs.mkdirSync(path.dirname(mine), { recursive: true });
  fs.writeFileSync(mine, 'The director\'s own.\n');
  const journal = [];
  let n = 0;
  applyComputer(copyOf(plan(home, kits)), { record: (c) => journal.push(c), newId: () => `chg-${n += 1}` });
  assert.equal(journal.length, 3);
  assert.ok(journal.every((c) => c.kind === 'file' && fs.readFileSync(c.target, 'utf8') === c.after));
  assert.equal(journal.find((c) => c.target === mine).before, 'The director\'s own.\n');
  assert.equal(journal.filter((c) => c.before === null).length, 2);
}));

test('when the pin moves, update copies it again into the same files, recorded in the setup run\'s journal', () => withHome(async () => {
  const old = superpowers();
  await ensureKits({ ...old, now: NOW });
  const home = tempFolder('wh-copilot-');
  const env = { COPILOT_HOME: home };
  const journal = { runs: [{ id: 'run-1', changes: [] }] };
  const add = (id, changes) => journal.runs.find((r) => r.id === id).changes.push(...changes);
  applyComputer(copyOf(plan(home, old)), { record: (c) => add('run-1', [c]), newId: () => 'c' });
  const moved = superpowers({ ...FILES, 'visual-companion.md': 'The visual companion, moved.\n' }, 'd'.repeat(40));
  await ensureKits({ ...moved, now: NOW });
  const line = refresh({ env, userHome: home, platform: 'darwin', root: ROOT, journal: () => journal, add, brainstorming: () => brainstormingFiles({ ...moved, now: NOW }) });
  assert.match(line, /Superpowers' brainstorming file visual-companion\.md now matches the pinned release/);
  assert.equal(fs.readFileSync(path.join(home, 'skills', 'wheelhouse-brainstorming', 'visual-companion.md'), 'utf8'), 'The visual companion, moved.\n');
  assert.equal(journal.runs[0].changes.at(-1).after, 'The visual companion, moved.\n');
  // A file the director changed since setup is left alone, and said so.
  fs.writeFileSync(path.join(home, 'skills', 'wheelhouse-brainstorming', 'visual-companion.md'), 'Edited.\n');
  const again = superpowers({ ...FILES, 'visual-companion.md': 'Another.\n' }, 'e'.repeat(40));
  await ensureKits({ ...again, now: NOW });
  const left = refresh({ env, userHome: home, platform: 'darwin', root: ROOT, journal: () => journal, add, brainstorming: () => brainstormingFiles({ ...again, now: NOW }) });
  assert.match(left, /isn't the one setup wrote, so it was left as it is/);
  assert.equal(fs.readFileSync(path.join(home, 'skills', 'wheelhouse-brainstorming', 'visual-companion.md'), 'utf8'), 'Edited.\n');
}));

test('renameBrainstorming changes the name and description lines and refuses a skill without them', () => {
  assert.match(renameBrainstorming('---\nname: brainstorming\ndescription: Plain words.\n---\nBody.\n'), /^---\nname: wheelhouse-brainstorming\ndescription: "In a Wheelhouse project only: Plain words\."\n---\nBody\.\n$/);
  assert.throws(() => renameBrainstorming('Body only.\n'), /no front matter/);
  assert.throws(() => renameBrainstorming('---\nname: brainstorming\n---\nBody.\n'), /no name or no description/);
});
