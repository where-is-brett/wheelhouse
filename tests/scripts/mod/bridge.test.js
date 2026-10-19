// tests/scripts/mod/bridge.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handle, runBridge, lineOf, limitFor, BRIDGE_MS, MAX_REQUEST_BYTES } from '../../../scripts/mod/bridge.js';
import { readPaneStatus } from '../../../scripts/mod/status.js';
import { recordRole } from '../../../scripts/lib/role.js';
import { TICK_MS, WATCH_BRIDGE_MS } from '../../../scripts/lib/mod-numbers.js';
import { makeSigningKey, enrol, verify, readEnrolled } from '../../../scripts/state/signing.js';
import { LIFT_STOP } from '../../../scripts/state/card-lines.js';
import { setStop, stopState, liftStop } from '../../../scripts/lib/stop.js';
import { keysDir, usageDir } from '../../../scripts/lib/paths.js';
import { pendingDir } from '../../../scripts/hooks/pending.js';
import { withHome, tempFolder } from '../../helpers/homes.js';
import { writeProject } from '../../../scripts/lib/projects.js';

const BRIDGE = fileURLToPath(new URL('../../../scripts/mod/bridge.js', import.meta.url));
const P = 'owner__name';
const NOW = new Date('2026-10-19T05:00:00.000Z');
const unix = process.platform !== 'win32';

// A folder whose .git/HEAD names `branch`, so featureSlug reads it as git would.
function folderOn(branch) {
  const dir = tempFolder('wh-bridge-cwd-');
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  return dir;
}

function fakeClient({ takes = true } = {}) {
  const calls = { record: [], write: [], profileRecord: [] };
  return {
    calls,
    state: {
      record: async (b) => { calls.record.push(b); return takes ? { ok: true } : { ok: false, refused: 'no' }; },
      write: async (b) => { calls.write.push(b); return { ok: true }; },
    },
    profile: { record: async (b) => { calls.profileRecord.push(b); return { ok: true }; } },
  };
}

const building = (n, others = 0) => async () => ({
  project: P,
  model: { build: { features: [...Array(n).fill({ step: 'building' }), ...Array(others).fill({ step: 'reviewing' })] } },
});

const deps = (extra = {}) => ({
  now: () => NOW,
  projectOf: () => ({ project: P }),
  loadInputs: building(0),
  ...extra,
});

function enrolKey() {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
}

const pendingFiles = () => {
  try {
    return fs.readdirSync(pendingDir(P)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const readLines = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('usage readings are recorded with the session\'s part', () => withHome(async () => {
  const feature = folderOn('feature/login');
  const answer = await handle({
    cmd: 'usage', session: 'sess-1', cwd: feature, usd: 1.25,
    windows: [{ kind: 'five_hour', percentUsed: 20 }, { kind: 'week', percentUsed: 'lots' }, 'junk', null],
  }, deps());
  assert.deepEqual(answer, { ok: true });
  assert.deepEqual(readLines(path.join(usageDir(), 'mod', '2026-10-19.jsonl')), [{ at: NOW.toISOString(), session: 'sess-1', usd: 1.25 }]);
  assert.deepEqual(readJson(path.join(usageDir(), 'allowance.json')).windows, [{ kind: 'five_hour', percentUsed: 20 }]);
  assert.deepEqual(readJson(path.join(usageDir(), 'sessions', 'sess-1.json')), { session: 'sess-1', project: P, role: 'feature', work: 'login', at: NOW.toISOString(), by: 'mod' });

  // Written once: a later reading from another folder changes nothing.
  await handle({ cmd: 'usage', session: 'sess-1', cwd: folderOn('main'), usd: 2 }, deps());
  assert.equal(readJson(path.join(usageDir(), 'sessions', 'sess-1.json')).role, 'feature');
  assert.equal(readLines(path.join(usageDir(), 'mod', '2026-10-19.jsonl')).length, 2);

  // Not on a feature branch: the front desk. The foreman is the session start's to record: it
  // replaces a file the bridge wrote once (tests/scripts/usage/store.test.js).
  await handle({ cmd: 'usage', session: 'sess-2', cwd: folderOn('main') }, deps());
  assert.deepEqual(readJson(path.join(usageDir(), 'sessions', 'sess-2.json')), { session: 'sess-2', project: P, role: 'front-desk', at: NOW.toISOString(), by: 'mod' });

  // Outside a project the reading is still kept, with no part recorded.
  assert.deepEqual(await handle({ cmd: 'usage', session: 'sess-3', cwd: feature, usd: 0.5 }, deps({ projectOf: () => null })), { ok: true });
  assert.equal(fs.existsSync(path.join(usageDir(), 'sessions', 'sess-3.json')), false);
  assert.equal(readLines(path.join(usageDir(), 'mod', '2026-10-19.jsonl')).at(-1).session, 'sess-3');

  // A cost that isn't one is dropped; a session ID that isn't one records nothing.
  await handle({ cmd: 'usage', session: 'sess-4', cwd: feature, usd: -1 }, deps());
  await handle({ cmd: 'usage', session: 'sess-4', cwd: feature, usd: Number.NaN }, deps());
  await handle({ cmd: 'usage', session: 'sess-4', cwd: feature, usd: '3' }, deps());
  assert.equal(readLines(path.join(usageDir(), 'mod', '2026-10-19.jsonl')).some((l) => l.session === 'sess-4'), false);
  for (const session of ['../escape', '..', '', 42, undefined]) {
    const bad = await handle({ cmd: 'usage', session, cwd: feature, usd: 1 }, deps());
    assert.equal(bad.ok, false);
    assert.equal(typeof bad.says, 'string');
  }
  assert.equal(readLines(path.join(usageDir(), 'mod', '2026-10-19.jsonl')).length, 3);
}));

test('a reply from composer or bridge is recorded; from sdk or peer it is not', () => withHome(async () => {
  const calls = [];
  const replyRecord = async (args) => { calls.push(args); return { made: true, says: 'Recorded: Approve pull request #4' }; };
  const client = fakeClient();
  for (const origin of ['composer', 'bridge']) {
    const answer = await handle({ cmd: 'reply', origin, text: 'K7QD Approve', cwd: '/work' }, deps({ replyRecord, client }));
    assert.deepEqual(answer, { ok: true, says: 'Recorded: Approve pull request #4' });
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0].project, P);
  assert.equal(calls[0].text, 'K7QD Approve');
  assert.equal(calls[0].client, client);

  for (const origin of ['sdk', 'peer', 'Composer', 'hook', undefined, null, ['composer'], { origin: 'composer' }]) {
    const answer = await handle({ cmd: 'reply', origin, text: 'K7QD Approve', cwd: '/work' }, deps({ replyRecord, client }));
    assert.deepEqual(answer, { ok: false, says: 'Only the director\'s own messages count' });
  }
  assert.equal(calls.length, 2);

  const outside = await handle({ cmd: 'reply', origin: 'composer', text: 'K7QD Approve', cwd: '/work' }, deps({ replyRecord, client, projectOf: () => null }));
  assert.deepEqual(outside, { ok: false, says: 'This isn\'t a Wheelhouse project' });
  assert.equal(calls.length, 2);

  // The real reply record answers a message that is no reply code, and nothing is sent.
  const real = await handle({ cmd: 'reply', origin: 'composer', text: 'yes', cwd: '/work' }, deps({ client }));
  assert.equal(real.ok, false);
  assert.match(real.says, /isn't a reply code/);
  assert.equal(client.calls.record.length, 0);
}));

test('/go from the director lifts STOP with a signed record, kept before it lifts', () => withHome(async () => {
  enrolKey();
  for (const origin of ['composer', 'bridge']) {
    setStop({ by: 'prompt', now: () => NOW });
    const client = fakeClient();
    const seen = [];
    const lift = () => {
      // What is kept when STOP is lifted.
      seen.push(pendingFiles().map((n) => readJson(path.join(pendingDir(P), n))));
      liftStop();
    };
    const answer = await handle({ cmd: 'go', origin, cwd: '/work' }, deps({ client, liftStop: lift, loadInputs: building(2, 1) }));
    assert.deepEqual(answer, { ok: true, says: 'STOP is off. In progress: 2 features building.' });
    assert.equal(stopState().on, false);

    assert.equal(seen.length, 1);
    assert.equal(seen[0].length, 1);
    const kept = seen[0][0];
    assert.equal(kept.route, 'record');
    assert.equal(kept.body.project, P);
    const event = kept.body.event;
    assert.equal(event.kind, 'action');
    assert.deepEqual(event.data, { action: 'lift-stop', question: LIFT_STOP, label: '/go' });
    assert.equal(verify(event, readEnrolled()), true);

    // Sent to the helper, and gone from pending once it was taken.
    assert.deepEqual(client.calls.record.map((b) => b.event.id), [event.id]);
    assert.deepEqual(pendingFiles(), []);
  }

  // Kept when the helper doesn't take it, for the next session start to send.
  setStop({ by: 'prompt', now: () => NOW });
  const refused = await handle({ cmd: 'go', origin: 'composer', cwd: '/work' }, deps({ client: fakeClient({ takes: false }), loadInputs: building(1) }));
  assert.deepEqual(refused, { ok: true, says: 'STOP is off. In progress: 1 feature building.' });
  assert.equal(pendingFiles().length, 1);
  fs.rmSync(pendingDir(P), { recursive: true, force: true });

  // Nothing building, or the build loop's views absent.
  for (const loadInputs of [building(0, 2), async () => ({ none: 'This folder isn\'t part of a Wheelhouse project' }), async () => { throw new Error('no'); }]) {
    setStop({ by: 'prompt', now: () => NOW });
    const answer = await handle({ cmd: 'go', origin: 'composer', cwd: '/work' }, deps({ client: fakeClient(), loadInputs }));
    assert.deepEqual(answer, { ok: true, says: 'STOP is off. No build work is in progress.' });
  }

  // STOP off: nothing to lift, and nothing signed.
  const client = fakeClient();
  assert.deepEqual(await handle({ cmd: 'go', origin: 'composer', cwd: '/work' }, deps({ client })), { ok: true, says: 'STOP isn\'t on.' });
  assert.equal(client.calls.record.length, 0);
  assert.deepEqual(pendingFiles(), []);
}));

test('/go from any other origin leaves STOP on', () => withHome(async () => {
  enrolKey();
  setStop({ by: 'prompt', now: () => NOW });
  const client = fakeClient();
  let lifted = 0;
  for (const origin of ['sdk', 'peer', 'hook', '', undefined, 'COMPOSER', ['bridge']]) {
    const answer = await handle({ cmd: 'go', origin, cwd: '/work' }, deps({ client, liftStop: () => { lifted += 1; } }));
    assert.deepEqual(answer, { ok: false, says: 'Only the director can lift STOP' });
  }
  assert.equal(lifted, 0);
  assert.equal(stopState().on, true);
  assert.equal(client.calls.record.length, 0);
  assert.deepEqual(pendingFiles(), []);

  // The director outside a project: no record can be kept, so STOP stays on.
  const outside = await handle({ cmd: 'go', origin: 'composer', cwd: '/work' }, deps({ client, projectOf: () => null }));
  assert.equal(outside.ok, false);
  assert.equal(stopState().on, true);
}));

test('stop from the phone sets STOP by the mod', () => withHome(async () => {
  for (const origin of ['composer', 'sdk', 'peer', undefined]) {
    const answer = await handle({ cmd: 'stop', origin, cwd: '/work' }, deps());
    assert.deepEqual(answer, { ok: false, says: 'Only a message from your phone sets STOP here' });
    assert.equal(stopState().on, false);
  }
  assert.deepEqual(await handle({ cmd: 'stop', origin: 'bridge', cwd: '/work' }, deps()), { ok: true, says: 'STOP is on.' });
  assert.deepEqual(stopState(), { on: true, by: 'mod', at: NOW.toISOString() });
}));

test('a request it cannot read answers ok false and exits 0', () => withHome(async (home) => {
  // Through the process itself: one JSON line on standard output, and exit code 0.
  const run = (input) => spawnSync(process.execPath, [BRIDGE], { input, encoding: 'utf8', env: { ...process.env, WHEELHOUSE_HOME: home }, timeout: 20000 });
  for (const input of ['', 'not json', '[1,2]', 'null', '"go"', '{"cmd":"launch"}', '{"cmd":"__proto__"}', '{"cmd":"go"', 'x'.repeat(MAX_REQUEST_BYTES + 1)]) {
    const result = run(input);
    assert.equal(result.status, 0, `exit code for ${input.slice(0, 20)}`);
    const lines = result.stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, `one line for ${input.slice(0, 20)}`);
    const answer = JSON.parse(lines[0]);
    assert.equal(answer.ok, false);
    assert.equal(typeof answer.says, 'string');
  }
  // A request it can read, through the process: a phoned stop.
  const stop = run(JSON.stringify({ cmd: 'stop', origin: 'bridge', cwd: home }));
  assert.equal(stop.status, 0);
  assert.deepEqual(JSON.parse(stop.stdout), { ok: true, says: 'STOP is on.' });

  // A throw inside is an answer too.
  const thrown = await handle({ cmd: 'stop', origin: 'bridge' }, deps({ setStop: () => { throw new Error('disk'); } }));
  assert.equal(thrown.ok, false);
  assert.equal(typeof thrown.says, 'string');

  // A request that takes too long is answered when the limit comes.
  const slow = await runBridge({ stdin: Readable.from([JSON.stringify({ cmd: 'go', origin: 'composer', cwd: '/work' })]), limitMs: 50, deps: deps({ stopState: () => new Promise(() => {}) }) });
  assert.deepEqual(JSON.parse(slow), { ok: false, says: 'Wheelhouse couldn\'t do that in time' });
  // So is standard input that never closes.
  const open = new Readable({ read() {} });
  assert.deepEqual(JSON.parse(await runBridge({ stdin: open, limitMs: 50, deps: deps() })), { ok: false, says: 'Wheelhouse couldn\'t do that in time' });
  open.destroy();
}));

test('run where the signing key cannot be read, it signs nothing and says so', () => withHome(async () => {
  // Inside the real sandbox the bridge fails earlier, at "not a project" (the project records
  // can't be read either); this covers the key alone. Both sign nothing.
  const check = async () => {
    setStop({ by: 'prompt', now: () => NOW });
    const client = fakeClient();
    let lifted = 0;
    const answer = await handle({ cmd: 'go', origin: 'composer', cwd: '/work' }, deps({ client, liftStop: () => { lifted += 1; } }));
    assert.deepEqual(answer, { ok: false, says: 'Wheelhouse couldn\'t sign that here, so STOP stays on' });
    assert.equal(stopState().on, true);
    assert.equal(lifted, 0);
    assert.deepEqual(pendingFiles(), []);
    assert.equal(client.calls.record.length, 0);
  };
  // No key at all.
  await check();
  // A key this process isn't allowed to read, as inside the sandbox.
  if (unix && process.getuid?.() !== 0) {
    enrolKey();
    const key = path.join(keysDir(), 'signing.pem');
    fs.chmodSync(key, 0o000);
    try {
      await check();
    } finally {
      fs.chmodSync(key, 0o600);
    }
  }
}));

// A FIFO where git keeps a small file, in a folder an agent controls, must not hang the bridge.
test('a FIFO in the session\'s folder doesn\'t hold the bridge past its limit', { skip: !unix }, () => withHome(async (home) => {
  const dir = tempFolder('wh-bridge-fifo-');
  // A worktree's .git file pointing at a git folder whose commondir is a FIFO.
  const gitdir = path.join(dir, 'gitdir');
  fs.mkdirSync(gitdir);
  execFileSync('mkfifo', [path.join(gitdir, 'commondir')]);
  execFileSync('mkfifo', [path.join(gitdir, 'HEAD')]);
  const work = path.join(dir, 'work');
  fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, '.git'), `gitdir: ${gitdir}\n`);
  // A main folder whose HEAD is a FIFO.
  const main = path.join(dir, 'main');
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  execFileSync('mkfifo', [path.join(main, '.git', 'HEAD')]);
  // Registered, so the bridge reads its branch for the session's part.
  writeProject(P, { folder: fs.realpathSync.native(main), remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });

  const run = (request) => spawnSync(process.execPath, [BRIDGE], {
    input: JSON.stringify(request), encoding: 'utf8', env: { ...process.env, WHEELHOUSE_HOME: home }, timeout: 15000,
  });
  for (const cwd of [work, main]) {
    for (const request of [
      { cmd: 'usage', session: 'sess-f', cwd, usd: 1 },
      { cmd: 'reply', origin: 'composer', text: 'K7QD Approve', cwd },
      { cmd: 'go', origin: 'composer', cwd },
    ]) {
      if (request.cmd === 'go') setStop({ by: 'prompt', now: () => NOW });
      const started = Date.now();
      const result = run(request);
      assert.equal(result.status, 0, `${request.cmd} in ${path.basename(cwd)}`);
      assert.ok(Date.now() - started < 10000);
      const lines = result.stdout.split('\n').filter(Boolean);
      assert.equal(lines.length, 1);
      assert.notEqual(JSON.parse(lines[0]).says, 'Wheelhouse couldn\'t do that in time');
    }
  }

  // The branch reader, in a process of its own so a hang shows as a timeout, reads no branch.
  const script = `import { featureSlug } from ${JSON.stringify(new URL('../../../scripts/hooks/session-start.js', import.meta.url).href)};
for (const dir of ${JSON.stringify([work, main])}) console.log(String(featureSlug(dir)));`;
  const slug = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, WHEELHOUSE_HOME: home }, timeout: 15000 });
  assert.equal(slug.status, 0);
  assert.deepEqual(slug.stdout.trim().split('\n'), ['null', 'null']);
}));

// --- tick: what the pane and the status line show ---

// A registered project whose main folder is `repo`, on `branch`.
function registered(home, branch = 'main') {
  const repo = path.join(home, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  writeProject(P, { folder: repo, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });
  return repo;
}

// The bridge's own dependencies, with the real project lookup and an environment with no role.
const live = (extra = {}) => ({ now: () => NOW, env: {}, ...extra });
const tickOf = (cwd, extra = {}) => ({ cmd: 'tick', session: 'sess-1', cwd, idle: false, surface: 'desktop', ...extra });

test('the front desk\'s tick gives the pane, the glance and the status line, and ticks again', () => withHome(async (home) => {
  const repo = registered(home);
  const answer = await handle(tickOf(repo), live());
  assert.equal(answer.ok, true);
  assert.equal(answer.role, 'front-desk');
  assert.equal(answer.every, TICK_MS);
  assert.equal(answer.every, 15000);
  assert.equal(answer.pane.v, 1);
  assert.equal(answer.pane.project, P);
  assert.equal(answer.glance, answer.pane.glance);
  assert.equal(answer.status, answer.glance);
  assert.ok(answer.glance.length <= 80);
  assert.equal('submit' in answer, false);
}));

test('the model is written to status.json before the tick answers', () => withHome(async (home) => {
  const repo = registered(home);
  assert.equal(readPaneStatus(P), null);
  const seen = [];
  const answer = await handle(tickOf(repo), live({
    writePaneStatus: (project, model) => {
      seen.push([project, model.v]);
      // Nothing has answered yet: the file is not there until this returns.
      assert.equal(readPaneStatus(P), null);
      fs.mkdirSync(path.join(home, 'projects', P), { recursive: true });
      fs.writeFileSync(path.join(home, 'projects', P, 'status.json'), `${JSON.stringify(model)}\n`);
    },
  }));
  assert.deepEqual(seen, [[P, 1]]);
  assert.deepEqual(readPaneStatus(P), JSON.parse(JSON.stringify(answer.pane)));

  // With the real writer, the file is the answer's pane.
  fs.rmSync(path.join(home, 'projects', P, 'status.json'));
  const again = await handle(tickOf(repo), live());
  assert.deepEqual(readPaneStatus(P), JSON.parse(JSON.stringify(again.pane)));

  // A file that can't be kept costs the file, never the answer, and the pane says so.
  const failing = await handle(tickOf(repo), live({ writePaneStatus: () => { throw new Error('disk full'); } }));
  assert.equal(failing.ok, true);
  assert.ok(failing.pane.missing.includes('The pane\'s status file couldn\'t be kept'));
}));

test('STOP set from the phone shows in the next tick\'s model', () => withHome(async (home) => {
  const repo = registered(home);
  assert.equal((await handle(tickOf(repo), live())).pane.stop.on, false);
  assert.deepEqual(await handle({ cmd: 'stop', origin: 'bridge', cwd: repo }, live()), { ok: true, says: 'STOP is on.' });
  const next = await handle(tickOf(repo), live());
  assert.deepEqual(next.pane.stop, { on: true, since: NOW.toISOString() });
  assert.match(next.glance, /STOP on/);
}));

test('in the terminal with Wheelhouse\'s status line set, the tick gives no status', () => withHome(async (home) => {
  const repo = registered(home);
  const settings = path.join(repo, '.claude', 'settings.local.json');
  const keep = (value) => {
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const ownCommand = { statusLine: { type: 'command', command: '"/usr/bin/node" "/plugins/wheelhouse/scripts/statusline.js"' } };

  assert.equal(typeof (await handle(tickOf(repo, { surface: 'terminal' }), live())).status, 'string', 'no local settings');
  keep(ownCommand);
  const terminal = await handle(tickOf(repo, { surface: 'terminal' }), live());
  assert.equal(terminal.ok, true);
  assert.equal('status' in terminal, false);
  assert.equal(typeof terminal.glance, 'string');
  assert.equal(typeof terminal.pane, 'object');
  // The desktop app has no terminal status line to repeat.
  assert.equal(typeof (await handle(tickOf(repo, { surface: 'desktop' }), live())).status, 'string');
  // The director's own status line is not Wheelhouse's, and a damaged file names none.
  keep({ statusLine: { type: 'command', command: 'theirs.sh' } });
  assert.equal(typeof (await handle(tickOf(repo, { surface: 'terminal' }), live())).status, 'string');
  keep('{ not json');
  assert.equal(typeof (await handle(tickOf(repo, { surface: 'terminal' }), live())).status, 'string');
  // The settings file is only read.
  keep(ownCommand);
  const before = fs.readFileSync(settings, 'utf8');
  await handle(tickOf(repo, { surface: 'terminal' }), live());
  assert.equal(fs.readFileSync(settings, 'utf8'), before);
}));

test('a feature session or a Shape 1 foreman is told to stop ticking', () => withHome(async (home) => {
  // A feature session: its folder is on a feature branch.
  const feature = registered(home, 'feature/login');
  assert.deepEqual(await handle(tickOf(feature), live()), { ok: true, role: 'feature', every: 0 });

  fs.writeFileSync(path.join(feature, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  // A foreman by the environment the session was started with.
  assert.deepEqual(await handle(tickOf(feature), live({ env: { WHEELHOUSE_ROLE: 'foreman' } })), { ok: true, role: 'foreman', every: 0 });
  // A foreman known from its first prompt, recorded by the board-context hook.
  assert.equal(recordRole('sess-foreman', 'foreman'), true);
  assert.deepEqual(await handle(tickOf(feature, { session: 'sess-foreman' }), live()), { ok: true, role: 'foreman', every: 0 });
  // Nothing has been written for the project: no pane is made for them.
  assert.equal(readPaneStatus(P), null);

  // Outside a project, and for a request that names no folder.
  const elsewhere = tempFolder('wh-bridge-outside-');
  assert.deepEqual(await handle(tickOf(elsewhere), live()), { ok: true, role: 'front-desk', every: 0 });
  assert.deepEqual(await handle({ cmd: 'tick', session: 'sess-1' }, live()), { ok: true, role: 'front-desk', every: 0 });
}));

test('the answer line carries only its own fields', () => {
  const full = {
    ok: true, says: 'x', role: 'front-desk', every: 15000, pane: { v: 1 }, glance: 'g', status: 's', submit: ['one', 'two'], rows: [{ key: 'k' }], text: 'digest',
  };
  assert.deepEqual(JSON.parse(lineOf({ ...full, secret: 'no', cards: [], watcher: 'running', nested: { x: 1 } })), full);
  assert.deepEqual(JSON.parse(lineOf({ ...full, submit: 'one prompt' })).submit, 'one prompt');
  // Each only when it is of its type.
  assert.deepEqual(JSON.parse(lineOf({
    ok: true, says: 5, role: 7, every: '15000', pane: [], glance: 1, status: {}, submit: [1], rows: ['x'], text: null,
  })), { ok: true });
  assert.deepEqual(JSON.parse(lineOf({ ok: true, every: -1 })), { ok: true });
  assert.deepEqual(JSON.parse(lineOf({ ok: true, every: Infinity })), { ok: true });
  assert.deepEqual(JSON.parse(lineOf({ ok: true, every: 0 })), { ok: true, every: 0 });
  assert.deepEqual(JSON.parse(lineOf(null)), { ok: false });
  assert.equal(lineOf({ ok: 'yes' }), '{"ok":false}');
});

test('the time to answer starts once the request is read: longer for a foreman\'s tick', () => {
  const foreman = { env: { WHEELHOUSE_ROLE: 'foreman' } };
  assert.equal(WATCH_BRIDGE_MS, 45000);
  assert.equal(limitFor(tickOf('/work'), { deps: foreman }), WATCH_BRIDGE_MS);
  assert.equal(limitFor(tickOf('/work'), { deps: { env: {} } }), BRIDGE_MS);
  assert.equal(limitFor({ cmd: 'go', origin: 'composer', cwd: '/work' }, { deps: foreman }), BRIDGE_MS);
  assert.equal(limitFor({ cmd: 'usage', session: 's', cwd: '/work' }, { deps: foreman }), BRIDGE_MS);
  assert.equal(limitFor('junk', { deps: foreman }), BRIDGE_MS);
  assert.equal(limitFor(null), BRIDGE_MS);
  assert.equal(limitFor(tickOf('/work'), { limitMs: 70, watchMs: 90, deps: foreman }), 90);
  assert.equal(limitFor(tickOf('/work'), { limitMs: 70, watchMs: 90, deps: { env: {} } }), 70);
  // A role that can't be read is the front desk's.
  assert.equal(limitFor(tickOf('/work'), { deps: { sessionRole: () => { throw new Error('x'); } } }), BRIDGE_MS);
});

test('runBridge answers a tick as a line, and reads a foreman\'s request before its longer limit starts', () => withHome(async (home) => {
  const repo = registered(home);
  const line = await runBridge({ stdin: Readable.from([JSON.stringify(tickOf(repo))]), deps: live() });
  const parsed = JSON.parse(line);
  assert.equal(parsed.role, 'front-desk');
  assert.equal(parsed.every, TICK_MS);
  assert.equal(parsed.pane.project, P);
  // Standard input that never closes is answered at the reading limit, whatever the role.
  const open = new Readable({ read() {} });
  assert.deepEqual(JSON.parse(await runBridge({ stdin: open, limitMs: 50, watchMs: 5000, deps: live({ env: { WHEELHOUSE_ROLE: 'foreman' } }) })), { ok: false, says: 'Wheelhouse couldn\'t do that in time' });
  open.destroy();
}));
