// tests/e2e/git-alone-merge.test.js
// The local queue from a ready change to the main version (spec 7.4): the real helper, the fake engine and a real home. A merge
// needs the signed check, a signed review and the permit; a planted check, a clash, a red main line and All stop each hold it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_COMMAND, LOCAL_P as P, gitAloneWorld } from '../helpers/engine-e2e.js';
import { waitLongerOnTheHelper, until } from '../helpers/until.js';
import { commandDigest } from '../../scripts/checks/record.js';
import { FIX_LANE } from '../../scripts/engine/fix-main.js';
import { workOrder } from '../../scripts/engine/order.js';
import { withTicket } from '../../scripts/engine/ticket.js';
import { localChanges } from '../../scripts/host/local/changes.js';
import { keepSeenMain, seenMain } from '../../scripts/host/local/merge.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { run } from '../../scripts/lib/run.js';
import { liftStop, setStop } from '../../scripts/lib/stop.js';
import { g } from '../helpers/git-fixture.js';
import { dataHash, eventPath, listEvents, makeEvent } from '../../scripts/state/events.js';

waitLongerOnTheHelper();

const DIGEST = commandDigest(LOCAL_COMMAND);
const records = (kind) => listEvents(stateDir(P), { report: () => {} }).filter((e) => e.kind === kind);
const orderOf = (id) => workOrder({ work: { id, lane: 'quick', goal: 'Show prices with two decimals', done: [{ test: 'prices' }], visible: false }, config: { pages: [] } });
const headIn = async (repo, ref) => (await run('git', ['rev-parse', '--verify', '-q', ref], { cwd: repo })).stdout.trim();
const changeOf = (n) => localChanges({ project: P }).changeOf(n);
const verdictsFile = () => path.join(stateDir(P), '..', 'engine', 'verdicts.json');
// What the queue has said once, which is where a send back shows.
function saidOnce() {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir(P), '..', 'engine', 'local-queue.json'), 'utf8'));
  } catch {
    return {};
  }
}

// A stand-in for the checks: every commit passes unless `said` names another result for it.
function checks(said = () => 'passed') {
  return async ({ commit, main }) => ({ commit, command: DIGEST, result: said(commit, main === true), minutes: 0, tail: '', ...(main ? { clean: true } : {}) });
}

// A run's change: opened, signed CLEAN if `reviewed`, and marked ready as the run's mark-ready step would.
async function readyChange({ helper, client, engine, worktreeWith }, id, text, { reviewed = true, also = null } = {}) {
  const started = await helper.engine.start({ project: P, order: orderOf(id) });
  assert.equal(started.ok, true, started.refused);
  const made = await worktreeWith(`wh/${id}`, text);
  const { worktree } = made;
  if (also !== null) {
    fs.mkdirSync(path.dirname(path.join(worktree, also)), { recursive: true });
    fs.writeFileSync(path.join(worktree, also), 'A setting.\n');
    await run('git', ['add', '-A'], { cwd: worktree });
    await run('git', ['-c', 'user.name=Run', '-c', 'user.email=run@localhost', 'commit', '-q', '-m', 'And a setting'], { cwd: worktree });
  }
  const head = await headIn(worktree, 'HEAD');
  const opened = await withTicket(client, ['--artefacts', engine.artefactsOf(started.runId)]).engine.openPr({ runId: started.runId, cwd: worktree, title: `Change ${id}`, body: 'Prices show two decimals.' });
  assert.equal(opened.ok, true, opened.refused);
  if (reviewed) {
    const signed = await client.state.record({ project: P, event: makeEvent({ kind: 'review', data: { pr: opened.pr, commit: head, verdict: 'CLEAN' } }) });
    assert.equal(signed.ok, true, JSON.stringify(signed));
  }
  const verdicts = JSON.parse(fs.readFileSync(verdictsFile(), 'utf8'));
  verdicts.ready = { ...verdicts.ready, [opened.pr]: { head, runId: started.runId, showFirst: false, work: id } };
  fs.writeFileSync(verdictsFile(), `${JSON.stringify(verdicts, null, 2)}\n`);
  return { n: opened.pr, head, worktree, runId: started.runId };
}
const ticksUntil = (helper, found, what) => until(async () => {
  await helper.engine.tick();
  return found();
}, { what, within: 30000 });
const ticks = async (helper, n) => { for (let i = 0; i < n; i += 1) await helper.engine.tick(); };

test('a change with its signed check, review and permit reaches the main version, and the folder comes up', { timeout: 120000 }, () => gitAloneWorld(async (world) => {
  const { helper, folder, home, tools } = world;
  const was = await headIn(home, 'refs/heads/main');
  const { n, head } = await readyChange(world, 'card-1', 'export const price = (c) => (c / 100).toFixed(2);\n');
  const merged = await ticksUntil(helper, () => (changeOf(n).state === 'merged' ? changeOf(n) : null), 'the merge');
  const main = await headIn(home, 'refs/heads/main');
  assert.equal(main, merged.mergeCommit);
  assert.notEqual(main, head, 'most changes squash');
  assert.equal((await run('git', ['rev-parse', `${main}^`], { cwd: home })).stdout.trim(), was);
  assert.equal(await headIn(home, 'refs/heads/wh/card-1'), '', 'the branch goes from the home');
  assert.equal(await headIn(home, `refs/pull/${n}/head`), head, 'the change keeps its place');
  assert.equal(await headIn(folder, 'refs/heads/main'), main, 'the folder comes up');
  assert.match(fs.readFileSync(path.join(folder, 'src', 'price.js'), 'utf8'), /toFixed/);
  assert.ok(records('merge').some((e) => e.data.commit === main));
  assert.deepEqual(tools, [], 'no call to gh');
}, { check: checks() }));

test('a check nobody signed adds nothing', { timeout: 120000 }, () => gitAloneWorld(async (world) => {
  const { helper, home } = world;
  const main = await headIn(home, 'refs/heads/main');
  const { n, head } = await readyChange(world, 'card-2', 'export const price = () => 2;\n');
  const { sig: _dropped, ...planted } = makeEvent({ kind: 'check', data: { commit: head, command: DIGEST, result: 'passed', minutes: 0, tail: '' } });
  const file = path.join(stateDir(P), eventPath(planted));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(planted, null, 2)}\n`);
  await ticks(helper, 6);
  assert.equal(changeOf(n).state, 'open');
  assert.equal(await headIn(home, 'refs/heads/main'), main);
}, { check: checks((commit, onMain) => (onMain ? 'passed' : 'could-not-run')) }));

test('a change with no signed review goes back', { timeout: 120000 }, () => gitAloneWorld(async (world) => {
  const { helper, home } = world;
  const main = await headIn(home, 'refs/heads/main');
  const { n, head } = await readyChange(world, 'card-9', 'export const price = () => 9;\n', { reviewed: false });
  await ticksUntil(helper, () => saidOnce()[`sent:${n}:${head}:stale`], 'the send back');
  assert.equal(changeOf(n).state, 'open');
  assert.equal(await headIn(home, 'refs/heads/main'), main);
}, { check: checks() }));

test('a change that no longer merges goes back, and the main version keeps the first', { timeout: 120000 }, () => gitAloneWorld(async (world) => {
  const { helper, home } = world;
  const first = await readyChange(world, 'card-3', 'export const price = () => 3;\n');
  const second = await readyChange(world, 'card-4', 'export const price = () => 4;\n');
  await ticksUntil(helper, () => changeOf(first.n).state === 'merged', 'the first merge');
  await ticks(helper, 6);
  assert.equal(changeOf(second.n).state, 'open');
  assert.equal(await headIn(home, 'refs/heads/main'), changeOf(first.n).mergeCommit);
  assert.ok(saidOnce()[`sent:${second.n}:${second.head}:clash`]);
}, { check: checks() }));

const firstMain = { commit: null };
test('a red main line holds the work and opens one incident for its commit, and green closes it', { timeout: 120000 }, () => gitAloneWorld(async (world) => {
  const { helper, home, engine } = world;
  firstMain.commit = await headIn(home, 'refs/heads/main');
  const { n } = await readyChange(world, 'card-5', 'export const price = () => 5;\n');
  await ticksUntil(helper, () => changeOf(n).state === 'merged', 'the merge');
  const incident = await ticksUntil(helper, () => records('incident').find((e) => e.data.kind === 'red-main'), 'the incident');
  assert.equal(incident.data.suspect, n);
  const waiting = await readyChange(world, 'card-6', 'export const price = () => 6;\n');
  await ticks(helper, 6);
  assert.equal(changeOf(waiting.n).state, 'open', 'the rest waits');
  assert.equal(records('incident').filter((e) => e.data.id === incident.data.id).length, 1, 'one incident for one commit');
  assert.equal(engine.calls.filter((c) => c.call === 'start' && c.order?.lane === FIX_LANE).length, 1, 'one fix');
  assert.equal(await headIn(home, 'refs/heads/main'), changeOf(n).mergeCommit);
  // The fix lands, stood in by a new main version the helper keeps: its clean check is green, and the work moves on.
  const tree = await headIn(home, 'refs/heads/main^{tree}');
  const fix = (await run('git', ['-c', 'user.name=Fix', '-c', 'user.email=fix@localhost', 'commit-tree', tree, '-p', 'refs/heads/main', '-m', 'The fix'], { cwd: home })).stdout.trim();
  await run('git', ['update-ref', 'refs/heads/main', fix], { cwd: home });
  keepSeenMain(P, fix);
  firstMain.commit = fix;
  await ticksUntil(helper, () => changeOf(waiting.n).state === 'merged', 'the waiting change, on a green main line');
}, { check: checks((commit, onMain) => (onMain && firstMain.commit !== null && commit !== firstMain.commit ? 'failed' : 'passed')) }));

test('All stop holds a ready change until it lifts', { timeout: 120000 }, () => gitAloneWorld(async (world) => {
  const { helper, home } = world;
  const main = await headIn(home, 'refs/heads/main');
  const { n } = await readyChange(world, 'card-7', 'export const price = () => 7;\n');
  setStop({ by: 'helper' });
  try {
    await ticks(helper, 6);
    assert.equal(changeOf(n).state, 'open');
    assert.equal(await headIn(home, 'refs/heads/main'), main);
  } finally {
    liftStop();
  }
  await ticksUntil(helper, () => changeOf(n).state === 'merged', 'the merge after the stop lifts');
}, { check: checks() }));

test('the merge route needs the signed check too', { timeout: 120000 }, () => gitAloneWorld(async (world) => {
  const { client, home } = world;
  const main = await headIn(home, 'refs/heads/main');
  const { n } = await readyChange(world, 'card-8', 'export const price = () => 8;\n');
  const got = await client.merge({ project: P, number: n });
  assert.notEqual(got.ok, true);
  assert.equal(changeOf(n).state, 'open');
  assert.equal(await headIn(home, 'refs/heads/main'), main);
}, { check: checks(() => 'could-not-run') }));

// The main version moved by hand, as something outside the helper would.
async function moveOutside(home) {
  const tree = await headIn(home, 'refs/heads/main^{tree}');
  const moved = (await run('git', ['-c', 'user.name=Outside', '-c', 'user.email=out@localhost', 'commit-tree', tree, '-p', 'refs/heads/main', '-m', 'From outside'], { cwd: home })).stdout.trim();
  await run('git', ['update-ref', 'refs/heads/main', moved], { cwd: home });
  return moved;
}
const cardOf = (found) => records('card').find((e) => found(e.data));
const confirm = (client, card) => client.confirm({ project: P, card: card.id, hash: dataHash(card.data) });
const atWindow = (label) => async () => ({ choice: label });

test('Keep it answers Main moved at the window, and the queue goes on', { timeout: 120000 }, () => gitAloneWorld(async (world) => {
  const { helper, client, home } = world;
  await ticksUntil(helper, () => seenMain(P) !== null, 'the first look');
  const moved = await moveOutside(home);
  const card = await ticksUntil(helper, () => cardOf((d) => String(d.question).includes(moved)), 'the Main moved card');
  const { n } = await readyChange(world, 'card-10', 'export const price = () => 10;\n');
  await ticks(helper, 3);
  assert.equal(changeOf(n).state, 'open', 'the queue holds');
  const kept = await confirm(client, card);
  assert.equal(kept.kept, true, JSON.stringify(kept));
  assert.equal(seenMain(P), moved);
  await ticksUntil(helper, () => changeOf(n).state === 'merged', 'the merge');
  assert.equal((await run('git', ['merge-base', '--is-ancestor', moved, 'refs/heads/main'], { cwd: home })).code, 0, 'what moved it stays');
}, { check: checks(), askWindow: atWindow('Keep it') }));

test('Undo it takes what moved the main version back out, under All stop too, and one click does it once', { timeout: 120000 }, () => gitAloneWorld(async (world) => {
  const { helper, client, home, worktreeWith } = world;
  await ticksUntil(helper, () => seenMain(P) !== null, 'the first look');
  const { worktree, head: moved } = await worktreeWith('wh/outside', 'export const price = () => 0;\n');
  await g(worktree, 'push', '-q', home, 'HEAD:refs/heads/main');
  const card = await ticksUntil(helper, () => cardOf((d) => String(d.question).includes(moved)), 'the Main moved card');
  setStop({ by: 'helper' });
  try {
    const undone = await confirm(client, card);
    assert.equal(typeof undone.undone?.undo, 'string', JSON.stringify(undone));
    assert.equal(await headIn(home, 'refs/heads/main'), undone.undone.undo);
    assert.equal(seenMain(P), undone.undone.undo);
  } finally {
    liftStop();
  }
}, { check: checks(), askWindow: atWindow('Undo it') }));

test('Undo takes a merge back out on the director\'s click, and one click does it once', { timeout: 120000 }, () => gitAloneWorld(async (world) => {
  const { helper, client, home } = world;
  const { n } = await readyChange(world, 'card-13', 'export const price = () => 13;\n');
  await ticksUntil(helper, () => changeOf(n).state === 'merged', 'the merge');
  const merge = changeOf(n).mergeCommit;
  const asked = await client.local.undo({ project: P, merge });
  assert.equal(asked.needs, 'window');
  const card = cardOf((d) => String(d.question).includes(merge));
  const undone = await confirm(client, card);
  assert.equal(await headIn(home, 'refs/heads/main'), undone.undone.undo);
  assert.equal(seenMain(P), undone.undone.undo);
  assert.equal((await client.local.undo({ project: P, merge })).needs, 'window', 'the click is spent');
  assert.equal(await headIn(home, 'refs/heads/main'), undone.undone.undo);
}, { check: checks(), askWindow: atWindow('Undo') }));

test('a change that takes the director\'s say raises its card once, and goes in on their Approve', { timeout: 120000 }, () => gitAloneWorld(async (world) => {
  const { helper, client } = world;
  const { n } = await readyChange(world, 'card-11', 'export const price = () => 11;\n', { also: '.archon/settings.yaml' });
  const card = await ticksUntil(helper, () => cardOf((d) => String(d.question).includes(`#${n}`)), 'the approval card');
  assert.match(card.data.question, new RegExp(`Pull request #${n}`));
  await ticks(helper, 3);
  assert.equal(records('card').filter((e) => e.id !== card.id && String(e.data.question).includes(`#${n}`)).length, 0);
  assert.equal(changeOf(n).state, 'open');
  const answered = await confirm(client, card);
  assert.equal(answered.recorded, true, JSON.stringify(answered));
  await ticksUntil(helper, () => changeOf(n).state === 'merged', 'the merge');
}, { check: checks(), askWindow: atWindow('Approve') }));

test('the merge route answers to the main line and to a main version moved outside', { timeout: 120000 }, () => gitAloneWorld(async (world) => {
  const { helper, client, home } = world;
  const { n } = await readyChange(world, 'card-12', 'export const price = () => 12;\n');
  await ticks(helper, 2);
  const early = await client.merge({ project: P, number: n });
  assert.match(String(early.refused), /own check/);
  assert.equal(changeOf(n).state, 'open');
  await moveOutside(home);
  const moved = await client.merge({ project: P, number: n });
  assert.notEqual(moved.ok, true);
  assert.equal(changeOf(n).state, 'open');
}, { check: checks((commit, onMain) => (onMain ? 'could-not-run' : 'passed')) }));
