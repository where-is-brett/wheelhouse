// tests/scripts/hooks/session-start.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn as spawnChild } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { decide, NO_HELPER, NOT_SYNCED, NO_USAGE, GUARD_FLOOR, OLD_CLAUDE_CODE, FRONT_DESK_LINE } from '../../../scripts/hooks/session-start.js';
import { recordRole } from '../../../scripts/lib/role.js';
import { decide as hold } from '../../../scripts/hooks/lineage-hold.js';
import { checkLineage, holdFile, MANIFEST_UNREADABLE, MANIFEST_UNREADABLE_NOT_HELD } from '../../../scripts/lineage/check.js';
import { pendingDir } from '../../../scripts/hooks/pending.js';
import { CLAUDE_CODE_FLOOR } from '../../../scripts/lib/build-loop.js';
import { tempFolder } from '../../helpers/homes.js';
import { lineageFixture, SHA } from '../../helpers/lineage.js';
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
  const calls = { spawn: [], health: 0, sync: 0, views: 0, unref: 0, writes: [] };
  let started = false;
  return {
    calls,
    client: {
      health: async () => { calls.health += 1; return { ok: answersAfterStart && started }; },
      state: {
        sync: async () => { calls.sync += 1; return sync; },
        views: async () => { calls.views += 1; return { ok: true, views }; },
        write: async (body) => { calls.writes.push(body); return { ok: true }; },
        record: async () => ({ ok: true }),
      },
    },
    spawn: (file, args, opts) => { calls.spawn.push({ file, args, opts }); started = startsUp; return { unref() { calls.unref += 1; }, on() {} }; },
  };
}

const PLUGIN_ROOT = '/plugin/root';
// The installed skills match, unless a test says otherwise.
const MATCHED = () => ({ ok: true, mismatches: [], manifest: true, upstreams: {}, kept: true });
const run = (f, extra = {}, input = {}) => decide(
  { cwd: '/x', session_id: 's1', ...input },
  { pluginRoot: PLUGIN_ROOT, client: f.client, spawn: f.spawn, platform: 'darwin', projectOf: () => ({ project: P }), stopState: () => ({ on: false }), pause: async () => {}, startWaitMs: 200, background: async () => ({ receiver: 'running', weekly: 'not-due' }), lineage: MATCHED, ...extra },
);
const text = (out) => out?.hookSpecificOutput?.additionalContext ?? '';
const call = (cwd, tool) => ({ cwd, session_id: 's1', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: {} });

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
  // The receiver the session starts goes to a port of its own, and is stopped afterwards.
  const receiverPort = await new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
  fs.mkdirSync(path.join(home, 'usage'), { recursive: true });
  fs.writeFileSync(path.join(home, 'usage', 'receiver.json'), JSON.stringify({ port: receiverPort }));
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
    assert.ok(fs.existsSync(path.join(home, 'usage', 'sessions', 's1.json')), 'the session\'s part is recorded');
  } finally {
    for (let tries = 0; tries < 40; tries += 1) {
      try {
        process.kill(Number.parseInt(fs.readFileSync(path.join(home, 'usage', 'receiver.pid'), 'utf8'), 10));
        break;
      } catch { /* not written yet, or not running */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
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
    assert.deepEqual(fs.readdirSync(path.dirname(marker)).filter((name) => name.endsWith('.managed')), ['s1.managed']);
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

test('the session\'s part and the usage receiver are handed this session\'s details, and the reload says nothing when they start', async () => {
  await withHome(async () => {
    const f = fake();
    const seen = [];
    const out = await run(f, { background: async (args) => { seen.push(args); return { receiver: 'started', weekly: 'not-due' }; } }, { cwd: '/some/cwd', session_id: 's-9' });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].session, 's-9');
    assert.equal(seen[0].cwd, '/some/cwd');
    assert.equal(seen[0].project, P);
    assert.equal(seen[0].pluginRoot, PLUGIN_ROOT);
    assert.doesNotMatch(text(out), /Usage counts/);
  });
});

test('a usage receiver that could not start is named in the reload, once', async () => {
  await withHome(async () => {
    const f = fake();
    const out = await run(f, { background: async () => ({ receiver: 'failed', weekly: 'not-due' }) });
    assert.equal(text(out).split(NO_USAGE).length - 1, 1);
    assert.equal(NO_USAGE, 'Usage counts couldn\'t start this time');
    // A background step that throws or never answers does not stop the session or add the line.
    const thrown = await run(fake(), { background: async () => { throw new Error('x'); } });
    assert.doesNotMatch(text(thrown), /Usage counts/);
    const began = Date.now();
    const hung = await run(fake(), { totalMs: 400, background: () => new Promise(() => {}) });
    assert.ok(Date.now() - began < 1500);
    assert.doesNotMatch(text(hung), /Usage counts/);
  });
});

// The project's configuration as the helper reads it from the default branch.
const shapeConfig = (watcherShape) => ({ ok: true, config: { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], watcherShape } });
const watcherStarts = (f) => f.calls.spawn.filter((c) => c.args[0] === path.join(PLUGIN_ROOT, 'scripts', 'watcher', 'main.js'));

test('in a Shape 1 project the session start starts the watcher when it isn\'t running, detached and hidden', async () => {
  await withHome(async (home) => {
    const f = fake();
    f.client.health = async () => ({ ok: true });
    f.client.config = async () => shapeConfig(1);
    // The started watcher takes its lock, as the real one does.
    const spawn = f.spawn;
    f.spawn = (file, args, opts) => {
      const child = spawn(file, args, opts);
      fs.mkdirSync(path.join(home, 'projects', P, 'watcher'), { recursive: true });
      fs.writeFileSync(path.join(home, 'projects', P, 'watcher', 'watcher.lock'), `${process.pid}\n`);
      return child;
    };
    await run(f);
    const started = watcherStarts(f);
    assert.equal(started.length, 1);
    assert.equal(started[0].file, process.execPath);
    assert.deepEqual(started[0].args, [path.join(PLUGIN_ROOT, 'scripts', 'watcher', 'main.js'), P]);
    assert.equal(started[0].opts.detached, true);
    assert.equal(started[0].opts.windowsHide, true);
    assert.equal(started[0].opts.stdio, 'ignore');
    // A second session finds it running and starts nothing; it doesn't ask for the configuration either.
    let asked = 0;
    f.client.config = async () => { asked += 1; return shapeConfig(1); };
    await run(f);
    assert.equal(watcherStarts(f).length, 1);
    assert.equal(asked, 0);
  });
});

test('the session start leaves the watcher alone in Shape 2, and fails open when the configuration can\'t be had', async () => {
  await withHome(async () => {
    const answers = [
      async () => shapeConfig(2),
      async () => ({ ok: false, refused: 'the helper could not be reached' }),
      async () => { throw new Error('boom'); },
      () => new Promise(() => {}),
    ];
    for (const answer of answers) {
      const f = fake();
      f.client.health = async () => ({ ok: true });
      f.client.config = answer;
      const began = Date.now();
      await assert.doesNotReject(run(f, { totalMs: 400 }));
      assert.ok(Date.now() - began < 3000);
      assert.equal(watcherStarts(f).length, 0);
    }
    // A helper that isn't running gives no configuration: nothing is started but the helper.
    const f = fake({ startsUp: false });
    f.client.config = async () => shapeConfig(1);
    await run(f);
    assert.equal(watcherStarts(f).length, 0);
  });
});

test('in the project\'s main folder the reload names the front desk\'s playbook, after STOP and damaged state', async () => {
  await withHome(async () => {
    assert.equal(FRONT_DESK_LINE, 'This is the front desk. Follow wheelhouse:front-desk.');
    const lines = text(await run(fake(), { env: {} })).split('\n');
    assert.equal(lines.filter((l) => l === FRONT_DESK_LINE).length, 1);
    const f = fake({ views: { ...VIEWS, damaged: ['events/bad.json could not be read'] } });
    const stopped = text(await run(f, { env: {}, stopState: () => ({ on: true, by: 'prompt', at: 'now' }) })).split('\n');
    assert.deepEqual(stopped.slice(0, 4), ['STOP is on (set by prompt at now)', 'Damaged state:', '- events/bad.json could not be read', FRONT_DESK_LINE]);
  });
});

test('a feature worktree and the foreman are not pointed at the front desk\'s playbook', async () => {
  await withHome(async (home) => {
    const tree = path.join(home, 'tree');
    const gitdir = path.join(home, 'main', '.git', 'worktrees', 'tree');
    fs.mkdirSync(tree, { recursive: true });
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${gitdir}\n`);
    fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/feature/gift-cards\n');
    assert.doesNotMatch(text(await run(fake(), { env: {} }, { cwd: tree })), /front desk/);
    // Nor when a front-desk role was recorded for the session earlier: the worktree decides.
    recordRole('s-moved', 'front-desk');
    assert.doesNotMatch(text(await run(fake(), { env: {} }, { cwd: tree, session_id: 's-moved' })), /front desk/);
    assert.doesNotMatch(text(await run(fake(), { env: { WHEELHOUSE_ROLE: 'foreman' } })), /front desk/);
    // A foreman known from its first prompt, as the board-context hook recorded it, after a compaction.
    recordRole('s-foreman', 'foreman');
    assert.doesNotMatch(text(await run(fake(), { env: {} }, { session_id: 's-foreman' })), /front desk/);
  });
});

// --- Lineage: the installed upstream skills against Wheelhouse's manifest ---

const LINEAGE_LINE = (paths) => `Lineage: the installed superpowers files differ from Wheelhouse's manifest (${paths}). Edits and commands are held until a session starts with matching files. Raise this with the director as a card.`;

// A session start in a project whose folder is `folder`, checked against the fixture's manifest.
const lineageRun = (f, fixture, folder, extra = {}, input = {}) => run(f, {
  lineage: checkLineage, lineageRoot: fixture.root, claudeHome: fixture.claudeHome, projectOf: () => ({ project: P, record: { folder } }), ...extra,
}, input);

test('an installed Superpowers file that differs raises the warning and writes the hold', async () => {
  await withHome(async () => {
    const folder = tempFolder('wh-ss-project-');
    const fixture = lineageFixture(folder);
    const stop = { stopState: () => ({ on: true, by: 'prompt', at: '2026-10-18T01:00:00.000Z' }), now: () => new Date('2026-10-19T02:00:00.000Z') };
    const f = fake({ views: { ...VIEWS, damaged: ['events/bad.json could not be read'] } });

    // Matching: no warning, and no hold.
    assert.doesNotMatch(text(await lineageRun(f, fixture, folder, stop)), /Lineage/);
    assert.equal(fs.existsSync(holdFile(P)), false);

    fixture.put({ 'skills/brainstorming/SKILL.md': 'brainstorm, changed\n', LICENSE: 'another licence\n' });
    const lines = text(await lineageRun(f, fixture, folder, stop)).split('\n');
    assert.equal(lines[0], 'STOP is on (set by prompt at 2026-10-18T01:00:00.000Z)');
    assert.equal(lines[1], LINEAGE_LINE('skills/brainstorming, LICENSE'), 'first after STOP');
    assert.equal(lines[2], 'Damaged state:');
    const held = JSON.parse(fs.readFileSync(holdFile(P), 'utf8'));
    assert.equal(holdFile(P), path.join(process.env.WHEELHOUSE_HOME, 'projects', P, 'lineage', 'hold.json'));
    assert.equal(held.at, '2026-10-19T02:00:00.000Z');
    assert.deepEqual(held.mismatches.map((m) => [m.upstream, m.path]), [['superpowers', 'skills/brainstorming'], ['superpowers', 'LICENSE']]);
    // While held, the hold hook refuses an edit in the project.
    assert.equal((await hold(call(folder, 'Edit'), { projectOf: () => ({ project: P }) }))?.hookSpecificOutput?.permissionDecision, 'deny');

    // With no STOP, the warning is the first line; put right, the next start lifts the hold.
    assert.equal(text(await lineageRun(f, fixture, folder)).split('\n')[0], LINEAGE_LINE('skills/brainstorming, LICENSE'));
    fixture.restore();
    assert.doesNotMatch(text(await lineageRun(f, fixture, folder)), /Lineage/);
    assert.equal(fs.existsSync(holdFile(P)), false);
    assert.equal(await hold(call(folder, 'Edit'), { projectOf: () => ({ project: P }) }), undefined);

    // Not installed for this project, or a manifest that can't be read: held too.
    assert.equal(text(await lineageRun(f, fixture, tempFolder('wh-ss-other-'))).split('\n')[0], LINEAGE_LINE('not installed'));
    assert.equal(text(await lineageRun(f, { ...fixture, root: tempFolder('wh-ss-empty-root-') }, folder)).split('\n')[0], MANIFEST_UNREADABLE);
    assert.ok(fs.existsSync(holdFile(P)));
  });
});

test('a hold is recorded in the state once for each set of mismatches, through the kept records (R146)', async () => {
  await withHome(async () => {
    const folder = tempFolder('wh-ss-project-');
    const fixture = lineageFixture(folder);
    const at = (time) => ({ now: () => new Date(time) });
    const f = fake();
    const holds = () => f.calls.writes.filter((w) => w.kind === 'lineage-hold');

    fixture.put({ LICENSE: 'another licence\n' });
    await lineageRun(f, fixture, folder, at('2026-10-19T02:00:00.000Z'));
    assert.deepEqual(holds(), [{
      project: P, kind: 'lineage-hold', data: { at: '2026-10-19T02:00:00.000Z', mismatches: [{ upstream: 'superpowers', path: 'LICENSE' }] },
    }]);
    // The same set at the next starts: not recorded again, and the hold still stands.
    await lineageRun(f, fixture, folder, at('2026-10-19T03:00:00.000Z'));
    await lineageRun(f, fixture, folder, at('2026-10-19T04:00:00.000Z'));
    assert.equal(holds().length, 1);
    assert.ok(fs.existsSync(holdFile(P)));
    // Another set is recorded; so is the same set again once a matching start has lifted the hold.
    fixture.put({ 'skills/brainstorming/SKILL.md': 'changed\n' });
    await lineageRun(f, fixture, folder, at('2026-10-19T05:00:00.000Z'));
    assert.deepEqual(holds()[1].data.mismatches, [{ upstream: 'superpowers', path: 'skills/brainstorming' }, { upstream: 'superpowers', path: 'LICENSE' }]);
    fixture.restore();
    await lineageRun(f, fixture, folder, at('2026-10-19T06:00:00.000Z'));
    assert.equal(fs.existsSync(holdFile(P)), false);
    fixture.put({ LICENSE: 'another licence\n' });
    await lineageRun(f, fixture, folder, at('2026-10-19T07:00:00.000Z'));
    assert.equal(holds().length, 3);
    assert.equal(holds()[2].data.at, '2026-10-19T07:00:00.000Z');

    // With no helper, the record is kept and sent by a later start; the hold stands meanwhile.
    fixture.restore();
    await lineageRun(f, fixture, folder);
    fixture.put({ 'skills/writing-plans/SKILL.md': 'changed\n' });
    const down = fake({ answersAfterStart: false });
    const text1 = text(await lineageRun(down, fixture, folder, at('2026-10-19T08:00:00.000Z')));
    assert.match(text1, /Lineage: the installed superpowers files differ/);
    assert.equal(fs.readdirSync(pendingDir(P)).filter((n) => n.endsWith('.json')).length, 1);
    assert.ok(fs.existsSync(holdFile(P)));
    await lineageRun(f, fixture, folder, at('2026-10-19T09:00:00.000Z'));
    assert.equal(holds().length, 4);
    assert.equal(holds()[3].data.at, '2026-10-19T08:00:00.000Z', 'the kept one, not a second');
    assert.equal(fs.readdirSync(pendingDir(P)).filter((n) => n.endsWith('.json')).length, 0);
  });
});

test('a hold that could not be written is not called one, and a record that could not be kept leaves the hold standing', async () => {
  await withHome(async () => {
    const folder = tempFolder('wh-ss-project-');
    const fixture = lineageFixture(folder);
    fixture.put({ LICENSE: 'another licence\n' });
    const f = fake();
    // The hold's folder is a file, so the hold can't be written.
    const lineageFolder = path.dirname(holdFile(P));
    fs.mkdirSync(path.dirname(lineageFolder), { recursive: true });
    fs.writeFileSync(lineageFolder, 'not a folder');
    const first = text(await lineageRun(f, fixture, folder)).split('\n')[0];
    assert.equal(first, 'Lineage: the installed superpowers files differ from Wheelhouse\'s manifest (LICENSE). The hold could not be written, so edits and commands are not held. Raise this with the director as a card.');
    assert.equal(text(await lineageRun(f, { ...fixture, root: tempFolder('wh-ss-empty-root-') }, folder)).split('\n')[0], MANIFEST_UNREADABLE_NOT_HELD);
    assert.equal(f.calls.writes.filter((w) => w.kind === 'lineage-hold').length, 0, 'no hold, so none recorded');
    fs.rmSync(lineageFolder);
    // The kept records' folder is a file, so the record can't be kept: the hold still stands and the session starts.
    fs.mkdirSync(path.dirname(pendingDir(P)), { recursive: true });
    fs.writeFileSync(pendingDir(P), 'not a folder');
    assert.equal(text(await lineageRun(f, fixture, folder)).split('\n')[0], LINEAGE_LINE('LICENSE'));
    assert.ok(fs.existsSync(holdFile(P)));
    assert.equal(JSON.parse(fs.readFileSync(holdFile(P), 'utf8')).recorded, undefined, 'not marked, so a later start tries again');
  });
});

test('provenance is written at each session start', async () => {
  await withHome(async () => {
    const folder = tempFolder('wh-ss-project-');
    const fixture = lineageFixture(folder, { version: '1.2.3', register: '0.4.0' });
    const transcript = path.join(tempFolder('wh-ss-transcript-'), 't.jsonl');
    fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', version: '2.1.300' })}\n`);
    const f = fake();
    const file = path.join(process.env.WHEELHOUSE_HOME, 'projects', P, 'sessions', 's1', 'provenance.json');
    await lineageRun(f, fixture, folder, {}, { transcript_path: transcript });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
      wheelhouse: '1.2.3', upstreams: { superpowers: SHA }, register: '0.4.0', claudeCode: '2.1.300', fingerprints: 'match', transcript,
    });
    // The next start of the same session writes it again, as things stand then.
    fixture.put({ LICENSE: 'another licence\n' });
    await lineageRun(f, fixture, folder, {}, { transcript_path: transcript });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).fingerprints, 'mismatch');
    // Nothing installed for the project: the upstream's commit is null. No transcript entry yet: Claude Code's version is null.
    const empty = path.join(path.dirname(transcript), 'empty.jsonl');
    fs.writeFileSync(empty, '');
    await lineageRun(f, fixture, tempFolder('wh-ss-other-'), {}, { session_id: 's2', transcript_path: empty });
    const second = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(file)), 's2', 'provenance.json'), 'utf8'));
    assert.deepEqual(second, {
      wheelhouse: '1.2.3', upstreams: { superpowers: null }, register: '0.4.0', claudeCode: null, fingerprints: 'mismatch', transcript: empty,
    });
    // An odd session id writes no provenance.
    await lineageRun(f, fixture, folder, {}, { session_id: '../x' });
    assert.deepEqual(fs.readdirSync(path.dirname(path.dirname(file))).sort(), ['s1', 's2']);
  });
});

test('a lineage check that throws is passed over: the session starts and says nothing of it', async () => {
  await withHome(async () => {
    const out = await run(fake(), { lineage: () => { throw new Error('boom'); } });
    assert.doesNotMatch(text(out), /Lineage/);
  });
});

test('the guard floor is the build loop\'s Claude Code floor, named once', () => {
  assert.deepEqual(GUARD_FLOOR, CLAUDE_CODE_FLOOR.split('.').map(Number));
  assert.equal(OLD_CLAUDE_CODE, 'This Claude Code is older than 2.1.295, so a guard that fails does not stop a tool call: update Claude Code');
});
