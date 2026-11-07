// tests/scripts/update/panel-click.test.js
// The update's three cards answered from the pane and the panel, and the Update card from the helper's window (update design,
// sections 4, 6.2 and 7.3). A press signs the same action a click in the chat earns, through the same function, and the
// update reads it back as before: the Update card's click only for the plan the helper kept, the release's approval only for
// the move and commit the journal names, the old helper's answer only for the card finish is waiting on. Nothing here lets an
// agent sign: a press with no plan, a spent plan or another card's words records nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { shortHome, testAddress, withHome } from '../../helpers/homes.js';
import { run } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { pressCard } from '../../../scripts/mod/press.js';
import { cardButtons } from '../../../scripts/mod/buttons.js';
import { hashOf } from '../../../scripts/mod/status.js';
import { dataHash, listEvents, makeEvent, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled, verify, sign } from '../../../scripts/state/signing.js';
import { openJournal } from '../../../scripts/update/journal.js';
import { clickWasMade } from '../../../scripts/update/routes.js';
import { helperCardFor, releaseCard, updateCard } from '../../../scripts/update/cards.js';
import { helperCard, helperCardId, signedAnswer, STOP_IT, LEAVE_IT } from '../../../scripts/update/finish.js';
import { setLineOf } from '../../../scripts/state/card-lines.js';
import { releaseApproved } from '../../../scripts/gate/release-approval.js';

const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const P = 'owner__name';
const T0 = new Date('2026-11-04T01:00:00.000Z');
const T1 = new Date('2026-11-04T02:00:00.000Z');
const HASH = 'e'.repeat(64);
const PLAN = { from: 'v0.2.6', to: 'v0.2.7', put: 'release' };
const COMMIT = 'c'.repeat(40);
const ID = helperCardId({ pid: 4242, startTime: '2026-11-04T09:00:00.000Z' });

const withKey = (fn) => withHome(async () => {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-11-03T00:00:00.000Z' });
  return fn();
});

// A card as the state keeps it once the chat has asked it: the asked card's question, header and options.
const stateData = (asked, kind) => ({ kind, level: 4, line: setLineOf(asked.question), question: asked.question, header: asked.header, options: asked.options.map((o) => o.label), descriptions: asked.options.map((o) => o.description) });

function keepEvent(event, project) {
  const file = path.join(stateDir(project), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(event));
}

function putCard(data, project = P) {
  const event = makeEvent({ kind: 'card', data, now: () => T0 });
  keepEvent(event, project);
  return { id: event.id, data, hash: hashOf(data.question) };
}

// The plan the helper kept when it showed the card, and the card as it asked it.
function keepPlan(project, over = {}) {
  const asked = updateCard({ ...PLAN, says: 'A small release.', hash: HASH });
  const journal = openJournal(project);
  fs.mkdirSync(journal.folder, { recursive: true });
  const stored = { hash: HASH, project, folder: '/x', at: T0.toISOString(), plan: PLAN, card: asked, ...over };
  fs.writeFileSync(path.join(journal.folder, 'plan.json'), JSON.stringify(stored));
  return { stored, asked };
}

// A helper that takes what it is sent and keeps it in the state clone, as the helper does.
function fake() {
  const calls = { record: [], write: [] };
  return {
    calls,
    prState: async () => ({ ok: false }),
    goalRecheck: async () => ({ ok: true, refused: [] }),
    state: {
      write: async (b) => { calls.write.push(b); keepEvent(makeEvent({ kind: b.kind, data: b.data, now: () => T1 }), P); return { ok: true }; },
      record: async (b) => { calls.record.push(b); keepEvent(b.event, P); return { ok: true }; },
    },
    profile: { record: async () => ({ ok: true }) },
  };
}

const press = (card, client, label, extra = {}) => pressCard({ project: P, card: card.id, hash: card.hash, label, client, now: () => T1, liftStop: () => {}, proof: 'add-on', ...extra });
const actions = (client) => client.calls.record.map((r) => r.event).filter((e) => e.kind === 'action');
const stateEvents = () => listEvents(stateDir(P), { report: () => {} });

test('the Update card\'s Update, pressed on the panel, signs the click for the plan the helper kept, and only that plan', () => withKey(async () => {
  const { stored, asked } = keepPlan(P);
  const card = putCard(stateData(asked, 'update'));
  const client = fake();
  const out = await press(card, client, 'Update');
  assert.equal(out.made, true, JSON.stringify(out));
  const [click] = actions(client);
  assert.equal(click.data.action, 'update-click');
  assert.deepEqual([click.data.hash, click.data.from, click.data.to, click.data.put, click.data.label, click.data.proof], [HASH, 'v0.2.6', 'v0.2.7', 'release', 'Update', 'add-on']);
  assert.equal(verify(click, readEnrolled()), true, 'signed by this computer\'s own key');
  assert.equal(clickWasMade({ events: stateEvents(), enrolled: readEnrolled(), stored, label: 'Update' }), true);
  // Neither a decline nor a click for another plan or another move is made by it.
  assert.equal(clickWasMade({ events: stateEvents(), enrolled: readEnrolled(), stored, label: 'Not now' }), false);
  assert.equal(clickWasMade({ events: stateEvents(), enrolled: readEnrolled(), stored: { ...stored, hash: 'd'.repeat(64) }, label: 'Update' }), false);
  assert.equal(clickWasMade({ events: stateEvents(), enrolled: readEnrolled(), stored: { ...stored, plan: { ...PLAN, to: 'v0.2.8' } }, label: 'Update' }), false);
  // A plan shown again after the click is not clicked for.
  assert.equal(clickWasMade({ events: stateEvents(), enrolled: readEnrolled(), stored: { ...stored, at: T1.toISOString() }, label: 'Update' }), false);
}));

test('the Update card\'s Not now, pressed on the panel, is signed too, so the decline is the director\'s', () => withKey(async () => {
  const { stored, asked } = keepPlan(P);
  const card = putCard(stateData(asked, 'update'));
  const client = fake();
  const out = await press(card, client, 'Not now');
  assert.equal(out.made, true, JSON.stringify(out));
  assert.equal(actions(client).length, 1);
  assert.equal(clickWasMade({ events: stateEvents(), enrolled: readEnrolled(), stored, label: 'Not now' }), true);
  assert.equal(clickWasMade({ events: stateEvents(), enrolled: readEnrolled(), stored, label: 'Update' }), false);
}));

test('a press on the Update card signs nothing without the plan the helper kept, for a spent plan, or for words that are not its card', () => withKey(async () => {
  const asked = updateCard({ ...PLAN, says: 'A small release.', hash: HASH });
  const card = putCard(stateData(asked, 'update'));
  // No plan was shown.
  let client = fake();
  assert.equal((await press(card, client, 'Update')).made, false);
  assert.deepEqual(client.calls.record, []);
  // A plan already started.
  keepPlan(P, { used: true });
  client = fake();
  assert.equal((await press(card, client, 'Update')).made, false);
  assert.deepEqual(client.calls.record, []);
  // A plan whose card is another's words.
  keepPlan(P, { card: updateCard({ ...PLAN, says: 'Other words.', hash: HASH }) });
  client = fake();
  assert.equal((await press(card, client, 'Update')).made, false);
  assert.deepEqual(client.calls.record, []);
}));

test('the release\'s Approve, pressed on the panel, signs the approval the gate counts for that move and commit, and only when it is newer than the opening of the change', () => withKey(async () => {
  const given = { previous: 'v0.2.6', release: 'v0.2.7', commit: COMMIT };
  openJournal(P).mark('change', 'done', { card: given });
  const { card: data } = releaseCard(given);
  const card = putCard(data);
  const client = fake();
  const out = await press(card, client, 'Approve');
  assert.equal(out.made, true, JSON.stringify(out));
  const [approval] = actions(client);
  assert.deepEqual([approval.data.action, approval.data.previous, approval.data.release, approval.data.commit, approval.data.label], ['approve-release', 'v0.2.6', 'v0.2.7', COMMIT, 'Approve']);
  // The gate counts it only when it is newer than the update's record of opening the change.
  const branch = `wheelhouse-release-${COMMIT}`;
  const opening = (at) => sign(makeEvent({ kind: 'provenance', data: { branch, provenance: { update: { release: 'v0.2.7', commit: COMMIT } } }, now: () => at }));
  const gate = (events) => releaseApproved({ events, ...given, branch, enrolled: readEnrolled() });
  assert.equal(gate([approval]), false, 'no opening record: nothing to be newer than');
  assert.equal(gate([approval, opening(T0)]), true, 'newer than the opening of the change');
  assert.equal(gate([approval, opening(new Date(T1.getTime() + 1000))]), false, 'an approval from before the change was opened counts for nothing');
}));

test('the release\'s Not now, pressed on the panel, signs nothing and leaves the update waiting for its approval', () => withKey(async () => {
  const given = { previous: 'v0.2.6', release: 'v0.2.7', commit: COMMIT };
  openJournal(P).mark('change', 'done', { card: given });
  const card = putCard(releaseCard(given).card);
  const client = fake();
  const declined = await press(card, client, 'Not now');
  assert.equal(declined.made, true, JSON.stringify(declined));
  assert.deepEqual(client.calls.record, []);
}));

test('a release approval signs nothing when the journal names another move', () => withKey(async () => {
  openJournal(P).mark('change', 'done', { card: { previous: 'v0.2.6', release: 'v0.2.7', commit: 'd'.repeat(40) } });
  const card = putCard(releaseCard({ previous: 'v0.2.6', release: 'v0.2.7', commit: COMMIT }).card);
  const client = fake();
  assert.equal((await press(card, client, 'Approve')).made, false);
  assert.deepEqual(client.calls.record, []);
}));

test('the old helper\'s card: each option pressed on the panel signs the answer finish reads, by the card finish is waiting on', () => withKey(async () => {
  const given = helperCard({ kind: 'unknown', version: '0.2.4', canStop: true, id: ID });
  const journal = openJournal(P);
  fs.mkdirSync(journal.folder, { recursive: true });
  fs.writeFileSync(path.join(journal.folder, 'finish.json'), JSON.stringify({ handover: { waiting: { card: given } } }));
  const card = putCard(helperCardFor(given).card);
  const client = fake();
  const out = await press(card, client, STOP_IT);
  assert.equal(out.made, true, JSON.stringify(out));
  const [answer] = actions(client);
  assert.deepEqual([answer.data.action, answer.data.card, answer.data.label], ['update-helper-answer', ID, STOP_IT]);
  assert.equal(signedAnswer({ events: stateEvents(), enrolled: readEnrolled(), card: ID, options: [STOP_IT, LEAVE_IT] }), STOP_IT);
}));

test('the three cards each have buttons that record, so the panel draws them', () => {
  assert.equal(cardButtons(helperCardFor(helperCard({ kind: 'unknown', version: '0.2.4', canStop: true, id: ID })).card).buttons.filter((b) => b.does === 'record').length, 2);
  assert.equal(cardButtons(releaseCard({ previous: 'v0.2.6', release: 'v0.2.7', commit: COMMIT }).card).buttons.some((b) => b.label === 'Approve' && b.does === 'record'), true);
});

// --- the helper's own window, for an agent whose hooks only read ---

async function computer(choose) {
  const home = shortHome();
  const folder = path.join(shortHome(), 'shop');
  fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  writeProject('shop', { folder, remoteUrl: null, host: 'local', repo: 'local/shop', connection: { mode: 'none' } });
  const own = makeSigningKey();
  enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: T0.toISOString() });
  let tick = 0;
  const helper = await startHelper({
    run: hostGuard,
    askWindow: async (card) => ({ choice: choose(card) }),
    address: testAddress(home),
    envFor: async () => ({}),
    adapterFor: async () => ({}),
    now: () => new Date(T1.getTime() + 1000 * (tick += 1)),
  });
  return {
    client: helperClient({ address: helper.address }),
    events: () => listEvents(stateDir('shop'), { report: () => {} }),
    close: async () => {
      await helper.close();
      if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    },
  };
}

async function windowOn(pick) {
  const shown = [];
  const c = await computer((card) => { shown.push(card); return pick; });
  const { stored, asked } = keepPlan('shop');
  const data = stateData(asked, 'update');
  const made = await c.client.state.write({ project: 'shop', kind: 'card', data });
  assert.equal(made.ok, true, JSON.stringify(made));
  return { c, shown, at: { ...stored, at: T0.toISOString() }, confirm: () => c.client.confirm({ project: 'shop', card: made.id, hash: dataHash(data) }) };
}

test('the helper\'s window signs the Update card\'s click for the plan the helper kept, and update\'s apply reads it back', async () => {
  const w = await windowOn('Update');
  try {
    const got = await w.confirm();
    assert.deepEqual([got.ok, got.recorded, got.kind, got.step, got.choice], [true, true, 'action', 'update', 'Update']);
    assert.deepEqual(w.shown[0].options, ['Update']);
    assert.equal(w.shown[0].noDefault, true, 'Return chooses nothing on the Update card');
    const click = w.c.events().find((e) => e.kind === 'action');
    assert.deepEqual([click.data.action, click.data.hash, click.data.proof], ['update-click', HASH, 'window']);
    assert.equal(clickWasMade({ events: w.c.events(), enrolled: readEnrolled(), stored: w.at, label: 'Update' }), true);
  } finally {
    await w.c.close();
  }
});

test('Not now in the helper\'s window is a signed decline for the same plan, earned the way the panel\'s is', async () => {
  const w = await windowOn('Not now');
  try {
    const got = await w.confirm();
    assert.deepEqual([got.ok, got.recorded, got.choice], [true, true, 'Not now']);
    assert.equal(w.shown[0].noDefault, true);
    const decline = w.c.events().find((e) => e.kind === 'action');
    assert.deepEqual([decline.data.action, decline.data.hash, decline.data.from, decline.data.to, decline.data.put, decline.data.label, decline.data.proof], ['update-click', HASH, 'v0.2.6', 'v0.2.7', 'release', 'Not now', 'window']);
    assert.equal(verify(decline, readEnrolled()), true);
    assert.equal(clickWasMade({ events: w.c.events(), enrolled: readEnrolled(), stored: w.at, label: 'Not now' }), true);
    assert.equal(clickWasMade({ events: w.c.events(), enrolled: readEnrolled(), stored: w.at, label: 'Update' }), false);
  } finally {
    await w.c.close();
  }
});

test('a window closed without a click records nothing on the Update card', async () => {
  const w = await windowOn(null);
  try {
    const got = await w.confirm();
    assert.equal(got.recorded, false);
    assert.equal(w.c.events().filter((e) => e.kind === 'action').length, 0);
  } finally {
    await w.c.close();
  }
});

test('the helper\'s window confirms nothing for an Update card with no plan kept', async () => {
  const c = await computer(() => assert.fail('no window opens'));
  try {
    const asked = updateCard({ ...PLAN, says: 'A small release.', hash: HASH });
    const data = stateData(asked, 'update');
    const made = await c.client.state.write({ project: 'shop', kind: 'card', data });
    const got = await c.client.confirm({ project: 'shop', card: made.id, hash: dataHash(data) });
    assert.equal(got.ok, false);
    assert.match(got.refused, /not one the window confirms/);
    assert.equal(c.events().filter((e) => e.kind === 'action').length, 0);
  } finally {
    await c.close();
  }
});
