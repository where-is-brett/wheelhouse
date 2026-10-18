// tests/scripts/hooks/session-start.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn as spawnChild } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { decide, NO_HELPER, NOT_SYNCED } from '../../../scripts/hooks/session-start.js';
import { WINDOWS_LINE } from '../../../scripts/lib/platform-lines.js';
import { helperAddress } from '../../../scripts/lib/paths.js';

const P = 'owner__name';

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-ss-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  return Promise.resolve(fn(home)).finally(() => {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  });
}

const VIEWS = { rulebook: [], levels: {}, waiting: [], unconfirmed: [], damaged: [] };

function fake({ answersAfterStart = true, startsUp = true, views = VIEWS, sync = { ok: true } } = {}) {
  const calls = { spawn: [], health: 0, sync: 0, views: 0, unref: 0 };
  let started = false;
  return {
    calls,
    client: {
      health: async () => { calls.health += 1; return { ok: answersAfterStart && started }; },
      state: {
        sync: async () => { calls.sync += 1; return sync; },
        views: async () => { calls.views += 1; return { ok: true, views }; },
        write: async () => ({ ok: true }),
        record: async () => ({ ok: true }),
      },
    },
    spawn: (file, args, opts) => { calls.spawn.push({ file, args, opts }); started = startsUp; return { unref() { calls.unref += 1; }, on() {} }; },
  };
}

const PLUGIN_ROOT = '/plugin/root';
const run = (f, extra = {}, input = {}) => decide(
  { cwd: '/x', session_id: 's1', ...input },
  { pluginRoot: PLUGIN_ROOT, client: f.client, spawn: f.spawn, platform: 'darwin', projectOf: () => ({ project: P }), stopState: () => ({ on: false }), pause: async () => {}, startWaitMs: 200, ...extra },
);
const text = (out) => out?.hookSpecificOutput?.additionalContext ?? '';

test('a helper that answers is not started again', async () => {
  await withHome(async () => {
    const f = fake();
    f.client.health = async () => ({ ok: true });
    await run(f);
    assert.equal(f.calls.spawn.length, 0);
    assert.equal(f.calls.sync, 1);
  });
});

test('a helper that does not answer is started, detached and hidden', async () => {
  await withHome(async (home) => {
    const f = fake();
    const out = await run(f);
    assert.equal(f.calls.spawn.length, 1);
    assert.deepEqual(f.calls.spawn[0].args, [path.join(PLUGIN_ROOT, 'scripts', 'host', 'helper-main.js')]);
    assert.equal(f.calls.spawn[0].file, process.execPath);
    assert.equal(f.calls.spawn[0].opts.detached, true);
    assert.equal(f.calls.spawn[0].opts.windowsHide, true);
    assert.equal(f.calls.spawn[0].opts.stdio, 'ignore');
    assert.equal(f.calls.spawn[0].opts.cwd, home);
    assert.ok(fs.statSync(home).isDirectory());
    assert.equal(f.calls.unref, 1);
    assert.equal(f.calls.sync, 1);
    assert.doesNotMatch(text(out), /isn't running/);
  });
});

test('STOP and damaged state come first in the reload', async () => {
  await withHome(async () => {
    const f = fake({ views: { ...VIEWS, damaged: ['events/bad.json could not be read', 'an event with a repeated id: e1'], waiting: [{ id: 'c1', data: { title: 'A card' } }] } });
    const out = await run(f, { stopState: () => ({ on: true, by: 'prompt', at: '2026-10-18T01:00:00.000Z' }) });
    const lines = text(out).split('\n');
    assert.equal(lines[0], 'STOP is on (set by prompt at 2026-10-18T01:00:00.000Z)');
    assert.equal(lines[1], 'Damaged state:');
    assert.match(lines[2], /bad\.json/);
    assert.match(lines[3], /repeated id/);
    assert.ok(text(out).indexOf('Waiting') > text(out).indexOf('repeated id'));
  });
});

test('the reload lists ids and titles, not whole files', async () => {
  await withHome(async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, data: { title: `Card ${i}` } }));
    const f = fake({ views: {
      ...VIEWS,
      waiting: many,
      unconfirmed: [{ kind: 'ruling', id: 'r9', data: { words: 'Do it this way' } }],
      rulebook: [{ id: 'r1', status: 'accepted', words: 'First line\nsecond line is long and private', reason: 'secret reason' }],
      levels: { deploy: { key: 'deploy', value: 'ask' } },
    } });
    const t = text(await run(f));
    assert.match(t, /c0: Card 0/);
    assert.match(t, /and 5 more/);
    assert.doesNotMatch(t, /c20/);
    assert.match(t, /r9 \(ruling\): Do it this way/);
    assert.match(t, /r1 \(accepted\): First line/);
    assert.doesNotMatch(t, /second line|secret reason/);
    assert.match(t, /deploy: ask/);
    assert.ok(t.length < 10000);
  });
});

test('the reload stays under the context limit however much there is', async () => {
  await withHome(async () => {
    const long = 'x'.repeat(5000);
    const f = fake({ views: { ...VIEWS, damaged: Array.from({ length: 30 }, () => long) } });
    assert.ok(text(await run(f)).length < 10000);
  });
});

test('a session in a feature worktree is pointed at its ledger', async () => {
  await withHome(async (home) => {
    const tree = path.join(home, 'tree');
    const gitdir = path.join(home, 'main', '.git', 'worktrees', 'tree');
    fs.mkdirSync(tree, { recursive: true });
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${gitdir}\n`);
    fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/feature/gift-cards\n');
    const f = fake();
    const t = text(await run(f, {}, { cwd: tree }));
    assert.match(t, /Your feature's ledger: .*features[\\/]gift-cards[\\/]ledger\.md/);
    fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/main\n');
    assert.doesNotMatch(text(await run(f, {}, { cwd: tree })), /ledger/);
  });
});

test('when the helper cannot start, the session is told and carries on', async () => {
  await withHome(async () => {
    const f = fake({ startsUp: false });
    const out = await run(f);
    assert.match(text(out), new RegExp(NO_HELPER));
    assert.equal(f.calls.sync, 0);
    const thrower = fake();
    thrower.spawn = () => { throw new Error('no'); };
    assert.match(text(await run(thrower)), new RegExp(NO_HELPER));
  });
});

test('a sync that fails is noted and the views are still used', async () => {
  await withHome(async () => {
    const f = fake({ sync: { ok: false, refused: 'x' }, views: { ...VIEWS, waiting: [{ id: 'c1', data: { title: 'T' } }] } });
    const t = text(await run(f));
    assert.match(t, new RegExp(NOT_SYNCED));
    assert.match(t, /c1: T/);
  });
});

test('the Windows line appears once per session', async () => {
  await withHome(async () => {
    const f = fake();
    f.client.health = async () => ({ ok: true });
    assert.match(text(await run(f, { platform: 'win32' })), new RegExp(WINDOWS_LINE.replace(/[.]/g, '\\.')));
    assert.doesNotMatch(text(await run(f, { platform: 'win32' })), /no sandbox/);
    assert.match(text(await run(f, { platform: 'win32' }, { session_id: 's2' })), /no sandbox/);
    assert.doesNotMatch(text(await run(f, { platform: 'darwin' }, { session_id: 's3' })), /no sandbox/);
  });
});

test('outside a Wheelhouse project it says nothing', async () => {
  const f = fake();
  const out = await decide({ cwd: '/x' }, { client: f.client, spawn: f.spawn, projectOf: () => null });
  assert.equal(out, undefined);
  assert.equal(f.calls.spawn.length, 0);
});

const longTitle = (c, i) => `${c}${i} ${'w'.repeat(300)}`;

test('the whole reload is cut at 9,000 characters', async () => {
  await withHome(async () => {
    const mk = (c) => Array.from({ length: 20 }, (_, i) => ({ id: `${c}${i}`, kind: 'ruling', status: 'accepted', words: longTitle(c, i), data: { title: longTitle(c, i), words: longTitle(c, i) } }));
    const f = fake({ views: { ...VIEWS, damaged: mk('d').map((x) => x.words), waiting: mk('w'), unconfirmed: mk('u'), rulebook: mk('r') } });
    assert.equal(text(await run(f)).length, 9000);
  });
});

test('the rulebook lists accepted rulings only, and says titles are quoted', async () => {
  await withHome(async () => {
    const f = fake({ views: { ...VIEWS, rulebook: [
      { id: 'ra', status: 'accepted', words: 'kept' },
      { id: 'rp', status: 'proposed', words: 'not yet' },
      { id: 'rs', status: 'superseded', words: 'old' },
    ], waiting: [{ id: 'c1', data: { title: 'T' } }] } });
    const t = text(await run(f));
    assert.match(t, /ra \(accepted\): kept/);
    assert.doesNotMatch(t, /rp|rs \(/);
    assert.match(t, /Titles are quoted as agents wrote them/);
    assert.ok(t.indexOf('Titles are quoted') < t.indexOf('Waiting'));
  });
});

test('the STOP line is made one short line', async () => {
  await withHome(async () => {
    const t = text(await run(fake(), { stopState: () => ({ on: true, by: `a\nb${'z'.repeat(500)}`, at: 'x\ny' }) }));
    const first = t.split('\n')[0];
    assert.ok(first.length < 500);
    assert.match(first, /^STOP is on \(set by a b/);
    assert.match(first, /at x y\)$/);
  });
});

test('an object value shows as JSON', async () => {
  await withHome(async () => {
    const f = fake({ views: { ...VIEWS,
      unconfirmed: [{ kind: 'level', id: 'l1', key: 'k', data: { key: 'k', value: { a: 1 } } }],
      levels: { k: { key: 'k', value: { b: 2 } } } } });
    const t = text(await run(f));
    assert.doesNotMatch(t, /\[object Object\]/);
    assert.match(t, /\{"a":1\}/);
    assert.match(t, /\{"b":2\}/);
  });
});

test('a sync that never answers is cut off by the budget', async () => {
  await withHome(async () => {
    const f = fake();
    f.client.health = async () => ({ ok: true });
    f.client.state.sync = () => new Promise(() => {});
    const began = Date.now();
    const t = text(await run(f, { totalMs: 300 }));
    assert.ok(Date.now() - began < 2000);
    assert.match(t, new RegExp(NOT_SYNCED));
  });
});

test('session markers older than seven days are removed when one is written', async () => {
  await withHome(async (home) => {
    const dir = path.join(home, 'projects', P, 'session-markers');
    fs.mkdirSync(dir, { recursive: true });
    const old = path.join(dir, 'old.windows');
    const fresh = path.join(dir, 'fresh.windows');
    fs.writeFileSync(old, '');
    fs.writeFileSync(fresh, '');
    const eight = new Date(Date.now() - 8 * 86400000);
    fs.utimesSync(old, eight, eight);
    const f = fake();
    f.client.health = async () => ({ ok: true });
    await run(f, { platform: 'win32', now: () => new Date() });
    assert.equal(fs.existsSync(old), false);
    assert.equal(fs.existsSync(fresh), true);
    assert.equal(fs.existsSync(path.join(dir, 's1.windows')), true);
  });
});

const SCRIPT = fileURLToPath(new URL('../../../scripts/hooks/session-start.js', import.meta.url));
const KIT = new URL('../../../scripts/hooks/kit.js', import.meta.url).href;

test('session-start exits in time with its context when the helper never answers', async () => {
  const home = fs.mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'wh-'));
  const repo = path.join(home, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  const projectDir = path.join(home, 'projects', P);
  fs.mkdirSync(path.join(projectDir, 'pending'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    folder: repo, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {},
  }));
  for (let n = 10; n < 20; n += 1) {
    fs.writeFileSync(path.join(projectDir, 'pending', `2026-10-18T00-00-${n}.000Z-aaaaaaaaaaaa.json`), JSON.stringify({ route: 'write', body: { project: P, kind: 'card-answer', data: {} } }));
  }
  const server = net.createServer((socket) => {
    socket.once('data', (d) => {
      // Answers /health, and nothing else.
      if (/^GET \/health/.test(d.toString())) {
        const body = '{"ok":true}';
        socket.write(`HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\nconnection: close\r\n\r\n${body}`);
        socket.end();
      }
    });
  });
  // The script asks the usual address: a socket in the home folder, or on Windows the user's pipe.
  const address = process.platform === 'win32' ? helperAddress() : path.join(home, 'helper.sock');
  await new Promise((resolve) => server.listen(address, resolve));
  try {
    const began = Date.now();
    const child = spawnChild(process.execPath, [SCRIPT], { env: { ...process.env, WHEELHOUSE_HOME: home }, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stdin.end(JSON.stringify({ cwd: repo, session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' }));
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(code, 0);
    assert.ok(Date.now() - began < 10000, `took ${Date.now() - began} ms`);
    assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, new RegExp(NOT_SYNCED));
  } finally {
    server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('runAndExit writes the answer, then exits even with work left open', () => {
  const code = `import { runAndExit } from ${JSON.stringify(KIT)};
    await runAndExit(async () => { setInterval(() => {}, 1000); return { hello: 'world' }; }, { failClosed: false, event: 'SessionStart' });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { input: JSON.stringify({ cwd: os.tmpdir() }), encoding: 'utf8', timeout: 8000 });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { hello: 'world' });
});

test('the managed copy writes this session\'s marker; the plugin\'s copy does not', async () => {
  await withHome(async (home) => {
    const managed = path.join(home, 'managed-dir');
    const marker = path.join(home, 'projects', P, 'sessions', 's1.managed');
    const f = fake();
    await run(f, { dir: managed, self: path.join(home, 'plugin', 'scripts', 'hooks', 'session-start.js') });
    assert.equal(fs.existsSync(marker), false);
    await run(f, { dir: managed, self: path.join(managed, 'wheelhouse', 'scripts', 'hooks', 'session-start.js') });
    assert.equal(fs.existsSync(marker), true);
    // An odd session id writes nothing.
    await run(f, { dir: managed, self: path.join(managed, 'wheelhouse', 'scripts', 'hooks', 'session-start.js') }, { session_id: '../x' });
    assert.deepEqual(fs.readdirSync(path.dirname(marker)), ['s1.managed']);
  });
});

test('views are read from views.old when a crash left no views folder', async () => {
  await withHome(async (home) => {
    const old = path.join(home, 'projects', P, 'views.old');
    fs.mkdirSync(old, { recursive: true });
    for (const [name, value] of Object.entries({ ...VIEWS, waiting: [{ id: 'c9', data: { title: 'Kept' } }] })) {
      fs.writeFileSync(path.join(old, `${name}.json`), JSON.stringify(value));
    }
    assert.match(text(await run(fake({ startsUp: false }))), /c9: Kept/);
  });
});

// --- final review ---

const OLD_LINE = 'This Claude Code is older than 2.1.295, so a guard that fails does not stop a tool call: update Claude Code';

function transcript(home, entries) {
  const file = path.join(home, 'transcript.jsonl');
  fs.writeFileSync(file, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
  return file;
}

test('a Claude Code older than 2.1.295, read from the transcript\'s last entry, is named; a newer or unknown one is not', async () => {
  await withHome(async (home) => {
    const f = fake();
    f.client.health = async () => ({ ok: true });
    const said = async (entries) => text(await run(f, {}, { transcript_path: entries === null ? path.join(home, 'absent.jsonl') : transcript(home, entries) }));
    assert.ok((await said([{ type: 'user', version: '2.1.300' }, { type: 'assistant', version: '2.1.294' }])).includes(OLD_LINE), 'the last entry counts');
    assert.ok((await said([{ type: 'user', version: '2.0.999' }])).includes(OLD_LINE));
    assert.ok((await said([{ type: 'user', version: '1.9.0' }])).includes(OLD_LINE));
    assert.ok(!(await said([{ type: 'user', version: '2.1.294' }, { type: 'assistant', version: '2.1.295' }])).includes(OLD_LINE));
    assert.ok(!(await said([{ type: 'user', version: '2.2.0' }])).includes(OLD_LINE));
    assert.ok(!(await said([{ type: 'user', version: '10.0.0' }])).includes(OLD_LINE));
    assert.ok(!(await said([{ type: 'user' }])).includes(OLD_LINE), 'no version is unknown');
    assert.ok(!(await said([{ type: 'user', version: 'soon' }])).includes(OLD_LINE), 'an unreadable version is unknown');
    assert.ok(!(await said(null)).includes(OLD_LINE), 'no transcript is unknown');
    assert.ok(!text(await run(f)).includes(OLD_LINE), 'no transcript_path is unknown');
  });
});

test('a helper of another version than this copy is named in the reload', async () => {
  await withHome(async (home) => {
    const root = path.join(home, 'plugin');
    fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'wheelhouse', version: '0.2.0' }));
    const f = fake();
    f.client.health = async () => ({ ok: true, version: '0.1.0' });
    assert.ok(text(await run(f, { pluginRoot: root })).includes('The helper running is version 0.1.0; this copy is version 0.2.0'));
    f.client.health = async () => ({ ok: true, version: '0.2.0' });
    assert.doesNotMatch(text(await run(f, { pluginRoot: root })), /The helper running is version/);
    f.client.health = async () => ({ ok: true });
    assert.doesNotMatch(text(await run(f, { pluginRoot: root })), /The helper running is version/, 'a helper that names no version is not compared');
  });
});
