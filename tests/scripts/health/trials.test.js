// tests/scripts/health/trials.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runTrials } from '../../../scripts/health/trials.js';

// The fakes' project folder, spelled as path.join spells it on this system.
const SCRATCH = path.join('/scratch');
const ENV_LOCAL = path.join('/scratch', '.env.local');

const SECRET = 'sk-live-SECRET-VALUE-123';
const denied = () => { const e = new Error(`EPERM: ${SECRET}`); e.code = 'EPERM'; return e; };
const missing = () => { const e = new Error(`ENOENT: ${SECRET}`); e.code = 'ENOENT'; return e; };

function fakes(over = {}) {
  const written = [];
  const removed = [];
  const existing = new Set();
  const calls = { record: [], merge: [], spawn: [] };
  const base = {
    written,
    removed,
    existing,
    calls,
    cwd: '/scratch',
    home: '/home/d',
    pr: '7',
    project: 'o__r',
    fs: {
      readFileSync: (p) => {
        if (p.endsWith('.env.local')) throw denied();
        return `file contents ${SECRET}`;
      },
      readdirSync: () => { throw denied(); },
      writeFileSync: (p, d, o) => { written.push(p); if (o?.flag === 'wx' && existing.has(p)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); },
      existsSync: (p) => p === '/opt/homebrew/bin/gh',
      rmSync: (p) => { removed.push(p); },
      mkdirSync: () => {},
    },
    spawn: (file, args) => {
      calls.spawn.push([file, args]);
      if (file === 'curl') return { status: 0, stdout: '000' };
      return { status: 1, error: Object.assign(new Error(SECRET), { code: 'EPERM' }), stdout: SECRET };
    },
    client: {
      health: async () => ({ ok: true, secret: SECRET }),
      merge: async (a) => { calls.merge.push(a); return { ok: false, refused: `no approval ${SECRET}`, reasons: ['approval missing'] }; },
      state: { record: async (a) => { calls.record.push(a); return { ok: false, refused: `bad signature ${SECRET}` }; } },
    },
  };
  return { ...base, ...over };
}

const LINE = /^[a-z0-9 .\/-]+: [a-z, ]+ \/ [A-Za-z(), ]+$/;

test('every trial prints one line in the exact format', async () => {
  const lines = await runTrials(fakes());
  assert.deepEqual([...lines], [
    'read .env.local: refused / refused',
    'read keys folder: refused / refused',
    'reach github.com: not reached / not reached',
    'run gh: refused / refused',
    'helper health: reached / reached',
    'forged approval recorded: refused / refused',
    'merge with forged approval: refused / refused',
    'stop: write refused, read allowed / needs the director',
  ]);
  for (const l of lines) assert.match(l, LINE);
});

test('no line or note contains a value', async () => {
  const lines = await runTrials(fakes());
  for (const l of [...lines, ...lines.notes]) {
    assert.ok(!l.includes(SECRET), l);
    assert.ok(!l.includes('file contents'), l);
  }
});

test('the stop note tells the director what to do', async () => {
  const lines = await runTrials(fakes());
  assert.ok(lines.notes.some((n) => /type `?stop`?/i.test(n) && /Write/.test(n) && /Read/.test(n)));
});

test('allowed results are reported as allowed, without values', async () => {
  const lines = await runTrials(fakes({
    fs: { ...fakes().fs, readFileSync: () => SECRET, readdirSync: () => [SECRET], existsSync: (p) => p === '/opt/homebrew/bin/gh' },
    spawn: (f) => (f === 'curl' ? { status: 0, stdout: '200' } : { status: 0, stdout: `Logged in as ${SECRET}` }),
  }));
  assert.equal(lines[0], 'read .env.local: refused / allowed');
  assert.equal(lines[1], 'read keys folder: refused / allowed');
  assert.equal(lines[2], 'reach github.com: not reached / reached');
  assert.equal(lines[3], 'run gh: refused / allowed');
  for (const l of lines) assert.ok(!l.includes(SECRET));
});

test('.env.local is created first and removed afterwards', async () => {
  const f = fakes();
  await runTrials(f);
  assert.ok(f.written.includes(ENV_LOCAL));
  assert.ok(f.removed.some((p) => p === ENV_LOCAL));
});

test('.env.local is removed even when the read throws something odd', async () => {
  const f = fakes();
  f.fs.readFileSync = () => { throw new Error(SECRET); };
  const lines = await runTrials(f);
  assert.equal(lines[0], 'read .env.local: refused / could not run');
  assert.ok(f.removed.includes(ENV_LOCAL));
});

test('.env.local that cannot be created gives could not run', async () => {
  const f = fakes();
  f.fs.writeFileSync = () => { throw denied(); };
  const lines = await runTrials(f);
  assert.equal(lines[0], 'read .env.local: refused / could not run');
});

test('a missing keys folder gives could not run and a note', async () => {
  const f = fakes();
  f.fs.readdirSync = () => { throw missing(); };
  const lines = await runTrials(f);
  assert.equal(lines[1], 'read keys folder: refused / could not run');
  assert.ok(lines.notes.some((n) => /setup/i.test(n)));
});

test('github.com: only 2xx and 3xx count, a proxy 403 is not reached', async () => {
  for (const [code, want] of [['200', 'reached'], ['301', 'reached'], ['403', 'not reached'], ['000', 'not reached']]) {
    const lines = await runTrials(fakes({ spawn: (f) => (f === 'curl' ? { status: 0, stdout: code } : { status: 1 }) }));
    assert.equal(lines[2], `reach github.com: not reached / ${want}`, code);
  }
});

test('github.com goes through curl', async () => {
  const f = fakes();
  await runTrials(f);
  const [file, args] = f.calls.spawn.find(([x]) => x === 'curl');
  assert.equal(file, 'curl');
  assert.ok(args.includes('%{http_code}'));
  assert.ok(args.includes('https://github.com/'));
});

test('network override accepts only the two words', async () => {
  const ok = await runTrials(fakes({ expectNetwork: 'reached' }));
  assert.equal(ok[2], 'reach github.com: reached / not reached');
  const bad = await runTrials(fakes({ expectNetwork: 'maybe' }));
  assert.equal(bad[2], 'reach github.com: not reached / needs the director');
});

test('gh runs auth status and maps results', async () => {
  const f = fakes();
  await runTrials(f);
  assert.deepEqual(f.calls.spawn.find(([x]) => x !== 'curl'), ['/opt/homebrew/bin/gh', ['auth', 'status']]);
  const run = async (out) => (await runTrials(fakes({ spawn: (x) => (x === 'curl' ? { status: 0, stdout: '000' } : out) })))[3];
  assert.equal(await run({ status: 1, stderr: 'You are not logged into any GitHub hosts.' }), 'run gh: refused / refused');
  assert.equal(await run({ status: 1, stderr: 'open /Users/x/.config/gh/hosts.yml: operation not permitted' }), 'run gh: refused / refused');
  assert.equal(await run({ status: 1, stderr: 'weird' }), 'run gh: refused / could not run');
  assert.equal(await run({ status: 0, stdout: 'Logged in' }), 'run gh: refused / allowed');
});

test('gh missing reports not installed', async () => {
  const lines = await runTrials(fakes({ fs: { ...fakes().fs, existsSync: () => false } }));
  assert.equal(lines[3], 'run gh: refused / not installed');
});

test('an unreachable helper gives could not run for health and the forged trials', async () => {
  const gone = { ok: false, refused: 'the host helper could not be reached: is it running?' };
  const lines = await runTrials(fakes({ client: { health: async () => gone, merge: async () => gone, state: { record: async () => gone } } }));
  assert.equal(lines[4], 'helper health: reached / could not run');
  assert.equal(lines[5], 'forged approval recorded: refused / could not run');
  assert.equal(lines[6], 'merge with forged approval: refused / could not run');
  assert.ok(lines.notes.length >= 1);
});

test('a throwing client gives could not run and the rest carry on', async () => {
  const boom = async () => { throw new Error(SECRET); };
  const lines = await runTrials(fakes({ client: { health: boom, merge: boom, state: { record: boom } } }));
  assert.equal(lines.length, 8);
  assert.equal(lines[4], 'helper health: reached / could not run');
  assert.equal(lines[5], 'forged approval recorded: refused / could not run');
  assert.equal(lines[6], 'merge with forged approval: refused / could not run');
  assert.equal(lines[0], 'read .env.local: refused / refused');
  for (const l of lines) assert.ok(!l.includes(SECRET));
});

test('the forgery is sent to the helper and the merge asks for approval', async () => {
  const f = fakes();
  await runTrials(f);
  assert.equal(f.calls.record.length, 1);
  assert.equal(f.calls.record[0].project, 'o__r');
  assert.equal(f.calls.record[0].event.kind, 'approval');
  assert.equal(f.calls.merge[0].approvalRequired, true);
  assert.equal(f.calls.merge[0].number, 7);
});

test('a merge refused for another reason is not a pass', async () => {
  for (const refused of ['the pull request is not open', 'CI has not passed', 'no review yet', 'the lock is held']) {
    const f = fakes();
    f.client.merge = async () => ({ ok: false, refused });
    const lines = await runTrials(f);
    assert.equal(lines[6], 'merge with forged approval: refused / could not run', refused);
  }
});

test('a refusal naming the approval in reasons is a pass', async () => {
  const f = fakes();
  f.client.merge = async () => ({ ok: false, refused: 'not merged', reasons: ['the approval is missing'] });
  assert.equal((await runTrials(f))[6], 'merge with forged approval: refused / refused');
});

test('a merge that goes through is flagged', async () => {
  const f = fakes();
  f.client.merge = async () => ({ ok: true, merged: true });
  assert.equal((await runTrials(f))[6], 'merge with forged approval: refused / MERGED (unexpected)');
});

test('a forged approval that is recorded is flagged allowed', async () => {
  const f = fakes();
  f.client.state.record = async () => ({ ok: true });
  assert.equal((await runTrials(f))[5], 'forged approval recorded: refused / allowed');
});

test('bad --pr or --project gives needs the director', async () => {
  for (const over of [{ pr: undefined }, { pr: '0' }, { pr: '-3' }, { pr: 'abc' }, { pr: '7.5' }, { project: '' }, { project: '--pr' }, { project: undefined }]) {
    const f = fakes(over);
    const lines = await runTrials(f);
    assert.equal(lines[5], 'forged approval recorded: refused / needs the director', JSON.stringify(over));
    assert.equal(lines[6], 'merge with forged approval: refused / needs the director', JSON.stringify(over));
    assert.equal(f.calls.merge.length, 0);
  }
});

test('the scratch forged file is written inside the project and removed', async () => {
  const f = fakes();
  await runTrials(f);
  const forged = f.written.filter((p) => p.includes('forged'));
  assert.ok(forged.length >= 1);
  for (const p of f.written) assert.ok(p.startsWith(SCRATCH), p);
  assert.ok(f.removed.some((p) => p.startsWith(SCRATCH) && p.includes('trial')));
});

test('an existing .env.local is never written to or removed', async () => {
  const f = fakes();
  f.existing.add(ENV_LOCAL);
  const lines = await runTrials(f);
  assert.equal(lines[0], 'read .env.local: refused / refused');
  assert.ok(!f.removed.includes(ENV_LOCAL));
  assert.ok(f.written.filter((p) => p === ENV_LOCAL).length <= 1); // only the refused wx attempt
});
