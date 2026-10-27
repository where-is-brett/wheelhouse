// tests/e2e/copilot-lean.test.js
// Lean with the helper, end to end (Part 5 Task 7, ruling P5-32): a real helper on a temporary home, a Lean project
// adopted into its store, the window a stand-in, and Copilot's recorded hook inputs fed to the real entry
// (scripts/agents/copilot/hook-entry.js) in a process of its own, as Copilot starts it. The run: the session start;
// STOP by the word, then a write refused and STOP lifted in the window; an unknown tool refused; a chat that isn't
// Copilot's let read only; an idea and a ruling confirmed by a chat click through the helper; a feature branch
// approved by a chat click and merged with hooks planted in the store and the project's core.hooksPath (on macOS
// and Linux, with a commit outside the fence first showing they fire), none run;
// undo on a window click used once; the copy holding main only, the record staying in its own folder; the main version moved outside the
// helper, said at the session start and kept in the window; the helper stopped, then a write refused and a read
// let through. Then a real-user Lean project's merge refused on a chat click and accepted after the window's click.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { guardedRun, standInTools } from '../helpers/host-stand-ins.js';
import { shortHome, testAddress } from '../helpers/homes.js';
import { waitLongerOnTheHelper } from '../helpers/until.js';
import { run, withoutGitVars } from '../../scripts/lib/run.js';
import { NULL_FILE } from '../../scripts/lib/safe-git.js';
import { startHelper } from '../../scripts/host/helper.js';
import { helperClient } from '../../scripts/host/helper-client.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { RECORD_BRANCH } from '../../scripts/state/record.js';
import { stopState, liftStop, NO_HELPER_STOP } from '../../scripts/lib/stop.js';
import { listEvents, eventPath } from '../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled, verify } from '../../scripts/state/signing.js';
import { registerLean, readLean, updateLean } from '../../scripts/lean/project.js';
import { storeDir, adoptProject, leanApprovalLine, MAIN_MOVED } from '../../scripts/lean/store.js';
import { leanCommand } from '../../scripts/lean/cli.js';
import { record, view } from '../../scripts/frontdesk/cli.js';
import { UNKNOWN_TOOL } from '../../adapters/copilot/translate.js';
import { LOCAL_HARNESS } from '../../scripts/agents/copilot/hook-entry.js';
import { DENIED } from '../../scripts/hooks/stop-guard.js';
import { CONTEXT as STOP_CONTEXT } from '../../scripts/hooks/stop-word.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = path.join(ROOT, 'scripts', 'agents', 'copilot', 'hook-entry.js');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'copilot', 'hook-input');
const COPILOT_ENV = { COPILOT_CLI_BINARY_VERSION: '1.0.101' };
const unix = process.platform !== 'win32';

// No real gh, glab, copilot or curl runs, through the helper or from the PATH (P5-44).
const shims = standInTools();
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
afterEach(() => {
  assert.deepEqual(hostLog, [], 'no host tool ran through the helper');
  assert.deepEqual(shims.calls(), [], 'no host tool ran from the PATH');
});
after(() => shims.restore());

waitLongerOnTheHelper();

const T0 = Date.parse('2026-10-24T01:00:00.000Z');
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: NULL_FILE, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: NULL_FILE,
  GIT_AUTHOR_NAME: 'Ann', GIT_AUTHOR_EMAIL: 'ann@example.com', GIT_COMMITTER_NAME: 'Ann', GIT_COMMITTER_EMAIL: 'ann@example.com',
};
async function git(cwd, args) {
  const got = await run('git', args, { cwd, baseEnv: withoutGitVars(), env: GIT_ENV });
  if (got.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${got.stderr}`);
  return got.stdout.trim();
}

// Git as a person's own would run, with no hooks folder set aside: only for showing that the planted hooks fire.
async function unfencedGit(cwd, args) {
  const { GIT_CONFIG_COUNT, GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0, ...env } = GIT_ENV;
  const got = await run('git', args, { cwd, baseEnv: withoutGitVars(), env });
  if (got.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${got.stderr}`);
  return got.stdout.trim();
}

// A recorded Copilot input (check 58), with the project's folder in place of <PROJECT>.
function recorded(name, folder) {
  const text = fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8');
  // Written as JSON writes it, so a Windows folder's backslashes are escaped.
  return JSON.parse(text.replaceAll('<PROJECT>', JSON.stringify(folder).slice(1, -1)).replaceAll('<ID>', 's1'));
}

// The real entry, started as Copilot starts it: one Node.js, the event as its argument, the input on standard input.
// Not spawnSync: the helper answering it runs in this process. `copilot: false` is a chat that isn't Copilot's.
function entry(event, raw, { copilot = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY, event], {
      env: { ...process.env, COPILOT_CLI_BINARY_VERSION: copilot ? COPILOT_ENV.COPILOT_CLI_BINARY_VERSION : '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill(), 90_000);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const text = Buffer.concat(out).toString('utf8');
      resolve({ code, signal, text, body: text === '' ? null : JSON.parse(text), stderr: Buffer.concat(err).toString('utf8') });
    });
    child.stdin.end(JSON.stringify(raw));
  });
}
// An answer that lets the call through: nothing written, exit 0, and the process not ended by a signal.
const assertLetThrough = (got) => assert.deepEqual([got.text, got.code, got.signal], ['', 0, null], got.stderr);
const deny = (reason) => ({ permissionDecision: 'deny', permissionDecisionReason: reason });
const prompt = (folder, text) => ({ sessionId: 's1', timestamp: 0, cwd: folder, prompt: text });
const tool = (folder, toolName, toolArgs) => ({ sessionId: 's1', timestamp: 0, cwd: folder, toolName, toolArgs });

// The window's stand-in: the first deciding option of these the card offers, as the director's click.
const CLICKS = ['Lift STOP', 'Undo', 'Keep it', 'Approve'];
const click = (card) => CLICKS.find((label) => card.options.includes(label)) ?? null;

// A computer with a Lean project adopted into its store, a copy folder, an enrolled key, and a real helper on the
// home's own address whose window is the stand-in above.
async function computer({ project = 'shop', realUsers = false } = {}) {
  const home = shortHome();
  const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(shortHome(), `${project}-`)));
  const copy = path.join(fs.realpathSync.native(shortHome()), 'copy.git');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  await git(folder, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(folder, 'README.md'), `${project}\n`);
  await git(folder, ['add', '-A']);
  await git(folder, ['commit', '-q', '-m', 'Start']);
  fs.mkdirSync(copy);
  await git(copy, ['init', '-q', '--bare']);
  await git(folder, ['remote', 'add', 'wheelhouse-copy', copy]);
  registerLean({ project, folder, now: () => new Date(T0) });
  updateLean(project, { realUsers, agent: 'copilot' });
  const own = makeSigningKey();
  enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: new Date(T0).toISOString() });
  let tick = 0;
  const now = () => new Date(T0 + 1000 * (tick += 1));
  await adoptProject({ project, folder, run: hostGuard, now });
  const windows = [];
  let helper = await startHelper({
    run: hostGuard,
    address: testAddress(home),
    envFor: async () => { throw new Error('no connection on this computer'); },
    adapterFor: async () => { throw new Error('no adapter on this computer'); },
    askWindow: async (card) => {
      windows.push(card);
      return { choice: click(card) };
    },
    now,
  });
  const client = helperClient({ address: helper.address });
  // The Lean command, run in the project's folder, with standard input when it takes some.
  const lean = (argv, input) => leanCommand(argv, { cwd: folder, client, stdin: Readable.from([input === undefined ? '' : JSON.stringify(input)]) });
  const feature = async (slug, files) => {
    await git(folder, ['switch', '-q', '-c', `feature/${slug}`]);
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
      fs.writeFileSync(path.join(folder, name), text, { mode: 0o755 });
    }
    await git(folder, ['add', '-A']);
    await git(folder, ['commit', '-q', '-m', `Build ${slug}`]);
    const head = await git(folder, ['rev-parse', 'HEAD']);
    await git(folder, ['switch', '-q', '--detach', 'main']);
    return head;
  };
  return {
    home, folder, copy, client, windows, lean, feature, now,
    events: () => listEvents(stateDir(project), { report: () => {} }),
    main: () => git(storeDir(project), ['rev-parse', 'refs/heads/main']),
    stopHelper: async () => {
      if (helper) await helper.close();
      helper = null;
    },
    close: async () => {
      liftStop();
      if (helper) await helper.close();
      if (before === undefined) delete process.env.WHEELHOUSE_HOME;
      else process.env.WHEELHOUSE_HOME = before;
    },
  };
}

test('a Lean project with the helper, from the session start to the helper stopped', async () => {
  const c = await computer();
  try {
    const patch = recorded('camel-preToolUse-apply_patch', c.folder);
    const read = recorded('camel-preToolUse-view', c.folder);

    // The session start: the briefing through the helper, and the Lean command to reach it.
    const start = await entry('sessionStart', recorded('camel-sessionStart-none', c.folder));
    assert.equal(start.code, 0, start.stderr);
    assert.match(start.body.additionalContext, /The Lean command is ".+" ".+\/scripts\/lean\/cli\.js"/);
    assert.ok(!start.body.additionalContext.includes(NO_HELPER_STOP));
    // With the helper up and STOP off, a read and a write are let through.
    assertLetThrough(await entry('preToolUse', read));
    assertLetThrough(await entry('preToolUse', patch));

    // STOP by the word: set through the helper as the director's, then a write refused and reading carrying on.
    const word = await entry('userPromptSubmitted', prompt(c.folder, 'stop'));
    assert.ok(word.body.additionalContext.startsWith(STOP_CONTEXT), word.text);
    // In Copilot's words (ruling P5-54): Lift STOP is the Lean command's window step, never Claude Code's tool.
    assert.doesNotMatch(word.body.additionalContext, /AskUserQuestion|cli\.js cards/);
    assert.match(word.body.additionalContext, /the Lean command's `confirm lift-stop`/);
    assert.deepEqual([stopState().on, stopState().by], [true, 'prompt']);
    const stopped = await entry('preToolUse', patch);
    assert.deepEqual([stopped.body, stopped.code], [deny(DENIED), 2]);
    assertLetThrough(await entry('preToolUse', read));
    // The chat can't decide anything under STOP; Lift STOP is the window's.
    const head0 = await c.main();
    assert.match((await c.lean(['click', 'merge-x', 'Approve', head0], { question: 'x' })).refused, /All stop is on/);
    const lifted = await c.lean(['confirm', 'lift-stop']);
    assert.equal(lifted.ok, true, lifted.refused);
    assert.equal(c.windows.at(-1).title, 'Wheelhouse: All stop');
    assert.equal(stopState().on, false);
    assert.equal((await entry('preToolUse', patch)).text, '');

    // A tool Wheelhouse doesn't know is refused, and marked through the helper.
    const unknown = await entry('preToolUse', tool(c.folder, 'apply_patch_v2', { patch: 'x' }));
    assert.deepEqual([unknown.body, unknown.code], [deny(UNKNOWN_TOOL('apply_patch_v2')), 2]);
    assert.ok(c.events().some((e) => e.kind === 'note' && e.data.mark === 'unknown-tool' && e.data.name === 'apply_patch_v2'));

    // A chat that isn't Copilot's (no COPILOT_CLI_BINARY_VERSION): only reading passes.
    const local = await entry('preToolUse', patch, { copilot: false });
    assert.deepEqual([local.body, local.code], [deny(LOCAL_HARNESS), 2]);
    assert.equal((await entry('preToolUse', read, { copilot: false })).text, '');

    // Intake through the helper: an idea, and a ruling confirmed by a chat click on its card (ruling P5-52).
    const idea = await record({ client: c.client, cwd: c.folder, kind: 'idea', input: { key: 'dark-mode', title: 'A dark theme for the shop' }, now: c.now });
    assert.ok(idea.id);
    const words = 'Every export is a CSV file, never Excel.';
    const ruling = await record({ client: c.client, cwd: c.folder, kind: 'ruling', input: { words }, now: c.now });
    const confirmed = await c.lean(['click', `ruling-${ruling.card.id}`, 'Confirm'], { question: ruling.card.question.question });
    assert.equal(confirmed.ok, true, confirmed.refused);
    const { views } = await c.client.state.views({ cwd: c.folder });
    assert.ok(Object.hasOwn(views.ideas, 'dark-mode'));
    assert.match((await view({ client: c.client, cwd: c.folder, name: 'ideas', now: c.now })).join('\n'), /A dark theme for the shop/);
    assert.deepEqual(views.rulebook.map((r) => [r.words, r.status, r.proof]), [[words, 'accepted', 'chat-click']]);
    assert.match((await view({ client: c.client, cwd: c.folder, name: 'rulebook', now: c.now })).join('\n'), /in force, by a click in the chat, not proven/);

    // A feature branch approved by a chat click and merged, with hooks planted in the store and in the folder the
    // store's core.hooksPath names: none runs. The hooks are shell scripts, so they are planted on macOS and Linux
    // only; every other step runs on every system.
    const marks = path.join(c.home, 'hook-ran');
    const hook = `#!/bin/sh\necho "$0" >> "${marks}"\n`;
    const HOOKS = ['pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-merge', 'post-commit', 'post-checkout', 'reference-transaction', 'pre-push', 'post-rewrite'];
    const plant = (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      for (const name of HOOKS) fs.writeFileSync(path.join(dir, name), hook, { mode: 0o755 });
    };
    const husky = path.join(c.folder, '.husky');
    if (unix) plant(path.join(storeDir('shop'), 'hooks'));
    const head = await c.feature('login', { 'login.txt': 'login\n', ...(unix ? { '.husky/post-merge': hook } : {}) });
    if (unix) {
      plant(husky);
      // The planted hooks do fire when git is let run them: a commit in the folder, outside the fence, runs the
      // store's own, and once the store's settings name .husky, the ones there. Then the folder is put back.
      await unfencedGit(c.folder, ['commit', '-q', '--allow-empty', '-m', 'Canary']);
      await git(storeDir('shop'), ['config', 'core.hooksPath', husky]);
      await unfencedGit(c.folder, ['commit', '-q', '--allow-empty', '-m', 'Canary']);
      const fired = fs.readFileSync(marks, 'utf8');
      assert.ok(fired.includes(path.join('hooks', 'post-commit')) && fired.includes(path.join('.husky', 'post-commit')), fired);
      fs.rmSync(marks);
      await git(c.folder, ['switch', '-q', '--detach', 'main']);
    } else {
      await git(storeDir('shop'), ['config', 'core.hooksPath', husky]);
    }
    assert.match((await c.lean(['merge', 'login', head])).refused, /no approval of/);
    const question = `Add login to the main version?\n${leanApprovalLine('feature/login', head)}`;
    const approved = await c.lean(['click', 'merge-login', 'Approve', head], { question });
    assert.equal(approved.ok, true, approved.refused);
    assert.equal(c.events().find((e) => e.id === approved.id).data.proof, 'chat-click');
    const merged = await c.lean(['merge', 'login', head]);
    assert.equal(merged.ok, true, merged.refused);
    assert.equal(await c.main(), merged.merge);
    assert.equal(await git(storeDir('shop'), ['rev-parse', `${merged.merge}^2`]), head);
    assert.equal(fs.existsSync(marks), false, 'no planted hook ran');

    // Undo: a chat click undoes nothing; the window's signed click does, once.
    assert.equal((await c.lean(['click', 'undo-login', 'Undo', merged.merge], { question: 'Undo login?' })).ok, true);
    const asked = await c.lean(['undo', merged.merge]);
    assert.deepEqual([asked.ok, asked.needs], [false, 'window']);
    assert.equal(await c.main(), merged.merge);
    const undone = await c.lean(['confirm', asked.card]);
    assert.equal(undone.ok, true, undone.refused);
    assert.deepEqual(c.windows.at(-1).options, ['Undo']);
    assert.equal(undone.undone?.ok, true, undone.undone?.refused);
    const reverted = await c.main();
    assert.equal(reverted, undone.undone.undo);
    assert.equal(await git(storeDir('shop'), ['rev-parse', `${reverted}^`]), merged.merge);
    const undoClick = c.events().find((e) => e.kind === 'action' && e.data.action === 'undo-merge');
    assert.deepEqual([undoClick.data.merge, undoClick.data.proof], [merged.merge, 'window']);
    assert.ok(verify(undoClick, readEnrolled()));
    const again = await c.lean(['undo', merged.merge]);
    assert.deepEqual([again.ok, again.needs], [false, 'window'], 'the click is used once');
    assert.equal(await c.main(), reverted);
    assert.equal(fs.existsSync(marks), false, 'no planted hook ran');

    // The copy holds the main version and nothing of the record (design section 24.3 item 7).
    const copied = await c.lean(['copy']);
    assert.equal(copied.ok, true, copied.refused);
    assert.equal(copied.pushed, true);
    assert.equal(await git(c.copy, ['rev-parse', 'refs/heads/main']), reverted);
    assert.deepEqual((await git(c.copy, ['for-each-ref', '--format=%(refname)'])).split('\n'), ['refs/heads/main'], 'the copy holds main only');
    // The record stays in its own folder on this computer, on its own branch, holding the merge, the undo and the copy.
    assert.equal(await git(stateDir('shop'), ['symbolic-ref', '--short', 'HEAD']), RECORD_BRANCH);
    assert.equal(await git(stateDir('shop'), ['remote']), '', 'the record has no remote');
    const files = (await git(stateDir('shop'), ['ls-tree', '-r', '--name-only', 'HEAD'])).split('\n');
    const mergeEvent = c.events().find((e) => e.kind === 'merge');
    const copyNote = c.events().find((e) => e.kind === 'note' && e.data.lean === 'copy' && e.data.choice === 'pushed');
    // git names files with "/" on any system.
    for (const e of [mergeEvent, undoClick, copyNote]) assert.ok(files.includes(eventPath(e).split(path.sep).join('/')), `the record holds ${e.kind}`);

    // The main version moved outside the helper (P5-27): said at the session start, a merge waits, Keep it in the
    // window decides it.
    const sneak = await c.feature('sneak', { 'sneak.txt': 'sneak\n' });
    await git(storeDir('shop'), ['update-ref', 'refs/heads/main', sneak]);
    const moved = await entry('sessionStart', recorded('camel-sessionStart-none', c.folder));
    assert.ok(moved.body.additionalContext.includes(MAIN_MOVED), moved.text);
    const status = await c.lean(['status']);
    assert.deepEqual([status.moved, status.recorded, status.main], [true, reverted, sneak]);
    const next = await c.feature('cart', { 'cart.txt': 'cart\n' });
    const cart = `Add cart to the main version?\n${leanApprovalLine('feature/cart', next)}`;
    assert.equal((await c.lean(['click', 'merge-cart', 'Approve', next], { question: cart })).ok, true);
    const waiting = await c.lean(['merge', 'cart', next]);
    assert.deepEqual([waiting.ok, waiting.card], [false, status.card]);
    const kept = await c.lean(['confirm', status.card]);
    assert.equal(kept.ok, true, kept.refused);
    assert.deepEqual([kept.step, kept.kept], ['keep-main', true]);
    assert.equal(readLean('shop').main, sneak);
    const cartMerged = await c.lean(['merge', 'cart', next]);
    assert.equal(cartMerged.ok, true, cartMerged.refused);
    assert.equal(fs.existsSync(marks), false, 'no planted hook ran');

    // The helper stopped: a write is refused as under STOP, reading carries on, and the STOP word says so.
    await c.stopHelper();
    const down = await entry('preToolUse', patch);
    assert.deepEqual([down.body, down.code], [deny(NO_HELPER_STOP), 2]);
    const push = await entry('preToolUse', tool(c.folder, 'bash', { command: 'git push' }));
    assert.deepEqual(push.body, deny(NO_HELPER_STOP));
    assertLetThrough(await entry('preToolUse', read));
    assert.deepEqual((await entry('userPromptSubmitted', prompt(c.folder, 'stop'))).body, { additionalContext: NO_HELPER_STOP });
    assert.equal(stopState().on, false);
  } finally {
    await c.close();
  }
});

test('a real-user Lean project\'s merge is refused on a chat click and accepted after the window\'s click', async () => {
  const c = await computer({ project: 'clinic', realUsers: true });
  try {
    const head = await c.feature('booking', { 'booking.txt': 'booking\n' });
    const question = `Add booking to the main version?\n${leanApprovalLine('feature/booking', head)}`;
    assert.equal((await c.lean(['click', 'merge-booking', 'Approve', head], { question })).ok, true);
    const refused = await c.lean(['merge', 'booking', head]);
    assert.deepEqual([refused.ok, refused.needs], [false, 'window']);
    assert.match(refused.refused, /Wheelhouse's window/);
    const before = await c.main();
    const confirmed = await c.lean(['confirm', refused.card]);
    assert.equal(confirmed.ok, true, confirmed.refused);
    assert.deepEqual([confirmed.recorded, confirmed.kind], [true, 'approval']);
    assert.deepEqual(c.windows.at(-1).options, ['Approve']);
    assert.ok(c.windows.at(-1).lines.includes(leanApprovalLine('feature/booking', head)));
    const approval = c.events().find((e) => e.kind === 'approval');
    assert.deepEqual([approval.data.commit, approval.data.proof], [head, 'window']);
    assert.ok(verify(approval, readEnrolled()));
    assert.equal(await c.main(), before, 'the window\'s click merges nothing by itself');
    const merged = await c.lean(['merge', 'booking', head]);
    assert.equal(merged.ok, true, merged.refused);
    assert.equal(await c.main(), merged.merge);
    const event = c.events().find((e) => e.kind === 'merge');
    assert.equal(event.data.proof, 'window');
    assert.ok(verify(event, readEnrolled()), 'a merge decided in the window is recorded signed');
    // The entry still places the adopted project: with STOP off, a read is let through.
    assert.equal((await entry('preToolUse', recorded('camel-preToolUse-view', c.folder))).text, '');
  } finally {
    await c.close();
  }
});
