// tests/scripts/hooks/session-start.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn as spawnChild } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  decide, toolSheetLines, NO_HELPER, NOT_SYNCED, NO_USAGE, GUARD_FLOOR, OLD_CLAUDE_CODE, FRONT_DESK_LINE, JOURNAL_UNREADABLE, FOREMAN_HELD_NEWER, FOREMAN_HELD_UNREADABLE,
  TRUST_ASK, MAX_TRUST_CARDS, moreTrust, NOT_SET_UP, REMOVED, REMOVE_PLUGIN, PLUGIN_KEY,
} from '../../../scripts/hooks/session-start.js';
import { differentKeyLine, fingerprint, keyHash, readShownTrust } from '../../../scripts/lib/trust-clicks.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';
import { recordRole } from '../../../scripts/lib/role.js';
import { runningModel } from '../../../scripts/lib/front-desk-model.js';
import { decide as hold } from '../../../scripts/hooks/lineage-hold.js';
import { checkLineage, holdFile, MANIFEST_UNREADABLE, MANIFEST_UNREADABLE_NOT_HELD } from '../../../scripts/lineage/check.js';
import { pendingDir } from '../../../scripts/hooks/pending.js';
import { CLAUDE_CODE_FLOOR } from '../../../scripts/lib/build-loop.js';
import { writeCaFile } from '../../../scripts/host/company-ca.js';
import { tempFolder } from '../../helpers/homes.js';
import { beingSetUp, removedFrom } from '../../../scripts/hooks/kit.js';
import { lineageFixture, SHA } from '../../helpers/lineage.js';
import { WINDOWS_LINE, UNATTENDED_LINE } from '../../../scripts/lib/platform-lines.js';
import { helperAddress, keysDir, computerId, stateDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { selfTestFile } from '../../../scripts/windows/low.js';
import { settingKey } from '../../../scripts/protection/windows-builds.js';
import { unattendedBuildsLine, trustLine, setLineOf } from '../../../scripts/state/card-lines.js';
import { makeEvent, confirmationFor, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled, verify } from '../../../scripts/state/signing.js';
import { startRun, markStep, addChanges, newId, closeRun } from '../../../scripts/setup/journal.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { decide as toolGuard } from '../../../scripts/hooks/tool-guard.js';
import { decide as stopGuard } from '../../../scripts/hooks/stop-guard.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { journalFile } from '../../../scripts/lib/setup-run.js';
import { beforeTimer, nodeStartMs } from '../../helpers/until.js';
import { searchPathIn } from '../../helpers/env.js';

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
  { pluginRoot: PLUGIN_ROOT, client: f.client, spawn: f.spawn, platform: 'darwin', projectOf: () => ({ project: P }), stopState: () => ({ on: false }), pause: async () => {}, startWaitMs: 200, background: async () => ({ receiver: 'running', weekly: 'not-due' }), lineage: MATCHED, guardedSelfTest: async () => null, startLowNodeCopy: () => true, ...extra },
);
const text = (out) => out?.hookSpecificOutput?.additionalContext ?? '';
// The context without the tool sheet and the command line (tests/skills/tool-names.test.js pins those),
// for the tests that pin the other lines of a short reload exactly.
const SHEET_LINES = new Set(toolSheetLines('claude-code', { pluginRoot: PLUGIN_ROOT, platform: 'darwin' }));
const withoutSheet = (out) => text(out).split('\n').filter((l) => !SHEET_LINES.has(l) && !l.startsWith('The Wheelhouse command is ')).join('\n');
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

test('a helper started once setup has made the company\'s certificate gets it for Node.js, set at process start', async () => {
  const pem = fs.readFileSync(new URL('../../fixtures/certs/ca-valid.pem', import.meta.url), 'utf8');
  await withHome(async (home) => {
    const before = fake();
    await run(before);
    assert.equal(before.calls.spawn[0].opts.env.NODE_EXTRA_CA_CERTS, process.env.NODE_EXTRA_CA_CERTS);
    const file = writeCaFile({ home, pem });
    const after = fake();
    await run(after);
    assert.equal(after.calls.spawn[0].opts.env.NODE_EXTRA_CA_CERTS, file);
    assert.equal(searchPathIn(after.calls.spawn[0].opts.env), process.env.PATH);
    assert.equal(after.calls.spawn[0].opts.detached, true);
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

test('the reload leaves out a proposal kept as is on its card', async () => {
  await withHome(async () => {
    const f = fake({ views: {
      ...VIEWS,
      unconfirmed: [
        { kind: 'level', id: 'l1', key: 'copy-changes', data: { words: '"copy-changes": level 2' } },
        { kind: 'ruling', id: 'r9', data: { words: 'Do it this way' } },
      ],
      keptAsIs: ['l1'],
    } });
    const t = text(await run(f));
    assert.match(t, /Changed without the director's confirmation:\n- r9 \(ruling\): Do it this way/);
    assert.doesNotMatch(t, /l1 \(level/);
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

// The settings view as buildViews makes it, holding Unattended on `computer` from a click on its own card.
const unattendedOn = (computer, value = 'unattended') => ({
  [settingKey(computer)]: { key: settingKey(computer), id: 'e-1', at: '2026-10-19T01:00:00.000Z', value, computer, confirmedOn: computer, line: unattendedBuildsLine('e-1', computer) },
});

test('on Windows the session start runs the Guarded self-test when there is no recent result or the level would be Guarded', async () => {
  await withHome(async () => {
    const me = computerId();
    const NOW = new Date('2026-10-19T09:00:00.000Z');
    const tried = [];
    const guardedSelfTest = async (options) => {
      tried.push(options);
      const result = { at: NOW.toISOString(), lowStarts: true, writeHeld: true, keysReadHeld: false };
      fs.mkdirSync(path.dirname(selfTestFile(options.home)), { recursive: true });
      fs.writeFileSync(selfTestFile(options.home), JSON.stringify(result));
      return result;
    };
    const up = (settings = {}) => {
      const f = fake({ views: { ...VIEWS, settings } });
      f.client.health = async () => ({ ok: true });
      return f;
    };
    let copies = 0;
    const go = (f, extra = {}, input = {}) => run(f, {
      platform: 'win32', now: () => NOW, guardedSelfTest, lowNodeReady: () => true, startLowNodeCopy: () => { copies += 1; return true; }, ...extra,
    }, { cwd: '/x/wt', ...input });
    // With no whole copy of Node.js, the copy is started in the background and nothing waits for it.
    await go(up(), { lowNodeReady: () => false }, { session_id: 's0' });
    assert.equal(copies, 1);
    assert.equal(tried.length, 0, 'no self-test without the copy');
    await go(up());
    assert.equal(copies, 1, 'a whole copy is not made again');
    assert.equal(tried.length, 1, 'no result yet');
    assert.equal(tried[0].home, wheelhouseHome());
    assert.equal(tried[0].worktree, '/x/wt');
    assert.ok(tried[0].timeoutMs > 0 && tried[0].timeoutMs <= 3000, String(tried[0].timeoutMs));
    assert.equal(typeof tried[0].run, 'function');
    // A result under a day old is kept, unless the level would be Guarded.
    await go(up(), {}, { session_id: 's2' });
    assert.equal(tried.length, 1);
    const guarded = { [settingKey(me)]: { key: settingKey(me), id: 'e-g', at: '2026-10-19T01:00:00.000Z', value: 'guarded', computer: me, confirmedOn: me, line: null } };
    await go(up(guarded), {}, { session_id: 's3' });
    assert.equal(tried.length, 2);
    // A day later it runs again.
    await go(up(), { now: () => new Date(NOW.getTime() + 25 * 60 * 60 * 1000) }, { session_id: 's4' });
    assert.equal(tried.length, 3);
    // Never off Windows, and a self-test that fails leaves the session start as it was.
    await go(up(guarded), { platform: 'darwin' }, { session_id: 's5' });
    assert.equal(tried.length, 3);
    const out = await go(up(guarded), { guardedSelfTest: async () => { throw new Error('icacls'); } }, { session_id: 's6' });
    assert.match(text(out), new RegExp(WINDOWS_LINE.replace(/[.]/g, '\\.')));
  });
});

test('while Unattended is on, the Windows line is followed by the Unattended line', async () => {
  await withHome(async () => {
    const me = computerId();
    const up = (views) => {
      const f = fake({ views: { ...VIEWS, ...views } });
      f.client.health = async () => ({ ok: true });
      return f;
    };
    let n = 0;
    const session = () => ({ session_id: `u${(n += 1)}` });
    const lines = text(await run(up({ settings: unattendedOn(me) }), { platform: 'win32' }, session())).split('\n');
    assert.equal(lines[lines.indexOf(WINDOWS_LINE) + 1], UNATTENDED_LINE);
    // At Ask, for another computer, in a Locked project, or off Windows, nothing new.
    assert.doesNotMatch(text(await run(up({ settings: unattendedOn(me, 'ask') }), { platform: 'win32' }, session())), /unattended/);
    assert.doesNotMatch(text(await run(up({ settings: unattendedOn('deadbeef') }), { platform: 'win32' }, session())), /unattended/);
    assert.doesNotMatch(text(await run(up({}), { platform: 'win32' }, session())), /unattended/);
    const locked = { projectOf: () => ({ project: P, locked: true }), platform: 'win32' };
    assert.doesNotMatch(text(await run(up({ settings: unattendedOn(me) }), locked, session())), /unattended/);
    assert.doesNotMatch(text(await run(up({ settings: unattendedOn(me) }), { platform: 'darwin' }, session())), /unattended/);
    // Only with the Windows line, once a session.
    const again = session();
    assert.match(text(await run(up({ settings: unattendedOn(me) }), { platform: 'win32' }, again)), /unattended/);
    assert.doesNotMatch(text(await run(up({ settings: unattendedOn(me) }), { platform: 'win32' }, again)), /unattended/);
  });
});

test('with no helper, the level is read from the local events, as the waker reads them', async () => {
  await withHome(async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
    const me = computerId();
    const put = (event) => {
      const file = path.join(stateDir(P), eventPath(event));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(event));
    };
    const on = makeEvent({ kind: 'setting', data: { key: settingKey(me), value: 'unattended', words: 'Build commands: unattended' }, now: () => new Date('2026-10-19T01:00:00.000Z') });
    const { kind, data } = confirmationFor(on);
    put(on);
    put(makeEvent({ kind, data: { ...data, line: unattendedBuildsLine(on.id, me) }, now: () => new Date('2026-10-19T01:00:01.000Z') }));
    // The views on disk, as an older sync left them, say nothing of it.
    const views = path.join(process.env.WHEELHOUSE_HOME, 'projects', P, 'views');
    fs.mkdirSync(views, { recursive: true });
    fs.writeFileSync(path.join(views, 'settings.json'), '{}');
    fs.writeFileSync(path.join(views, 'unconfirmed.json'), '[]');
    const t = text(await run(fake({ startsUp: false }), { platform: 'win32' }));
    assert.match(t, new RegExp(NO_HELPER));
    const lines = t.split('\n');
    assert.equal(lines[lines.indexOf(WINDOWS_LINE) + 1], UNATTENDED_LINE);
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

test('the Windows and Unattended lines come before the lists, so a cut reload keeps them', async () => {
  await withHome(async () => {
    const me = computerId();
    const mk = (c) => Array.from({ length: 20 }, (_, i) => ({ id: `${c}${i}`, kind: 'ruling', status: 'accepted', words: longTitle(c, i), data: { title: longTitle(c, i), words: longTitle(c, i) } }));
    const f = fake({ views: { ...VIEWS, damaged: mk('d').map((x) => x.words), waiting: mk('w'), unconfirmed: mk('u'), rulebook: mk('r'), settings: unattendedOn(me) } });
    f.client.health = async () => ({ ok: true });
    const t = text(await run(f, { platform: 'win32', stopState: () => ({ on: true, by: 'the director', at: '2026-10-19T01:00:00.000Z' }) }));
    assert.equal(t.length, 9000, 'cut');
    const lines = t.split('\n');
    assert.match(lines[0], /^STOP is on/);
    assert.deepEqual(lines.slice(1, 3), [WINDOWS_LINE, UNATTENDED_LINE]);
  });
});

test('a computer id that can\'t be read leaves the rest of the reload, and shows Ask', async () => {
  await withHome(async (home) => {
    // computer.json as a folder: computerId throws.
    fs.mkdirSync(path.join(home, 'computer.json'), { recursive: true });
    assert.throws(() => computerId());
    const f = fake({ views: { ...VIEWS, waiting: [{ id: 'c1', data: { title: 'T' } }] } });
    f.client.health = async () => ({ ok: true });
    const t = text(await run(f, { platform: 'win32', stopState: () => ({ on: true, by: 'the director', at: '2026-10-19T01:00:00.000Z' }) }));
    assert.match(t, /^STOP is on/);
    assert.ok(t.includes(WINDOWS_LINE));
    assert.ok(!t.includes(UNATTENDED_LINE));
    assert.match(t, /c1: T/);
  });
});

test('a proposal for build commands on Windows is not listed as changed without the director\'s confirmation', async () => {
  await withHome(async () => {
    const f = fake({ views: { ...VIEWS, unconfirmed: [
      { kind: 'setting', id: 'e-b', at: '2026-10-19T01:00:00.000Z', key: settingKey('0a1b2c3d'), data: { key: settingKey('0a1b2c3d'), value: 'unattended' } },
      { kind: 'setting', id: 'e-s', at: '2026-10-19T01:00:01.000Z', key: 'reviewRounds', data: { key: 'reviewRounds', value: 3 } },
    ] } });
    f.client.health = async () => ({ ok: true });
    const t = text(await run(f));
    assert.match(t, /e-s \(setting reviewRounds\)/);
    assert.doesNotMatch(t, /e-b|windowsBuildCommands/);
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
    const ran = await beforeTimer(() => run(f, { totalMs: 300 }), 2000);
    assert.equal(ran.inTime, true, 'cut off');
    const t = text(ran.value);
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
  // The script asks the usual address: a socket in the home folder, or on Windows that home's pipe.
  const address = helperAddress({ home });
  await new Promise((resolve) => server.listen(address, resolve));
  // The receiver the session starts goes to a port of its own, and is stopped afterwards.
  const receiverPort = await new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
  fs.mkdirSync(path.join(home, 'usage'), { recursive: true });
  fs.writeFileSync(path.join(home, 'usage', 'receiver.json'), JSON.stringify({ port: receiverPort }));
  try {
    const boot = await nodeStartMs();
    const began = Date.now();
    const child = spawnChild(process.execPath, [SCRIPT], { env: { ...process.env, WHEELHOUSE_HOME: home }, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stdin.end(JSON.stringify({ cwd: repo, session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' }));
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(code, 0);
    // Its limits count from when Node has started it, which a loaded computer can make slow.
    assert.ok(Date.now() - began - boot < 10000, `took ${Date.now() - began} ms, ${boot} ms of it to start Node`);
    assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, new RegExp(NOT_SYNCED));
    assert.ok(fs.existsSync(path.join(home, 'usage', 'sessions', 's1.json')), 'the session\'s part is recorded');
  } finally {
    // The receiver is stopped once it has written its pid (a slow start on Windows takes seconds), and
    // waited for until it has gone, so it holds nothing in the folder when it is removed.
    const alive = (pid) => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    };
    for (let tries = 0; tries < 300; tries += 1) {
      let pid = null;
      try { pid = Number.parseInt(fs.readFileSync(path.join(home, 'usage', 'receiver.pid'), 'utf8'), 10); } catch { /* not written yet */ }
      if (Number.isInteger(pid)) {
        try { process.kill(pid); } catch { /* not running */ }
        for (let wait = 0; wait < 100 && alive(pid); wait += 1) await new Promise((resolve) => setTimeout(resolve, 50));
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    server.close();
    // On Windows a stopped process's files may be held a moment longer: removal tries again.
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
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

const OLD_LINE = 'This Claude Code is older than 2.1.299, so Wheelhouse\'s mod doesn\'t load and a guard that fails may not stop a tool call: update Claude Code';

function transcript(home, entries) {
  const file = path.join(home, 'transcript.jsonl');
  fs.writeFileSync(file, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
  return file;
}

test('a Claude Code older than 2.1.299, read from the transcript\'s last entry, is named; a newer or unknown one is not', async () => {
  await withHome(async (home) => {
    const f = fake();
    f.client.health = async () => ({ ok: true });
    const said = async (entries) => text(await run(f, {}, { transcript_path: entries === null ? path.join(home, 'absent.jsonl') : transcript(home, entries) }));
    assert.ok((await said([{ type: 'user', version: '2.1.300' }, { type: 'assistant', version: '2.1.298' }])).includes(OLD_LINE), 'the last entry counts');
    assert.ok((await said([{ type: 'user', version: '2.1.295' }])).includes(OLD_LINE), 'a guard holds on 2.1.295, but the mod does not load');
    assert.ok((await said([{ type: 'user', version: '2.0.999' }])).includes(OLD_LINE));
    assert.ok((await said([{ type: 'user', version: '1.9.0' }])).includes(OLD_LINE));
    assert.ok(!(await said([{ type: 'user', version: '2.1.298' }, { type: 'assistant', version: '2.1.299' }])).includes(OLD_LINE));
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
    const ran = await beforeTimer(() => run(fake(), { totalMs: 400, background: () => new Promise(() => {}) }), 1500);
    assert.equal(ran.inTime, true, 'cut off');
    const hung = ran.value;
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

// The foreman's start is the last thing setup does, once step 10's board is green (ruling R44):
// a session start in a project setup is still finishing starts no watcher.
test('the session start starts no watcher in a project setup is still finishing', async () => {
  await withHome(async (home) => {
    const folder = fs.realpathSync.native(tempFolder('wh-finishing zoë '));
    fs.mkdirSync(path.join(folder, '.git'));
    writeProject(P, { folder, remoteUrl: 'https://example.com/o/p.git', host: 'github', repo: 'o/p', connection: {} });
    const T = Date.parse('2026-10-19T03:00:00.000Z');
    const setupRun = startRun({ folder, now: () => new Date(T) });
    for (let n = 1; n <= 9; n += 1) markStep(setupRun.id, n, 'doneAt', { now: () => new Date(T + n * 60000) });
    const start = (f) => decide({ cwd: folder, session_id: 's1' }, {
      pluginRoot: PLUGIN_ROOT, client: f.client, spawn: f.spawn, platform: 'darwin', dir: path.join(home, 'managed'), stopState: () => ({ on: false }),
      pause: async () => {}, startWaitMs: 200, background: async () => ({ receiver: 'running', weekly: 'not-due' }), lineage: MATCHED,
      guardedSelfTest: async () => null, startLowNodeCopy: () => true,
    });
    const f = fake();
    f.client.health = async () => ({ ok: true });
    f.client.config = async () => shapeConfig(1);
    await start(f);
    assert.equal(watcherStarts(f).length, 0, 'not while step 10 is unfinished');
    // Interrupted after step 10's apply, before the board went green (ruling R67): the session
    // start resumes at step 10 and starts no watcher.
    markStep(setupRun.id, 10, 'doneAt', { now: () => new Date(T + 10 * 60000) });
    const resumed = await start(f);
    assert.equal(watcherStarts(f).length, 0, 'not before the board is green');
    assert.ok(text(resumed).split('\n').includes('Setup is part-way through: step 10, Health check, is next. Follow wheelhouse:setup.'), text(resumed));
    addChanges(setupRun.id, [{ id: newId('chg'), step: 10, kind: 'answer', target: 'step 10', before: null, after: { green: new Date(T + 11 * 60000).toISOString() } }]);
    await start(f);
    assert.equal(watcherStarts(f).length, 1, 'a project setup has finished is started as any other');
  });
});

// Whether setup has finished here isn't known while its journal can't be read, so the foreman,
// the last thing setup starts, is held back (rulings R44, R67); the rest of the session start
// goes on as in any project, and the front desk's reload says why, naming what to tell the
// director (rulings R72, R73).
test('in a registered folder whose setup journal can\'t be read, the session start starts no watcher and tells the front desk why', async () => {
  await withHome(async (home) => {
    assert.equal(FOREMAN_HELD_NEWER, 'The foreman is held back because setup\'s journal couldn\'t be read: a newer Wheelhouse wrote it. Tell the director to update Wheelhouse.');
    assert.equal(FOREMAN_HELD_UNREADABLE, 'The foreman is held back because setup\'s journal couldn\'t be read. Tell the director, and follow wheelhouse:setup to look at it.');
    const folder = fs.realpathSync.native(tempFolder('wh-unreadable journal '));
    fs.mkdirSync(path.join(folder, '.git'));
    writeProject(P, { folder, remoteUrl: 'https://example.com/o/p.git', host: 'github', repo: 'o/p', connection: {} });
    const start = (f, env = {}) => decide({ cwd: folder, session_id: 's1' }, {
      pluginRoot: PLUGIN_ROOT, client: f.client, spawn: f.spawn, platform: 'darwin', dir: path.join(home, 'managed'), stopState: () => ({ on: false }),
      pause: async () => {}, startWaitMs: 200, background: async () => ({ receiver: 'running', weekly: 'not-due' }), lineage: MATCHED,
      guardedSelfTest: async () => null, startLowNodeCopy: () => true, env,
    });
    // A helper that answers and a Shape 1 project: a watcher would be started.
    const shape1 = () => {
      const made = fake();
      made.client.health = async () => ({ ok: true });
      made.client.config = async () => shapeConfig(1);
      return made;
    };
    const f = shape1();
    const held = [FOREMAN_HELD_NEWER, FOREMAN_HELD_UNREADABLE, JOURNAL_UNREADABLE];
    const heldLines = (out) => text(out).split('\n').filter((l) => held.includes(l));
    fs.mkdirSync(path.dirname(journalFile()), { recursive: true });
    // Not JSON, a journal of another shape, and one a newer Wheelhouse wrote.
    const cases = [
      ['not json', FOREMAN_HELD_UNREADABLE],
      ['{"v":1,"runs":{}}', FOREMAN_HELD_UNREADABLE],
      ['[]', FOREMAN_HELD_UNREADABLE],
      ['{"v":2,"runs":[]}', FOREMAN_HELD_NEWER],
      ['{"v":3}', FOREMAN_HELD_NEWER],
    ];
    for (const [journal, line] of cases) {
      fs.writeFileSync(journalFile(), journal);
      assert.equal(beingSetUp(folder), null, 'the guards treat it as the project it is');
      const out = await start(f);
      assert.equal(watcherStarts(f).length, 0, `not while the journal can't be read: ${journal}`);
      assert.deepEqual(heldLines(out), [line], journal);
      // The rest of the reload is a project's: the front desk's line is there too.
      assert.ok(text(out).split('\n').includes(FRONT_DESK_LINE), journal);
      // Nothing rewrites the journal.
      assert.equal(fs.readFileSync(journalFile(), 'utf8'), journal);
    }
    // The foreman's own session and a feature's are held back too, and given no such line.
    const foreman = shape1();
    const foremanOut = await start(foreman, { WHEELHOUSE_ROLE: 'foreman' });
    assert.equal(watcherStarts(foreman).length, 0);
    assert.deepEqual(heldLines(foremanOut), []);
    fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/feature/login\n');
    const feature = shape1();
    const featureOut = await start(feature);
    assert.equal(watcherStarts(feature).length, 0);
    assert.deepEqual(heldLines(featureOut), []);
    assert.ok(!text(featureOut).split('\n').includes(FRONT_DESK_LINE));
    fs.rmSync(path.join(folder, '.git', 'HEAD'));
    // Held back with the helper down too, and still said.
    const down = fake({ startsUp: false });
    down.client.config = async () => shapeConfig(1);
    const unhelped = await start(down);
    assert.equal(watcherStarts(down).length, 0);
    assert.deepEqual(heldLines(unhelped), [FOREMAN_HELD_NEWER]);
    // Readable again (no journal at all: setup never ran here), it is started, and the reload
    // has no such line.
    fs.rmSync(journalFile());
    const readable = await start(f);
    assert.equal(watcherStarts(f).length, 1);
    assert.deepEqual(heldLines(readable), []);
    // A readable journal whose runs are elsewhere, too.
    fs.writeFileSync(journalFile(), JSON.stringify({ v: 1, runs: [] }));
    const again = shape1();
    assert.deepEqual(heldLines(await start(again)), []);
    assert.equal(watcherStarts(again).length, 1);
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
      assert.equal((await beforeTimer(() => run(f, { totalMs: 400 }), 3000)).inTime, true, 'cut off');
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
    assert.equal(FRONT_DESK_LINE, 'This is the front desk. Load wheelhouse:front-desk before you write anything, and never announce a skill: the director sees every line.');
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

test('the front desk\'s session start keeps the model it runs on; a feature\'s or the foreman\'s keeps nothing (design section 8)', async () => {
  await withHome(async (home) => {
    await run(fake(), { env: {} }, { model: 'model-small' });
    assert.equal(runningModel(P).model, 'model-small');
    await run(fake(), { env: { WHEELHOUSE_ROLE: 'foreman' } }, { model: 'model-foreman' });
    assert.equal(runningModel(P).model, 'model-small', 'the foreman runs on its own model');
    const tree = path.join(home, 'tree');
    const gitdir = path.join(home, 'main', '.git', 'worktrees', 'tree');
    fs.mkdirSync(tree, { recursive: true });
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${gitdir}\n`);
    fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/feature/gift-cards\n');
    await run(fake(), { env: {} }, { cwd: tree, model: 'model-builder' });
    assert.equal(runningModel(P).model, 'model-small', 'nor does a feature session');
    // A session start with no model leaves what was kept.
    await run(fake(), { env: {} });
    assert.equal(runningModel(P).model, 'model-small');
    await run(fake(), { env: {} }, { model: { id: 'model-top' } });
    assert.equal(runningModel(P).model, 'model-top');
  });
});

test('in the main folder the session start keeps .wheelhouse/ out of git, once, and leaves other folders alone (F87)', async () => {
  await withHome(async (home) => {
    const main = path.join(home, 'main');
    fs.mkdirSync(main, { recursive: true });
    spawnSync('git', ['init', '--quiet', main]);
    const exclude = path.join(main, '.git', 'info', 'exclude');
    const listed = () => (fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8').split('\n').filter((l) => l.trim() === '.wheelhouse/').length : 0);
    const inMain = { projectOf: () => ({ project: P, record: { folder: main } }), env: {} };
    assert.equal(listed(), 0);
    assert.match(text(await run(fake(), inMain, { cwd: main })), /This is the front desk/);
    assert.equal(listed(), 1, 'added to the main checkout\'s local exclusions');
    await run(fake(), inMain, { cwd: main });
    assert.equal(listed(), 1, 'a second start does not add it again');

    // A feature worktree's session, and a folder that isn't a project, change nothing.
    const other = path.join(home, 'other');
    fs.mkdirSync(other, { recursive: true });
    spawnSync('git', ['init', '--quiet', other]);
    const otherExclude = path.join(other, '.git', 'info', 'exclude');
    const before = fs.readFileSync(otherExclude, 'utf8');
    const tree = path.join(home, 'tree');
    const gitdir = path.join(other, '.git', 'worktrees', 'tree');
    fs.mkdirSync(tree, { recursive: true });
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${gitdir}\n`);
    fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/feature/gift-cards\n');
    await run(fake(), { projectOf: () => ({ project: P, record: { folder: other } }), env: {} }, { cwd: tree });
    assert.equal(await run(fake(), { projectOf: () => null, env: {} }, { cwd: other }), undefined);
    assert.equal(fs.readFileSync(otherExclude, 'utf8'), before);

    // A local exclusions file that can't be written changes nothing else the session start does.
    fs.rmSync(otherExclude);
    fs.mkdirSync(otherExclude);
    const out = text(await run(fake(), { projectOf: () => ({ project: P, record: { folder: other } }), env: {} }, { cwd: other }));
    assert.match(out, /This is the front desk/);
    assert.ok(fs.statSync(otherExclude).isDirectory());
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

test('a session start in a project whose setup has not reached step 7 holds nothing for kits not installed yet; once step 7 is done, it does (ruling R136)', async () => {
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-ss-setting-up-'));
    writeProject(P, { folder, remoteUrl: 'https://github.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });
    // Nothing installed for this folder: the fixture's installs are for another.
    const fixture = lineageFixture(tempFolder('wh-ss-elsewhere-'));
    const run = startRun({ folder, now: () => new Date('2026-10-20T03:00:00.000Z') });
    for (const n of [1, 2, 3, 4, 5, 6]) markStep(run.id, n, 'doneAt', { now: () => new Date('2026-10-20T03:00:00.000Z') });
    const f = fake();
    f.client.health = async () => ({ ok: true });
    const said = text(await lineageRun(f, fixture, folder, {}, { cwd: folder }));
    assert.doesNotMatch(said, /Lineage/);
    assert.match(said, /Setup is part-way through: step 7/);
    assert.equal(fs.existsSync(holdFile(P)), false, 'no hold: setup installs the kits at step 7');
    assert.equal(await hold({ ...call(folder, 'Edit'), cwd: folder }, { projectOf: () => ({ project: P }) }), undefined);
    // A kit installed but differing still holds while setup is part-way.
    const differs = lineageFixture(folder);
    differs.put({ LICENSE: 'another licence\n' });
    assert.match(text(await lineageRun(f, differs, folder, {}, { cwd: folder })), /Lineage/);
    assert.equal(fs.existsSync(holdFile(P)), true);
    // Once step 7 has installed them, kits not installed hold again.
    markStep(run.id, 7, 'doneAt', { now: () => new Date('2026-10-20T03:00:00.000Z') });
    fs.rmSync(holdFile(P));
    assert.equal(text(await lineageRun(f, fixture, folder, {}, { cwd: folder })).split('\n')[0], LINEAGE_LINE('not installed'));
    assert.equal(fs.existsSync(holdFile(P)), true);
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

test('a matching check after a hold records a lift, once; a compaction records one when the file is gone', async () => {
  await withHome(async () => {
    const folder = tempFolder('wh-ss-project-');
    const fixture = lineageFixture(folder);
    const standing = { lineageHolds: [{ id: 'h1', at: '2026-10-19T02:00:00.000Z', computer: computerId(), data: { at: '2026-10-19T02:00:00.000Z', mismatches: [{ upstream: 'superpowers', path: 'LICENSE' }] }, card: null }] };
    const f = fake({ views: { ...VIEWS, ...standing } });
    const lifts = () => f.calls.writes.filter((w) => w.kind === 'lineage-lift');
    const at = { now: () => new Date('2026-10-19T06:00:00.000Z') };
    // The hold file stands, so the hold stands.
    fixture.put({ LICENSE: 'another licence\n' });
    await lineageRun(f, fixture, folder, at);
    assert.equal(lifts().length, 0);
    // A matching check removes the file; the views still show the hold, so one lift is recorded.
    fixture.restore();
    await lineageRun(f, fixture, folder, at);
    assert.deepEqual(lifts(), [{ project: P, kind: 'lineage-lift', data: { at: '2026-10-19T06:00:00.000Z', holds: ['h1'] } }]);
    // With the hold lifted in the views, nothing more.
    const done = fake({ views: { ...VIEWS, lineageHolds: [] } });
    await lineageRun(done, fixture, folder, at);
    assert.equal(done.calls.writes.filter((w) => w.kind === 'lineage-lift').length, 0);
  });
});

test('a compaction that finds the hold file gone records a lift, and never writes the file', async () => {
  await withHome(async () => {
    const folder = tempFolder('wh-ss-project-');
    const fixture = lineageFixture(folder);
    const standing = { lineageHolds: [{ id: 'h1', at: '2026-10-19T02:00:00.000Z', computer: computerId(), data: { at: '2026-10-19T02:00:00.000Z', mismatches: [{ upstream: 'superpowers', path: 'LICENSE' }] }, card: null }] };
    const f = fake({ views: { ...VIEWS, ...standing } });
    await lineageRun(f, fixture, folder, {}, { source: 'compact' });
    await lineageRun(f, fixture, folder, {}, { source: 'compact' });
    assert.equal(f.calls.writes.filter((w) => w.kind === 'lineage-lift').length, 1);
    assert.equal(fs.existsSync(holdFile(P)), false);
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
  assert.equal(OLD_CLAUDE_CODE, 'This Claude Code is older than 2.1.299, so Wheelhouse\'s mod doesn\'t load and a guard that fails may not stop a tool call: update Claude Code');
});

test('on Windows under STOP, the lineage hold line comes first after STOP, then the Windows lines', async () => {
  await withHome(async () => {
    const folder = tempFolder('wh-ss-project-');
    const fixture = lineageFixture(folder);
    fixture.put({ LICENSE: 'another licence\n' });
    const f = fake({ views: { ...VIEWS, settings: unattendedOn(computerId()) } });
    f.client.health = async () => ({ ok: true });
    const stop = { stopState: () => ({ on: true, by: 'prompt', at: '2026-10-18T01:00:00.000Z' }), now: () => new Date('2026-10-19T02:00:00.000Z') };
    const lines = text(await lineageRun(f, fixture, folder, { ...stop, platform: 'win32' })).split('\n');
    assert.deepEqual(lines.slice(0, 4), [
      'STOP is on (set by prompt at 2026-10-18T01:00:00.000Z)', LINEAGE_LINE('LICENSE'), WINDOWS_LINE, UNATTENDED_LINE,
    ]);
  });
});

// --- A folder being set up: no project record yet, the plugin switched on in its own settings or a setup run there.

const pluginOn = (folder) => {
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'wheelhouse@wheelhouse': true } }));
  return folder;
};
const setupStart = (f, cwd, extra = {}) => decide(
  { cwd, session_id: 's1' },
  { pluginRoot: PLUGIN_ROOT, client: f.client, spawn: f.spawn, platform: 'darwin', projectOf: () => null, stopState: () => ({ on: false }), pause: async () => {}, startWaitMs: 200, ...extra },
);

test('a fresh computer gets a signing key and enrols it once', async () => {
  await withHome(async () => {
    const folder = pluginOn(fs.realpathSync.native(tempFolder('wh-fresh zoë ')));
    const f = fake();
    const out = await setupStart(f, folder);
    const keyFile = path.join(keysDir(), 'signing.pem');
    const key = fs.readFileSync(keyFile, 'utf8');
    assert.deepEqual(readEnrolled().map((e) => e.computer), [computerId()]);
    assert.equal(withoutSheet(out), 'This folder isn\'t set up for Wheelhouse yet. Follow wheelhouse:setup.');
    // The first click can be signed and checked.
    const signed = makeEvent({ kind: 'action', data: { action: 'lift-stop', question: 'q', label: 'Lift STOP' } });
    assert.equal(verify(signed, readEnrolled()), true);
    // A second session start makes no new key and adds nothing.
    await setupStart(fake(), folder);
    assert.equal(fs.readFileSync(keyFile, 'utf8'), key);
    assert.equal(readEnrolled().length, 1);
  });
  // A computer that already has a list: its own key is made, and the list is left as it is.
  await withHome(async () => {
    const other = { computer: 'aaaaaaaa', publicKey: 'b3RoZXI=', enrolledAt: '2026-10-01T00:00:00.000Z' };
    enrol(other);
    const folder = pluginOn(fs.realpathSync.native(tempFolder('wh-listed-')));
    await setupStart(fake(), folder);
    assert.ok(fs.existsSync(path.join(keysDir(), 'signing.pem')));
    assert.deepEqual(readEnrolled(), [other]);
  });
  // A key made before, with no list yet (a start cut short): it is enrolled, not replaced.
  await withHome(async () => {
    const made = makeSigningKey();
    const key = fs.readFileSync(path.join(keysDir(), 'signing.pem'), 'utf8');
    const folder = pluginOn(fs.realpathSync.native(tempFolder('wh-half-')));
    await setupStart(fake(), folder);
    assert.equal(fs.readFileSync(path.join(keysDir(), 'signing.pem'), 'utf8'), key);
    assert.deepEqual(readEnrolled().map((e) => [e.computer, e.publicKey]), [[made.computer, made.publicKey]]);
  });
  // Outside every project and setup, nothing is made.
  await withHome(async () => {
    await setupStart(fake(), fs.realpathSync.native(tempFolder('wh-stranger-')));
    assert.equal(fs.existsSync(path.join(keysDir(), 'signing.pem')), false);
    assert.deepEqual(readEnrolled(), []);
  });
});

// A folder with no project record, with a journal that can't be read, is counted as being set up
// (kit.js's beingSetUp): its reload has setup's own line for it, and not the project's as well.
test('in a folder being set up, a journal that can\'t be read gives setup\'s line alone', async () => {
  await withHome(async () => {
    const folder = pluginOn(fs.realpathSync.native(tempFolder('wh-unread-setup ')));
    fs.mkdirSync(path.dirname(journalFile()), { recursive: true });
    for (const journal of ['not json', '{"v":2,"runs":[]}']) {
      fs.writeFileSync(journalFile(), journal);
      const f = fake();
      f.client.health = async () => ({ ok: true });
      const out = await setupStart(f, folder);
      assert.equal(withoutSheet(out), JOURNAL_UNREADABLE, journal);
    }
  });
});

test('the next session start resumes at the first unfinished step', async () => {
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-resume '));
    const run = startRun({ folder, now: () => new Date('2026-10-19T03:00:00.000Z') });
    const at = (m) => () => new Date(Date.parse('2026-10-19T03:00:00.000Z') + m * 60000);
    markStep(run.id, 1, 'shownAt', { now: at(1) });
    markStep(run.id, 1, 'clickedAt', { now: at(2) });
    markStep(run.id, 1, 'doneAt', { now: at(3) });
    // Step 2 (the long installs) is still running while step 3 finished.
    markStep(run.id, 2, 'clickedAt', { now: at(4) });
    markStep(run.id, 3, 'doneAt', { now: at(5) });
    const f = fake();
    const out = await setupStart(f, folder);
    assert.equal(f.calls.spawn.length, 1, 'the helper is started as in a project');
    assert.equal(withoutSheet(out), 'Setup is part-way through: step 2, Tools, is next. Follow wheelhouse:setup.');
    // From a folder inside it too, and once step 2 is done the next is step 4: step 3 is not repeated.
    markStep(run.id, 2, 'doneAt', { now: at(6) });
    fs.mkdirSync(path.join(folder, 'web'));
    const later = await setupStart(fake(), path.join(folder, 'web'));
    assert.equal(withoutSheet(later), 'Setup is part-way through: step 4, Three questions, is next. Follow wheelhouse:setup.');
    // STOP and a helper that could not start are said first.
    const stopped = await setupStart(fake({ startsUp: false }), folder, { stopState: () => ({ on: true, by: 'prompt', at: '2026-10-19T04:00:00.000Z' }) });
    assert.deepEqual(withoutSheet(stopped).split('\n'), [
      'STOP is on (set by prompt at 2026-10-19T04:00:00.000Z)',
      NO_HELPER,
      'Setup is part-way through: step 4, Three questions, is next. Follow wheelhouse:setup.',
    ]);
  });
});

test('the guards act in a folder being set up', async () => {
  await withHome(async (home) => {
    const managed = path.join(home, 'managed');
    const withRun = fs.realpathSync.native(tempFolder('wh-guarded zoë '));
    startRun({ folder: withRun });
    const switchedOn = pluginOn(fs.realpathSync.native(tempFolder('wh-switched-')));
    const stranger = fs.realpathSync.native(tempFolder('wh-stranger-'));
    const bash = (cwd, command) => ({ ...call(cwd, 'Bash'), tool_input: { command } });
    const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';
    const tool = (input) => toolGuard(input, { dir: managed, home: os.homedir(), platform: 'darwin', pluginRoot: PLUGIN_ROOT });
    const stop = (input) => stopGuard(input, { dir: managed, pluginRoot: PLUGIN_ROOT, platform: 'darwin' });
    for (const folder of [withRun, switchedOn]) {
      assert.ok(denied(await tool(bash(folder, 'gh pr merge 3'))), folder);
      assert.ok(denied(await tool({ ...call(folder, 'Read'), tool_input: { file_path: path.join(folder, '.env') } })), folder);
      assert.ok(denied(await tool({ ...call(folder, 'Write'), tool_input: { file_path: path.join(home, 'keys', 'signing.pem') } })), folder);
    }
    assert.equal(await tool(bash(stranger, 'gh pr merge 3')), undefined, 'a folder no one is setting up is left alone');
    setStop({ by: 'prompt' });
    const cli = `node ${PLUGIN_ROOT}/scripts/setup/cli.js`;
    for (const folder of [withRun, switchedOn]) {
      assert.ok(denied(await stop({ ...call(folder, 'Write'), tool_input: { file_path: path.join(folder, 'a.txt') } })), folder);
      assert.ok(denied(await stop(bash(folder, 'npm install'))), folder);
      // `health` with the trial lines the session printed is a reading form too (ruling R41).
      const trialLine = '"read .env.local: refused / refused"';
      for (const reading of ['status', 'plan 3', 'plan 10', 'resume', 'health', `health ${trialLine}`, `health ${trialLine} "merge with forged approval: refused / MERGED (unexpected)"`,
        'uninstall plan', 'uninstall status']) {
        assert.equal(await stop(bash(folder, `${cli} ${reading}`)), undefined, reading);
      }
      for (const writing of [`apply 3 ${'a'.repeat(64)}`, 'plan 11', 'plan', 'status now', 'resume 3', 'status; rm -rf x', 'health "not a line"', 'health status',
        `uninstall apply ${'a'.repeat(64)}`, 'uninstall', 'uninstall plan 3',
        `health ${Array.from({ length: 13 }, () => trialLine).join(' ')}`]) assert.ok(denied(await stop(bash(folder, `${cli} ${writing}`))), writing);
      assert.equal(await stop(call(folder, 'Read')), undefined);
    }
    assert.equal(await stop({ ...call(stranger, 'Write'), tool_input: { file_path: path.join(stranger, 'a.txt') } }), undefined);
    liftStop();
  });
});

// The setup playbook runs the Wheelhouse command, so a folder being set up, and one Wheelhouse was removed
// from (whose director may set it up again), are told the tool sheet and where the command is.
test('a folder being set up, and one Wheelhouse was removed from, are given the tool sheet and the command line', async () => {
  await withHome(async () => {
    const sheet = toolSheetLines('claude-code', { pluginRoot: PLUGIN_ROOT, platform: 'darwin' });
    const folder = fs.realpathSync.native(tempFolder('wh-sheet-setup '));
    const T = Date.parse('2026-10-20T03:00:00.000Z');
    const run = startRun({ folder, now: () => new Date(T) });
    const part = text(await setupStart(fake(), folder)).split('\n');
    assert.deepEqual(part, [...sheet, 'Setup is part-way through: step 1, Install, is next. Follow wheelhouse:setup.']);
    for (const n of [1, 2, 3]) markStep(run.id, n, 'doneAt', { now: () => new Date(T + n * 60000) });
    closeRun(run.id, { at: () => new Date(T + 3600000), by: 'uninstall' });
    assert.deepEqual(text(await setupStart(fake(), folder)).split('\n'), [REMOVED, ...sheet]);
  });
});

test('a folder whose setup run uninstall closed reads as removed, not as being set up, and the guards leave it (ruling R89)', async () => {
  await withHome(async (home) => {
    const managed = path.join(home, 'managed');
    const T = Date.parse('2026-10-20T03:00:00.000Z');
    // The plugin is still switched on in the folder's own settings until the director removes it.
    const folder = pluginOn(fs.realpathSync.native(tempFolder('wh-removed zoë ')));
    const run = startRun({ folder, now: () => new Date(T) });
    for (const n of [1, 2, 3]) markStep(run.id, n, 'doneAt', { now: () => new Date(T + n * 60000) });
    closeRun(run.id, { at: () => new Date(T + 3600000), by: 'uninstall' });
    fs.mkdirSync(path.join(folder, 'web'));
    for (const cwd of [folder, path.join(folder, 'web')]) {
      assert.equal(beingSetUp(cwd), null, cwd);
      assert.equal(removedFrom(cwd)?.run?.id, run.id, cwd);
      const f = fake();
      const out = await setupStart(f, cwd);
      assert.equal(withoutSheet(out), REMOVED, cwd);
      assert.notEqual(withoutSheet(out), NOT_SET_UP);
      assert.equal(f.calls.spawn.length, 0, 'no helper is started for a folder Wheelhouse was removed from');
    }
    // A new folder made inside it, whose own settings switch the plugin on, is a folder of its own
    // to set up: only the removed folder itself reads as removed.
    const inner = pluginOn(path.join(folder, 'new shop'));
    assert.deepEqual(beingSetUp(inner), { folder: inner, run: null, journal: true });
    assert.equal(withoutSheet(await setupStart(fake(), inner)), NOT_SET_UP);
    assert.equal(PLUGIN_KEY, 'wheelhouse@wheelhouse', 'the key setup\'s step 1 switches on');
    assert.ok(REMOVED.includes(REMOVE_PLUGIN) && REMOVE_PLUGIN.includes(PLUGIN_KEY), REMOVED);
    assert.match(REMOVED, /^Wheelhouse was removed from this folder\./);
    // The guards no longer act there: Wheelhouse is gone from it.
    const bash = (command) => ({ ...call(folder, 'Bash'), tool_input: { command } });
    assert.equal(await toolGuard(bash('gh pr merge 3'), { dir: managed, home: os.homedir(), platform: 'darwin', pluginRoot: PLUGIN_ROOT }), undefined);
    setStop({ by: 'prompt' });
    try {
      assert.equal(await stopGuard(bash('npm install'), { dir: managed, pluginRoot: PLUGIN_ROOT, platform: 'darwin' }), undefined);
    } finally {
      liftStop();
    }
    // A folder nothing was ever set up in, with the plugin on, still reads as not set up yet.
    const fresh = pluginOn(fs.realpathSync.native(tempFolder('wh-fresh-again ')));
    assert.equal(removedFrom(fresh), null);
    assert.equal(withoutSheet(await setupStart(fake(), fresh)), NOT_SET_UP);
  });
});

test('a folder set up again after uninstall reads as being set up by the newer run (ruling R89)', async () => {
  await withHome(async () => {
    const T = Date.parse('2026-10-20T03:00:00.000Z');
    const folder = pluginOn(fs.realpathSync.native(tempFolder('wh-again zoë ')));
    const old = startRun({ folder, now: () => new Date(T) });
    for (const n of [1, 2, 3, 4]) markStep(old.id, n, 'doneAt', { now: () => new Date(T + n * 60000) });
    closeRun(old.id, { at: () => new Date(T + 3600000), by: 'uninstall' });
    const again = startRun({ folder, now: () => new Date(T + 7200000) });
    markStep(again.id, 1, 'doneAt', { now: () => new Date(T + 7260000) });
    assert.equal(beingSetUp(folder)?.run?.id, again.id);
    assert.equal(removedFrom(folder), null);
    assert.equal(withoutSheet(await setupStart(fake(), folder)), 'Setup is part-way through: step 2, Tools, is next. Follow wheelhouse:setup.');
    // Uninstalled again, it reads as removed again.
    closeRun(again.id, { at: () => new Date(T + 9000000), by: 'uninstall' });
    assert.equal(beingSetUp(folder), null);
    assert.equal(removedFrom(folder)?.run?.id, again.id);
  });
  // A registered folder whose latest run is closed is a project like any other, never being set up.
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-registered-closed '));
    writeProject('o__closed', { folder, remoteUrl: 'https://example.com/o/p.git', host: 'github', repo: 'o/p', connection: {} });
    const run = startRun({ folder });
    markStep(run.id, 1, 'doneAt', {});
    assert.equal(beingSetUp(folder)?.run?.id, run.id, 'unfinished, so being set up');
    closeRun(run.id, { by: 'uninstall' });
    assert.equal(beingSetUp(folder), null);
    assert.equal(removedFrom(folder), null, 'a registered folder is a project, not one Wheelhouse was removed from');
  });
});

test('in a registered folder setup is still finishing, the session start resumes it and the guards act, with or without its first commit', async () => {
  // Step 3 registers the folder; step 7 makes its first commit. Between them it has no .git.
  await withHome(async (home) => {
    const managed = path.join(home, 'managed');
    const T = Date.parse('2026-10-19T03:00:00.000Z');
    const start = (f, cwd) => decide({ cwd, session_id: 's1' }, {
      pluginRoot: PLUGIN_ROOT, client: f.client, spawn: f.spawn, platform: 'darwin', dir: managed, stopState: () => ({ on: false }),
      pause: async () => {}, startWaitMs: 200, background: async () => ({ receiver: 'running', weekly: 'not-due' }), lineage: MATCHED,
    });
    const STEP_4 = 'Setup is part-way through: step 4, Three questions, is next. Follow wheelhouse:setup.';
    for (const git of [false, true]) {
      const folder = fs.realpathSync.native(tempFolder(`wh-registered${git ? '-git' : ''} zoë `));
      if (git) fs.mkdirSync(path.join(folder, '.git'));
      writeProject(git ? 'o__git' : 'o__new', { folder, remoteUrl: 'https://example.com/o/p.git', host: 'github', repo: 'o/p', connection: {} });
      const run = startRun({ folder, now: () => new Date(T) });
      for (const n of [1, 2, 3]) markStep(run.id, n, 'doneAt', { now: () => new Date(T + n * 60000) });
      const f = fake();
      const out = await start(f, folder);
      assert.equal(f.calls.spawn.length, 1, `the helper is started (${git ? 'with' : 'without'} .git)`);
      const lines = text(out).split('\n');
      assert.ok(lines.includes(STEP_4), lines.join('\n'));
      assert.ok(!lines.includes(FRONT_DESK_LINE), 'setup, not the front desk, while setup is part-way');
      // The guards act there, as in a project.
      const bash = (command) => ({ ...call(folder, 'Bash'), tool_input: { command } });
      const denied = (answer) => answer?.hookSpecificOutput?.permissionDecision === 'deny';
      assert.ok(denied(await toolGuard(bash('gh pr merge 3'), { dir: managed, home: os.homedir(), platform: 'darwin', pluginRoot: PLUGIN_ROOT })));
      setStop({ by: 'prompt' });
      const stop = (input) => stopGuard(input, { dir: managed, pluginRoot: PLUGIN_ROOT, platform: 'darwin' });
      assert.ok(denied(await stop(bash('npm install'))));
      assert.equal(await stop(bash(`node ${PLUGIN_ROOT}/scripts/setup/cli.js resume`)), undefined);
      liftStop();
      // Once every step is done, the folder is a project like any other.
      for (let n = 4; n <= 10; n += 1) markStep(run.id, n, 'doneAt', { now: () => new Date(T + n * 60000) });
      addChanges(run.id, [{ id: newId('chg'), step: 10, kind: 'answer', target: 'step 10', before: null, after: { green: new Date(T + 11 * 60000).toISOString() } }]);
      const g = fake();
      const after = await start(g, folder);
      if (git) {
        assert.equal(g.calls.spawn.length, 1);
        assert.ok(!text(after).includes('Setup is part-way'), text(after));
        assert.ok(text(after).split('\n').includes(FRONT_DESK_LINE), text(after));
      } else {
        assert.equal(after, undefined);
        assert.equal(g.calls.spawn.length, 0);
      }
    }
  });
});

test('a run in a parent folder does not put a registered project below it in setup mode', async () => {
  // Ruling R27: another product's setup, unfinished in a folder above a registered project, is
  // not the project's. The project gets its front-desk line, and only a run in its own folder counts.
  await withHome(async (home) => {
    const managed = path.join(home, 'managed');
    const parent = fs.realpathSync.native(tempFolder('wh-parent zoë '));
    const parentRun = startRun({ folder: parent });
    const folder = path.join(parent, 'shop');
    fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
    fs.mkdirSync(path.join(folder, 'web'));
    writeProject('o__shop', { folder, remoteUrl: 'https://example.com/o/shop.git', host: 'github', repo: 'o/shop', connection: {} });
    assert.equal(beingSetUp(folder), null);
    assert.equal(beingSetUp(path.join(folder, 'web')), null);
    const f = fake();
    const out = await decide({ cwd: folder, session_id: 's1' }, {
      pluginRoot: PLUGIN_ROOT, client: f.client, spawn: f.spawn, platform: 'darwin', dir: managed, stopState: () => ({ on: false }),
      pause: async () => {}, startWaitMs: 200, background: async () => ({ receiver: 'running', weekly: 'not-due' }), lineage: MATCHED,
    });
    const lines = text(out).split('\n');
    assert.ok(lines.includes(FRONT_DESK_LINE), lines.join('\n'));
    assert.ok(!lines.some((l) => l.startsWith('Setup is part-way')), lines.join('\n'));
    // The parent's own folder is still being set up, and a run in the project's own folder counts there.
    assert.equal(beingSetUp(parent)?.run?.id, parentRun.id);
    const own = startRun({ folder: fs.realpathSync.native(folder) });
    assert.equal(beingSetUp(path.join(folder, 'web'))?.run?.id, own.id);
  });
});

test('on Windows, a registered folder being set up gets the Windows lines straight after STOP and setup\'s line in place of the front desk\'s; a folder with no project record gets no Windows lines', async () => {
  await withHome(async (home) => {
    const managed = path.join(home, 'managed');
    const T = Date.parse('2026-10-19T03:00:00.000Z');
    const me = computerId();
    const STOP = { on: true, by: 'prompt', at: '2026-10-19T04:00:00.000Z' };
    const windows = { platform: 'win32', stopState: () => STOP, guardedSelfTest: async () => null, lowNodeReady: () => false, startLowNodeCopy: () => true };
    const STEP_4 = 'Setup is part-way through: step 4, Three questions, is next. Follow wheelhouse:setup.';
    // Registered (step 3 done), with its first commit, Unattended on for this computer.
    const folder = fs.realpathSync.native(tempFolder('wh-registered-win zoë '));
    fs.mkdirSync(path.join(folder, '.git'));
    writeProject('o__win', { folder, remoteUrl: 'https://example.com/o/p.git', host: 'github', repo: 'o/p', connection: {} });
    const run3 = startRun({ folder, now: () => new Date(T) });
    for (const n of [1, 2, 3]) markStep(run3.id, n, 'doneAt', { now: () => new Date(T + n * 60000) });
    const f = fake({ views: { ...VIEWS, settings: unattendedOn(me) } });
    const out = await decide({ cwd: folder, session_id: 'w1' }, {
      pluginRoot: PLUGIN_ROOT, client: f.client, spawn: f.spawn, dir: managed, pause: async () => {}, startWaitMs: 200,
      background: async () => ({ receiver: 'running', weekly: 'not-due' }), lineage: MATCHED, ...windows,
    });
    const lines = text(out).split('\n');
    assert.deepEqual(lines.slice(0, 3), ['STOP is on (set by prompt at 2026-10-19T04:00:00.000Z)', WINDOWS_LINE, UNATTENDED_LINE], lines.join('\n'));
    assert.ok(lines.includes(STEP_4), lines.join('\n'));
    assert.ok(!lines.includes(FRONT_DESK_LINE), lines.join('\n'));
    // No project record yet: setup's short reload, with no Windows lines.
    const fresh = fs.realpathSync.native(tempFolder('wh-fresh-win-'));
    startRun({ folder: fresh, now: () => new Date(T) });
    const g = fake();
    const short = await decide({ cwd: fresh, session_id: 'w2' }, {
      pluginRoot: PLUGIN_ROOT, client: g.client, spawn: g.spawn, projectOf: () => null, pause: async () => {}, startWaitMs: 200, ...windows,
    });
    assert.deepEqual(withoutSheet(short).split('\n'), [
      'STOP is on (set by prompt at 2026-10-19T04:00:00.000Z)',
      'Setup is part-way through: step 1, Install, is next. Follow wheelhouse:setup.',
    ]);
  });
});

// ---- Another of the director's computers (rulings R80, R81) ----

// A public key made here, standing for another computer's.
const someKey = () => crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
// The trust cards a reload hands over, as AskUserQuestion's questions.
const trustCards = (out) => text(out).split('\n').filter((l) => l.startsWith(TRUST_ASK)).map((l) => JSON.parse(l.slice(TRUST_ASK.length)));
const ADDED = '2026-10-19T22:30:00.000Z';
const AT = Date.parse('2026-10-20T03:00:00.000Z');

test('the front desk is handed a trust card for each computer the profile holds that this one doesn\'t trust, the helper asked at most once an hour', async () => {
  await withHome(async (home) => {
    const own = makeSigningKey();
    enrol({ ...own, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const other = { computer: '0a1b2c3d', publicKey: someKey(), at: ADDED };
    const known = { computer: '1b2c3d4e', publicKey: someKey() };
    enrol({ ...known, enrolledAt: '2026-10-19T00:00:00.000Z' });
    let enrolments = [other, { ...known, publicKey: someKey(), at: ADDED }, { ...own, at: ADDED }];
    let asked = 0;
    const f = fake();
    f.client.profile = { enrolments: async () => { asked += 1; return { ok: true, fetched: true, enrolments }; } };
    const at = (minutes) => ({ now: () => new Date(AT + minutes * 60000) });

    const out = await run(f, at(0));
    assert.equal(asked, 1);
    const [card, ...more] = trustCards(out);
    assert.deepEqual(more, [], 'one card: this computer and the one it trusts get none');
    assert.equal(setLineOf(card.question), trustLine(other.computer, ADDED, fingerprint(other.publicKey)));
    assert.deepEqual(cardProblems(card.question), [], 'the card check lets it through');
    assert.deepEqual(card.options.map((o) => o.label), ['Trust it', 'Not now']);
    // A computer it trusts whose enrolment holds another key: a line, never a card.
    assert.ok(text(out).split('\n').includes(differentKeyLine(known.computer)));
    assert.equal(differentKeyLine(known.computer), 'A different key claims your computer 1b2c3d4e; nothing was trusted.');
    // When it asked is kept beside weekly.json.
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'jobs', 'enrolments.json'), 'utf8')).at, new Date(AT).toISOString());

    // Within the hour the helper isn't asked again: the card comes from what the last fetch found.
    assert.equal(trustCards(await run(f, at(59))).length, 1);
    assert.equal(asked, 1);
    // An hour on it is asked again; an ask with no answer (a refusal, or none in time) keeps what
    // the last fetch found and its time, so the next start asks again (ruling R107).
    f.client.profile.enrolments = async () => { asked += 1; return { ok: false, refused: 'the host helper did not answer in time' }; };
    assert.equal(trustCards(await run(f, at(60))).length, 1);
    assert.equal(asked, 2);
    assert.equal(trustCards(await run(f, at(61))).length, 1);
    assert.equal(asked, 3);
    // A fetch slower than what is left of the budget: asked again at the next start too.
    f.client.profile.enrolments = () => { asked += 1; return new Promise(() => {}); };
    assert.equal(trustCards(await run(f, { ...at(62), totalMs: 300 })).length, 1);
    assert.equal(asked, 4);
    f.client.profile.enrolments = async () => { asked += 1; return { ok: true, fetched: false, enrolments }; };
    assert.equal(trustCards(await run(f, at(63))).length, 1);
    assert.equal(asked, 5);
    // Once an answer has arrived (here the helper's fetch failed, and it said so), not again for an hour.
    assert.equal(trustCards(await run(f, at(90))).length, 1);
    assert.equal(asked, 5);
    // Each card handed over has its key's full hash kept, which a click must match.
    assert.deepEqual(readShownTrust(), { [setLineOf(card.question)]: keyHash(other.publicKey) });

    // Once trusted, no card.
    enrol({ computer: other.computer, publicKey: other.publicKey, enrolledAt: new Date(AT).toISOString() });
    assert.deepEqual(trustCards(await run(f, at(91))), []);

    // At most MAX_TRUST_CARDS a time, and a line saying more are waiting.
    enrolments = ['2a000001', '2a000002', '2a000003', '2a000004'].map((computer) => ({ computer, publicKey: someKey(), at: ADDED }));
    f.client.profile.enrolments = async () => { asked += 1; return { ok: true, fetched: true, enrolments }; };
    const many = await run(f, at(200));
    assert.equal(trustCards(many).length, MAX_TRUST_CARDS);
    assert.ok(text(many).includes(moreTrust(4 - MAX_TRUST_CARDS)));
  });
});

test('only the front desk is handed trust cards, and only once step 3 is done in a folder being set up', async () => {
  await withHome(async () => {
    const own = makeSigningKey();
    enrol({ ...own, enrolledAt: '2026-10-18T00:00:00.000Z' });
    let asked = 0;
    const f = fake();
    f.client.profile = { enrolments: async () => { asked += 1; return { ok: true, fetched: true, enrolments: [{ computer: '0a1b2c3d', publicKey: someKey(), at: ADDED }] }; } };
    // The foreman's session: not asked, no card.
    recordRole('s-foreman', 'foreman');
    assert.deepEqual(trustCards(await run(f, { now: () => new Date(AT) }, { session_id: 's-foreman' })), []);
    assert.equal(asked, 0);
    // A folder being set up: not before step 3 is done; then the card, for setup's session to ask.
    const folder = fs.realpathSync.native(tempFolder('wh-trust-setup '));
    const setupRun = startRun({ folder, now: () => new Date(AT) });
    const g = fake();
    g.client.profile = f.client.profile;
    assert.deepEqual(trustCards(await setupStart(g, folder, { now: () => new Date(AT) })), []);
    assert.equal(asked, 0);
    markStep(setupRun.id, 3, 'doneAt', { now: () => new Date(AT) });
    assert.equal(trustCards(await setupStart(g, folder, { now: () => new Date(AT) })).length, 1);
    assert.equal(asked, 1);
  });
});

test('a helper that answers nothing about enrolments costs the session start nothing and adds no line', async () => {
  await withHome(async () => {
    const f = fake();
    f.client.profile = { enrolments: async () => { throw new Error('boom'); } };
    const out = await run(f, { now: () => new Date(AT) });
    assert.deepEqual(trustCards(out), []);
    assert.doesNotMatch(text(out), /different key|trusted/);
  });
});

test('a compaction\'s start writes no hold', async () => {
  await withHome(async () => {
    const folder = tempFolder('wh-ss-compact-');
    const fixture = lineageFixture(folder);
    fixture.put({ LICENSE: 'another licence\n' });
    let checks = 0;
    const counting = (args) => { checks += 1; return checkLineage(args); };
    const said = text(await lineageRun(fake(), fixture, folder, { lineage: counting }, { source: 'compact' }));
    assert.equal(checks, 0, 'the check is not called');
    assert.equal(fs.existsSync(holdFile(P)), false);
    assert.doesNotMatch(said, /Lineage/);
  });
});

test('a compaction\'s start leaves a standing hold', async () => {
  await withHome(async () => {
    const folder = tempFolder('wh-ss-compact-held-');
    const fixture = lineageFixture(folder);
    fixture.put({ LICENSE: 'another licence\n' });
    const f = fake();
    await lineageRun(f, fixture, folder, {}, { source: 'startup' });
    assert.ok(fs.existsSync(holdFile(P)), 'held before');
    const before = fs.readFileSync(holdFile(P), 'utf8');
    // Put right, yet a compaction still leaves the hold standing, untouched.
    fixture.restore();
    await lineageRun(f, fixture, folder, {}, { source: 'compact' });
    assert.equal(fs.readFileSync(holdFile(P), 'utf8'), before, 'held after, unchanged');
  });
});

test('a startup still writes the hold', async () => {
  await withHome(async () => {
    const folder = tempFolder('wh-ss-startup-held-');
    const fixture = lineageFixture(folder);
    fixture.put({ LICENSE: 'another licence\n' });
    for (const source of ['startup', 'resume', 'clear', 'fork']) {
      if (fs.existsSync(holdFile(P))) fs.rmSync(holdFile(P));
      await lineageRun(fake(), fixture, folder, {}, { source });
      assert.ok(fs.existsSync(holdFile(P)), source);
    }
  });
});

test('the Wheelhouse command line carries the flag that turns the system certificate store off, when this Node.js knows it', () => {
  const command = (flags) => toolSheetLines('claude-code', { pluginRoot: '/plugin/root', platform: 'darwin', allowedFlags: flags }).find((l) => l.startsWith('The Wheelhouse command is '));
  assert.equal(command(new Set(['--use-system-ca'])), 'The Wheelhouse command is node --no-use-system-ca "/plugin/root/scripts/frontdesk/cli.js"');
  assert.equal(command(new Set(['--inspect'])), 'The Wheelhouse command is node "/plugin/root/scripts/frontdesk/cli.js"');
});
