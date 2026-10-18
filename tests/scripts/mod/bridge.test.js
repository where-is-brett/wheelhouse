// tests/scripts/mod/bridge.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handle, runBridge, MAX_REQUEST_BYTES } from '../../../scripts/mod/bridge.js';
import { makeSigningKey, enrol, verify, readEnrolled } from '../../../scripts/state/signing.js';
import { LIFT_STOP } from '../../../scripts/state/card-lines.js';
import { setStop, stopState, liftStop } from '../../../scripts/lib/stop.js';
import { keysDir, usageDir } from '../../../scripts/lib/paths.js';
import { pendingDir } from '../../../scripts/hooks/pending.js';
import { withHome, tempFolder } from '../../helpers/homes.js';

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
  assert.deepEqual(readJson(path.join(usageDir(), 'sessions', 'sess-1.json')), { session: 'sess-1', project: P, role: 'feature', work: 'login', at: NOW.toISOString() });

  // Written once: a later reading from another folder changes nothing.
  await handle({ cmd: 'usage', session: 'sess-1', cwd: folderOn('main'), usd: 2 }, deps());
  assert.equal(readJson(path.join(usageDir(), 'sessions', 'sess-1.json')).role, 'feature');
  assert.equal(readLines(path.join(usageDir(), 'mod', '2026-10-19.jsonl')).length, 2);

  // Not on a feature branch: the front desk. The foreman is the session start's to record.
  await handle({ cmd: 'usage', session: 'sess-2', cwd: folderOn('main') }, deps());
  assert.deepEqual(readJson(path.join(usageDir(), 'sessions', 'sess-2.json')), { session: 'sess-2', project: P, role: 'front-desk', at: NOW.toISOString() });

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
