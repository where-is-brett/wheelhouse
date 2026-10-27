// tests/scripts/hooks/copilot-read-only.test.js
// On Copilot, hooks only read and the helper writes (Part 5 Task 3, rulings P5-20, P5-22 and P5-41): every hook the
// entry runs in Copilot mode leaves the Wheelhouse home as it was and never opens the keys folder; with no helper,
// writes are refused as under STOP and reading carries on; and Claude Code's hooks still sign and write as before.
import '../../helpers/homes.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import module from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { as, shortHome } from '../../helpers/homes.js';
import { runEntry } from '../../../scripts/agents/copilot/hook-entry.js';
import { UNKNOWN_TOOL } from '../../../adapters/copilot/translate.js';
import { hookMain, writeVia } from '../../../scripts/hooks/kit.js';
import { decide as stopGuard, DENIED } from '../../../scripts/hooks/stop-guard.js';
import { decide as stopWord, CONTEXT as STOP_CONTEXT } from '../../../scripts/hooks/stop-word.js';
import { decide as promptRecord } from '../../../scripts/hooks/prompt-record.js';
import { registerLean } from '../../../scripts/lean/project.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { stopState, setStop, liftStop, NO_HELPER_STOP } from '../../../scripts/lib/stop.js';
import { keysDir, bypassDir, computerId } from '../../../scripts/lib/paths.js';
import { makeSigningKey, enrol, readEnrolled, verify } from '../../../scripts/state/signing.js';
import { approvalLine } from '../../../scripts/state/card-lines.js';
import { HELPER_PROBE_MS, C6_PASSED } from '../../../scripts/lib/copilot-numbers.js';

const COPILOT_ENV = { COPILOT_CLI_BINARY_VERSION: '1.0.101' };
const posix = process.platform !== 'win32';

// Stand-ins for gh, glab, copilot and curl come first on the PATH; the last test asserts none ran (P5-44).
const stand = standInTools();
after(() => stand.restore());

// A computer with a home of its own: a signing key enrolled, its id kept, and a Lean project whose folder has a
// .git folder (the hooks read files only, never git).
function computer() {
  const home = shortHome();
  const folder = path.join(shortHome(), 'shop');
  fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(folder, 'README.md'), 'readme');
  return as(home, () => {
    registerLean({ project: 'shop', folder, now: () => new Date('2026-10-23T01:00:00.000Z') });
    const own = makeSigningKey();
    enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: '2026-10-23T01:00:00.000Z' });
    computerId();
    return { home, folder: fs.realpathSync.native(folder), managed: path.join(home, 'no-managed-copy') };
  });
}

// A stand-in helper client: each call is logged, and every answer is a refusal while the helper is "down".
function helper({ up = true } = {}) {
  const calls = [];
  const reply = (route, answer) => async (body) => {
    calls.push({ route, body });
    return up ? answer : { ok: false, refused: 'the host helper could not be reached: is it running?' };
  };
  const client = {
    health: reply('/health', { ok: true }),
    stop: reply('/stop/set', { ok: true }),
    session: { mark: reply('/session/mark', { ok: true }) },
    cards: { chatClick: reply('/cards/chat-click', { ok: true }) },
    state: {
      views: reply('/state/views', { ok: true, views: {} }),
      write: reply('/state/write', { ok: true }),
      sync: reply('/state/sync', { ok: true, pulled: 0, unpushed: 0 }),
      answer: reply('/state/answer', { ok: true, answer: null }),
    },
    config: reply('/config', { ok: false, refused: 'a Lean project has no code host' }),
    profile: { views: reply('/profile/views', { ok: false }), enrolments: reply('/profile/enrolments', { ok: false }) },
  };
  return { calls, client, routes: () => calls.map((c) => c.route) };
}

const entry = (event, raw, c, deps = {}) => runEntry(event, {
  stdin: Readable.from([JSON.stringify(raw)]), env: COPILOT_ENV, deps: { dir: c.managed, ...deps },
});
const body = (result) => (result.text === '' ? null : JSON.parse(result.text));
const call = (cwd, toolName, toolArgs) => ({ sessionId: 's1', timestamp: 0, cwd, toolName, toolArgs });
const prompt = (cwd, text) => ({ sessionId: 's1', timestamp: 0, cwd, prompt: text });
const patch = (file) => ['*** Begin Patch', `*** Add File: ${file}`, '+x', '*** End Patch'].join('\n');
const deny = (reason) => ({ permissionDecision: 'deny', permissionDecisionReason: reason });

// A hash of every name and file under `dir`.
function treeHash(dir) {
  const hash = crypto.createHash('sha256');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(d, e.name);
      hash.update(path.relative(dir, full));
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) hash.update(fs.readFileSync(full));
    }
  };
  walk(dir);
  return hash.digest('hex');
}

// Every fs call naming a path under `watched`, while `fn` runs: the hooks reach fs through `node:fs` (its
// default object and its named exports, kept in step by syncBuiltinESMExports) and `node:fs/promises`.
const SPIED = ['openSync', 'readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync', 'opendirSync', 'accessSync', 'writeFileSync', 'mkdirSync', 'renameSync', 'rmSync', 'appendFileSync', 'copyFileSync', 'open', 'readFile', 'readdir', 'stat', 'lstat', 'access'];
const SPIED_PROMISES = ['open', 'readFile', 'readdir', 'stat', 'lstat', 'access', 'writeFile', 'mkdir', 'rename', 'rm', 'appendFile', 'opendir'];
async function touching(watched, fn) {
  const seen = [];
  const under = (p) => {
    const text = p instanceof URL ? p.pathname : typeof p === 'string' ? p : Buffer.isBuffer(p) ? p.toString() : '';
    return text !== '' && (text === watched || text.startsWith(`${watched}${path.sep}`));
  };
  const restore = [];
  const wrap = (owner, name, label) => {
    const real = owner[name];
    if (typeof real !== 'function') return;
    owner[name] = function spied(...args) {
      if (under(args[0]) || under(args[1])) seen.push(`${label}(${args[0]})`);
      return real.apply(this, args);
    };
    restore.push(() => { owner[name] = real; });
  };
  for (const name of SPIED) wrap(fs, name, name);
  for (const name of SPIED_PROMISES) wrap(fs.promises, name, `promises.${name}`);
  module.syncBuiltinESMExports();
  try {
    await fn();
  } finally {
    for (const undo of restore) undo();
    module.syncBuiltinESMExports();
  }
  return seen;
}

test('in Copilot mode no hook reads the keys folder or writes under the Wheelhouse home', { skip: posix ? false : 'chmod 000 and a read-only home are POSIX; Windows has no such modes' }, async () => {
  const c = await computer();
  await as(c.home, async () => {
    const h = helper();
    const events = [
      ['sessionStart', { sessionId: 's1', timestamp: 0, cwd: c.folder, source: 'new', initialPrompt: 'hi' }],
      ['userPromptSubmitted', prompt(c.folder, 'hello')],
      ['userPromptSubmitted', prompt(c.folder, '/wheelhouse:board')],
      ['userPromptSubmitted', prompt(c.folder, 'stop')],
      ['preToolUse', call(c.folder, 'view', { path: path.join(c.folder, 'README.md') })],
      ['preToolUse', call(c.folder, 'bash', { command: 'ls' })],
      ['preToolUse', call(c.folder, 'apply_patch', patch(path.join(c.folder, 'a.txt')))],
      ['preToolUse', call(c.folder, 'apply_patch_v2', { patch: 'x' })],
      ['preCompact', { sessionId: 's1', timestamp: 0, cwd: c.folder, trigger: 'auto', customInstructions: '' }],
    ];
    const before = treeHash(c.home);
    // The keys folder unreadable, and every other file and folder in the home read-only (ruling P5-41).
    const keys = keysDir();
    const all = [c.home, ...fs.readdirSync(c.home, { recursive: true }).map((p) => path.join(c.home, p))]
      .filter((p) => p !== keys && !p.startsWith(`${keys}${path.sep}`));
    fs.chmodSync(keys, 0o000);
    for (const p of all) fs.chmodSync(p, fs.lstatSync(p).mode & ~0o222);
    const answers = [];
    let opened;
    try {
      opened = await touching(keys, async () => {
        for (const [event, raw] of events) answers.push(await entry(event, raw, c, { client: h.client }));
      });
      // The spy sees a read of the keys folder when one is made, as Claude Code's prompt record makes one.
      const spied = await touching(keys, () => { readEnrolled(); });
      assert.ok(spied.length > 0, 'the spy sees the keys folder opened');
    } finally {
      for (const p of all) fs.chmodSync(p, fs.lstatSync(p).mode | 0o200);
      fs.chmodSync(keys, 0o700);
    }
    assert.deepEqual(opened, [], 'the keys folder was never opened');
    assert.equal(treeHash(c.home), before, 'nothing under the Wheelhouse home changed');

    // Every event was answered, none with "could not run".
    assert.ok(answers.every((a) => !a.text.includes('could not run')), JSON.stringify(answers));
    // The session start answered with the briefing, the tool sheet and the Lean command line.
    const start = body(answers[0]).additionalContext;
    assert.match(start, /The Wheelhouse command is /);
    assert.match(start, /The Lean command is ".+" ".+\/scripts\/lean\/cli\.js"/);
    // The STOP word set STOP through the helper, recorded as the director's word, and nothing set it here.
    assert.deepEqual(h.calls.filter((x) => x.route === '/stop/set').map((x) => x.body), [{ by: 'prompt' }]);
    assert.deepEqual(body(answers[3]), { additionalContext: STOP_CONTEXT });
    assert.equal(stopState().on, false);
    // The unknown tool was refused and marked, and the compaction marked, both through the helper.
    assert.deepEqual(body(answers[7]), deny(UNKNOWN_TOOL('apply_patch_v2')));
    assert.deepEqual(h.calls.filter((x) => x.route === '/session/mark').map((x) => x.body), [
      { project: 'shop', mark: 'unknown-tool', data: { name: 'apply_patch_v2' } },
      { project: 'shop', mark: 'compaction', data: { trigger: 'auto' } },
    ]);
    // The helper was asked once per event the entry runs steps for (seven), and once more by the board's own
    // inputs for /wheelhouse:board; the unknown tool and the compaction ran no step and asked nothing.
    assert.equal(h.routes().filter((r) => r === '/health').length, 8);
  });
});

test('with no helper a Copilot write is refused and a read is let through', async () => {
  assert.equal(HELPER_PROBE_MS, 2000);
  const c = await computer();
  await as(c.home, async () => {
    // Nothing listens at this home's helper address: the entry's own client finds no helper.
    for (const deps of [{}, { client: helper({ up: false }).client }]) {
      const read = await entry('preToolUse', call(c.folder, 'view', { path: path.join(c.folder, 'README.md') }), c, deps);
      assert.deepEqual([read.text, read.code], ['', 0]);
      for (const raw of [call(c.folder, 'apply_patch', patch(path.join(c.folder, 'a.txt'))), call(c.folder, 'bash', { command: 'git push' }), call(c.folder, 'task', { prompt: 'build it' })]) {
        const refused = await entry('preToolUse', raw, c, deps);
        assert.deepEqual(body(refused), deny(NO_HELPER_STOP), raw.toolName);
        assert.equal(refused.code, 2);
      }
      // The STOP word sets nothing, and says the helper isn't running and how to start it.
      const word = await entry('userPromptSubmitted', prompt(c.folder, 'stop'), c, deps);
      assert.deepEqual(body(word), { additionalContext: NO_HELPER_STOP });
      assert.equal(stopState().on, false);
      // The session start says so too.
      const start = await entry('sessionStart', { sessionId: 's1', timestamp: 0, cwd: c.folder, source: 'new' }, c, deps);
      assert.match(body(start).additionalContext, new RegExp(NO_HELPER_STOP.replace(/[.']/g, '.')));
    }
    assert.equal(NO_HELPER_STOP, 'Wheelhouse\'s helper isn\'t running, so writes, pushes, merges and new agents are refused until it is. Start it with the Wheelhouse command.');
    // A helper that answers late counts as not running, within HELPER_PROBE_MS.
    const slow = helper();
    slow.client.health = () => new Promise(() => {});
    const started = Date.now();
    const late = await entry('preToolUse', call(c.folder, 'apply_patch', patch(path.join(c.folder, 'a.txt'))), c, { client: slow.client });
    assert.deepEqual(body(late), deny(NO_HELPER_STOP));
    assert.ok(Date.now() - started < HELPER_PROBE_MS + 1500);
    // With the helper up and STOP off the same patch is let through.
    const up = helper();
    assert.deepEqual((await entry('preToolUse', call(c.folder, 'apply_patch', patch(path.join(c.folder, 'a.txt'))), c, { client: up.client })).text, '');
  });
});

test('the STOP word on Copilot sets STOP through the helper, and the STOP guard marks no bypass', async () => {
  const c = await computer();
  await as(c.home, async () => {
    const h = helper();
    const word = await stopWord({ cwd: c.folder, prompt: 'stop', hook_event_name: 'UserPromptSubmit' }, { writeVia: 'helper', client: h.client, helperUp: true });
    assert.equal(word.hookSpecificOutput.additionalContext, STOP_CONTEXT);
    assert.deepEqual(h.calls, [{ route: '/stop/set', body: { by: 'prompt' } }]);
    assert.equal(stopState().on, false, 'STOP is the helper\'s to set');
    // A helper that refuses: nothing is set, and the reply says so.
    const down = await stopWord({ cwd: c.folder, prompt: 'stop' }, { writeVia: 'helper', client: helper({ up: false }).client });
    assert.equal(down.hookSpecificOutput.additionalContext, NO_HELPER_STOP);
    // The STOP guard in bypass mode marks nothing.
    await stopGuard({ cwd: c.folder, session_id: 's1', tool_name: 'Read', permission_mode: 'bypassPermissions', hook_event_name: 'PreToolUse' }, { dir: c.managed, writeVia: 'helper', bypass: false });
    assert.equal(fs.existsSync(path.join(bypassDir(), 's1')), false);
    // The prompt record does nothing at all: it signs, keeps and sends no click.
    const asked = { cwd: c.folder, tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Approve?', options: [{ label: 'Approve' }] }], answers: { 'Approve?': 'Approve' } } };
    const sent = helper();
    assert.equal(await promptRecord(asked, { writeVia: 'helper', client: sent.client }), undefined);
    assert.deepEqual(sent.calls, []);
    // A hook chat click names chat-click until check 59 (C6) passes.
    assert.equal(C6_PASSED, false);
  });
});

test('Claude Code hooks still sign and write as before', async () => {
  const c = await computer();
  await as(c.home, async () => {
    const folder = path.join(c.home, 'cc');
    fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
    writeProject('owner__shop', { folder, remoteUrl: 'https://example.com/owner/shop.git', host: 'github', repo: 'owner/shop', connection: {} });
    assert.equal(writeVia('claude-code'), 'self');
    assert.equal(writeVia('copilot'), 'helper');
    assert.equal(writeVia('an-agent-nobody-knows'), 'helper');
    // hookMain gives Claude Code's input writeVia 'self', and the hooks write under the home as they did.
    const given = [];
    const out = [];
    const io = (raw) => ({ stdin: Readable.from([JSON.stringify(raw)]), write: (t) => out.push(t), dir: c.managed });
    await hookMain(async (input, deps) => { given.push(deps.writeVia); return stopWord(input, deps); }, { failClosed: false, event: 'UserPromptSubmit' },
      io({ hook_event_name: 'UserPromptSubmit', session_id: 's2', cwd: folder, prompt: 'stop' }));
    assert.deepEqual(given, ['self']);
    assert.deepEqual(stopState().by, 'prompt');
    assert.match(out.join(''), /All stop is on/);
    liftStop();
    await hookMain(stopGuard, { failClosed: true, event: 'PreToolUse' },
      io({ hook_event_name: 'PreToolUse', session_id: 's2', cwd: folder, tool_name: 'Read', tool_input: {}, permission_mode: 'bypassPermissions' }));
    assert.equal(fs.existsSync(path.join(bypassDir(), 's2')), true, 'the bypass marker is written as before');
    // A signed click: Approve on a card naming the pull request and its head, through Claude Code's prompt
    // record, is signed with this computer's key and verifies, and the plain answer goes beside it.
    const head = 'abcdef1234567890abcdef1234567890abcdef12';
    const question = `${approvalLine(7, head)}? It changes the sign-in.`;
    const sent = { write: [], record: [] };
    const client = {
      prState: async () => ({ ok: true, result: { headSha: head, state: 'open' } }),
      state: { write: async (b) => { sent.write.push(b); return { ok: true }; }, record: async (b) => { sent.record.push(b); return { ok: true }; } },
      profile: { record: async () => ({ ok: true }) },
    };
    await hookMain(promptRecord, { failClosed: false, event: 'PostToolUse' }, {
      ...io({
        hook_event_name: 'PostToolUse', session_id: 's2', cwd: folder, tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question, options: [{ label: 'Approve' }, { label: 'Not now' }] }], answers: { [question]: 'Approve' } },
        tool_response: { answers: { [question]: 'Approve' } },
      }),
      deps: { client, now: () => new Date('2026-10-23T02:00:00.000Z') },
    });
    assert.equal(sent.record.length, 1);
    const [{ event: approval }] = sent.record;
    assert.equal(approval.kind, 'approval');
    assert.deepEqual([approval.data.pr, approval.data.commit], [7, head]);
    assert.ok(approval.sig, 'signed');
    assert.equal(verify(approval, readEnrolled()), true, 'and it verifies against this computer\'s enrolled key');
    assert.deepEqual(sent.write.map((w) => [w.kind, w.data]), [['card-answer', { question, label: 'Approve' }]]);
    // STOP on, a Claude Code write is refused in STOP's words, never the helper's.
    setStop({ by: 'helper' });
    try {
      const refused = await stopGuard({ hook_event_name: 'PreToolUse', session_id: 's2', cwd: folder, tool_name: 'Write', tool_input: {} }, { dir: c.managed });
      assert.equal(refused.hookSpecificOutput.permissionDecisionReason, DENIED);
    } finally {
      liftStop();
    }
  });
});

test('no real copilot, gh, glab or curl ran', () => {
  assert.deepEqual(stand.calls(), []);
});
