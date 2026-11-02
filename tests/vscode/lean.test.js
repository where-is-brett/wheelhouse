// tests/vscode/lean.test.js
// The helper inside VS Code's own process, for a Lean project where no Node.js runs (design for other agents, section 8.5),
// and the merge the add-on's press allows. Every git repository here is a temporary one under a temporary home, and no
// real Node.js, host tool or window is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { shortHome, testAddress } from '../helpers/homes.js';
import { run, withoutGitVars } from '../../scripts/lib/run.js';
import { NULL_FILE } from '../../scripts/lib/safe-git.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { listEvents, makeEvent, writeEvent } from '../../scripts/state/events.js';
import { sign, makeSigningKey, enrol } from '../../scripts/state/signing.js';
import { registerLean, updateLean, leanState } from '../../scripts/lean/project.js';
import { adoptProject, mergeApproved, LeanRefusal, SIGNED_LEAN_PROOFS, leanSignedProofs, leanApprovalLine } from '../../scripts/lean/store.js';
import { ADDON_LEAN_READY } from '../../scripts/lib/copilot-numbers.js';
import { startHelper, editorSpawn, EDITOR_NO_NODE } from '../../scripts/host/helper.js';
import { writeProject } from '../../scripts/lib/projects.js';
import { require } from './helpers.js';

const { startLean, guardedRun, LEAN_LOADS } = require('../../vscode/lean.cjs');

const PROJECT = 'shop';
const T0 = Date.parse('2026-11-02T01:00:00.000Z');
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: NULL_FILE, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: NULL_FILE,
  GIT_AUTHOR_NAME: 'Ann', GIT_AUTHOR_EMAIL: 'ann@example.com', GIT_COMMITTER_NAME: 'Ann', GIT_COMMITTER_EMAIL: 'ann@example.com',
};
async function git(cwd, args) {
  const got = await run('git', args, { cwd, baseEnv: withoutGitVars(), env: GIT_ENV });
  if (got.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${got.stderr}`);
  return got.stdout.trim();
}

// A computer with a home of its own and a Lean project with real users, adopted into the store.
async function computer() {
  const home = shortHome();
  const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(shortHome(), 'shop-')));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  await git(folder, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(folder, 'README.md'), 'shop\n');
  fs.writeFileSync(path.join(folder, '.gitignore'), '.wheelhouse/*\n!.wheelhouse/record/\n');
  await git(folder, ['add', '-A']);
  await git(folder, ['commit', '-q', '-m', 'Start']);
  const copy = path.join(fs.realpathSync.native(shortHome()), 'copy.git');
  fs.mkdirSync(copy);
  await git(copy, ['init', '-q', '--bare']);
  await git(folder, ['remote', 'add', 'wheelhouse-copy', copy]);
  registerLean({ project: PROJECT, folder, now: () => new Date(T0) });
  updateLean(PROJECT, { test: null, identity: { name: 'Wheelhouse helper', email: 'helper@example.com' }, realUsers: true });
  const own = makeSigningKey();
  enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: new Date(T0).toISOString() });
  let tick = 0;
  const now = () => new Date(T0 + 1000 * (tick += 1));
  await adoptProject({ project: PROJECT, folder, run, now });
  const events = () => listEvents(stateDir(PROJECT), { report: () => {} });
  const feature = async (slug, file) => {
    await git(folder, ['switch', '-q', '-c', `feature/${slug}`]);
    fs.writeFileSync(path.join(folder, file), `${slug}\n`);
    await git(folder, ['add', '-A']);
    await git(folder, ['commit', '-q', '-m', `Build ${slug}`]);
    const head = await git(folder, ['rev-parse', 'HEAD']);
    await git(folder, ['switch', '-q', '--detach', 'main']);
    return head;
  };
  // A signed press of Approve in the add-on's pane, for `commit`.
  const press = async (slug, commit, question, proof = 'add-on') => {
    await leanState(PROJECT, { run });
    const event = sign(makeEvent({ kind: 'approval', data: { branch: `feature/${slug}`, commit, words: 'Approve', question, proof }, now }));
    await writeEvent({ project: PROJECT, event, push: async () => ({ ok: false }), env: {}, now });
  };
  const ask = (proofs) => ({ project: PROJECT, branch: 'feature/login', run, now, approvalProofs: proofs });
  return {
    home, folder, copy, feature, press, ask, events, now,
    main: () => git(folder, ['rev-parse', 'main']).catch(() => git(path.join(home, 'projects', PROJECT, 'git'), ['rev-parse', 'refs/heads/main'])),
    close: () => {
      if (before === undefined) delete process.env.WHEELHOUSE_HOME;
      else process.env.WHEELHOUSE_HOME = before;
    },
  };
}

test('a merge runs only after an add-on press for that commit', async () => {
  const c = await computer();
  try {
    const head = await c.feature('login', 'login.txt');
    const other = await c.feature('logout', 'logout.txt');
    const proofs = ['chat-click', ...leanSignedProofs(true)];
    assert.ok(proofs.includes('add-on'));
    // No press: refused, and the card raised names the commit in full.
    let refusal;
    await assert.rejects(mergeApproved({ ...c.ask(proofs), commit: head }), (error) => { refusal = error; return error instanceof LeanRefusal; });
    const card = c.events().find((e) => e.id === refusal.extra.card);
    const question = card.data.question;
    assert.ok(question.endsWith(leanApprovalLine('feature/login', head)));
    // A press for another commit decides nothing about this one.
    await c.press('logout', other, question);
    await assert.rejects(mergeApproved({ ...c.ask(proofs), commit: head }), (error) => error instanceof LeanRefusal);
    // A press for this commit counts only where the add-on's proof is taken.
    await c.press('login', head, question);
    await assert.rejects(mergeApproved({ ...c.ask(['chat-click', ...leanSignedProofs(false)]), commit: head }), (error) => error instanceof LeanRefusal);
    const got = await mergeApproved({ ...c.ask(proofs), commit: head });
    assert.equal(c.events().find((e) => e.kind === 'merge').data.proof, 'add-on');
    assert.equal(await c.main(), got.merge);
    // The copy follows the approval: it holds the merge, and the record says it was pushed.
    assert.deepEqual(got.copy, { pushed: true, commit: got.merge });
    assert.equal(await git(c.copy, ['rev-parse', 'refs/heads/main']), got.merge);
  } finally {
    c.close();
  }
});

test('the switch off starts nothing, and the add-on\'s proof isn\'t taken', async () => {
  assert.equal(ADDON_LEAN_READY, false);
  assert.deepEqual([...SIGNED_LEAN_PROOFS], ['window']);
  assert.deepEqual([...leanSignedProofs(false)], ['window']);
  assert.deepEqual([...leanSignedProofs(true)], ['window', 'add-on']);
  const home = shortHome();
  const started = [];
  const off = await startLean({
    address: testAddress(home), run, isLean: true, node: null,
    modules: { numbers: { ADDON_LEAN_READY }, helper: { startHelper: async () => { started.push('helper'); } } },
  });
  assert.equal(off.mode, 'off');
  assert.deepEqual(started, []);
  await off.stop();
});

// Two windows and a real helper, each on the same address.
async function windows() {
  const home = shortHome();
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  const address = testAddress(home);
  const log = [];
  const modules = { numbers: { ADDON_LEAN_READY: true }, helper: { startHelper } };
  const go = (extra = {}) => startLean({ address, run: async (file, args, options) => { log.push(file); return run(file, args, options); }, isLean: true, node: null, modules, ...extra });
  return {
    home, address, log, go,
    close: () => {
      if (before === undefined) delete process.env.WHEELHOUSE_HOME;
      else process.env.WHEELHOUSE_HOME = before;
    },
  };
}

const health = (address) => new Promise((resolve) => {
  http.get({ socketPath: address, path: '/health', agent: false }, (res) => {
    let text = '';
    res.on('data', (d) => { text += d; });
    res.on('end', () => resolve(JSON.parse(text)?.ok === true));
  }).on('error', () => resolve(false));
});

test('the second window is a client', async () => {
  const w = await windows();
  try {
    const first = await w.go();
    assert.equal(first.mode, 'helper');
    assert.equal(await health(w.address), true);
    const second = await w.go();
    assert.equal(second.mode, 'client');
    // A client closes nothing: the first window's helper answers after the second window has gone.
    await second.stop();
    assert.equal(await health(w.address), true);
    await first.stop();
    assert.equal(await health(w.address), false);
    await first.stop();
  } finally {
    w.close();
  }
});

test('a real helper taking over leaves one helper', async () => {
  const w = await windows();
  try {
    const first = await w.go();
    const base = { address: w.address, adapterFor: async () => { throw new Error('none'); }, envFor: async () => { throw new Error('none'); } };
    // While the window's helper answers, a real one is refused: there is one.
    await assert.rejects(startHelper(base), /already running/);
    // Once the window lets go, the real one binds, and a window started after it is its client.
    await first.stop();
    const real = await startHelper(base);
    try {
      const late = await w.go();
      assert.equal(late.mode, 'client');
      await late.stop();
      assert.equal(await health(w.address), true);
    } finally {
      await real.close();
    }
  } finally {
    w.close();
  }
});

test('nothing spawns VS Code\'s own program, the foreman\'s route included', async () => {
  const w = await windows();
  try {
    const seen = [];
    const guarded = guardedRun(async (file) => { seen.push(file); return { code: 0, stdout: '', stderr: '' }; });
    await assert.rejects(guarded(process.execPath, ['x.js']), /VS Code/);
    await assert.rejects(guarded('/usr/bin/node', ['x.js']), /VS Code/);
    await assert.rejects(guarded('node.exe', ['x.js']), /VS Code/);
    await guarded('git', ['status']);
    assert.deepEqual(seen, ['git']);

    // A real project on a host, so the request gets to the route itself; the connection stands in as setup's tests do.
    const folder = fs.realpathSync.native(shortHome());
    writeProject('o__p', { folder, remoteUrl: 'https://example.test/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    const standIn = { startHelper: (o) => startHelper({ ...o, envFor: async () => ({}), adapterFor: async () => ({}) }) };
    const first = await w.go({ modules: { numbers: { ADDON_LEAN_READY: true }, helper: standIn } });
    assert.equal(first.mode, 'helper');
    const post = (route, body) => new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request({ socketPath: w.address, path: route, method: 'POST', agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
        let text = '';
        res.on('data', (d) => { text += d; });
        res.on('end', () => resolve(JSON.parse(text)));
      });
      req.on('error', reject);
      req.end(data);
    });
    const answer = await post('/foreman/run', { folder, script: 'wake', argv: ['measures'] });
    assert.deepEqual(answer, { ok: false, refused: EDITOR_NO_NODE });
    assert.equal(w.log.includes(process.execPath), false);
    await first.stop();
  } finally {
    w.close();
  }
  // The other starts of a Node.js the helper makes (setup's step runs, the uninstall, the watcher, the engine's wake) go
  // through its `spawn`: inside the editor that refuses the running program and lets others on.
  const calls = [];
  const spawn = editorSpawn((file) => { calls.push(file); return {}; });
  assert.throws(() => spawn(process.execPath, ['step.js']), new RegExp(EDITOR_NO_NODE));
  spawn('git', []);
  assert.deepEqual(calls, ['git']);
  // The window's file names neither a spawn nor the program running it.
  const source = fs.readFileSync(new URL('../../vscode/lean.cjs', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/\bspawn\w*\s*\(|\bexec\w*\s*\(|\bfork\s*\(|child_process/.test(source), false);
  // VS Code's own program is named once, to be refused.
  assert.deepEqual(source.match(/process\.execPath/g), ['process.execPath']);
  assert.match(source, /const OWN_PROGRAM = process\.execPath;/);
  // Every script it loads is one the pack carries.
  assert.ok(Object.values(LEAN_LOADS).every((rel) => fs.existsSync(new URL(`../../${rel}`, import.meta.url))));
});
