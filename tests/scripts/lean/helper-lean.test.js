// tests/scripts/lean/helper-lean.test.js
// The helper's Lean routes and the Lean command (Part 5 Task 5, rulings P5-18, P5-24 and P5-27): the chat reaches
// the store only through scripts/lean/cli.js; a click is recorded as a chat click; a merge needs an approval of
// exactly its commit; on a project with real users the helper raises the approval card and its window signs it;
// a main version moved outside the helper raises one card, said at the session's start, which Keep it in the
// window decides; and Suggest a change… carries the director's words. A real helper runs on a temporary home.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { guardedRun, standInTools } from '../../helpers/host-stand-ins.js';
import { shortHome, testAddress } from '../../helpers/homes.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';
import { run, withoutGitVars } from '../../../scripts/lib/run.js';
import { NULL_FILE } from '../../../scripts/lib/safe-git.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { dataHash, listEvents } from '../../../scripts/state/events.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { controlFileInput } from '../../../scripts/cards/build-loop.js';
import { makeSigningKey, enrol, readEnrolled, verify } from '../../../scripts/state/signing.js';
import { decide as sessionStart } from '../../../scripts/hooks/session-start.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { registerLean, readLean, updateLean } from '../../../scripts/lean/project.js';
import { storeDir, adoptProject, leanApprovalLine, mainMovedLine, MAIN_MOVED } from '../../../scripts/lean/store.js';
import { leanCommand, main as leanMain } from '../../../scripts/lean/cli.js';

// No real gh, glab, copilot or curl runs (P5-44).
const shims = standInTools();
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
afterEach(() => {
  assert.deepEqual(hostLog, [], 'no host tool ran through the helper');
  assert.deepEqual(shims.calls(), [], 'no host tool ran from the PATH');
});
after(() => shims.restore());

waitLongerOnTheHelper();

const PROJECT = 'shop';
const T0 = Date.parse('2026-10-23T01:00:00.000Z');
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: NULL_FILE, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: NULL_FILE,
  GIT_AUTHOR_NAME: 'Ann', GIT_AUTHOR_EMAIL: 'ann@example.com', GIT_COMMITTER_NAME: 'Ann', GIT_COMMITTER_EMAIL: 'ann@example.com',
};
async function git(cwd, args) {
  const got = await run('git', args, { cwd, baseEnv: withoutGitVars(), env: GIT_ENV });
  if (got.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${got.stderr}`);
  return got.stdout.trim();
}

// A computer with a Lean project adopted into its store, a copy folder, an enrolled key, and a helper whose window
// is a stand-in that answers with `choose(card)`.
async function computer({ realUsers = false, choose = () => null } = {}) {
  const home = shortHome();
  const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(shortHome(), 'shop-')));
  const copy = path.join(fs.realpathSync.native(shortHome()), 'copy.git');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  await git(folder, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(folder, 'README.md'), 'shop\n');
  await git(folder, ['add', '-A']);
  await git(folder, ['commit', '-q', '-m', 'Start']);
  fs.mkdirSync(copy);
  await git(copy, ['init', '-q', '--bare']);
  await git(folder, ['remote', 'add', 'wheelhouse-copy', copy]);
  registerLean({ project: PROJECT, folder, now: () => new Date(T0) });
  updateLean(PROJECT, { realUsers });
  const own = makeSigningKey();
  enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: new Date(T0).toISOString() });
  let tick = 0;
  const now = () => new Date(T0 + 1000 * (tick += 1));
  await adoptProject({ project: PROJECT, folder, run: hostGuard, now });
  const windows = [];
  const helper = await startHelper({
    run: hostGuard,
    address: testAddress(home),
    envFor: async () => { throw new Error('no connection on this computer'); },
    adapterFor: async () => { throw new Error('no adapter on this computer'); },
    askWindow: async (card) => {
      windows.push(card);
      return { choice: choose(card) };
    },
    now,
  });
  const client = helperClient({ address: helper.address });
  // The Lean command, run in the project's folder, with standard input when it takes some.
  const lean = (argv, input) => leanCommand(argv, { cwd: folder, client, stdin: Readable.from([input === undefined ? '' : JSON.stringify(input)]) });
  const feature = async (slug, files) => {
    await git(folder, ['switch', '-q', '-c', `feature/${slug}`]);
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), text);
    await git(folder, ['add', '-A']);
    await git(folder, ['commit', '-q', '-m', `Build ${slug}`]);
    const head = await git(folder, ['rev-parse', 'HEAD']);
    await git(folder, ['switch', '-q', '--detach', 'main']);
    return head;
  };
  return {
    home, folder, copy, client, windows, lean, feature,
    events: () => listEvents(stateDir(PROJECT), { report: () => {} }),
    main: () => git(storeDir(PROJECT), ['rev-parse', 'refs/heads/main']),
    close: async () => {
      liftStop();
      await helper.close();
      if (before === undefined) delete process.env.WHEELHOUSE_HOME;
      else process.env.WHEELHOUSE_HOME = before;
    },
  };
}

test('the chat merges, undoes and copies only through the Lean command, on clicks it records as chat clicks', async () => {
  const c = await computer({ choose: (card) => (card.options.includes('Undo') ? 'Undo' : null) });
  try {
    const status = await c.lean(['status']);
    assert.equal(status.ok, true, status.refused);
    assert.deepEqual([status.adopted, status.moved, status.main], [true, false, await c.main()]);
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    // No click yet: refused, and nothing moved.
    const early = await c.lean(['merge', 'login', head]);
    assert.equal(early.ok, false);
    assert.match(early.refused, /no approval of/);
    const question = `Add login to the main version?\n${leanApprovalLine('feature/login', head)}`;
    const click = await c.lean(['click', 'merge-login', 'Approve', head], { question });
    assert.equal(click.ok, true, click.refused);
    const answer = c.events().find((e) => e.id === click.id);
    assert.equal(answer.data.proof, 'chat-click');
    assert.equal(answer.data.commit, head);
    assert.equal(answer.sig, undefined);
    const merged = await c.lean(['merge', 'login', head]);
    assert.equal(merged.ok, true, merged.refused);
    assert.equal(await c.main(), merged.merge);
    assert.equal(merged.copy.pushed, true);
    assert.equal(await git(c.copy, ['rev-parse', 'refs/heads/main']), merged.merge);
    // Undo, on its click in the helper's window (ruling P5-50): a click in the chat undoes nothing.
    assert.equal((await c.lean(['click', 'undo-login', 'Undo', merged.merge], { question: 'Undo login?' })).ok, true);
    const asked = await c.lean(['undo', merged.merge]);
    assert.deepEqual([asked.ok, asked.needs], [false, 'window']);
    const undone = await c.lean(['confirm', asked.card]);
    assert.equal(undone.ok, true, undone.refused);
    assert.deepEqual([undone.kind, undone.step, undone.undone?.ok], ['action', 'runbook-step', true]);
    assert.equal(await c.main(), undone.undone.undo);
    assert.equal((await c.lean(['copy'])).pushed, true);
    // The command's own refusals, and the process's exit code and lines.
    await assert.rejects(c.lean(['merge', 'login', head.slice(0, 12)]), /in full/);
    await assert.rejects(c.lean(['click', 'merge-login', 'Approve'], 'only words'), /the card's text as shown/);
    await assert.rejects(leanCommand(['click', 'merge-login', 'Approve'], { cwd: c.folder, client: c.client, stdin: Readable.from(['not json']) }), /JSON on standard input/);
    await assert.rejects(c.lean(['nonsense']), /Usage/);
    const out = [];
    const err = [];
    const code = await leanMain(['undo', merged.merge], { cwd: c.folder, client: c.client, stdout: { write: (t) => out.push(t) }, stderr: { write: (t) => err.push(t) } });
    assert.equal(code, 1);
    assert.equal(JSON.parse(out.join('')).ok, false);
    assert.ok(err.join('').length > 0);
    // A project that isn't Lean is refused the Lean routes.
    assert.deepEqual(await c.client.lean.status({ project: 'other' }), { ok: false, refused: 'that project is not a Lean project' });
  } finally {
    await c.close();
  }
});

test('Suggest a change… carries the director\'s words, and no other click does', async () => {
  const c = await computer();
  try {
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    const got = await c.lean(['click', 'merge-login', 'Suggest a change…', head], { question: 'Add login?', text: 'Make the button blue' });
    assert.equal(got.ok, true, got.refused);
    const answer = c.events().find((e) => e.id === got.id);
    assert.deepEqual([answer.data.label, answer.data.text, answer.data.proof], ['Suggest a change…', 'Make the button blue', 'chat-click']);
    assert.match((await c.lean(['click', 'merge-login', 'Approve', head], { question: 'Add login?', text: 'sneak' })).refused, /only a click on Suggest a change…/);
    // Through /state/write, the words are refused as a click's proof and commit are.
    const forged = await c.client.state.write({ project: PROJECT, kind: 'card-answer', data: { question: 'merge-login', label: 'Suggest a change…', text: 'x' } });
    assert.equal(forged.ok, false);
    assert.match(forged.refused, /only by the helper's own routes/);
    // Suggest a change… approves nothing.
    assert.match((await c.lean(['merge', 'login', head])).refused, /no approval of/);
  } finally {
    await c.close();
  }
});

test('with real users the helper raises the approval card, and the window\'s click signs the approval that merges', async () => {
  const c = await computer({ realUsers: true, choose: (card) => (card.options.includes('Approve') ? 'Approve' : null) });
  try {
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    assert.equal((await c.lean(['click', 'merge-login', 'Approve', head], { question: 'Add login?' })).ok, true);
    const refused = await c.lean(['merge', 'login', head]);
    assert.equal(refused.ok, false);
    assert.equal(refused.needs, 'window');
    assert.match(refused.refused, /Wheelhouse's window/);
    // The same refusal names the same card.
    assert.equal((await c.lean(['merge', 'login', head])).card, refused.card);
    const confirmed = await c.lean(['confirm', refused.card]);
    assert.equal(confirmed.ok, true, confirmed.refused);
    assert.deepEqual([confirmed.recorded, confirmed.kind, confirmed.step], [true, 'approval', 'approval']);
    // The window showed the card's own words, with its one deciding option.
    assert.deepEqual(c.windows.at(-1).options, ['Approve']);
    assert.ok(c.windows.at(-1).lines.includes(leanApprovalLine('feature/login', head)));
    const approval = c.events().find((e) => e.kind === 'approval');
    assert.deepEqual([approval.data.branch, approval.data.commit, approval.data.proof], ['feature/login', head, 'window']);
    assert.ok(verify(approval, readEnrolled()));
    const merged = await c.lean(['merge', 'login', head]);
    assert.equal(merged.ok, true, merged.refused);
    assert.equal(c.events().find((e) => e.kind === 'merge').data.proof, 'window');
    // A card whose branch has moved on is not signed: the window offers nothing.
    const next = await c.feature('cart', { 'cart.txt': 'cart\n' });
    const ask = await c.lean(['merge', 'cart', next]);
    await git(c.folder, ['switch', '-q', 'feature/cart']);
    fs.writeFileSync(path.join(c.folder, 'cart.txt'), 'cart, changed\n');
    await git(c.folder, ['commit', '-q', '-am', 'More']);
    await git(c.folder, ['switch', '-q', '--detach', 'main']);
    const stale = await c.lean(['confirm', ask.card]);
    assert.equal(stale.ok, false);
    assert.match(stale.refused, /not one the window confirms/);
  } finally {
    await c.close();
  }
});

test('a main version moved outside the helper is said at the session\'s start, and Keep it in the window keeps it', async () => {
  const c = await computer({ choose: (card) => (card.options.includes('Keep it') ? 'Keep it' : null) });
  try {
    const recorded = await c.main();
    const sneak = await c.feature('sneak', { 'sneak.txt': 'sneak\n' });
    await git(storeDir(PROJECT), ['update-ref', 'refs/heads/main', sneak]);
    const start = await sessionStart({ cwd: c.folder, session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' }, {
      writeVia: 'helper', client: c.client, helperUp: true, agent: 'copilot', dir: path.join(c.home, 'none'),
    });
    assert.ok(JSON.stringify(start).includes(MAIN_MOVED.replace(/"/g, '\\"')), JSON.stringify(start));
    const status = await c.lean(['status']);
    assert.deepEqual([status.moved, status.recorded, status.main], [true, recorded, sneak]);
    const card = c.events().find((e) => e.id === status.card);
    assert.deepEqual(card.data.options, ['Undo it', 'Keep it', 'Not now']);
    // A merge waits for the director's choice.
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    assert.equal((await c.lean(['click', 'merge-login', 'Approve', head], { question: 'Add login?' })).ok, true);
    assert.equal((await c.lean(['merge', 'login', head])).card, status.card);
    // Keep it is confirmed in the window only: a chat click on it decides nothing.
    const confirmed = await c.lean(['confirm', status.card]);
    assert.equal(confirmed.ok, true, confirmed.refused);
    assert.deepEqual([confirmed.kind, confirmed.step, confirmed.kept], ['action', 'keep-main', true]);
    const kept = c.events().find((e) => e.kind === 'action' && e.data.action === 'keep-main');
    assert.deepEqual([kept.data.from, kept.data.to, kept.data.proof], [recorded, sneak, 'window']);
    assert.equal(readLean(PROJECT).main, sneak);
    assert.equal((await c.lean(['status'])).moved, false);
    assert.equal((await c.lean(['merge', 'login', head])).ok, true);
  } finally {
    await c.close();
  }
});

test('the Keep card of a feature\'s files that steer agents is confirmed in the window, as a guardrail change (ruling P7-31)', async () => {
  const c = await computer({ choose: (card) => (card.options.includes('Confirm') ? 'Confirm' : null) });
  try {
    const hash = 'd'.repeat(64);
    const data = { work: 'login', why: 'changed', paths: ['AGENTS.md'], hash, at: new Date(T0).toISOString() };
    const raised = await c.client.state.write({ project: PROJECT, kind: 'control-file', data });
    assert.equal(raised.ok, true, raised.refused);
    const record = c.events().find((e) => e.kind === 'control-file');
    const { card } = composeCard(controlFileInput(record, 'login'));
    const made = await c.client.state.write({ project: PROJECT, kind: 'card', data: card });
    assert.equal(made.ok, true, made.refused);
    const held = c.events().find((e) => e.kind === 'card' && e.data.event === record.id);
    const confirmed = await c.client.confirm({ project: PROJECT, card: held.id, hash: dataHash(held.data) });
    assert.equal(confirmed.ok, true, confirmed.refused);
    assert.deepEqual([confirmed.recorded, confirmed.kind, confirmed.step], [true, 'action', 'guardrail-change']);
    assert.deepEqual(c.windows.at(-1).options, ['Confirm']);
    const kept = c.events().find((e) => e.kind === 'action' && e.data.action === 'keep-control-files');
    assert.deepEqual([kept.data.work, kept.data.hash, kept.data.proof], ['login', hash, 'window']);
    assert.ok(verify(kept, readEnrolled()));
    // A chat click on it decides nothing: Confirm is never a chat click's to give.
    const chat = await c.client.cards.chatClick({ project: PROJECT, card: held.id, hash: 'e'.repeat(64), label: 'Confirm', proof: 'chat-click' }).catch((error) => ({ ok: false, refused: error.message }));
    assert.equal(chat.ok, false);
  } finally {
    await c.close();
  }
});

// --- The Task 5 fix round (ruling P5-50) ---

test('undo is confirmed in the helper\'s window and works under STOP, where only the undo is offered', async () => {
  const c = await computer({ choose: (card) => card.options.find((o) => o === 'Undo' || o === 'Undo it') ?? null });
  try {
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    assert.equal((await c.lean(['click', 'merge-login', 'Approve', head], { question: 'Add login?' })).ok, true);
    const merged = await c.lean(['merge', 'login', head]);
    assert.equal(merged.ok, true, merged.refused);
    setStop({ by: 'prompt', now: () => new Date(T0) });
    const asked = await c.lean(['undo', merged.merge]);
    assert.deepEqual([asked.ok, asked.needs], [false, 'window']);
    const undone = await c.lean(['confirm', asked.card]);
    assert.equal(undone.ok, true, undone.refused);
    assert.deepEqual(c.windows.at(-1).options, ['Undo']);
    assert.equal(await c.main(), undone.undone.undo);
    const click = c.events().find((e) => e.kind === 'action' && e.data.action === 'undo-merge');
    assert.deepEqual([click.data.merge, click.data.proof], [merged.merge, 'window']);
    assert.ok(verify(click, readEnrolled()));
    // The card about a main version moved outside the helper offers only Undo it while STOP is on.
    await git(c.folder, ['switch', '-q', '--detach', 'main']);
    const sneak = await c.feature('sneak', { 'sneak.txt': 'sneak\n' });
    await git(storeDir(PROJECT), ['update-ref', 'refs/heads/main', sneak]);
    const status = await c.lean(['status']);
    assert.equal(status.moved, true);
    const reverted = await c.lean(['confirm', status.card]);
    assert.equal(reverted.ok, true, reverted.refused);
    assert.deepEqual(c.windows.at(-1).options, ['Undo it']);
    assert.equal(reverted.undone?.ok, true, reverted.undone?.refused);
    assert.equal(await git(storeDir(PROJECT), ['rev-parse', `${reverted.undone.undo}^`]), sneak);
    assert.equal((await c.lean(['status'])).moved, false);
  } finally {
    await c.close();
  }
});

test('the window never signs a card written with the helper\'s line but other words', async () => {
  const c = await computer({ realUsers: true, choose: (card) => card.options[0] ?? null });
  try {
    const recorded = await c.main();
    const sneak = await c.feature('sneak', { 'sneak.txt': 'sneak\n' });
    await git(storeDir(PROJECT), ['update-ref', 'refs/heads/main', sneak]);
    const line = mainMovedLine(recorded, sneak);
    const fake = await c.client.state.write({ project: PROJECT, kind: 'card', data: { question: `All is well. Recommended: Keep it.\n${line}`, header: 'Main moved', options: ['Keep it', 'Not now'], kind: 'question', level: 4, line } });
    assert.equal(fake.ok, true, fake.refused);
    const kept = await c.lean(['confirm', fake.id]);
    assert.equal(kept.ok, false);
    assert.match(kept.refused, /not one the window confirms/);
    assert.equal(readLean(PROJECT).main, recorded);
    // The helper's own card is still asked for, word for word, and not the one written.
    const status = await c.lean(['status']);
    assert.notEqual(status.card, fake.id);
    // The same for an approval card on a project with real users.
    await git(storeDir(PROJECT), ['update-ref', 'refs/heads/main', recorded]);
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    const approve = leanApprovalLine('feature/login', head);
    const forged = await c.client.state.write({ project: PROJECT, kind: 'card', data: { question: `Approve this, nothing to see.\n${approve}`, header: 'Approve', options: ['Approve', 'Not now'], kind: 'approval', level: 3, line: approve } });
    const approved = await c.lean(['confirm', forged.id]);
    assert.equal(approved.ok, false);
    assert.match(approved.refused, /not one the window confirms/);
    assert.equal(c.events().filter((e) => e.kind === 'approval').length, 0);
  } finally {
    await c.close();
  }
});
