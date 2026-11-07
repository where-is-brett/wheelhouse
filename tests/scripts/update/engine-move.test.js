// tests/scripts/update/engine-move.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  moveOffArchon, undoMove, archiveArchon, liveArchonRuns, openQuestion, removalCard, carriedFile, REMOVE_THEM, KEEP_THEM, MOVED_LINE,
} from '../../../scripts/update/engine-move.js';
import { readReadyRecord } from '../../../scripts/survey/ready-record.js';
import { CARRY_ON } from '../../../scripts/engine/archon/adapter.js';
import { openJournal, restore } from '../../../scripts/update/journal.js';
import { withHome, tempFolder } from '../../helpers/homes.js';

const P = 'o__p';
const WORK = 'todo-cli';
const BRANCH = 'feature/todo-cli';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function repo() {
  const dir = tempFolder('wh-move-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Base');
  git(dir, 'checkout', '-q', '-b', BRANCH);
  fs.writeFileSync(path.join(dir, 'a.js'), '// a.js\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Half the work');
  git(dir, 'checkout', '-q', 'main');
  return dir;
}

const runRec = (runId, state, extra = {}) => ({ kind: 'run', data: { runId, state, work: WORK, lane: 'slice', branch: BRANCH, engine: 'archon', ...extra } });

// A stand-in for the helper's state and Archon's connector, counting what each was asked.
function fakes({ runs = { [WORK]: [runRec('r1', 'running')] }, asks = {}, questions = {}, status = 'running', unread = false } = {}) {
  const writes = [];
  const cancels = [];
  const inspects = [];
  const client = { state: { write: async (body) => { writes.push(body); return { ok: true }; } } };
  const connector = {
    inspect: async (runId) => { inspects.push(runId); return unread ? { unread: true } : { status, branch: BRANCH }; },
    act: async (runId, how) => { cancels.push({ runId, how }); return { ok: true }; },
  };
  return { writes, cancels, inspects, client, connector, views: async () => ({ runs, asks, questions }) };
}

function move(f, { folder, progress, journal = null, stored = 'archon', othersOnArchon = () => false, archive = () => ({ folder: 'x', moved: [] }) }) {
  return moveOffArchon({
    project: P, folder, journal, progress, stored: () => stored, views: f.views, connector: f.connector, client: f.client,
    othersOnArchon, archive, now: () => new Date('2026-11-07T09:00:00Z'),
  });
}

test('a project not on Archon is left alone', () => withHome(async () => {
  const f = fakes();
  assert.equal(await move(f, { folder: repo(), progress: {}, stored: 'wheelhouse' }), null);
  assert.equal(f.inspects.length + f.writes.length, 0);
}));

test('a live Archon run is cancelled and carried on from its branch, once however often the update runs', () => withHome(async () => {
  const folder = repo();
  const f = fakes();
  const progress = {};
  const out = await move(f, { folder, progress });
  assert.equal(out.done, true);
  assert.equal(out.lines[0], MOVED_LINE);
  assert.deepEqual(f.cancels, [{ runId: 'r1', how: { cancel: true } }]);
  const head = git(folder, 'rev-parse', BRANCH);
  const id = 'carry-on-todo-cli';
  assert.deepEqual(readReadyRecord(P, id), { sha: head, ref: `refs/wheelhouse/from/${id}`, request: null, branch: BRANCH });
  assert.equal(git(folder, 'rev-parse', `refs/wheelhouse/from/${id}`), head);
  const work = f.writes.filter((w) => w.kind === 'work');
  assert.equal(work.length, 1);
  assert.deepEqual(work[0].data, { id, title: `Carry on: ${WORK}`, lane: 'slice', visible: true, dependsOn: [], parent: WORK, from: { sha: head, ref: `refs/wheelhouse/from/${id}` } });
  const carried = JSON.parse(fs.readFileSync(carriedFile(P), 'utf8'));
  assert.equal(carried[id].order, CARRY_ON);
  assert.equal(carried[id].branch, BRANCH);
  assert.equal(carried[id].ask, null);
  assert.equal(git(folder, 'rev-parse', BRANCH), head, 'the branch is kept as it was');

  const again = await move(f, { folder, progress });
  assert.equal(again.done, true);
  assert.equal(f.cancels.length, 1, 'not cancelled twice');
  assert.equal(f.writes.filter((w) => w.kind === 'work').length, 1, 'not queued twice');
  assert.equal(f.writes.filter((w) => w.kind === 'card').length, 1, 'one removal card');
}));

test('a run that has already ended is not cancelled, and an ended record is not live', () => withHome(async () => {
  assert.deepEqual(liveArchonRuns({ [WORK]: [runRec('r1', 'running'), runRec('r1', 'ended')] }), []);
  assert.deepEqual(liveArchonRuns({ [WORK]: [runRec('r2', 'running', { engine: 'wheelhouse' })] }), []);
  const f = fakes({ status: 'ended' });
  const out = await move(f, { folder: repo(), progress: {} });
  assert.equal(out.done, true);
  assert.equal(f.cancels.length, 0);
  assert.equal(f.writes.filter((w) => w.kind === 'work').length, 1, 'its work is still carried on');
}));

test('an Archon that does not answer holds the move until the next run, with nothing done twice', () => withHome(async () => {
  const folder = repo();
  const progress = {};
  const quiet = fakes({ unread: true });
  const out = await move(quiet, { folder, progress });
  assert.equal(out.done, false);
  assert.match(out.lines.join('\n'), /did not answer/);
  assert.equal(quiet.cancels.length, 0);
  let archived = 0;
  const f = fakes();
  await move(quiet, { folder, progress, archive: () => { archived += 1; return null; } });
  assert.equal(archived, 0, 'not archived while a run is unsettled');
  const done = await move(f, { folder, progress, archive: () => { archived += 1; return null; } });
  assert.equal(done.done, true);
  assert.equal(f.cancels.length, 1);
  assert.equal(archived, 1);
}));

test('an unanswered Archon question stays, and the carry-on\'s order names it', () => withHome(async () => {
  const asks = { [WORK]: [{ kind: 'ask', data: { id: 'q1', runId: 'r1', question: 'Which file?' } }, { kind: 'ask', data: { id: 'q0', runId: 'r1', question: 'Old?' } }] };
  const questions = { q0: { answer: { label: 'Yes' } }, q1: {} };
  assert.deepEqual(openQuestion({ asks, questions }, WORK, 'r1'), { id: 'q1', question: 'Which file?' });
  assert.equal(openQuestion({ asks, questions: { q0: { answer: { label: 'Yes' } }, q1: { answer: { label: 'a.js' } } } }, WORK, 'r1'), null);
  const f = fakes({ asks, questions });
  await move(f, { folder: repo(), progress: {} });
  const carried = JSON.parse(fs.readFileSync(carriedFile(P), 'utf8'));
  assert.deepEqual(carried['carry-on-todo-cli'].ask, { id: 'q1', question: 'Which file?' });
  assert.equal(f.writes.filter((w) => w.kind === 'answer').length, 0, 'the question is not answered for the director');
}));

test('the removal card is a card with clickable options and a recommendation', () => {
  const card = removalCard();
  assert.equal(card.kind, 'question');
  assert.deepEqual(card.options, [REMOVE_THEM, KEEP_THEM]);
  assert.equal(card.recommend, REMOVE_THEM);
  assert.match(card.question, /\.archon/);
  assert.ok(card.parts.meanwhile);
});

test('Archon on the computer is archived only once no other project here stores it, and the undo puts it back', () => withHome(async () => {
  const home = tempFolder('wh-archon-');
  const parts = [path.join(home, 'engine', 'archon'), path.join(home, 'engine', 'bun'), path.join(home, '.wheelhouse-engine')];
  for (const p of parts) { fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, 'x'), 'x'); }
  const archive = () => archiveArchon({ parts, into: path.join(home, 'archive'), date: new Date('2026-11-07T09:00:00Z') });

  const held = {};
  await move(fakes({ runs: {} }), { folder: repo(), progress: held, othersOnArchon: () => true, archive });
  assert.equal(held.engine.archived, null);
  assert.ok(parts.every((p) => fs.existsSync(p)), 'kept while another project uses it');

  const progress = {};
  const out = await move(fakes({ runs: {} }), { folder: repo(), progress, archive });
  assert.match(out.lines.join('\n'), /archive/);
  assert.ok(parts.every((p) => !fs.existsSync(p)));
  const folder = path.join(home, 'archive', 'archon-2026-11-07');
  assert.deepEqual(fs.readdirSync(folder).sort(), ['archon', 'bun', 'wheelhouse-engine']);
  undoMove(progress);
  assert.ok(parts.every((p) => fs.existsSync(path.join(p, 'x'))), 'nothing was deleted');
}));

test('the update\'s undo removes the ready record and the carried order the move wrote', () => withHome(async () => {
  const folder = repo();
  const journal = openJournal(P);
  await move(fakes(), { folder, progress: {}, journal });
  assert.ok(readReadyRecord(P, 'carry-on-todo-cli'));
  restore(journal);
  assert.equal(readReadyRecord(P, 'carry-on-todo-cli'), null);
  assert.equal(fs.existsSync(carriedFile(P)), false);
}));

test('a second carry-on of the same work takes a free name', () => withHome(async () => {
  const folder = repo();
  git(folder, 'update-ref', 'refs/wheelhouse/from/carry-on-todo-cli', git(folder, 'rev-parse', 'main'));
  const f = fakes();
  await move(f, { folder, progress: {} });
  assert.equal(f.writes.find((w) => w.kind === 'work').data.id, 'carry-on-todo-cli-2');
}));
