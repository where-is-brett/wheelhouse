// tests/scripts/lean/cli.test.js
// The Lean command's output for a click, a confirm and their refusals, pinned against a real helper on a temporary
// home (archon part 1, Task 9): moving the Copilot front end onto the desk changes nothing the chat prints. Each
// case is the command's standard output, standard error and exit code, with ids, commits, hashes and times put as
// placeholders, compared with tests/fixtures/desk-parity/copilot/lean-cli.json. DESK_PARITY_WRITE=1 writes the
// fixture again from today's output.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { guardedRun, standInTools } from '../../helpers/host-stand-ins.js';
import { shortHome, testAddress } from '../../helpers/homes.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';
import { run, withoutGitVars } from '../../../scripts/lib/run.js';
import { NULL_FILE } from '../../../scripts/lib/safe-git.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { registerLean, updateLean } from '../../../scripts/lean/project.js';
import { adoptProject, leanApprovalLine } from '../../../scripts/lean/store.js';
import { main as leanMain } from '../../../scripts/lean/cli.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'desk-parity', 'copilot', 'lean-cli.json');

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
const T0 = Date.parse('2026-10-29T01:00:00.000Z');
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: NULL_FILE, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: NULL_FILE,
  GIT_AUTHOR_NAME: 'Ann', GIT_AUTHOR_EMAIL: 'ann@example.com', GIT_COMMITTER_NAME: 'Ann', GIT_COMMITTER_EMAIL: 'ann@example.com',
};
async function git(cwd, args) {
  const got = await run('git', args, { cwd, baseEnv: withoutGitVars(), env: GIT_ENV });
  if (got.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${got.stderr}`);
  return got.stdout.trim();
}

// What varies from run to run, put as placeholders: ids, full hashes and commits, and times.
const steady = (text) => text
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
  .replace(/\b[0-9a-f]{64}\b/g, '<hash>')
  .replace(/\b[0-9a-f]{40}\b/g, '<commit>')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<at>');

// A computer with a Lean project adopted into its store, an enrolled key, and a helper whose window answers with
// `c.choose(card)`.
async function computer({ realUsers = false } = {}) {
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
  updateLean(PROJECT, { realUsers, agent: 'copilot' });
  const own = makeSigningKey();
  enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: new Date(T0).toISOString() });
  let tick = 0;
  const now = () => new Date(T0 + 1000 * (tick += 1));
  await adoptProject({ project: PROJECT, folder, run: hostGuard, now });
  const c = { folder, choose: () => null };
  const helper = await startHelper({
    run: hostGuard,
    address: testAddress(home),
    envFor: async () => { throw new Error('no connection on this computer'); },
    adapterFor: async () => { throw new Error('no adapter on this computer'); },
    askWindow: async (card) => ({ choice: c.choose(card) }),
    now,
  });
  // The routes each command asked, for the cases that say which way they went.
  const asked = [];
  const real = helperClient({ address: helper.address });
  const client = {
    ...real,
    confirm: (body) => { asked.push('confirm'); return real.confirm(body); },
    cards: { ...real.cards, chatClick: (body) => { asked.push('chat-click'); return real.cards.chatClick(body); } },
    state: { ...real.state, views: (body) => { asked.push('views'); return real.state.views(body); } },
    desk: {
      ...real.desk,
      read: (body) => { asked.push(`desk read ${body.view}`); return real.desk.read(body); },
      act: (body) => { asked.push(`desk ${body.command} ${body.evidence?.form}`); return real.desk.act(body); },
    },
  };
  c.asked = () => asked.splice(0);
  // The command as the chat runs it: what it prints, and its exit code. `printed` is the answer it printed, parsed.
  c.lean = async (argv, input) => {
    const out = [];
    const err = [];
    const code = await leanMain(argv, {
      cwd: folder, client, stdin: Readable.from([input === undefined ? '' : JSON.stringify(input)]),
      stdout: { write: (t) => out.push(t) }, stderr: { write: (t) => err.push(t) },
    });
    const stdout = out.join('');
    return { stdout: steady(stdout), stderr: steady(err.join('')), code, printed: stdout === '' ? null : JSON.parse(stdout) };
  };
  c.feature = async (slug, files) => {
    await git(folder, ['switch', '-q', '-c', `feature/${slug}`]);
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), text);
    await git(folder, ['add', '-A']);
    await git(folder, ['commit', '-q', '-m', `Build ${slug}`]);
    const head = await git(folder, ['rev-parse', 'HEAD']);
    await git(folder, ['switch', '-q', '--detach', 'main']);
    return head;
  };
  c.keep = (name, got) => {
    ways[name] = c.asked();
    return keep(name, got);
  };
  c.close = async () => {
    liftStop();
    await helper.close();
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  };
  return c;
}

const pinned = {};
const keep = (name, got) => {
  const { printed, ...shown } = got;
  pinned[name] = shown;
  return printed;
};
// The way each case went: through the desk, or the helper's own route where the desk can't answer as it did.
const WAYS = {
  'click-approve': ['desk answer chat-click'],
  'click-suggest': ['desk suggest chat-click'],
  'click-words-on-approve': ['chat-click'],
  'click-confirmed-step': ['chat-click'],
  'click-not-a-ruling': ['chat-click'],
  'click-undo': ['desk answer chat-click'],
  'click-under-stop': ['desk answer chat-click'],
  'confirm-undo-under-stop': ['desk read waiting', 'confirm'],
  'confirm-lift-stop': ['confirm'],
  'confirm-not-now': ['desk read waiting', 'desk answer window'],
  'confirm-approve': ['desk read waiting', 'desk answer window'],
  'confirm-unknown-card': ['desk read waiting'],
  'confirm-under-stop': ['desk read waiting', 'confirm'],
};
const ways = {};

test('a click in the chat, and its refusals, print as they did', async () => {
  const c = await computer();
  try {
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    const question = `Add login to the main version?\n${leanApprovalLine('feature/login', head)}`;
    c.keep('click-approve', await c.lean(['click', 'merge-login', 'Approve', head], { question }));
    c.keep('click-suggest', await c.lean(['click', 'merge-login', 'Suggest a change…', head], { question, text: 'Make the button blue' }));
    c.keep('click-words-on-approve', await c.lean(['click', 'merge-login', 'Approve', head], { question, text: 'sneak' }));
    c.keep('click-confirmed-step', await c.lean(['click', 'lift-stop', 'Lift STOP'], { question: 'Lift All stop?' }));
    c.keep('click-not-a-ruling', await c.lean(['click', `ruling-${crypto.randomUUID()}`, 'Confirm'], { question: 'Confirm this ruling?' }));
    c.keep('click-undo', await c.lean(['click', 'undo-login', 'Undo', head], { question: 'Undo login?' }));
    setStop({ by: 'helper' });
    c.keep('click-under-stop', await c.lean(['click', 'merge-login', 'Approve', head], { question }));
    liftStop();
    // The undo of a merge, confirmed in the window under STOP, where only the undo is offered.
    const merged = await c.lean(['merge', 'login', head]);
    assert.equal(merged.code, 0, merged.stderr);
    const asked = await c.lean(['undo', merged.printed.merge]);
    assert.equal(asked.printed.needs, 'window');
    setStop({ by: 'helper' });
    c.choose = (card) => (card.options.includes('Undo') ? 'Undo' : null);
    c.keep('confirm-undo-under-stop', await c.lean(['confirm', asked.printed.card]));
    c.choose = (card) => (card.options.includes('Lift STOP') ? 'Lift STOP' : card.options.find((o) => /^Lift/.test(o)) ?? null);
    c.keep('confirm-lift-stop', await c.lean(['confirm', 'lift-stop']));
  } finally {
    await c.close();
  }
});

test('a confirm in the helper\'s window, and its refusals, print as they did', async () => {
  const c = await computer({ realUsers: true });
  try {
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    assert.equal((await c.lean(['click', 'merge-login', 'Approve', head], { question: 'Add login?' })).code, 0);
    const refused = await c.lean(['merge', 'login', head]);
    assert.equal(refused.printed.needs, 'window');
    c.asked();
    c.keep('confirm-not-now', await c.lean(['confirm', refused.printed.card]));
    c.choose = (card) => (card.options.includes('Approve') ? 'Approve' : null);
    c.keep('confirm-approve', await c.lean(['confirm', refused.printed.card]));
    c.keep('confirm-unknown-card', await c.lean(['confirm', crypto.randomUUID()]));
    setStop({ by: 'helper' });
    c.keep('confirm-under-stop', await c.lean(['confirm', refused.printed.card]));
  } finally {
    await c.close();
  }
});

test('a click and a confirm go through the desk, but for what it can\'t answer as the helper did', () => {
  assert.deepEqual(ways, WAYS);
});

test('every case matches the pinned output', () => {
  if (process.env.DESK_PARITY_WRITE === '1') {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, `${JSON.stringify(pinned, null, 2)}\n`);
  }
  assert.deepEqual(pinned, JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
});
