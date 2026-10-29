// tests/scripts/host/helper-ruling-confirm.test.js
// A ruling confirmed by a click in the chat (ruling P5-52): at Lean, /cards/chat-click takes Confirm on a ruling's
// confirm card, named `ruling-<card id>`, unsigned, with proof chat-click, and the rulebook counts it, saying the
// proof. On a Claude Code project the same click is refused: there a ruling's confirmation stays signed.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { guardedRun, standInTools } from '../../helpers/host-stand-ins.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { run } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { eventPath, listEvents, makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { chatCopy, confirmLine } from '../../../scripts/state/card-lines.js';
import { registerLean } from '../../../scripts/lean/project.js';
import { leanCommand } from '../../../scripts/lean/cli.js';
import { record, view } from '../../../scripts/frontdesk/cli.js';

const shims = standInTools();
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
afterEach(() => {
  assert.deepEqual(hostLog, [], 'no host tool ran through the helper');
  assert.deepEqual(shims.calls(), [], 'no host tool ran from the PATH');
});
after(() => shims.restore());

waitLongerOnTheHelper();

const T0 = new Date('2026-10-23T01:00:00.000Z');
const WORDS = 'Every export is a CSV file, never Excel.';
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

// A Lean project on a computer of its own, with its helper running in this process.
async function leanComputer() {
  const home = shortHome();
  const folder = path.join(shortHome(), 'shop');
  fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  registerLean({ project: 'shop', folder, now: () => T0 });
  const own = makeSigningKey();
  enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: T0.toISOString() });
  let tick = 0;
  const now = () => new Date(T0.getTime() + 1000 * (tick += 1));
  const helper = await startHelper({
    run: hostGuard,
    address: testAddress(home),
    envFor: async () => { throw new Error('no connection on this computer'); },
    adapterFor: async () => { throw new Error('no adapter on this computer'); },
    now,
  });
  const client = helperClient({ address: helper.address });
  const real = fs.realpathSync.native(folder);
  return {
    folder: real,
    client,
    now,
    lean: (argv, input) => leanCommand(argv, { cwd: real, client, stdin: Readable.from([JSON.stringify(input)]) }),
    events: () => listEvents(stateDir('shop'), { report: () => {} }),
    close: async () => {
      await helper.close();
      if (before === undefined) delete process.env.WHEELHOUSE_HOME;
      else process.env.WHEELHOUSE_HOME = before;
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

test('at Lean a ruling\'s Confirm is a chat click the rulebook counts, naming the card by its id and its text by its hash', async () => {
  const c = await leanComputer();
  try {
    // The front desk's own record ruling writes the ruling and its confirm card through the helper.
    const made = await record({ client: c.client, cwd: c.folder, kind: 'ruling', input: { words: WORDS }, now: c.now });
    const card = c.events().find((e) => e.id === made.card.id);
    // The card record ruling prints is the question to ask; its text is the card's as the state holds it.
    const shown = made.card.question.question;
    assert.equal(card.data.question, shown, 'the text printed is the card as the state holds it');
    assert.equal(card.data.line, confirmLine(c.events().find((e) => e.id === made.id)));
    assert.match(await view({ client: c.client, cwd: c.folder, name: 'rulebook', now: c.now }).then((l) => l.join('\n')), /waiting for the director to confirm it/);

    // Refused, and nothing written: the card's text as it isn't, a card that isn't a ruling's confirm card, a card
    // the state doesn't hold, and Confirm under another name.
    const count = c.events().length;
    const other = (await c.client.state.write({ cwd: c.folder, kind: 'card', data: { ...card.data, kind: 'approval', line: 'something else' } })).id;
    const refusals = [
      [['click', `ruling-${card.id}`, 'Confirm'], { question: `${shown} (changed)` }, /the card's text as the state holds it/],
      [['click', `ruling-${other}`, 'Confirm'], { question: shown }, /not a ruling's confirm card/],
      [['click', `ruling-${crypto.randomUUID()}`, 'Confirm'], { question: shown }, /not a ruling's confirm card/],
      [['click', 'release-notes', 'Confirm'], { question: shown }, /can't decide that card/],
      [['click', card.id, 'Confirm'], { question: shown }, /can't decide that card/],
    ];
    for (const [argv, input, why] of refusals) {
      const got = await c.lean(argv, input);
      assert.equal(got.ok, false, argv.join(' '));
      assert.match(got.refused, why, argv.join(' '));
    }
    assert.equal(c.events().length, count + 1, 'only the other card was written');
    // /state/write can't make the click either.
    const forged = await c.client.state.write({ cwd: c.folder, kind: 'card-answer', data: { card: card.id, label: 'Confirm', hash: sha(card.data.question), proof: 'chat-click', tier: 'lean' } });
    assert.equal(forged.ok, false);

    // The click: unsigned, its proof chat-click, naming the card by id and its text by hash.
    const got = await c.lean(['click', `ruling-${card.id}`, 'Confirm'], { question: shown });
    assert.equal(got.ok, true, got.refused);
    const answer = c.events().find((e) => e.id === got.id);
    assert.deepEqual(answer.data, { card: card.id, label: 'Confirm', hash: sha(shown), proof: 'chat-click', tier: 'lean' });
    assert.equal(answer.sig, undefined, 'never signed');
    // The rulebook counts it and says the proof; the card no longer waits.
    const { views } = await c.client.state.views({ cwd: c.folder });
    assert.deepEqual(views.rulebook.map((r) => [r.words, r.status, r.proof]), [[WORDS, 'accepted', 'chat-click']]);
    assert.ok(!views.waiting.some((w) => w.id === card.id));
    assert.deepEqual(views.unconfirmed, []);
    const lines = (await view({ client: c.client, cwd: c.folder, name: 'rulebook', now: c.now })).join('\n');
    assert.match(lines, /in force, by a click in the chat, not proven/);
  } finally {
    await c.close();
  }
});

test('on a Claude Code project an unsigned Confirm in the chat is refused, and the ruling stays waiting', async () => {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  try {
    await as(home, async () => {
      writeProject('o__p', { folder: os.tmpdir(), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: T0.toISOString() });
      await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const ruling = makeEvent({ kind: 'ruling', data: { words: WORDS }, now: () => T0 });
      const question = `A rule you gave, in your words: "${WORDS}"`;
      const card = makeEvent({ kind: 'card', data: { question, header: 'Confirm', options: ['Confirm', 'Not now'], kind: 'confirm', level: 3, line: confirmLine(ruling) }, now: () => new Date(T0.getTime() + 1000) });
      for (const e of [ruling, card]) {
        const file = path.join(stateDir('o__p'), eventPath(e));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(e, null, 2)}\n`);
      }
      const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => ({ defaultBranch: async () => 'main' }), envFor: async () => ({}) });
      try {
        const client = helperClient({ address: helper.address });
        const got = await client.cards.chatClick({ project: 'o__p', card: `ruling-${card.id}`, label: 'Confirm', hash: sha(question), proof: 'chat-click' });
        assert.equal(got.ok, false);
        assert.match(got.refused, /can't decide that card/);
        assert.equal(listEvents(stateDir('o__p'), { report: () => {} }).filter((e) => e.kind === 'card-answer').length, 0);
        const { views } = await client.state.views({ project: 'o__p' });
        assert.deepEqual(views.rulebook.map((r) => r.status), ['proposed']);
      } finally {
        await helper.close();
      }
    });
  } finally {
    remote.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('at Lean a ruling\'s card takes one chat click: Not now or Suggest a change… closes it, nothing after counts, and only chat-click is taken', async () => {
  const c = await leanComputer();
  try {
    const ask = async (words) => {
      const made = await record({ client: c.client, cwd: c.folder, kind: 'ruling', input: { words, card: 'exports' }, now: c.now });
      return { id: made.card.id, shown: made.card.question.question };
    };
    const waiting = async () => (await c.client.state.views({ cwd: c.folder })).views.waiting.map((w) => w.id);

    // A proof other than chat-click is refused on a ruling's card, and nothing is written.
    const first = await ask('Exports are CSV.');
    const count = c.events().length;
    const hookClick = await c.client.cards.chatClick({ cwd: c.folder, card: `ruling-${first.id}`, label: 'Confirm', hash: sha(first.shown), proof: 'hook-click' });
    assert.equal(hookClick.ok, false);
    assert.match(hookClick.refused, /chat-click/);
    assert.equal(c.events().length, count);

    // Not now closes the card by its id and hash; a Confirm after it is refused.
    const notNow = await c.lean(['click', `ruling-${first.id}`, 'Not now'], { question: first.shown });
    assert.equal(notNow.ok, true, notNow.refused);
    assert.deepEqual(c.events().find((e) => e.id === notNow.id).data, { card: first.id, label: 'Not now', hash: sha(first.shown), proof: 'chat-click', tier: 'lean' });
    assert.ok(!(await waiting()).includes(first.id));
    const late = await c.lean(['click', `ruling-${first.id}`, 'Confirm'], { question: first.shown });
    assert.equal(late.ok, false);
    assert.match(late.refused, /answered already/);

    // Suggest a change… carries the new words and closes the card too.
    const second = await ask('Exports are CSV, always.');
    const changed = await c.lean(['click', `ruling-${second.id}`, 'Suggest a change…'], { question: second.shown, text: 'Exports are CSV or Excel.' });
    assert.equal(changed.ok, true, changed.refused);
    assert.equal(c.events().find((e) => e.id === changed.id).data.text, 'Exports are CSV or Excel.');
    assert.ok(!(await waiting()).includes(second.id));
    // A label the card doesn't have is refused.
    const third = await ask('Exports are CSV or Excel.');
    assert.match((await c.lean(['click', `ruling-${third.id}`, 'Approve'], { question: third.shown })).refused, /isn't one of the card's options/);

    // Confirmed, the newest words under the short name stand, and the earlier confirmed ones are replaced.
    assert.equal((await c.lean(['click', `ruling-${third.id}`, 'Confirm'], { question: third.shown })).ok, true);
    const fourth = await ask('Exports are Excel.');
    assert.equal((await c.lean(['click', `ruling-${fourth.id}`, 'Confirm'], { question: fourth.shown })).ok, true);
    const { views } = await c.client.state.views({ cwd: c.folder });
    // Every earlier ruling under the short name is replaced, confirmed or not, so none waits as unconfirmed.
    assert.deepEqual(views.rulebook.map((r) => [r.words, r.status]), [
      ['Exports are CSV.', 'superseded'], ['Exports are CSV, always.', 'superseded'], ['Exports are CSV or Excel.', 'superseded'], ['Exports are Excel.', 'accepted'],
    ]);
    assert.deepEqual(views.unconfirmed, []);
    const lines = (await view({ client: c.client, cwd: c.folder, name: 'rulebook', now: c.now })).join('\n');
    assert.match(lines, /Exports are Excel\. \(in force, by a click in the chat, not proven\)/);
    assert.doesNotMatch(lines, /Exports are CSV or Excel\. \(in force/);
  } finally {
    await c.close();
  }
});

test('at Lean a ruling\'s Confirm may name the card\'s text as the chat showed it, without its set line and reply code', async () => {
  const c = await leanComputer();
  try {
    const made = await record({ client: c.client, cwd: c.folder, kind: 'ruling', input: { words: WORDS }, now: c.now });
    const card = c.events().find((e) => e.id === made.card.id);
    const copy = chatCopy(card.data.question);
    assert.notEqual(copy, card.data.question, 'the chat copy leaves the card\'s last lines out');
    const got = await c.lean(['click', `ruling-${card.id}`, 'Confirm'], { question: copy });
    assert.equal(got.ok, true, got.refused);
    assert.equal(c.events().find((e) => e.id === got.id).data.hash, sha(copy));
    const { views } = await c.client.state.views({ cwd: c.folder });
    assert.deepEqual(views.rulebook.map((r) => [r.words, r.status]), [[WORDS, 'accepted']]);
    assert.ok(!views.waiting.some((w) => w.id === card.id));
  } finally {
    await c.close();
  }
});
