// tests/scripts/engine/review-round.test.js
// The small lane's review loop (Archon design, section 7.2): each round's verdict says which lenses held, so the next
// round fixes them and reruns standards, spec and those lenses, and the loop closes only on no BLOCKER or HIGH. The
// plan file is taken out in its own commit before the review, so the reviews read the change alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main as round } from '../../../scripts/engine/review-round.js';
import { main as unplan } from '../../../scripts/engine/unplan.js';
import { PLAN_FILE } from '../../../scripts/engine/plan-file.js';
import { tempFolder } from '../../helpers/homes.js';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe' }).toString();
const clean = JSON.stringify({ verdict: 'CLEAN', findings: [], summary: 'ok', blocked: false, assumptions: [] });
const finding = (severity, verdict = ['BLOCKER', 'HIGH'].includes(severity) ? 'FINDINGS' : 'CLEAN') => JSON.stringify({ verdict, findings: [{ severity, file: 'src/a.js', repro: 'r', fix: 'f' }], summary: 's', blocked: false, assumptions: [] });

async function verdict(lenses, { artefacts = tempFolder('wh-round-'), most = 4 } = {}) {
  const argv = ['--artefacts', artefacts, '--most', String(most)];
  for (const name of ['standards', 'spec', 'security', 'design', 'fix']) argv.push(`--${name}`, lenses[name] ?? '');
  const lines = [];
  assert.equal(await round(argv, { out: (l) => lines.push(l) }), 0);
  return JSON.parse(lines.at(-1));
}

test('every lens clean closes the loop', async () => {
  const got = await verdict({ standards: clean, spec: clean, security: clean, design: clean });
  assert.deepEqual([got.holds, got.held, got.blocked], [false, 'none', false]);
});

test('a HIGH or BLOCKER holds its lens; a MEDIUM or LOW does not', async () => {
  assert.deepEqual(await verdict({ standards: clean, spec: clean, security: finding('HIGH') }).then((g) => [g.holds, g.held]), [true, 'security']);
  assert.deepEqual(await verdict({ standards: finding('BLOCKER'), spec: finding('HIGH') }).then((g) => [g.holds, g.held]), [true, 'standards,spec']);
  assert.deepEqual(await verdict({ standards: finding('MEDIUM'), spec: finding('LOW') }).then((g) => [g.holds, g.held]), [false, 'none']);
});

test('a FINDINGS verdict holds even with no BLOCKER or HIGH, as the helper signs only CLEAN', async () => {
  assert.deepEqual(await verdict({ standards: finding('MEDIUM', 'FINDINGS'), spec: clean }).then((g) => [g.holds, g.held]), [true, 'standards']);
});

test('a lens that didn\'t run is not held, and one whose output can\'t be read is', async () => {
  const got = await verdict({ standards: clean, spec: 'not json', security: '' });
  assert.deepEqual([got.holds, got.held], [true, 'spec']);
  assert.deepEqual(await verdict({ standards: clean, spec: JSON.stringify({ verdict: 'CLEAN' }) }).then((g) => g.held), 'spec', 'a review with no findings list');
  assert.deepEqual(await verdict({ standards: clean }).then((g) => g.held), 'spec', 'standards and spec always run');
});

test('a blocked step carries its question, the fix step first', async () => {
  const ask = (q) => JSON.stringify({ verdict: 'CLEAN', findings: [], summary: 's', blocked: true, question: q, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], recommend: 'a', level: '4', topic: 'money', assumptions: [] });
  const got = await verdict({ standards: ask('From the reviewer?'), spec: clean });
  assert.deepEqual([got.blocked, got.question, got.level, got.topic, got.recommend], [true, 'From the reviewer?', '4', 'money', 'a']);
  const fixFirst = await verdict({ standards: ask('From the reviewer?'), spec: clean, fix: JSON.stringify({ summary: 's', blocked: true, question: 'From the fixer?', options: [], recommend: '', level: '3', topic: 't', assumptions: [] }) });
  assert.equal(fixFirst.question, 'From the fixer?');
  const none = await verdict({ standards: clean, spec: clean });
  assert.deepEqual([none.blocked, none.question, none.options], [false, '', []]);
});

test('each round is counted, and the last one closes the loop so the review can hold it', async () => {
  const artefacts = tempFolder('wh-round-');
  const held = { standards: finding('HIGH'), spec: clean };
  const first = await verdict(held, { artefacts, most: 2 });
  assert.deepEqual([first.round, first.last, first.done], [1, false, false]);
  const second = await verdict(held, { artefacts, most: 2 });
  assert.deepEqual([second.round, second.last, second.done, second.holds], [2, true, true, true]);
  const fresh = await verdict({ standards: clean, spec: clean });
  assert.deepEqual([fresh.round, fresh.done], [1, true], 'nothing held: done in round one');
  const asked = await verdict({ standards: JSON.stringify({ verdict: 'CLEAN', findings: [], blocked: true, question: 'q', options: [], recommend: '', level: '3', topic: 't' }), spec: clean });
  assert.equal(asked.done, true, 'a blocked exit ends the loop');
});

test('the round\'s findings from the lenses that held are left for the fix step', async () => {
  const artefacts = tempFolder('wh-round-');
  await verdict({ standards: finding('MEDIUM'), spec: finding('HIGH') }, { artefacts });
  const left = JSON.parse(fs.readFileSync(path.join(artefacts, 'review-findings.json'), 'utf8'));
  assert.equal(left.round, 1);
  assert.deepEqual(Object.keys(left.findings), ['spec']);
  assert.equal(left.findings.spec[0].severity, 'HIGH');
});

test('unplan takes the plan out in its own commit, once', async () => {
  const dir = tempFolder('wh-unplan-');
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'wh/card-1');
  fs.writeFileSync(path.join(dir, PLAN_FILE), '- [x] **Task 1:** One\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'plan');
  const call = async () => { const lines = []; assert.equal(await unplan(['--base', 'main'], { cwd: dir, out: (l) => lines.push(l) }), 0); return JSON.parse(lines.at(-1)); };
  assert.deepEqual(await call(), { removed: true });
  assert.equal(fs.existsSync(path.join(dir, PLAN_FILE)), false);
  assert.equal(git(dir, 'log', '-1', '--format=%s').trim(), 'Take out the build plan');
  assert.equal(git(dir, 'status', '--porcelain').trim(), '');
  assert.deepEqual(await call(), { removed: false });
  assert.equal(git(dir, 'diff', '--name-only', 'main...HEAD').trim(), '', 'the change no longer holds the plan');
});
