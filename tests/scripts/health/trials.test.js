// tests/scripts/health/trials.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runTrials, ghPaths, trialClients, MERGE_WAIT_MS, TRIAL_MARKER } from '../../../scripts/health/trials.js';
import { fetchedPath } from '../../../scripts/lib/host-tools.js';
import { TRIAL_LINE, parseTrialLine } from '../../../scripts/lib/trial-lines.js';
import { tempFolder } from '../../helpers/homes.js';

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
  ]);
  for (const l of lines) assert.match(l, LINE);
  for (const l of lines) assert.match(l, TRIAL_LINE);
});

test('parseTrialLine reads a trial line into its three parts, and nothing else', () => {
  assert.deepEqual(parseTrialLine('read .env.local: refused / refused'), { name: 'read .env.local', expected: 'refused', result: 'refused' });
  assert.deepEqual(parseTrialLine('merge with forged approval: refused / MERGED (unexpected)'), { name: 'merge with forged approval', expected: 'refused', result: 'MERGED (unexpected)' });
  for (const bad of ['', 'read .env.local refused / refused', 'x: y / z; rm -rf /', 'x: y / $(z)', 7, null, `${'a'.repeat(200)}: refused / refused`]) {
    assert.equal(parseTrialLine(bad), null, String(bad));
  }
});

test('no line or note contains a value', async () => {
  const lines = await runTrials(fakes());
  for (const l of [...lines, ...lines.notes]) {
    assert.ok(!l.includes(SECRET), l);
    assert.ok(!l.includes('file contents'), l);
  }
});

// STOP is tried by setup's step 10 in the helper, with the real stop guard (ruling R41), and the
// director does nothing at step 10 (design section 15): no trial asks for them.
test('no line or note asks for the director, and STOP is left to step 10', async () => {
  for (const over of [{}, { pr: undefined }, { project: '' }, { expectNetwork: 'maybe' }]) {
    const lines = await runTrials(fakes(over));
    for (const l of [...lines, ...lines.notes]) assert.doesNotMatch(l, /needs the director|ask the director/i, l);
    assert.ok(!lines.some((l) => l.startsWith('stop')), JSON.stringify(over));
  }
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

test('the gh trial tries only the paths it is given', async () => {
  const f = fakes({ ghPaths: ['/given/gh'], fs: { ...fakes().fs, existsSync: (p) => p === '/given/gh' } });
  await runTrials(f);
  const gh = f.calls.spawn.filter(([file]) => file !== 'curl');
  assert.deepEqual(gh.map(([file]) => file), ['/given/gh']);
  const none = fakes({ ghPaths: ['/given/gh'] });
  await runTrials(none);
  assert.deepEqual(none.calls.spawn.filter(([file]) => file !== 'curl').map(([file]) => file), ['gh'], 'none of the given paths exists, so gh by its bare name');
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
  assert.equal(bad[2], 'reach github.com: not reached / could not run');
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
  const lines = await runTrials(fakes({
    fs: { ...fakes().fs, existsSync: () => false },
    spawn: (file) => (file === 'curl' ? { status: 0, stdout: '000' } : { status: null, error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }),
  }));
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
  assert.equal(lines.length, 7);
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

// Check 31's first change: at Locked the director's real approval was on record, so the gate
// refused on the lock, CI and review instead, and the pull request stayed open. Any refusal that
// leaves the pull request unmerged counts.
test('the merge trial passes on any refusal that leaves the pull request unmerged', async () => {
  for (const refused of ['CI has not passed', 'no review yet', 'the lock is held', 'All stop is on', '']) {
    const f = fakes();
    f.client.merge = async () => ({ ok: false, refused, reasons: [refused] });
    const lines = await runTrials(f);
    assert.equal(lines[6], 'merge with forged approval: refused / refused', refused);
  }
  // A refusal that says it merged after all is no pass.
  const f = fakes();
  f.client.merge = async () => ({ ok: false, merged: true, refused: 'odd' });
  assert.equal((await runTrials(f))[6], 'merge with forged approval: refused / MERGED (unexpected)');
});

test('a merge answer that is no refusal at all is not a pass', async () => {
  for (const answer of [undefined, null, {}, { ok: true, merged: false }, { ok: 'false' }]) {
    const f = fakes();
    f.client.merge = async () => answer;
    assert.equal((await runTrials(f))[6], 'merge with forged approval: refused / could not run', JSON.stringify(answer));
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

test('bad --pr or --project gives could not run, with a note', async () => {
  for (const over of [{ pr: undefined }, { pr: '0' }, { pr: '-3' }, { pr: 'abc' }, { pr: '7.5' }, { project: '' }, { project: '--pr' }, { project: undefined }]) {
    const f = fakes(over);
    const lines = await runTrials(f);
    assert.equal(lines[5], 'forged approval recorded: refused / could not run', JSON.stringify(over));
    assert.equal(lines[6], 'merge with forged approval: refused / could not run', JSON.stringify(over));
    assert.equal(f.calls.merge.length, 0);
    assert.ok(lines.notes.some((n) => /--pr/.test(n)));
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

// ---- Check 31's changes (ruling R41) ----

test('the gh setup fetched into Wheelhouse\'s tools folder is among the places looked', async () => {
  const fetched = fetchedPath('gh');
  assert.ok(ghPaths().includes(fetched));
  assert.ok(ghPaths().includes('/opt/homebrew/bin/gh'));
  const f = fakes();
  f.fs.existsSync = (p) => p === fetched;
  const lines = await runTrials(f);
  assert.deepEqual(f.calls.spawn.find(([x]) => x !== 'curl'), [fetched, ['auth', 'status']]);
  assert.equal(lines[3], 'run gh: refused / refused');
});

// The sandbox hides ~/.wheelhouse, so the copy there can't even be seen: that is a refusal, not
// "not installed", or the board would never be green (pre-flight, row 7 vs 8 / 12).
test('a gh in the tools folder the sandbox hides is refused, not missing', async () => {
  const fetched = fetchedPath('gh');
  const f = fakes();
  f.fs.existsSync = () => false;
  f.fs.statSync = (p) => { throw p === fetched ? denied() : missing(); };
  const lines = await runTrials(f);
  assert.equal(lines[3], 'run gh: refused / refused');
  assert.equal(f.calls.spawn.filter(([x]) => x !== 'curl').length, 0);
});

// Check 31: the first merge request fills the helper's mirror, which took longer than 3 seconds.
test('the merge is asked through a client that waits for a first merge to fill the mirror', async () => {
  assert.ok(MERGE_WAIT_MS >= 30 * 1000 && MERGE_WAIT_MS <= 60 * 1000);
  const made = [];
  const clients = trialClients((options) => { made.push(options); return { options }; });
  assert.equal(clients.client.options.timeout, 3000);
  assert.equal(clients.mergeClient.options.timeout, MERGE_WAIT_MS);
  const f = fakes();
  const asked = [];
  f.mergeClient = { merge: async (a) => { asked.push(a); return { ok: false, refused: 'not merged' }; } };
  const lines = await runTrials(f);
  assert.equal(asked.length, 1);
  assert.equal(f.calls.merge.length, 0);
  assert.equal(lines[6], 'merge with forged approval: refused / refused');
});

// Check 31: the dry run's .env.local trial left the file behind. On a real folder, with the
// read refused as the sandbox refuses it, and with the read failing some other way, the file
// the trial made is gone afterwards: its removal is in a `finally`, so a read that throws
// still removes it.
test('the .env trial leaves no file behind', async () => {
  for (const readError of [denied, () => new Error('odd')]) {
    const cwd = tempFolder('wh-trial-env-');
    const fsWithDeniedRead = { ...fs, readFileSync: (p, ...rest) => (p.endsWith('.env.local') ? (() => { throw readError(); })() : fs.readFileSync(p, ...rest)) };
    const lines = await runTrials({ ...fakes(), cwd, fs: fsWithDeniedRead });
    assert.equal(lines[0], `read .env.local: refused / ${readError === denied ? 'refused' : 'could not run'}`);
    assert.equal(fs.existsSync(path.join(cwd, '.env.local')), false);
    assert.deepEqual(fs.readdirSync(cwd), []);
  }
});

test('a trial .env.local that can\'t be removed is named in a note, and holds only the marker', async () => {
  const f = fakes();
  const kept = [];
  f.fs.writeFileSync = (p, d, o) => { kept.push([p, d]); f.written.push(p); };
  f.fs.rmSync = () => { throw denied(); };
  const lines = await runTrials(f);
  assert.equal(lines[0], 'read .env.local: refused / refused');
  assert.deepEqual(kept.find(([p]) => p === ENV_LOCAL), [ENV_LOCAL, TRIAL_MARKER]);
  assert.ok(lines.notes.some((n) => /\.env\.local/.test(n) && /health check removes it/.test(n)));
  for (const n of lines.notes) assert.ok(!n.includes(SECRET));
});

// Ruling R68: the trial pull request is open while the session's trials run, so a refusal for
// its not being open shows nothing of the gate.
test('a merge refused only because the pull request isn\'t open is no pass', async () => {
  const f = fakes();
  f.client.merge = async () => ({ ok: false, refused: 'pull request 7 is not open', reasons: ['pull request 7 is not open'] });
  const lines = await runTrials(f);
  assert.equal(lines[6], 'merge with forged approval: refused / could not run');
  assert.ok(lines.notes.some((n) => /open/.test(n) && /step 10/.test(n)));
});

// gh found where setup finds it: the known places, the tools folder, then by its bare name on the
// path, as toolPath runs it and step 2 accepted it (tools.js, onPath).
test('a gh only on the path is run by its bare name, and only a missing one is not installed', async () => {
  const f = fakes();
  f.fs.existsSync = () => false;
  f.fs.statSync = () => { throw missing(); };
  f.spawn = (file, args) => { f.calls.spawn.push([file, args]); return file === 'curl' ? { status: 0, stdout: '000' } : { status: 1, stderr: 'You are not logged into any GitHub hosts.' }; };
  const lines = await runTrials(f);
  assert.deepEqual(f.calls.spawn.find(([x]) => x !== 'curl'), ['gh', ['auth', 'status']]);
  assert.equal(lines[3], 'run gh: refused / refused');
  const gone = fakes();
  gone.fs.existsSync = () => false;
  gone.spawn = (file) => (file === 'curl' ? { status: 0, stdout: '000' } : { status: null, error: Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }) });
  assert.equal((await runTrials(gone))[3], 'run gh: refused / not installed');
  const open = fakes();
  open.fs.existsSync = () => false;
  open.spawn = (file) => (file === 'curl' ? { status: 0, stdout: '000' } : { status: 0, stdout: 'Logged in' });
  assert.equal((await runTrials(open))[3], 'run gh: refused / allowed');
});
