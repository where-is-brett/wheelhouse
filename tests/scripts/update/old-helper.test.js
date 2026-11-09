// tests/scripts/update/old-helper.test.js
// Proving an old helper is Wheelhouse's own before an update may stop it. Every program run, every kill and the clock
// are stand-ins: no real process is looked at or ended.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  RESTART_LINE, defaultCacheRoot, findByAddress, reprove, isOwnHelperCommand, pidAlive, proveRecorded, startSeconds, stopProved, waitForQuiet,
} from '../../../scripts/update/old-helper.js';

const CACHE = '/Users/dir/.claude/plugins/cache';
const SOCK = '/Users/dir/.wheelhouse/helper.sock';
const COMMAND = `/usr/local/bin/node ${CACHE}/wheelhouse/wheelhouse/0.2.6/scripts/host/helper-main.js`;
const LSTART = 'Tue Nov  4 10:00:01 2026';

const OWN_COMMAND = `/usr/local/bin/node ${CACHE}/wheelhouse/wheelhouse/0.2.7/scripts/host/helper-main.js`;
const record = (extra = {}) => ({ pid: 4242, startTime: LSTART, version: '0.2.7', root: '/x', address: SOCK, ...extra });
const recorded = (over = {}) => ({
  address: SOCK, platform: 'darwin', user: 'dir', cacheRoot: CACHE,
  ...fakeRun({ lsof: { code: 0, stdout: '4242\n' }, ps: ps('dir', OWN_COMMAND) }),
  client: { health: async () => ({ ok: true, pid: 4242, version: '0.2.7' }) },
  read: () => record(),
  startTime: async () => LSTART,
  alive: async () => true,
  ...over,
});

// A stand-in for run that answers by program name and records what it was asked.
function fakeRun(answers) {
  const calls = [];
  const options = [];
  const run = async (file, args, opts) => {
    calls.push([file, ...args]);
    options.push(opts);
    const answer = answers[file];
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(args) : answer;
  };
  return { run, calls, options };
}
// ps answers the row (user, start, command) and, asked for comm, the executable's own path.
const ps = (user, command, lstart = LSTART, comm = command.split(' ')[0]) => (args) => (args.includes('comm=') ? { code: 0, stdout: `${comm}\n` } : { code: 0, stdout: `${user} ${lstart} ${command}\n` });
const raw = (stdout) => () => ({ code: 0, stdout });
const mac = (answers, extra = {}) => findByAddress({ address: SOCK, platform: 'darwin', user: 'dir', version: '0.2.6', cacheRoot: CACHE, ...fakeRun(answers), ...extra });

test('startSeconds reads the shapes and nothing else', () => {
  assert.equal(startSeconds('Tue 4 Nov 10:00:01 2026'), startSeconds(LSTART), 'day first, as ps prints it under en_AU');
  assert.equal(startSeconds('2026-11-04T10:00:01.900Z'), startSeconds('2026-11-04T10:00:01Z'));
  assert.equal(startSeconds(LSTART), startSeconds('Tue Nov 4 10:00:01 2026'));
  assert.notEqual(startSeconds(LSTART), startSeconds('Tue Nov  4 10:00:02 2026'));
  for (const bad of [null, undefined, 5, '', 'yesterday', 'Tue Nov 31 10:00:01 2026', '2026-11-04 10:00:01', `${LSTART}; rm -rf /`, 'x'.repeat(100)]) {
    assert.equal(startSeconds(bad), null, String(bad));
  }
});

test('old helper: a record, a start time and /health that agree give the pid', async () => {
  const proof = await proveRecorded(recorded());
  assert.deepEqual(proof, { pid: 4242, startTime: LSTART, command: OWN_COMMAND });
});

test('old helper: the start time to the second, not the millisecond', async () => {
  const out = await proveRecorded(recorded({
    read: () => record(), startTime: async () => new Date(startSeconds(LSTART) * 1000 + 900).toISOString(),
  }));
  assert.equal(out.pid, 4242);
});

test('old helper: a reused pid stops nothing', async () => {
  const out = await proveRecorded(recorded({ startTime: async () => 'Tue Nov  4 11:30:00 2026' }));
  assert.equal(out.pid, undefined);
  assert.match(out.why, /reused/);
});

test('old helper: a record for a process that has gone stops nothing', async () => {
  const out = await proveRecorded(recorded({ alive: async () => false }));
  assert.equal(out.pid, undefined);
  assert.match(out.why, /gone/);
});

test('old helper: /health giving another pid stops nothing', async () => {
  for (const health of [{ ok: true, pid: 9999 }, { ok: true }, { ok: false, pid: 4242 }, null]) {
    const out = await proveRecorded(recorded({ client: { health: async () => health } }));
    assert.equal(out.pid, undefined, JSON.stringify(health));
    assert.ok(out.why);
  }
  const down = await proveRecorded(recorded({ client: { health: async () => { throw new Error('no'); } } }));
  assert.ok(down.why);
});

test('old helper: no record is told apart from a record that is not proof', async () => {
  assert.deepEqual(await proveRecorded(recorded({ read: () => null })), { why: 'no record' });
  assert.deepEqual(await proveRecorded(recorded({ read: () => { throw new Error('x'); } })), { why: 'no record' });
  assert.equal((await proveRecorded(recorded({ read: () => record({ startTime: null }) }))).why, 'not proven');
  assert.equal((await proveRecorded(recorded({ read: () => record({ startTime: 'soon' }) }))).why, 'not proven');
  for (const pid of [0, 1, -5, 1.5, '4242', null]) {
    const out = await proveRecorded(recorded({ read: () => record({ pid }) }));
    assert.equal(out.pid, undefined, String(pid));
  }
  assert.ok((await proveRecorded(recorded({ startTime: async () => null }))).why);
  assert.ok((await proveRecorded(recorded({ startTime: async () => { throw new Error('x'); } }))).why);
});

test('old helper: a recorded pid names itself only when the whole proof holds', async () => {
  const asked = [];
  await proveRecorded(recorded({ alive: async (p) => { asked.push(p); return true; } }));
  assert.deepEqual(asked, [4242]);
});

test('old helper: the one process at the address, ours, in the cache, at the reported version is found', async () => {
  const { run, calls } = fakeRun({ lsof: { code: 0, stdout: '4242\n' }, ps: ps('dir', COMMAND) });
  const out = await findByAddress({ address: SOCK, platform: 'darwin', user: 'dir', version: '0.2.6', cacheRoot: CACHE, run });
  assert.deepEqual(out, { pid: 4242, startTime: LSTART, command: COMMAND });
  assert.deepEqual(calls[0], ['lsof', '-t', '--', SOCK]);
  assert.deepEqual(calls[1], ['ps', '-o', 'user=,lstart=,command=', '-p', '4242']);
});

test('old helper: ps is asked in the C locale, and a day-first row (an en_AU Mac) is still read', async () => {
  const dayFirst = 'Tue 4 Nov 10:00:01 2026';
  const { run, calls, options } = fakeRun({ lsof: { code: 0, stdout: '4242\n' }, ps: ps('dir', COMMAND, dayFirst) });
  const out = await findByAddress({ address: SOCK, platform: 'darwin', user: 'dir', version: '0.2.6', cacheRoot: CACHE, run });
  assert.deepEqual(out, { pid: 4242, startTime: dayFirst, command: COMMAND });
  assert.equal(options[calls.findIndex((c) => c.includes('user=,lstart=,command='))]?.env?.LC_ALL, 'C');
});

test('old helper: a record written day first proves against the same process read month first', async () => {
  const proof = await proveRecorded(recorded({ read: () => record({ startTime: 'Tue  4 Nov 10:00:01 2026' }) }));
  assert.equal(proof.pid, 4242);
});

test("old helper: another user's process stops nothing", async () => {
  const out = await mac({ lsof: { code: 0, stdout: '4242\n' }, ps: ps('root', COMMAND) });
  assert.equal(out.pid, undefined);
  assert.match(out.why, /another user/);
});

test('old helper: two processes at the address stop nothing', async () => {
  const out = await mac({ lsof: { code: 0, stdout: '4242\n4243\n' }, ps: ps('dir', COMMAND) });
  assert.equal(out.pid, undefined);
  assert.match(out.why, /more than one/);
  // the same process listed twice is still one process
  assert.equal((await mac({ lsof: { code: 0, stdout: '4242\n4242\n' }, ps: ps('dir', COMMAND) })).pid, 4242);
});

test('old helper: a command outside the plugin cache stops nothing', async () => {
  for (const command of [
    '/usr/local/bin/node /tmp/wheelhouse/wheelhouse/0.2.6/scripts/host/helper-main.js',
    `/usr/local/bin/node ${CACHE}/other/wheelhouse/0.2.6/scripts/host/helper-main.js`,
    `/usr/local/bin/node ${CACHE}/wheelhouse/wheelhouse/0.2.6/scripts/host/helper-main.js --extra`,
    `/usr/local/bin/node --inspect ${CACHE}/wheelhouse/wheelhouse/0.2.6/scripts/host/helper-main.js`,
    `/usr/local/bin/python ${CACHE}/wheelhouse/wheelhouse/0.2.6/scripts/host/helper-main.js`,
    `/usr/local/bin/node ${CACHE}/wheelhouse/wheelhouse/0.2.6/scripts/host/other.js`,
    `/usr/local/bin/node /evil${CACHE}/wheelhouse/wheelhouse/0.2.6/scripts/host/helper-main.js`,
    'node',
  ]) {
    const out = await mac({ lsof: { code: 0, stdout: '4242\n' }, ps: ps('dir', command) });
    assert.equal(out.pid, undefined, command);
    assert.ok(out.why, command);
  }
});

test('old helper: a version other than the one reported stops nothing', async () => {
  const out = await mac({ lsof: { code: 0, stdout: '4242\n' }, ps: ps('dir', COMMAND.replace('0.2.6', '0.2.5')) });
  assert.equal(out.pid, undefined);
  assert.ok(out.why);
  assert.equal((await mac({ lsof: { code: 0, stdout: '4242\n' }, ps: ps('dir', COMMAND) }, { version: '0.2.5' })).pid, undefined);
  assert.equal((await mac({ lsof: { code: 0, stdout: '4242\n' }, ps: ps('dir', COMMAND) }, { version: '../..' })).pid, undefined);
  assert.equal((await mac({ lsof: { code: 0, stdout: '4242\n' }, ps: ps('dir', COMMAND) }, { version: undefined })).pid, undefined);
});

test('old helper: a home folder with spaces still reads as the cache', () => {
  const cacheRoot = '/Users/Jo Smith/.claude/plugins/cache';
  const command = `/opt/homebrew/bin/node ${cacheRoot}/wheelhouse/wheelhouse/0.2.6/scripts/host/helper-main.js`;
  assert.equal(isOwnHelperCommand(command, { cacheRoot, version: '0.2.6', platform: 'darwin', exe: '/opt/homebrew/bin/node' }), true);
});

test('old helper: odd lsof and ps output stops nothing', async () => {
  const good = ps('dir', COMMAND);
  for (const lsof of [
    { code: 0, stdout: '' }, { code: 0, stdout: 'abc\n' }, { code: 0, stdout: '4242 4243\n' }, { code: 0, stdout: '1\n' },
    { code: 0, stdout: '-9\n' }, { code: 0, stdout: '99999999999\n' }, { code: 0, stdout: undefined },
  ]) {
    const out = await mac({ lsof, ps: good });
    assert.equal(out.pid, undefined, JSON.stringify(lsof));
    assert.ok(out.why);
  }
  for (const shown of [
    raw(''), raw('dir\n'), raw(`dir yesterday ${COMMAND}\n`), raw(`dir ${LSTART} ${COMMAND}\ndir ${LSTART} ${COMMAND}\n`),
  ]) {
    const out = await mac({ lsof: { code: 0, stdout: '4242\n' }, ps: shown });
    assert.equal(out.pid, undefined, JSON.stringify(shown));
  }
  assert.ok((await mac({ lsof: new Error('no lsof'), ps: good })).why);
  assert.ok((await mac({ lsof: { code: 0, stdout: '4242\n' }, ps: new Error('no ps') })).why);
});

test('old helper: a hostile address is never passed to a program', async () => {
  const { run, calls } = fakeRun({ lsof: { code: 0, stdout: '4242\n' } });
  for (const address of ['', '/a\n/b', '/a\0b', undefined, 5]) {
    const out = await findByAddress({ address, platform: 'darwin', user: 'dir', version: '0.2.6', cacheRoot: CACHE, run });
    assert.ok(out.why);
  }
  assert.equal(calls.length, 0);
});

const WIN_CACHE = 'C:\\Users\\dir\\.claude\\plugins\\cache';
const WIN_START = '2026-11-04T10:00:01.000Z';
const WIN_EXE = 'C:\\Program Files\\nodejs\\node.exe';
const WIN_COMMAND = `"${WIN_EXE}" ${WIN_CACHE}\\wheelhouse\\wheelhouse\\0.2.6\\scripts\\host\\helper-main.js`;
const winFind = (answers) => findByAddress({ address: '\\\\.\\pipe\\wheelhouse-dir-helper', platform: 'win32', user: 'dir', version: '0.2.6', cacheRoot: WIN_CACHE, ...fakeRun(answers) });

test('old helper: Windows finds the pipe server and checks its owner and command', async () => {
  const answers = { 'powershell.exe': (args) => (args.at(-1).includes('GetNamedPipeServerProcessId') ? { code: 0, stdout: '5150\r\n' } : { code: 0, stdout: `PC\\Dir\t${WIN_START}\t${WIN_EXE}\t${WIN_COMMAND}\r\n` }) };
  assert.deepEqual(await winFind(answers), { pid: 5150, startTime: WIN_START, command: WIN_COMMAND });
  const other = { 'powershell.exe': (args) => (args.at(-1).includes('GetNamedPipeServerProcessId') ? { code: 0, stdout: '5150\n' } : { code: 0, stdout: `PC\\Someone\t${WIN_START}\t${WIN_EXE}\t${WIN_COMMAND}\n` }) };
  assert.match((await winFind(other)).why, /another user/);
});

test('old helper: Windows not told gives the restart line', async () => {
  for (const answers of [
    { 'powershell.exe': { code: 3, stdout: '' } }, // constrained language
    { 'powershell.exe': new Error('refused') },
    { 'powershell.exe': { code: 0, stdout: 'not a number\n' } },
    { 'powershell.exe': { code: 0, stdout: '5150\n5151\n' } },
  ]) {
    assert.deepEqual(await winFind(answers), { why: 'not told' });
  }
  assert.match(RESTART_LINE, /restarts, or when you sign out and in/);
});

test('old helper: a Windows command outside the cache stops nothing', async () => {
  const bad = WIN_COMMAND.replace('.claude', 'elsewhere');
  const answers = { 'powershell.exe': (args) => (args.at(-1).includes('GetNamedPipeServerProcessId') ? { code: 0, stdout: '5150\n' } : { code: 0, stdout: `PC\\dir\t${WIN_START}\t${WIN_EXE}\t${bad}\n` }) };
  assert.equal((await winFind(answers)).pid, undefined);
});

const proofOf = (pid) => ({ pid, startTime: LSTART, command: COMMAND });
const same = async (proof) => ({ ...proof });

test('old helper: stopProved sends the polite stop on macOS and waits for quiet', async () => {
  const sent = [];
  const out = await stopProved({ proof: proofOf(4242), reprove: same, platform: 'darwin', kill: (p, s) => sent.push([p, s]), wait: async () => true });
  assert.deepEqual(out, { stopped: true });
  assert.deepEqual(sent, [[4242, 'SIGTERM']]);
});

test('old helper: stopProved ends the process by number on Windows', async () => {
  const sent = [];
  await stopProved({ proof: proofOf(5150), reprove: same, platform: 'win32', kill: (...a) => sent.push(a), wait: async () => true });
  assert.deepEqual(sent, [[5150]]);
});

test('old helper: a stop that leaves the address answering says so', async () => {
  const out = await stopProved({ proof: proofOf(4242), reprove: same, platform: 'darwin', kill: () => {}, wait: async () => false });
  assert.ok(out.why);
  assert.equal(out.stopped, undefined);
});

test('old helper: a refused stop is a why, a process already gone is not', async () => {
  const refused = Object.assign(new Error('x'), { code: 'EPERM' });
  assert.ok((await stopProved({ proof: proofOf(4242), reprove: same, platform: 'darwin', kill: () => { throw refused; }, wait: async () => true })).why);
  const gone = Object.assign(new Error('x'), { code: 'ESRCH' });
  assert.deepEqual(await stopProved({ proof: proofOf(4242), reprove: same, platform: 'darwin', kill: () => { throw gone; }, wait: async () => true }), { stopped: true });
});

test('old helper: stopProved never ends this process, pid 0, 1 or a non-number', async () => {
  for (const pid of [process.pid, 0, 1, -1, 2.5, '4242', null, undefined, NaN]) {
    let called = false;
    const out = await stopProved({ proof: proofOf(pid), reprove: same, platform: 'darwin', kill: () => { called = true; }, wait: async () => true });
    assert.ok(out.why, String(pid));
    assert.equal(called, false, String(pid));
  }
});

test('old helper: waitForQuiet polls on a clock of its own and gives up at the bound', async () => {
  let t = 0;
  const sleeps = [];
  const quiet = await waitForQuiet({
    client: { health: async () => (t >= 500 ? Promise.reject(new Error('down')) : { ok: true }) },
    now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, timeoutMs: 5000, everyMs: 250,
  });
  assert.equal(quiet, true);
  assert.equal(sleeps.length, 2);
  t = 0;
  const stuck = await waitForQuiet({ client: { health: async () => ({ ok: true }) }, now: () => t, sleep: async (ms) => { t += ms; }, timeoutMs: 1000, everyMs: 250 });
  assert.equal(stuck, false);
  assert.equal(t, 1000);
});

test('old helper: pidAlive treats a signal that is refused for permission as alive', () => {
  assert.equal(pidAlive(4242, { kill: () => {} }), true);
  assert.equal(pidAlive(4242, { kill: () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); } }), true);
  assert.equal(pidAlive(4242, { kill: () => { throw Object.assign(new Error('x'), { code: 'ESRCH' }); } }), false);
  assert.equal(pidAlive(0, { kill: () => {} }), false);
});

test('old helper: the cache folder sits under the home folder', () => {
  assert.equal(defaultCacheRoot({ home: '/h', env: {} }), '/h/.claude/plugins/cache');
  assert.equal(defaultCacheRoot({ home: '/h', env: { CLAUDE_CONFIG_DIR: '/elsewhere/claude' } }), '/elsewhere/claude/plugins/cache', 'CLAUDE_CONFIG_DIR is honoured');
  assert.equal(defaultCacheRoot({ home: '/h', env: { CLAUDE_CONFIG_DIR: '' } }), '/h/.claude/plugins/cache');
});

test('old helper: the file never ends a process by name', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../../../scripts/update/old-helper.js', import.meta.url)), 'utf8');
  for (const banned of [/pkill/i, /killall/i, /taskkill\s+\/IM/i, /pgrep/i, /Stop-Process\s+-Name/i, /-IM\b/]) {
    assert.doesNotMatch(source, banned);
  }
});

test('old helper: a pid reused while the card waits stops nothing', async () => {
  let called = false;
  const kill = () => { called = true; };
  for (const now of [
    { pid: 4242, startTime: 'Tue Nov  4 12:00:00 2026', command: COMMAND },
    { pid: 4242, startTime: LSTART, command: '/usr/bin/vim /tmp/x' },
    { why: 'nothing at the address' },
    null,
  ]) {
    const out = await stopProved({ proof: proofOf(4242), reprove: async () => now, platform: 'darwin', kill, wait: async () => true });
    assert.ok(out.why, JSON.stringify(now));
  }
  const thrown = await stopProved({ proof: proofOf(4242), reprove: async () => { throw new Error('x'); }, platform: 'darwin', kill, wait: async () => true });
  assert.ok(thrown.why);
  assert.equal(called, false);
});

test('old helper: a planted record and a fake /health stop nothing', async () => {
  // The record and /health agree on pid 4242, but the operating system says the process at the address is another.
  for (const lsof of [{ code: 0, stdout: '777\n' }, { code: 0, stdout: '' }, { code: 0, stdout: '4242\n777\n' }]) {
    const out = await proveRecorded(recorded({ run: fakeRun({ lsof, ps: ps('dir', OWN_COMMAND) }).run }));
    assert.equal(out.pid, undefined, JSON.stringify(lsof));
    assert.ok(out.why);
  }
  // The address is held by the recorded pid, but it is not Wheelhouse's helper, or not this user's, or another version.
  for (const row of [ps('dir', '/usr/bin/vim /tmp/node x'), ps('root', OWN_COMMAND), ps('dir', OWN_COMMAND.replace('0.2.7', '0.2.6'))]) {
    const out = await proveRecorded(recorded({ run: fakeRun({ lsof: { code: 0, stdout: '4242\n' }, ps: row }).run }));
    assert.equal(out.pid, undefined);
  }
  // The same on Windows, where the pipe's server is asked for.
  const win = (pipePid) => recorded({
    platform: 'win32', address: '\\\\.\\pipe\\wheelhouse-dir-helper', cacheRoot: WIN_CACHE,
    run: fakeRun({ 'powershell.exe': (args) => (args.at(-1).includes('GetNamedPipeServerProcessId') ? { code: 0, stdout: `${pipePid}\n` } : { code: 0, stdout: `PC\\dir\t2026-11-04T10:00:01.000Z\t${WIN_EXE}\t"${WIN_EXE}" ${WIN_CACHE}\\wheelhouse\\wheelhouse\\0.2.7\\scripts\\host\\helper-main.js\n` }) }).run,
    read: () => record({ startTime: '2026-11-04T10:00:01.000Z' }), startTime: async () => '2026-11-04T10:00:01.000Z',
  });
  assert.equal((await proveRecorded(win(777))).pid, undefined);
  assert.equal((await proveRecorded(win(4242))).pid, 4242);
});

test('old helper: the command is parsed as the node program and the helper script, nothing else', () => {
  const ok = { cacheRoot: CACHE, version: '0.2.6', platform: 'darwin' };
  const script = `${CACHE}/wheelhouse/wheelhouse/0.2.6/scripts/host/helper-main.js`;
  assert.equal(isOwnHelperCommand(`/usr/local/bin/node ${script}`, { ...ok, exe: '/usr/local/bin/node' }), true);
  assert.equal(isOwnHelperCommand(`/usr/bin/vim /tmp/node ${script}`, { ...ok, exe: '/usr/bin/vim' }), false);
  assert.equal(isOwnHelperCommand(`vim /tmp/node ${script}`, { ...ok, exe: 'vim' }), false);
  assert.equal(isOwnHelperCommand(`/usr/local/bin/node ${script}`, { ...ok, exe: '/usr/bin/vim' }), false);
  const w = { cacheRoot: WIN_CACHE, version: '0.2.6', platform: 'win32' };
  const wscript = `${WIN_CACHE}\\wheelhouse\\wheelhouse\\0.2.6\\scripts\\host\\helper-main.js`;
  assert.equal(isOwnHelperCommand(`"C:\\a\\node.exe" ${wscript}`, { ...w, exe: 'C:\\a\\node.exe' }), true);
  assert.equal(isOwnHelperCommand(`X.exe C:\\a\\node.exe ${wscript}`, { ...w, exe: 'X.exe' }), false);
  assert.equal(isOwnHelperCommand(`"X.exe" C:\\a\\node.exe ${wscript}`, { ...w, exe: 'X.exe' }), false);
});

test('old helper: reprove looks at the address again', async () => {
  const same = await reprove({ address: SOCK, platform: 'darwin', user: 'dir', version: '0.2.6', cacheRoot: CACHE, ...fakeRun({ lsof: { code: 0, stdout: '4242\n' }, ps: ps('dir', COMMAND) }) });
  assert.deepEqual(same, { pid: 4242, startTime: LSTART, command: COMMAND });
});
