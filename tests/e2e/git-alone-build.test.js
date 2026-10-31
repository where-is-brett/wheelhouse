// tests/e2e/git-alone-build.test.js
// A project with no host from work order to an open change (spec 5.3): the real helper, the fake engine and a real git folder.
// The run's branch reaches the home and the engine's mirror, a local change opens, its head is checked on this computer, and
// no host tool runs. Changes made by hand reach the same place through the director's click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_COMMAND, LOCAL_P as P, gitAloneWorld } from '../helpers/engine-e2e.js';
import { waitLongerOnTheHelper, until } from '../helpers/until.js';
import { commandDigest } from '../../scripts/checks/record.js';
import { workOrder } from '../../scripts/engine/order.js';
import { withTicket } from '../../scripts/engine/ticket.js';
import { localChanges } from '../../scripts/host/local/changes.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { run } from '../../scripts/lib/run.js';
import { dataHash, eventPath, listEvents, makeEvent } from '../../scripts/state/events.js';
import { CHECK_AND_ADD } from '../../scripts/state/card-lines.js';
import { commitIn } from '../helpers/local-home.js';
import { g } from '../helpers/git-fixture.js';

waitLongerOnTheHelper();

const records = (kind) => listEvents(stateDir(P), { report: () => {} }).filter((e) => e.kind === kind);
const orderOf = (id) => workOrder({ work: { id, lane: 'quick', goal: 'Show prices with two decimals', done: [{ test: 'prices' }], visible: false }, config: { pages: [] } });
// The real check on the Mac, fetching from the home; elsewhere nothing can run one, so it is stood in for.
const standInCheck = async ({ commit, main }) => ({ commit, command: commandDigest(LOCAL_COMMAND), result: 'passed', minutes: 0, tail: '', ...(main ? { clean: true } : {}) });
// The director's click on the card, as the record keeps it.
function answer({ data }) {
  const event = makeEvent({ kind: 'action', data: { action: 'answer', question: 'the card as shown', questionId: data.id, questionHash: dataHash(data), label: CHECK_AND_ADD } });
  const file = path.join(stateDir(P), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}
const headIn = async (repo, ref) => (await run('git', ['rev-parse', '--verify', '-q', ref], { cwd: repo })).stdout.trim();

test('a quick run goes from work order to an open change on the fake engine and a real git folder', { timeout: 120000 }, () => gitAloneWorld(async ({ helper, client, engine, home, mirror, tools, worktreeWith }) => {
  const started = await helper.engine.start({ project: P, order: orderOf('card-1') });
  assert.equal(started.ok, true, started.refused);
  const { worktree, head } = await worktreeWith('wh/card-1', 'export const price = (c) => (c / 100).toFixed(2);\n');
  const art = engine.artefactsOf(started.runId);
  const opened = await withTicket(client, ['--artefacts', art]).engine.openPr({ runId: started.runId, cwd: worktree, title: 'Show prices', body: 'Prices show two decimals.' });
  assert.equal(opened.ok, true, opened.refused);
  assert.equal(opened.head, head);
  const change = localChanges({ project: P }).changeOf(opened.pr);
  assert.deepEqual([change.state, change.branch, change.base, change.head, change.title], ['open', 'wh/card-1', 'main', head, 'Show prices']);
  assert.equal(await headIn(home, `refs/pull/${opened.pr}/head`), head);
  assert.equal(await headIn(mirror, 'refs/heads/wh/card-1'), head);
  const check = await until(async () => {
    await helper.engine.tick();
    return records('check').find((e) => e.data.commit === head);
  }, { what: 'a check at the head', within: 30000 });
  assert.equal(check.data.result, 'passed');
  assert.deepEqual(tools, [], 'no call to gh');
}, process.platform === 'darwin' ? {} : { check: standInCheck }));

test('changes made by hand reach a local change by the director\'s click, and the main version stays', { timeout: 120000 }, () => gitAloneWorld(async ({ helper, client, folder, home, tools }) => {
  const main = await headIn(home, 'refs/heads/main');
  const tip = await commitIn(folder, 'by-hand.txt');
  const card = await until(async () => {
    await helper.engine.tick();
    return records('question').find((e) => e.data.work === 'by-hand');
  }, { what: 'the card', within: 30000 });
  answer(card);
  const change = await until(async () => {
    await helper.engine.tick();
    return localChanges({ project: P }).openChanges()[0];
  }, { what: 'the local change', within: 30000 });
  assert.equal(change.head, tip);
  assert.equal(await headIn(home, 'refs/heads/main'), main);
  assert.equal(await headIn(folder, 'refs/heads/main'), tip, 'the folder keeps its work');
  assert.equal(await headIn(folder, `refs/heads/${change.branch}`), '', 'the folder keeps no branch for it');
  const survey = records('survey').at(-1);
  assert.deepEqual(survey.data.requests.map((r) => r.number), [change.n]);
  const carried = await client.survey.carryOn({ project: P, number: change.n });
  assert.equal(carried.ok, true, carried.refused);
  assert.equal(carried.from.sha, tip);
  assert.deepEqual(tools, []);
}, { check: standInCheck }));

test('parted work is brought up to date with the main version', { timeout: 120000 }, () => gitAloneWorld(async ({ helper, client, folder, home, worktreeWith }) => {
  // The home moves on by a change's branch, stood in by pushing to it directly, as a merge would.
  const { worktree } = await worktreeWith('wh/card-2', 'export const price = () => 1;\n');
  await g(worktree, 'push', '-q', home, 'HEAD:refs/heads/main');
  const moved = await headIn(home, 'refs/heads/main');
  await commitIn(folder, 'by-hand.txt');
  const card = await until(async () => {
    await helper.engine.tick();
    return records('question').find((e) => e.data.work === 'by-hand');
  }, { what: 'the card', within: 30000 });
  answer(card);
  const change = await until(async () => {
    await helper.engine.tick();
    const open = localChanges({ project: P }).openChanges()[0];
    return open && (await run('git', ['merge-base', '--is-ancestor', moved, open.head], { cwd: home })).code === 0 ? open : null;
  }, { what: 'the change brought up to date', within: 30000 });
  assert.equal(fs.existsSync(path.join(folder, 'by-hand.txt')), true);
  assert.notEqual(change.head, moved);
}, { check: standInCheck }));
