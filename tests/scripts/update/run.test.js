// tests/scripts/update/run.test.js
// The update's first half as the helper's /update/apply runs it (scripts/update/run.js): the steps in the journal's order, the
// lock held throughout, the waits asked again, the approval card and the old helper's card raised into the state, and the second
// half read from the one line of JSON the new version's finish prints. Real git for the reviewed change; every other outside
// thing is a stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { raiseCard, lastJson, runUpdate, startFresh, updateSteps } from '../../../scripts/update/run.js';
import { openJournal, updateLockHeld } from '../../../scripts/update/journal.js';
import { helperCard, helperCardId, STOP_IT } from '../../../scripts/update/finish.js';
import { releaseCard } from '../../../scripts/update/cards.js';
import { releaseLine } from '../../../scripts/state/card-lines.js';
import { g } from '../../helpers/git-fixture.js';
import { withHome, tempFolder } from '../../helpers/homes.js';

const cardEventFor = (composed) => ({ data: composed.card });
const NEWER = 'b'.repeat(40);
const OLD = { extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref: 'v0.2.6' } } } };
const named = (ref) => `${JSON.stringify({ extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref } } } }, null, 2)}\n`;
const plan = { from: 'v0.2.6', to: 'v0.2.7', sha: NEWER, put: 'release', approval: 'card', carryOn: false };

async function project() {
  const dir = tempFolder('wh-ur-');
  await g(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), `${JSON.stringify(OLD, null, 2)}\n`);
  await g(dir, 'add', '-A');
  await g(dir, 'commit', '-q', '-m', 'one');
  return dir;
}

const withScript = (claudeHome) => {
  const dir = path.join(claudeHome, 'plugins', 'cache', 'wheelhouse', 'wheelhouse', '0.2.7', 'scripts', 'update');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'finish.js'), '// stand-in\n');
};

// Builds the world with the new release's folder present.
async function ready(over = {}) {
  const dir = await project();
  const claudeHome = tempFolder('wh-claude-');
  withScript(claudeHome);
  const log = [];
  const state = { stop: false, prStates: ['open', 'open', 'merged'], features: {}, finish: [{ ok: true, line: 'Wheelhouse v0.2.7 is installed. Start a new session on this folder to use it.' }], ...over.state };
  const client = {
    push: async (b) => { log.push(['push', b.refspec]); return { ok: true }; },
    openReleasePr: async (b) => { log.push(['open', b.head]); return { ok: true, result: { number: 5 } }; },
    prState: async () => {
      const next = state.prStates.length > 1 ? state.prStates.shift() : state.prStates[0];
      log.push(['pr', next]);
      if (next === 'merged') {
        fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), named('v0.2.7'));
        await g(dir, 'commit', '-q', '-am', 'merged');
      }
      // The helper's /pr/state answers { ok, result: { state, ... } }.
      return { ok: true, result: { state: next } };
    },
    state: { views: async () => ({ ok: true, views: { features: state.features } }) },
  };
  const steps = updateSteps({
    project: 'p1',
    folder: dir,
    plan,
    client,
    stopped: () => state.stop,
    fetch: async () => ({ ok: true, sha: NEWER }),
    check: async () => ({ ok: true }),
    install: async () => { log.push(['install']); return { ok: true, line: 'Installed.' }; },
    raise: async (composed) => { log.push(['raise', composed.card.kind, composed.card.line]); },
    finishRun: async () => { log.push(['finish']); return { code: 0, stdout: `${JSON.stringify(state.finish.length > 1 ? state.finish.shift() : state.finish[0])}\n` }; },
    claudeHome,
    mirror: tempFolder('wh-mirror-'),
    ...over.steps,
  });
  return { dir, steps, log, state };
}

const quick = { poll: 1, sleep: async () => {} };

test('run: the steps go in the journal\'s order; the approval card is raised, the merge waited for, the install and the second half run', () => withHome(async () => {
  const w = await ready();
  const out = await runUpdate({ project: 'p1', plan, steps: w.steps, ...quick });
  assert.deepEqual([out.ok], [true]);
  const names = w.log.map((l) => l[0]);
  assert.deepEqual(names.filter((n) => n !== 'pr'), ['push', 'open', 'raise', 'install', 'finish']);
  assert.ok(names.indexOf('raise') < names.indexOf('install'));
  const read = openJournal('p1').read();
  assert.deepEqual(read.steps.checks.data, { tag: 'v0.2.7', sha: NEWER, from: 'v0.2.6', put: 'release' });
  assert.deepEqual(read.steps.change.data.card, { previous: 'v0.2.6', release: 'v0.2.7', commit: NEWER });
  assert.equal(read.steps.change.data.pr, 5);
  assert.deepEqual(read.steps.merged.data, { merged: true, approved: true });
  for (const name of ['backup', 'catalogue', 'verify']) assert.equal(read.steps[name].state, 'done', name);
  assert.equal(read.steps.done.state, 'done');
  assert.equal(read.steps.done.data.line, 'Wheelhouse v0.2.7 is installed. Start a new session on this folder to use it.');
  assert.equal(w.log.find((l) => l[0] === 'raise')[2], releaseLine('v0.2.6', 'v0.2.7', NEWER));
  assert.equal(updateLockHeld(), false, 'the lock is let go at the end');
}));

test('run: the lock is held through a wait, so a second update is refused and the helper may retire for it', () => withHome(async () => {
  const w = await ready();
  let during = null;
  let second = null;
  const sleep = async () => {
    during ??= updateLockHeld();
    second ??= await runUpdate({ project: 'p1', plan, steps: [], ...quick });
  };
  const out = await runUpdate({ project: 'p1', plan, steps: w.steps, poll: 1, sleep });
  assert.equal(out.ok, true);
  assert.equal(during, true);
  assert.equal(second.ok, false);
  assert.match(second.line, /already under way/);
}));

test('run: a closed change ends the update with nothing installed', () => withHome(async () => {
  const w = await ready({ state: { prStates: ['open', 'closed'] } });
  const out = await runUpdate({ project: 'p1', plan, steps: w.steps, ...quick });
  assert.deepEqual([out.ok, out.step], [false, 'merged']);
  assert.match(out.line, /closed without being merged, so nothing was installed/);
  assert.ok(!w.log.some((l) => l[0] === 'install'));
  assert.equal(openJournal('p1').read().steps.merged.state, 'failed');
}));

test('run: All stop during the wait holds the install until it lifts, and the lock is held meanwhile', () => withHome(async () => {
  const w = await ready({ state: { stop: true, prStates: ['merged'] } });
  let waits = 0;
  const sleep = async () => { waits += 1; if (waits === 3) w.state.stop = false; };
  const out = await runUpdate({ project: 'p1', plan, steps: w.steps, poll: 1, sleep });
  assert.equal(out.ok, true);
  assert.ok(waits >= 3);
  assert.ok(w.log.findIndex((l) => l[0] === 'install') >= 0);
}));

test('run: work in progress holds the install until no feature is past started', () => withHome(async () => {
  const w = await ready({ state: { prStates: ['merged'], features: { f1: { data: { step: 'building' } } } } });
  let waits = 0;
  const sleep = async () => { waits += 1; w.state.features = {}; };
  const out = await runUpdate({ project: 'p1', plan, steps: w.steps, poll: 1, sleep });
  assert.equal(out.ok, true);
  assert.equal(waits, 1);
  const journal = openJournal('p1').read();
  assert.equal(journal.steps.idle.state, 'done');
}));

test('run: an old helper that asks raises its card into the state, waits, and finishes when the second half does', () => withHome(async () => {
  const id = helperCardId({ pid: 4242, startTime: '2026-11-04T09:00:00.000Z' });
  const card = helperCard({ kind: 'unknown', version: '0.2.4', canStop: true, id });
  const w = await ready({ state: { prStates: ['merged'], finish: [{ ok: false, line: 'Waiting for your answer about the old helper.', asks: [card] }, { ok: true, line: 'Done.' }] } });
  let sawWaiting = null;
  const sleep = async () => { sawWaiting = openJournal('p1').read().steps.finish; };
  const out = await runUpdate({ project: 'p1', plan, steps: w.steps, poll: 1, sleep });
  assert.equal(out.ok, true);
  assert.equal(sawWaiting.state, 'running', 'the step stays running while it waits for the answer');
  const raised = w.log.filter((l) => l[0] === 'raise' && l[1] === 'update-helper');
  assert.equal(raised.length, 1);
  assert.equal(w.log.filter((l) => l[0] === 'finish').length, 2);
  assert.equal(STOP_IT, 'Stop it');
}));

test('run: a failed second half stops the job with its line, and the install stands', () => withHome(async () => {
  const w = await ready({ state: { prStates: ['merged'], finish: [{ ok: false, line: 'Locked was not brought up to date: the password was refused.' }] } });
  const out = await runUpdate({ project: 'p1', plan, steps: w.steps, ...quick });
  assert.deepEqual([out.ok, out.step], [false, 'finish']);
  const read = openJournal('p1').read();
  assert.equal(read.steps.installs.state, 'done');
  assert.equal(read.steps.finish.data.line, 'Locked was not brought up to date: the password was refused.');
}));

test('run: a second half that prints nothing readable is a failure with a line to try again, never a success', () => withHome(async () => {
  const w = await ready({ state: { prStates: ['merged'] }, steps: { finishRun: async () => ({ code: 1, stdout: 'garbage\n' }) } });
  const out = await runUpdate({ project: 'p1', plan, steps: w.steps, ...quick });
  assert.equal(out.ok, false);
  assert.match(out.line, /did not answer/);
}));

test('run: a release whose own folder is missing from the plugin cache does not finish', () => withHome(async () => {
  const w = await ready({ state: { prStates: ['merged'] }, steps: { claudeHome: tempFolder('wh-claude-empty-') } });
  const out = await runUpdate({ project: 'p1', plan, steps: w.steps, ...quick });
  assert.equal(out.ok, false);
  assert.match(out.line, /folder for finishing the update was not found/);
}));

test('run: a carry-on keeps the journal and never does a done step twice; a new update starts from a blank one', () => withHome(async () => {
  const w = await ready({ state: { prStates: ['merged'] } });
  const journal = openJournal('p1');
  journal.mark('checks', 'done', { tag: 'v0.2.7', sha: NEWER, from: 'v0.2.6', put: 'release' });
  journal.mark('change', 'done', { pr: 5, skipped: null, approval: 'review' });
  const out = await runUpdate({ project: 'p1', plan: { ...plan, carryOn: true }, steps: w.steps, ...quick });
  assert.equal(out.ok, true);
  assert.ok(!w.log.some((l) => l[0] === 'push' || l[0] === 'open'), 'the change is not opened a second time');
  // A finished update's journal is cleared for the next.
  const again = await ready({ state: { prStates: ['merged'] } });
  fs.writeFileSync(path.join(again.dir, '.claude', 'settings.json'), `${JSON.stringify(OLD, null, 2)}\n`);
  const second = await runUpdate({ project: 'p1', plan, steps: again.steps, ...quick });
  assert.equal(second.ok, true);
  assert.ok(again.log.some((l) => l[0] === 'open'), 'the new update opened its own change');
}));

test('run: a wait that outlasts the most it is given stops with the way to carry on', () => withHome(async () => {
  const w = await ready({ state: { prStates: ['open'] } });
  let t = 0;
  const out = await runUpdate({ project: 'p1', plan, steps: w.steps, poll: 1, mostMs: 10, now: () => { t += 6; return t; }, sleep: async () => {} });
  assert.equal(out.ok, false);
  assert.match(out.line, /Type \/wheelhouse:update to carry on\.$/);
  assert.equal(updateLockHeld(), false);
}));

test('raiseCard: a card already in the state is not raised again, and a helper that refuses for a moment is asked again', () => withHome(async () => {
  const composed = releaseCard({ previous: 'v0.2.6', release: 'v0.2.7', commit: NEWER });
  let written = 0;
  let refusals = 2;
  const client = {
    state: {
      views: async () => ({ ok: true, cards: written > 0 ? [cardEventFor(composed)] : [] }),
      write: async () => { if (refusals > 0) { refusals -= 1; return { ok: false, refused: 'Wheelhouse is updating; try again in a minute' }; } written += 1; return { ok: true }; },
    },
  };
  assert.equal(await raiseCard({ client, project: 'p1', composed, sleep: async () => {}, every: 1 }), true);
  assert.equal(written, 1);
  assert.equal(await raiseCard({ client, project: 'p1', composed, sleep: async () => {}, every: 1 }), true);
  assert.equal(written, 1);
  await assert.rejects(() => raiseCard({ client: { state: { views: async () => ({ ok: true, cards: [] }), write: async () => ({ ok: false, refused: 'no' }) } }, project: 'p1', composed, sleep: async () => {}, tries: 2, every: 1 }), /no/);
}));

test('lastJson: the last line that is a JSON object, and nothing for anything else', () => {
  assert.deepEqual(lastJson('noise\n{"ok":true}\n'), { ok: true });
  assert.deepEqual(lastJson('{"ok":false}\n{"ok":true}\nmore\n'), { ok: true });
  assert.equal(lastJson('[1]\nnot json\n'), null);
  assert.equal(lastJson(undefined), null);
  assert.equal(typeof startFresh, 'function');
});

test('run: an open change whose card is approved is handed to the helper to merge, read from the helper\'s own answer shape', () => withHome(async () => {
  const asked = [];
  const dir = await project();
  const client = {
    push: async () => ({ ok: true }),
    openReleasePr: async () => ({ ok: true, result: { number: 5 } }),
    prState: async () => ({ ok: true, result: { state: asked.length === 0 ? 'open' : 'merged' } }),
    mergeReleasePr: async (b) => {
      asked.push(b);
      fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), named('v0.2.7'));
      await g(dir, 'commit', '-q', '-am', 'merged');
      return { ok: true, merged: true };
    },
    state: { views: async () => ({ ok: true, views: { features: {} } }) },
  };
  const claudeHome = tempFolder('wh-claude-');
  withScript(claudeHome);
  const steps = updateSteps({
    project: 'p1', folder: dir, plan, client, stopped: () => false, signed: () => true,
    fetch: async () => ({ ok: true, sha: NEWER }), check: async () => ({ ok: true }),
    install: async () => ({ ok: true, line: 'Installed.' }), raise: async () => {},
    finishRun: async () => ({ code: 0, stdout: `${JSON.stringify({ ok: true, line: 'Done.' })}\n` }),
    claudeHome, mirror: tempFolder('wh-mirror-'),
  });
  const out = await runUpdate({ project: 'p1', plan, steps, ...quick });
  assert.equal(out.ok, true);
  assert.equal(asked.length, 1);
  assert.deepEqual([asked[0].number, asked[0].release, asked[0].commit], [5, 'v0.2.7', NEWER]);
}));
