// tests/scripts/host/helper-hook-click.test.js
// /cards/hook-shown and /cards/hook-click: a click an agent's hook saw is recorded as proof hook-click only for a card the
// helper kept as shown to that session, once, within HOOK_CLICK_MS, with the card's words and options unchanged. Every
// other click is refused and writes nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { eventPath, listEvents, makeEvent, dataHash } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { HOOK_CLICK_MS, CONFIRMED_STEPS } from '../../../scripts/agents/chat-clicks.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { LIFT_STOP_CARD } from '../../../scripts/frontdesk/cli.js';
import { CARD } from '../desk/fixture.js';

const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const T0 = new Date('2026-10-29T01:00:00.000Z');
const P = 'o__p';
let clock = T0.getTime();
const now = () => new Date(clock);

async function project() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  const folder = path.join(home, 'repo');
  await as(home, async () => {
    fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
    fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeProject(P, { folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await openTestRecord({ env: LOCAL_PATHS, project: P, remoteUrl: remote.url });
  });
  return { home, cleanup: () => { remote.cleanup(); fs.rmSync(home, { recursive: true, force: true }); } };
}

function keep(event) {
  const file = path.join(stateDir(P), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}

const inProject = (fn) => async () => {
  clock = T0.getTime();
  const p = await project();
  try {
    await as(p.home, async () => {
      const helper = await startHelper({ run: hostGuard, address: testAddress(process.env.WHEELHOUSE_HOME), adapterFor: async () => ({ defaultBranch: async () => 'main' }), envFor: async () => ({}), now });
      try { await fn(helperClient({ address: helper.address })); } finally { await helper.close(); }
    });
  } finally { p.cleanup(); }
};

const answers = () => listEvents(stateDir(P), { report: () => {} }).filter((e) => e.kind === 'card-answer');
const card = () => makeEvent({ kind: 'card', data: CARD, now });
const ask = (extra = {}) => ({ project: P, session: 's1', message: CARD.question, options: CARD.options, ...extra });

test('a click on a card shown to the session is recorded as hook-click, unsigned, naming the card, its hash and the session', inProject(async (client) => {
  const c = card();
  keep(c);
  const shown = await client.cards.hookShown(ask());
  assert.equal(shown.ok, true, shown.refused);
  assert.equal(shown.card, c.id);
  const got = await client.cards.hookClick(ask({ label: 'Approve' }));
  assert.equal(got.ok, true, got.refused);
  const [record] = answers();
  assert.equal(record.data.proof, 'hook-click', 'the audit can tell it from signed-hook');
  assert.equal(record.data.question, c.id);
  assert.equal(record.data.label, 'Approve');
  assert.equal(record.data.hash, dataHash(CARD));
  assert.equal(record.data.source, 's1');
  assert.equal(record.sig, undefined, 'a hook click is never signed');
}));

test('a click for a card never shown is refused, and so is one for a card shown to another session', inProject(async (client) => {
  keep(card());
  const never = await client.cards.hookClick(ask({ label: 'Approve' }));
  assert.equal(never.ok, false);
  assert.match(never.refused, /not shown to this session/);
  await client.cards.hookShown(ask({ session: 's2' }));
  assert.equal((await client.cards.hookClick(ask({ label: 'Approve' }))).ok, false);
  assert.deepEqual(answers(), []);
}));

test('a shown card takes one click: a replay is refused', inProject(async (client) => {
  keep(card());
  await client.cards.hookShown(ask());
  assert.equal((await client.cards.hookClick(ask({ label: 'Approve' }))).ok, true);
  const again = await client.cards.hookClick(ask({ label: 'Approve' }));
  assert.equal(again.ok, false);
  assert.match(again.refused, /taken already/);
  assert.equal(answers().length, 1);
}));

test('a click after the window is refused and the card must be shown again', inProject(async (client) => {
  keep(card());
  await client.cards.hookShown(ask());
  clock += HOOK_CLICK_MS + 1000;
  const late = await client.cards.hookClick(ask({ label: 'Approve' }));
  assert.equal(late.ok, false);
  assert.match(late.refused, /too long ago/);
  await client.cards.hookShown(ask());
  assert.equal((await client.cards.hookClick(ask({ label: 'Approve' }))).ok, true);
}));

test('the click must name one of the card\'s options, and the options asked must be the card\'s', inProject(async (client) => {
  keep(card());
  await client.cards.hookShown(ask());
  assert.equal((await client.cards.hookClick(ask({ label: 'Approve it all' }))).ok, false);
  assert.equal((await client.cards.hookClick(ask({ label: 'Suggest a change…', options: [...CARD.options, 'Suggest a change…'] }))).ok, false);
  assert.equal((await client.cards.hookClick(ask({ label: 'Approve', options: ['Approve', 'Merge everything'] }))).ok, false);
  assert.equal((await client.cards.hookShown(ask({ options: ['Approve', 'Merge everything'] }))).ok, false, 'no card reads like that');
  assert.deepEqual(answers(), []);
}));

test('a card that changed since it was shown takes no click', inProject(async (client) => {
  const c = card();
  keep(c);
  await client.cards.hookShown(ask());
  // The same question and options under a new id would be another card; the words of the shown one changing is the case here.
  const file = path.join(stateDir(P), eventPath(c));
  fs.writeFileSync(file, `${JSON.stringify({ ...c, data: { ...c.data, because: 'changed' } }, null, 2)}\n`);
  const got = await client.cards.hookClick(ask({ label: 'Approve' }));
  assert.equal(got.ok, false);
  assert.match(got.refused, /words changed/);
}));

test('two waiting cards that read alike cannot be named, so neither is shown or clicked', inProject(async (client) => {
  keep(card());
  keep(card());
  assert.equal((await client.cards.hookShown(ask())).ok, false);
  assert.equal((await client.cards.hookClick(ask({ label: 'Approve' }))).ok, false);
}));

test('a hook click may decide the steps a chat click may not', inProject(async (client) => {
  // Every confirmed step is named by a card's id or kind; the helper treats the card the same whatever its step, so a card
  // that signs (Approve) is taken here where /cards/chat-click refuses it for the steps in CONFIRMED_STEPS.
  assert.ok(CONFIRMED_STEPS.length > 0);
  keep(card());
  await client.cards.hookShown(ask());
  assert.equal((await client.cards.hookClick(ask({ label: 'Approve' }))).ok, true);
  assert.equal((await client.cards.chatClick({ project: P, card: 'lift-stop-1', label: 'Approve', hash: 'a'.repeat(64), proof: 'chat-click' })).ok, false);
}));

test('the proofs are not the caller\'s to name: /state/write refuses hook-click, and the route takes no proof or hash', inProject(async (client) => {
  keep(card());
  const forged = await client.state.write({ project: P, kind: 'card-answer', data: { question: 'x', label: 'Approve', hash: 'a'.repeat(64), proof: 'hook-click' } });
  assert.equal(forged.ok, false);
  await client.cards.hookShown(ask());
  await client.cards.hookClick(ask({ label: 'Approve', proof: 'signed-hook', hash: 'b'.repeat(64) }));
  const [record] = answers();
  assert.equal(record.data.proof, 'hook-click');
  assert.equal(record.data.hash, dataHash(CARD));
}));

test('under STOP a hook click on an ordinary card is refused; the Lift STOP card is shown and taken', inProject(async (client) => {
  keep(card());
  await client.cards.hookShown(ask());
  setStop({ by: 'prompt', now });
  assert.equal((await client.cards.hookClick(ask({ label: 'Approve' }))).ok, false);
  const lift = composeCard(LIFT_STOP_CARD).card;
  const liftAsk = ask({ message: lift.question, options: lift.options });
  const shown = await client.cards.hookShown(liftAsk);
  assert.equal(shown.ok, true, shown.refused);
  assert.equal(shown.card, 'lift-stop');
  const label = lift.options[0];
  const got = await client.cards.hookClick({ ...liftAsk, label });
  assert.equal(got.ok, true, got.refused);
  assert.equal(got.proof, 'hook-click');
  assert.equal((await client.cards.hookClick({ ...liftAsk, label })).ok, false, 'once');
  assert.deepEqual(answers(), [], 'nothing is written under STOP');
}));

test('the first auto-answer of a session is told once, and noted once', inProject(async (client) => {
  keep(card());
  assert.deepEqual(await client.cards.hookAuto({ project: P, session: 's1' }), { ok: true, first: true });
  assert.deepEqual(await client.cards.hookAuto({ project: P, session: 's1' }), { ok: true, first: false });
  assert.deepEqual(await client.cards.hookAuto({ project: P, session: 's2' }), { ok: true, first: true });
  const notes = listEvents(stateDir(P), { report: () => {} }).filter((e) => e.kind === 'note' && e.data?.mark === 'auto-answer');
  assert.equal(notes.length, 2);
}));
