// tests/scripts/setup/uninstall.test.js
// What uninstall would put back, worked out without changing anything (Task 15a, rulings R85 to
// R89): every change the folder's runs recorded, grouped and in the binding order, what is kept and
// why, and the level 4 cards for deleting what can't come back. The journals are made by hand here,
// each change written to a scratch home and folder as the step would make it, so what the plan reads
// of the world is real. Applying the plan is Task 15b's; where a test puts changes back, it does so
// through reverseChange, as 15b will.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  uninstallPlan, uninstallRoutes, planLines, readProgress, writeProgress, PHASES, WHAT_CHARS, PLUGIN_LINE, ASK_STEP,
  UNINSTALL_CHANGED, UNINSTALL_NEEDS_CLICK, UNINSTALL_OWN_LIST, UNINSTALL_STOP, UNINSTALL_RUNNING, UNINSTALL_RUN,
  NEVER_PUSHED, FOLDER_NOTE, UNINSTALL_NEW_SESSION, ENV_STAYS, ARCHIVE, ARCHIVE_UNREAD, ARCHIVE_OUTSIDE, ARCHIVE_TWICE, archiveAt, trustDir, seenFile, OLD_STAYS,
} from '../../../scripts/setup/uninstall.js';
import { applyUninstall, runUninstall, UNINSTALL_BRANCH, UNINSTALL_TITLE } from '../../../scripts/setup/uninstall-run.js';
import {
  startRun, addChanges, applyJsonKey, markPutBack, markStep, newId, readJournal, reverseChange, journalFile, closeRun,
} from '../../../scripts/setup/journal.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { loginEntry, installLoginStart, loginStartRecord } from '../../../scripts/lib/login-start.js';
import { wheelhouseHome, profileDir, oldProfileDir, stateDir, oldStateDir, keysDir, engineDir, archonHome } from '../../../scripts/lib/paths.js';
import { POLICY_FILE, brokerLauncher, installedPluginsFile, mirrorRulesFile } from '../../../scripts/setup/engine-parts.js';
import { toolFolder } from '../../../scripts/lib/host-tools.js';
import { clicksDir, usedDir } from '../../../scripts/lib/setup-clicks.js';
import { enrolledFile, signingKeyFile } from '../../../scripts/state/signing.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';
import { CARD } from '../../../scripts/lib/front-desk.js';
import { uninstallLine, UNINSTALL_LABEL } from '../../../scripts/state/card-lines.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { keepAnswer, keepUninstallClick, uninstallShownFor, freshUninstallClicks } from '../../../scripts/setup/clicks.js';
import { madeBySetup, joinedFolder } from '../../../scripts/setup/host.js';
import { writeKey, readKey } from '../../../scripts/host/keys.js';
import { caFile } from '../../../scripts/host/company-ca.js';
import { openInstaller } from '../../../scripts/setup/tools.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { registerLean, LEAN_FOLDER } from '../../../scripts/lean/project.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { standInTools, guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { makeBareRemote, g } from '../../helpers/git-fixture.js';
import { PROFILE_TARGET } from '../../../scripts/setup/own-app.js';
import { EXCLUDE_LINE, WHEELHOUSE_LINE } from '../../../scripts/setup/project-files.js';
import { as, shortHome, tempFolder, testAddress, withHome } from '../../helpers/homes.js';
import { until } from '../../helpers/until.js';
import { decide as sessionStart } from '../../../scripts/hooks/session-start.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const NOW = () => new Date('2026-10-20T03:00:00.000Z');
const SLUG = 'o__Cafe-Menu';
const REPO = 'o/Cafe-Menu';
const readText = (file) => fs.readFileSync(file, 'utf8');
const readJson = (file) => JSON.parse(readText(file));
const writeText = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

// launchctl as a fake: the account's variables, read only. An unset one reads as empty, as launchctl
// gives it; `failing` makes every read fail.
const launchEnv = (vars, { failing = false } = {}) => async (file, args) => {
  if (file === 'launchctl' && args[0] === 'getenv') {
    if (failing) return { code: 1, stdout: '', stderr: 'launchctl could not be reached' };
    return { code: 0, stdout: Object.hasOwn(vars, args[1]) ? `${vars[args[1]]}\n` : '', stderr: '' };
  }
  throw new Error(`nothing else is run: ${file} ${args.join(' ')}`);
};

// A scratch world: a home folder with the director's own Claude settings, and a product folder.
function makeWorld({ connection = { host: 'github', mode: 'narrow', project: REPO } } = {}) {
  const userHome = fs.realpathSync.native(tempFolder('wh-user Zoë '));
  const folder = fs.realpathSync.native(tempFolder('wh-cafe menu '));
  const settings = path.join(userHome, '.claude', 'settings.json');
  writeText(settings, `${JSON.stringify({ theme: 'dark', cleanupPeriodDays: 7 }, null, 2)}\n`);
  const register = (slug = SLUG, at = folder, repo = REPO, conn = connection) => {
    writeProject(slug, { folder: at, remoteUrl: `https://github.com/${repo}.git`, host: 'github', repo, connection: conn });
  };
  return { userHome, folder, settings, register };
}

// A setup run's recorder: each change written as its step makes it, recorded first.
function recorder(runId) {
  const add = (step, change) => {
    const c = { id: newId('chg'), step, ...change };
    addChanges(runId, [c]);
    return c;
  };
  return {
    add,
    key: (step, file, key, value) => applyJsonKey({ file, key, value, step, record: (c) => addChanges(runId, [c]) }),
    file(step, target, after, extra = {}) {
      const before = fs.existsSync(target) ? readText(target) : null;
      const c = add(step, { kind: 'file', target, before, after, ...extra });
      writeText(target, after);
      return c;
    },
    folder(step, target, after, { before } = {}) {
      const c = add(step, { kind: 'folder', target, before: before === undefined ? (fs.existsSync(target) ? {} : null) : before, after });
      fs.mkdirSync(target, { recursive: true });
      return c;
    },
  };
}

// The whole of setup on a fresh computer, as the journal would hold it, steps 1 to 10.
// `lockedDir` is where Locked's computer-wide settings are (a scratch folder when the plan is
// applied), and `trialSha` the commit step 10's trial branch was pushed at.
function fullSetup(world, { through = 10, lockedDir = '/Library/Application Support/ClaudeCode', trialSha = 'c'.repeat(40), slug = SLUG } = {}) {
  const { folder, settings, register } = world;
  const run = startRun({ folder, now: NOW });
  const r = recorder(run.id);
  const done = (n) => markStep(run.id, n, 'doneAt', { now: NOW });
  done(1);
  if (through < 2) return { run, r };
  // Step 2: gh fetched, and the allow rule for setup's command in the folder's own settings.
  r.folder(2, toolFolder('gh'), { tool: 'gh', version: 'v2.60.0' });
  writeText(path.join(toolFolder('gh'), 'bin', 'gh'), 'program');
  r.key(2, path.join(folder, '.claude', 'settings.local.json'), ['permissions', 'allow'], ['Bash(node setup)']);
  done(2);
  if (through < 3) return { run, r };
  // Step 3: the product's repository made, the folder connected, the app's keys, the project
  // registered, its private record opened, and the director's settings on this computer.
  r.add(3, { kind: 'host', target: `github:${REPO}`, before: null, after: { repository: REPO, private: true, made: true } });
  r.folder(3, path.join(folder, '.git'), { origin: `https://github.com/${REPO}.git`, branch: 'main' });
  writeText(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  r.add(3, { kind: 'host', target: 'key github-app', before: null, after: { key: 'github-app', clientId: 'Iv1.x', app: 'wheelhouse' } });
  writeText(path.join(keysDir(), 'github-app.json'), '{}');
  r.add(3, { kind: 'file', target: path.join(stateDir(slug), '..', 'project.json'), before: null, after: 'x' });
  register(slug);
  r.folder(3, stateDir(slug), { record: true }, { before: null });
  writeText(path.join(stateDir(slug), 'events', 'e1.json'), '{}');
  writeText(path.join(profileDir(), 'events', 'e1.json'), '{}');
  done(3);
  if (through < 4) return { run, r };
  r.add(4, { kind: 'answer', target: 'step 4', before: null, after: { phase: 'building' } });
  done(4);
  done(5);
  if (through < 6) return { run, r };
  // Step 6: Claude Code's settings on this computer, telemetry for the account and its login item.
  r.key(6, settings, ['cleanupPeriodDays'], 30);
  r.key(6, settings, ['agentPushNotifEnabled'], true);
  r.add(6, { kind: 'env', target: 'CLAUDE_CODE_ENABLE_TELEMETRY', before: null, after: '1', where: 'launchctl' });
  r.file(6, path.join(world.userHome, 'Library', 'LaunchAgents', 'wheelhouse.telemetry.plist'), '<plist/>\n');
  done(6);
  if (through < 7) return { run, r };
  // Step 7: the project's files, this computer's settings, the exclude line, a pin, the commit,
  // its push and protection.
  writeText(path.join(folder, '.claude', 'settings.json'), `${JSON.stringify({ enabledPlugins: { 'wheelhouse@wheelhouse': true } }, null, 2)}\n`);
  r.key(7, path.join(folder, '.claude', 'settings.json'), ['extraKnownMarketplaces'], { wheelhouse: { ref: 'v1' } });
  r.file(7, path.join(folder, '.claude', 'wheelhouse.json'), '{}\n');
  r.file(7, path.join(folder, 'CLAUDE.md'), '# Compact instructions\n');
  r.key(7, path.join(folder, '.claude', 'settings.local.json'), ['statusLine'], { type: 'command' });
  r.file(7, path.join(folder, '.git', 'info', 'exclude'), '/.claude/settings.local.json\n', { line: '/.claude/settings.local.json' });
  r.add(7, { kind: 'process', target: 'claude plugin install superpowers@wheelhouse --scope project', before: null, after: { plugin: 'superpowers@wheelhouse', scope: 'project', folder } });
  r.add(7, { kind: 'host', target: `${REPO} main`, before: { branch: 'main', sha: 'a'.repeat(40) }, after: { action: 'commit', branch: 'main', message: 'Set up Wheelhouse', files: [], folder } });
  r.add(7, { kind: 'host', target: `${REPO} main`, before: { branch: 'main', sha: 'a'.repeat(40) }, after: { action: 'push', branch: 'main', sha: 'b'.repeat(40) } });
  r.add(7, { kind: 'host', target: `${REPO} protection`, before: { on: false, available: true }, after: { action: 'protect', branch: 'main', on: true } });
  done(7);
  if (through < 8) return { run, r };
  // Step 8: Locked.
  r.add(8, { kind: 'locked', target: path.join(lockedDir, 'managed-settings.json'), before: { exists: false, ours: false, projects: [] }, after: { project: slug, folder } });
  done(8);
  r.add(9, { kind: 'answer', target: 'step 9', before: null, after: { pushArrived: true } });
  done(9);
  if (through < 10) return { run, r };
  // Step 10: the trial's branch and pull request, the pull request closed, its branch left.
  r.add(10, { kind: 'host', target: `${REPO} branch wheelhouse-health-check`, before: null, after: { branch: 'wheelhouse-health-check', sha: trialSha } });
  r.add(10, { kind: 'host', target: `${REPO} pull request from wheelhouse-health-check`, before: null, after: { state: 'opening', branch: 'wheelhouse-health-check' } });
  r.add(10, { kind: 'host', target: `${REPO} pull request 7`, before: null, after: { number: 7, state: 'open', branch: 'wheelhouse-health-check' } });
  r.add(10, { kind: 'host', target: `${REPO} pull request 7`, before: { state: 'open' }, after: { state: 'closed' } });
  r.add(10, { kind: 'answer', target: 'step 10', before: null, after: { green: NOW().toISOString() } });
  done(10);
  return { run, r };
}

// Everything the plan could read, as text, to show it changed nothing.
function snapshot(world) {
  const files = [];
  const walk = (dir) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names.sort()) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else files.push([p, readText(p)]);
    }
  };
  [wheelhouseHome(), world.userHome, world.folder].forEach(walk);
  return files;
}

// Every change the journal holds but the answers, by id; and every id a plan accounts for.
const recordedIds = () => readJournal().runs.flatMap((r) => r.changes).filter((c) => c.kind !== 'answer').map((c) => c.id).sort();
const accounted = (got) => [...new Set([
  ...got.changes.flatMap((c) => c.ids ?? []), ...got.keep.flatMap((k) => k.ids ?? []), ...got.asks.flatMap((a) => a.ids), ...got.done.flatMap((d) => d.ids),
])].sort();

const plan = (world, extra = {}) => uninstallPlan({ folder: world.folder, userHome: world.userHome, platform: 'darwin', run: launchEnv({ CLAUDE_CODE_ENABLE_TELEMETRY: '1' }), ...extra });
const of = (got, phase) => got.changes.filter((c) => c.phase === phase);
const ids = (list) => list.flatMap((c) => c.ids);

test('setup then uninstall lists every change setup made, by phase, newest first in a phase, Locked first', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    writeText(signingKeyFile(), 'key');
    writeText(enrolledFile(), '[]\n');
    const got = await plan(world);
    assert.equal(got.project, SLUG);
    assert.equal(got.last, true);
    // The phases come in the binding order, Stop first, and the helper stops last of all.
    const order = got.changes.map((c) => PHASES.indexOf(c.phase));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'phases in order');
    assert.deepEqual(PHASES, ['stop', 'locked', 'files', 'computer', 'keys', 'kept', 'last']);
    assert.deepEqual(of(got, 'stop').map((c) => c.what), ['foreman', 'watcher', 'receiver']);
    assert.deepEqual(got.changes.at(-1), { phase: 'last', put: 'stop', what: 'helper', when: 'after the answer' });
    // Locked comes before anything that removes the project's record.
    assert.equal(got.changes.find((c) => c.phase !== 'stop').put, 'leave-locked');
    assert.equal(of(got, 'locked')[0].project, SLUG);
    // The project's files go in a pull request the director merges, with the pin and the commit's
    // files; protection is left on and said; the trial's branch, still there, is deleted, and its
    // pull request, closed by step 10, is not listed again.
    const files = of(got, 'files');
    assert.deepEqual(files.map((c) => c.put), ['delete-branch', 'pull-request', 'in-pull-request', 'in-pull-request', 'in-pull-request', 'in-pull-request'], 'newest first: step 10\'s trial, then step 7\'s');
    const pr = files[1];
    assert.equal(pr.branch, 'main');
    assert.equal(pr.base, 'a'.repeat(40));
    const inPr = files.filter((c) => c.put === 'in-pull-request');
    assert.equal(pr.ids.length, 2 + inPr.length, 'the commit, its push and what it takes out, marked together');
    assert.deepEqual(inPr.map((c) => c.change.kind), ['process', 'file', 'file', 'json-key']);
    assert.deepEqual(inPr.slice(1).map((c) => path.basename(c.change.target)), ['CLAUDE.md', 'wheelhouse.json', 'settings.json']);
    assert.equal(files[0].branch, 'wheelhouse-health-check');
    assert.equal(files.some((c) => c.put === 'close-pull-request'), false);
    assert.ok(got.keep.some((k) => /protection/.test(k.what) && /left on/.test(k.why)));
    // This computer: step 7's own files here, then step 6's, then step 2's, each newest first.
    const computer = of(got, 'computer');
    const names = computer.map((c) => (c.change ? `${c.change.step}:${c.change.key?.join('.') ?? path.basename(c.change.target)}` : `${c.put}:${c.target}`));
    assert.deepEqual(names, [
      '7:exclude', '7:statusLine',
      '6:wheelhouse.telemetry.plist', 'unset-env:CLAUDE_CODE_ENABLE_TELEMETRY', '6:agentPushNotifEnabled', '6:cleanupPeriodDays',
      '2:permissions.allow',
    ]);
    // Step 2's allow rule is in the folder's own settings, so it is the project's, not this computer's.
    assert.equal(computer.at(-1).change.target, path.join(world.folder, '.claude', 'settings.local.json'));
    // Keys: the app's keys deleted on the last project, its installation page given. The
    // trusted-keys list and then the signing key beside it are removed last of all, after the
    // plugin's line and just before the helper stops (rulings R123, R128).
    const keys = of(got, 'keys');
    assert.equal(keys[0].put, 'delete-key');
    assert.equal(keys[0].key, 'github-app');
    assert.equal(keys.some((c) => c.put === 'remove'), false);
    // The trusted-keys list, then this computer's id and the folders the project's records and the
    // fetched tools were in, each once it is empty, then the signing key, and last the keys folder
    // it was in (rulings R128, R138, R142).
    const closing = got.changes.slice(got.changes.findIndex((c) => c.put === 'remove-plugin'), -1);
    assert.deepEqual(closing.map((c) => c.target ?? c.put), [
      'remove-plugin', enrolledFile(), ...(fs.existsSync(path.join(wheelhouseHome(), 'computer.json')) ? [path.join(wheelhouseHome(), 'computer.json')] : []),
      path.join(wheelhouseHome(), 'projects'), ...(fs.existsSync(path.dirname(toolFolder('gh'))) ? [path.dirname(toolFolder('gh'))] : []),
      signingKeyFile(), keysDir(),
    ]);
    assert.ok(closing.filter((c) => [keysDir(), path.join(wheelhouseHome(), 'projects'), path.dirname(toolFolder('gh'))].includes(c.target)).every((c) => c.put === 'remove-empty'));
    // Last: the project's own folder but for its private record (and v0.1.x's state clone), Wheelhouse's
    // own folders and files, the plugin's line. The director's settings stay.
    const last = of(got, 'last');
    assert.equal(last[0].target, path.join(wheelhouseHome(), 'projects', SLUG));
    assert.deepEqual(last[0].except, ['record', 'state', 'imported.json']);
    const removed = last.filter((c) => c.put === 'remove').map((c) => c.target);
    assert.ok(removed.includes(toolFolder('gh')));
    assert.ok(!removed.includes(profileDir()), 'the settings stay');
    assert.ok(got.keep.some((k) => k.what === path.join(wheelhouseHome(), 'settings') || k.what.endsWith('settings')));
    // The private record has its own card, recommended Keep.
    assert.deepEqual(got.asks.map((a) => a.about), ['product', 'record']);
    // The trust clicks and the session start's record of the profile's enrolments, Wheelhouse's own,
    // listed whether they are there yet or not.
    for (const p of [trustDir(), seenFile()]) assert.ok(removed.includes(p), p);
    assert.ok(last.some((c) => c.put === 'remove-plugin' && c.line === PLUGIN_LINE));
    // Every change setup recorded is listed, kept, asked about or settled, except the answers: the
    // trial's pull request, which step 10 closed itself, is settled.
    assert.deepEqual(accounted(got), recordedIds());
    assert.deepEqual(got.done.map((d) => d.why).sort(), ['closed by the health check', 'its pull request is recorded by its number']);
    // The git history is kept, and git's folder never removed.
    assert.ok(got.keep.some((k) => k.what.endsWith('.git') && k.why === 'the folder\'s git history is kept'));
  });
});

test('putting back what the plan lists leaves this computer\'s files as they were before setup', async () => {
  await withHome(async () => {
    const world = makeWorld();
    const before = readText(world.settings);
    fullSetup(world);
    const got = await plan(world);
    for (const c of got.changes.filter((x) => x.put === 'reverse')) assert.deepEqual(reverseChange(c.change), { put: true }, c.change.target);
    assert.equal(readText(world.settings), before);
    assert.equal(fs.existsSync(path.join(world.userHome, 'Library', 'LaunchAgents', 'wheelhouse.telemetry.plist')), false);
    // Setup made the local settings file, so with its keys put back it goes too (ruling R138).
    assert.equal(fs.existsSync(path.join(world.folder, '.claude', 'settings.local.json')), false);
    assert.equal(fs.existsSync(path.join(world.folder, '.git', 'info', 'exclude')), false);
  });
});

// The director's ruling of 25 October 2026: step 7 switches a folder on a line of work to main, and
// may keep changes at risk on a line of their own. Uninstall switches nothing back and deletes no line.
test('step 7\'s switch of the folder and a line of kept changes are left as they are, and named', async () => {
  await withHome(async () => {
    const world = makeWorld();
    const { r } = fullSetup(world);
    r.add(7, { kind: 'host', target: `${REPO}: this folder, from add-filters to main: add-filters-changes`, before: null, after: { action: 'keep', line: 'add-filters-changes', from: 'add-filters', files: ['CLAUDE.md'] } });
    r.add(7, { kind: 'host', target: `${REPO}: this folder, from add-filters to main`, before: { branch: 'add-filters', sha: 'c'.repeat(40) }, after: { action: 'switch', from: 'add-filters', to: 'main', keep: 'add-filters-changes' } });
    const got = await plan(world);
    assert.equal(got.changes.some((c) => c.ids?.length && JSON.stringify(c).includes('add-filters')), false, 'nothing is switched back or deleted');
    assert.equal(got.keep.find((k) => k.what === 'this folder\'s switch from add-filters to main').why, 'left as it is: your work stays on add-filters');
    assert.equal(got.keep.find((k) => k.what === 'your changes kept on add-filters-changes').why, 'left as they are, on their own line');
  });
});

test('a change made after setup is kept and named, never put back over the director\'s (Review Focus 2)', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    const now = readJson(world.settings);
    writeText(world.settings, `${JSON.stringify({ ...now, cleanupPeriodDays: 14 }, null, 2)}\n`);
    const got = await plan(world, { run: launchEnv({ CLAUDE_CODE_ENABLE_TELEMETRY: '0' }) });
    assert.equal(got.changes.some((c) => c.change?.key?.[0] === 'cleanupPeriodDays'), false);
    const kept = got.keep.find((k) => k.what.startsWith('cleanupPeriodDays'));
    assert.equal(kept.why, 'changed since setup');
    assert.equal(kept.ids.length, 1);
    // An account variable they set since is left too.
    assert.equal(got.changes.some((c) => c.put === 'unset-env'), false);
    assert.equal(got.keep.find((k) => k.what.startsWith('CLAUDE_CODE_ENABLE_TELEMETRY')).why, 'changed since setup');
    // The card names each.
    assert.match(got.card.what, /cleanupPeriodDays/);
    assert.match(got.card.what, /CLAUDE_CODE_ENABLE_TELEMETRY/);
  });
});

test('uninstall from a setup stopped at step 4 lists only what was done (Review Focus 1)', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world, { through: 4 });
    const got = await plan(world);
    const steps = new Set(got.changes.filter((c) => c.change).map((c) => c.change.step));
    assert.deepEqual([...steps].sort(), [2]);
    for (const phase of ['locked', 'files']) assert.deepEqual(of(got, phase), [], phase);
    assert.equal(got.changes.some((c) => c.put === 'pull-request' || c.put === 'unset-env'), false);
    // What step 3 made is still listed.
    assert.ok(of(got, 'keys').some((c) => c.put === 'delete-key'));
    assert.ok(got.asks.some((a) => a.target === `github:${REPO}`));
    assert.ok(got.asks.some((a) => a.about === 'record'));
    // A setup stopped before step 2 has nothing of its own to put back.
    await withHome(async () => {
      const early = makeWorld();
      fullSetup(early, { through: 1 });
      const none = await plan(early);
      assert.equal(none.changes.some((c) => c.ids), false);
      assert.deepEqual(none.asks, []);
    });
  });
});

test('retries: a folder or host change recorded again reverses against the earliest before; a key retried twice chains back to the director\'s value', async () => {
  await withHome(async () => {
    const world = makeWorld();
    const run = startRun({ folder: world.folder, now: NOW });
    const r = recorder(run.id);
    // A folder setup made, recorded again by a retry that found it there.
    const notes = path.join(world.folder, 'notes');
    const first = r.folder(3, notes, { made: true });
    const again = r.folder(3, notes, { made: true });
    assert.deepEqual(again.before, {});
    // A key the retry found kept.
    r.add(3, { kind: 'host', target: 'key gitlab-project-5', before: null, after: { key: 'gitlab-project-5', project: REPO, kind: 'pasted-token' } });
    r.add(3, { kind: 'host', target: 'key gitlab-project-5', before: { kept: true }, after: { key: 'gitlab-project-5', project: REPO, kind: 'pasted-token' } });
    // A key set twice by two attempts: the second's before is setup's own first after.
    const local = path.join(world.folder, '.claude', 'settings.local.json');
    writeText(local, `${JSON.stringify({ statusLine: 'theirs' }, null, 2)}\n`);
    r.key(7, local, ['statusLine'], 'setup');
    r.key(7, local, ['statusLine'], 'setup');
    const got = await plan(world);
    const folder = got.changes.find((c) => c.change?.target === notes);
    assert.equal(folder.change.before, null, 'the earliest before');
    assert.deepEqual(folder.ids.sort(), [first.id, again.id].sort());
    const revoke = got.changes.find((c) => c.put === 'revoke-key');
    assert.equal(revoke.key, 'gitlab-project-5');
    assert.equal(revoke.pasted, true);
    assert.equal(revoke.before, null);
    assert.equal(revoke.ids.length, 2);
    const chain = got.changes.filter((c) => c.change?.target === local);
    assert.equal(chain.length, 2);
    for (const c of got.changes.filter((x) => x.put === 'reverse')) assert.deepEqual(reverseChange(c.change), { put: true });
    assert.equal(readJson(local).statusLine, 'theirs');
    assert.equal(fs.existsSync(notes), false);
    // The pasted token's line says revoking it stops it everywhere.
    assert.match(revoke.line, /everywhere/);
  });
});

test('uninstall offers no state-branch or profile card', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    const got = await plan(world);
    assert.deepEqual(got.asks.map((a) => [a.about, a.put, a.target]), [
      ['product', 'delete-repository', `github:${REPO}`],
      ['record', 'delete-record', stateDir(SLUG)],
    ]);
    assert.ok(!got.asks.some((a) => /wheelhouse-state|wheelhouse-profile|wheelhouse-lock/.test(a.target)));
    assert.ok(!got.changes.some((c) => /wheelhouse-state|wheelhouse-profile|wheelhouse-lock/.test(JSON.stringify(c))));
    assert.ok(!got.changes.some((c) => c.put === 'remove-enrolment'));
    for (const ask of got.asks) {
      assert.equal(ask.phase, 'kept');
      assert.equal(ask.card.level, 4);
      assert.equal(ask.card.recommend, 'Keep it');
      const { question } = composeCard(ask.card);
      assert.ok(question.options.some((o) => o.label === 'Keep it'));
      assert.match(question.options.find((o) => o.label === 'Keep it').description, /^Recommended: /);
      assert.ok(!question.options.some((o) => o.label === 'Suggest a change…'), 'setup\'s own chat has no front-desk turn for it');
      assert.equal(question.question.split('\n').at(-1), 'To know more, just ask.');
    }
    // Nothing on the host is deleted by the plan itself.
    assert.equal(got.changes.some((c) => /delete-repository/.test(c.put)), false);
  });
});

test('uninstall keeps the private record by default', async () => {
  await withHome(async () => {
    const world = makeWorld();
    const { run } = fullSetup(world);
    const got = await plan(world);
    const ask = got.asks.find((a) => a.about === 'record');
    assert.equal(ask.put, 'delete-record');
    assert.equal(ask.target, stateDir(SLUG));
    assert.match(ask.card.what, /private record on this computer/);
    assert.match(ask.card.why, /can't be brought back/);
    // The journal's change for the record is the card's, not the project folder's removal.
    const recorded = readJournal().runs.find((x) => x.id === run.id).changes.find((c) => c.target === stateDir(SLUG));
    assert.deepEqual(ask.ids, [recorded.id]);
    const folder = got.changes.find((c) => c.target === path.join(wheelhouseHome(), 'projects', SLUG));
    assert.deepEqual(folder.except, ['record', 'state', 'imported.json']);
    assert.ok(!(folder.ids ?? []).includes(recorded.id));
    // No record folder, no card: its change is settled.
    fs.rmSync(stateDir(SLUG), { recursive: true });
    const gone = await plan(world);
    assert.ok(!gone.asks.some((a) => a.about === 'record'));
    assert.ok(gone.done.some((d) => d.ids.includes(recorded.id) && d.why === 'already gone'));
  });
});

test('what Wheelhouse v0.1.x made is named as kept: the profile, profile.json, the enrolment and the state clone', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    const run = startRun({ folder: world.folder, now: NOW });
    const r = recorder(run.id);
    r.add(3, { kind: 'host', target: 'github:o/wheelhouse-profile', before: null, after: { repository: 'o/wheelhouse-profile', private: true, made: true } });
    const profileJson = path.join(wheelhouseHome(), 'profile.json');
    r.file(3, profileJson, '{}\n');
    r.folder(3, oldProfileDir(), { clone: 'x', branch: 'wheelhouse-profile' }, { before: null });
    writeText(path.join(oldProfileDir(), 'events', 'e.json'), '{}');
    r.folder(3, oldStateDir(SLUG), { clone: 'x', branch: 'wheelhouse-state' }, { before: null });
    writeText(path.join(oldStateDir(SLUG), 'events', 'e.json'), '{}');
    r.add(3, { kind: 'host', target: 'github:o/wheelhouse-profile:enrolments/abcd1234.json', before: null, after: '{"computer":"abcd1234"}\n' });
    const got = await plan(world);
    const kept = got.keep.filter((k) => k.why === OLD_STAYS).map((k) => k.what);
    assert.ok(kept.some((w) => w.includes('wheelhouse-profile on GitHub')), kept.join('\n'));
    assert.ok(kept.some((w) => w.includes('this computer\'s key in o/wheelhouse-profile')), kept.join('\n'));
    assert.ok(kept.some((w) => w.endsWith('profile.json')), kept.join('\n'));
    assert.ok(kept.some((w) => w.endsWith(path.join('.wheelhouse', 'profile')) || w === oldProfileDir() || w.endsWith(`${path.sep}profile`)), kept.join('\n'));
    assert.ok(kept.some((w) => w.endsWith('state')), kept.join('\n'));
    assert.ok(!got.changes.some((c) => [oldProfileDir(), profileJson, oldStateDir(SLUG)].includes(c.target)), 'none is removed');
    assert.ok(!got.asks.some((a) => /wheelhouse-profile/.test(a.target)));
    assert.deepEqual(accounted(got), recordedIds());
  });
});

test('a second project keeps the helper, telemetry and the signing key', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    writeText(signingKeyFile(), 'key');
    const second = fs.realpathSync.native(tempFolder('wh-second '));
    world.register('o__Shop', second, 'o/Shop');
    const got = await plan(world);
    assert.equal(got.last, false);
    assert.deepEqual(of(got, 'stop').map((c) => c.what), ['foreman', 'watcher']);
    assert.equal(got.changes.some((c) => c.what === 'helper' || c.what === 'receiver'), false);
    assert.equal(got.changes.some((c) => [6, 9].includes(c.change?.step)), false, 'steps 6 and 9 are this computer\'s');
    // Step 2's allow rule in the folder's own settings is the project's, and goes with it.
    assert.deepEqual(got.changes.filter((c) => c.change?.step === 2).map((c) => c.change.key), [['permissions', 'allow']]);
    assert.equal(got.changes.some((c) => c.put === 'unset-env'), false);
    assert.equal(got.changes.some((c) => c.target === signingKeyFile() || c.target === profileDir() || c.target === toolFolder('gh')), false);
    // The app stays for the other project: this repository is unticked on its installation's page.
    assert.equal(got.changes.some((c) => c.put === 'delete-key'), false);
    assert.deepEqual(of(got, 'keys').map((c) => [c.put, c.repo]), [['untick-repository', REPO]]);
    // The project's own are still listed.
    assert.ok(got.changes.some((c) => c.put === 'leave-locked'));
    assert.ok(got.keep.some((k) => /another project/.test(k.why) && /helper/.test(k.what)));
    // The second project's own uninstall, now the last, puts back this computer's changes from the
    // first project's runs too.
    fs.rmSync(path.join(wheelhouseHome(), 'projects', SLUG), { recursive: true });
    closeRun(readJournal().runs[0].id, { at: NOW, by: 'uninstall' });
    const lastOne = await uninstallPlan({ folder: second, userHome: world.userHome, platform: 'darwin', run: launchEnv({ CLAUDE_CODE_ENABLE_TELEMETRY: '1' }) });
    assert.equal(lastOne.last, true);
    assert.ok(lastOne.changes.some((c) => c.change?.step === 6));
    assert.ok(lastOne.changes.some((c) => c.put === 'delete-key'));
    assert.equal(lastOne.changes.some((c) => c.change?.step === 7 || c.change?.step === 2), false, 'the first project\'s own are not the second\'s');
    assert.ok(lastOne.changes.some((c) => c.put === 'remove' && c.target === toolFolder('gh')));
  });
});

test('a joining computer\'s uninstall plans no pull request for a commit it never made', async () => {
  await withHome(async () => {
    const world = makeWorld();
    world.register();
    const run = startRun({ folder: world.folder, now: NOW });
    const r = recorder(run.id);
    r.add(3, { kind: 'answer', target: 'step 3', before: null, after: { joined: REPO } });
    r.folder(3, path.join(world.folder, '.git'), { origin: 'x', branch: 'main', joined: REPO });
    r.file(3, path.join(world.folder, '.claude', 'settings.json'), '{"committed":true}\n');
    r.key(7, path.join(world.folder, '.claude', 'settings.local.json'), ['statusLine'], { type: 'command' });
    r.add(7, { kind: 'process', target: 'claude plugin install superpowers@wheelhouse --scope project', before: null, after: { plugin: 'superpowers@wheelhouse', scope: 'project', folder: world.folder } });
    const got = await plan(world);
    assert.deepEqual(of(got, 'files'), []);
    assert.ok(got.keep.some((k) => k.what.endsWith('settings.json') && /as committed/.test(k.why)));
    assert.ok(got.keep.some((k) => /superpowers/.test(k.what)));
    assert.deepEqual(of(got, 'computer').map((c) => c.change.key), [['statusLine']]);
    assert.equal(got.asks.some((a) => a.put === 'delete-repository'), false, 'it made no repository');
  });
});

test('a change marked put back is skipped by the next plan, so an uninstall cut short resumes', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    const first = await plan(world);
    const reverse = first.changes.filter((c) => c.put === 'reverse');
    const done = reverse.slice(0, 2);
    for (const c of done) reverseChange(c.change);
    markPutBack(ids(done), { put: true, now: NOW });
    const pr = first.changes.find((c) => c.put === 'pull-request');
    markPutBack(pr.ids, { put: true, now: NOW });
    const kept = first.keep.find((k) => k.why === 'the folder\'s git history is kept');
    markPutBack(kept.ids, { put: false, why: kept.why, now: NOW });
    const next = await plan(world);
    for (const c of done) assert.equal(next.changes.some((x) => x.ids?.includes(c.ids[0])), false);
    assert.equal(next.changes.some((c) => c.put === 'pull-request'), false);
    assert.equal(next.keep.some((k) => k.why === 'the folder\'s git history is kept'), false);
    assert.equal(next.changes.filter((c) => c.put === 'reverse').length, reverse.length - done.length);
    assert.notEqual(next.hash, first.hash);
  });
});

test('the plan is pure: two plans of the same world change nothing and give the same hash', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    const journal = readText(journalFile());
    const world0 = snapshot(world);
    const a = await plan(world);
    const b = await plan(world);
    assert.equal(a.hash, b.hash);
    assert.match(a.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(a, b);
    assert.equal(readText(journalFile()), journal);
    assert.deepEqual(snapshot(world), world0);
    assert.equal(a.card.target.hash, a.hash);
    assert.equal(a.card.target.project, SLUG);
    // A world that differs gives another hash.
    writeText(world.settings, `${JSON.stringify({ ...readJson(world.settings), cleanupPeriodDays: 14 }, null, 2)}\n`);
    assert.notEqual((await plan(world)).hash, a.hash);
  });
});

test('Locked\'s file that was never Wheelhouse\'s is never touched; it is kept and named', async () => {
  await withHome(async () => {
    const world = makeWorld();
    world.register();
    const run = startRun({ folder: world.folder, now: NOW });
    recorder(run.id).add(8, { kind: 'locked', target: '/Library/x/managed-settings.json', before: { exists: true, ours: false, projects: [] }, after: { project: SLUG, folder: world.folder } });
    const got = await plan(world);
    assert.deepEqual(of(got, 'locked'), []);
    assert.match(got.keep.find((k) => k.what.includes('managed-settings.json')).why, /not Wheelhouse's/);
  });
});

test('the card names the groups, what is kept, that removed transcripts can\'t come back, and fits', async () => {
  await withHome(async () => {
    const world = makeWorld();
    const { r: setupRun } = fullSetup(world);
    // Step 7's .wheelhouse/ line too, with the project's .wheelhouse/ folder there (ruling R131).
    const exclude = path.join(world.folder, '.git', 'info', 'exclude');
    setupRun.file(7, exclude, `${readText(exclude)}${WHEELHOUSE_LINE}\n`, { line: WHEELHOUSE_LINE });
    writeText(path.join(world.folder, '.wheelhouse', 'front-desk.json'), '{}\n');
    const got = await plan(world);
    assert.ok(got.card.what.includes(FOLDER_NOTE));
    const { card } = got;
    assert.equal(card.kind, 'uninstall');
    assert.equal(card.level, 4);
    assert.match(card.what, /transcripts/i);
    assert.match(card.what, /can't come back/);
    assert.match(card.what, /pull request/);
    assert.ok(card.what.length + card.target.project.length <= WHAT_CHARS, `${card.what.length}`);
    assert.ok(typeof card.checks === 'string' && card.checks.length > 0);
    // Many kept items: the card names what fits, then how many more and where to read them.
    const settings = readJson(world.settings);
    const run = startRun({ folder: world.folder, now: NOW });
    const r = recorder(run.id);
    const theirs = {};
    for (let i = 0; i < 30; i++) {
      r.key(6, world.settings, [`someLongSettingName${i}`], i);
      theirs[`someLongSettingName${i}`] = 'theirs';
    }
    writeText(world.settings, `${JSON.stringify({ ...settings, ...theirs }, null, 2)}\n`);
    const many = await plan(world);
    assert.ok(many.keep.length > 30);
    assert.match(many.card.what, /(and \d+ more|\d+ left as you changed them): cli\.js uninstall status/);
    assert.ok(many.card.what.length + many.card.target.project.length <= WHAT_CHARS, `${many.card.what.length}`);
    // Shared with another computer whose key this one trusts (ruling R124), its parts the longest.
    enrol({ computer: 'ffff0000', publicKey: 'AAAA', enrolledAt: '2026-10-19T01:00:00.000Z' });
    const shared = await plan(world);
    assert.equal(shared.shared, true);
    assert.match(shared.card.what, /\.wheelhouse\/ stays, out of git/);
    // Each card composes as uninstall's own kind (Task 15c), within the composer's limit, and passes
    // the card check; its set line names the project and the list's hash.
    for (const one of [got, many, shared]) {
      const { question, card: data } = composeCard(one.card);
      assert.ok(question.question.length <= CARD.chars, `${question.question.length}`);
      assert.deepEqual(cardProblems(question.question), []);
      assert.equal(data.line, uninstallLine(SLUG, one.hash));
      assert.equal(data.code, null);
      assert.match(question.question, /if All stop is on, lift it first/, 'the card says to lift STOP first (ruling R91)');
    }
  });
});

test('uninstall\'s card composes within the limit for the longest names and the longest lists', async () => {
  await withHome(async () => {
    // A folder no project is registered for is named on the card by its own name; a long one, with
    // spaces and accents, and every group, with many items changed since setup.
    const world = makeWorld();
    const folder = path.join(world.folder, `Zoë's café menu, the new one for the summer of 2026 ${'x'.repeat(10)}`);
    fs.mkdirSync(folder);
    const run = startRun({ folder, now: NOW });
    const r = recorder(run.id);
    r.key(2, path.join(folder, '.claude', 'settings.local.json'), ['permissions', 'allow'], ['Bash(node setup)']);
    const settings = readJson(world.settings);
    const theirs = {};
    for (let i = 0; i < 40; i++) {
      r.key(6, world.settings, [`aRatherLongSettingNameForTheCard${i}`], i);
      theirs[`aRatherLongSettingNameForTheCard${i}`] = 'theirs';
    }
    writeText(world.settings, `${JSON.stringify({ ...settings, ...theirs }, null, 2)}\n`);
    for (let i = 0; i < 5; i++) r.key(6, world.settings, [`ours${i}`], i);
    // Step 7's .wheelhouse/ line, with the project's .wheelhouse/ folder there (ruling R131).
    r.file(7, path.join(folder, '.git', 'info', 'exclude'), `${WHEELHOUSE_LINE}\n`, { line: WHEELHOUSE_LINE });
    fs.mkdirSync(path.join(folder, '.wheelhouse'));
    // Alone, then shared with another computer whose key this one trusts (ruling R124).
    for (const trusting of [false, true]) {
      if (trusting) enrol({ computer: 'ffff0000', publicKey: 'AAAA', enrolledAt: '2026-10-19T01:00:00.000Z' });
      for (const slug of [null, `o__${'a'.repeat(37)}`]) {
        if (slug !== null) writeProject(slug, { folder, remoteUrl: `https://github.com/o/${'a'.repeat(37)}.git`, host: 'github', repo: `o/${'a'.repeat(37)}`, connection: { host: 'github', mode: 'narrow' } });
        const got = await uninstallPlan({ folder, userHome: world.userHome, platform: 'darwin', run: launchEnv({}) });
        assert.equal(got.shared, trusting);
        const { question } = composeCard(got.card);
        assert.ok(question.question.length <= CARD.chars, `${slug}: ${question.question.length}`);
        assert.deepEqual(cardProblems(question.question), []);
        assert.match(got.card.what, /cli\.js uninstall status/);
        assert.match(got.card.what, /\.wheelhouse\/ stays, out of git/);
      }
    }
  });
});

test('another folder\'s own changes are never this folder\'s, and a folder with no runs lists only what is there', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    const other = fs.realpathSync.native(tempFolder('wh-other '));
    const got = await uninstallPlan({ folder: other, userHome: world.userHome, platform: 'darwin', run: launchEnv({}) });
    assert.equal(got.project, null);
    assert.equal(got.changes.some((c) => c.change?.step === 7 || c.put === 'leave-locked' || c.put === 'pull-request'), false);
    assert.equal(got.last, false, 'the café is still registered');
  });
});

test('the own app recorded in the profile is put back through putBackOwnApp, on the last project', async () => {
  await withHome(async () => {
    const world = makeWorld();
    world.register();
    const run = startRun({ folder: world.folder, now: NOW });
    recorder(run.id).add(3, { kind: 'host', target: PROFILE_TARGET, before: null, after: { clientId: 'Iv1.y', slug: 'mine', owner: 'o' } });
    const got = await plan(world);
    const own = got.changes.find((c) => c.put === 'put-back-own-app');
    assert.equal(own.phase, 'computer');
    assert.equal(own.change.before, null);
  });
});

// ---- Fix round 1 ----

// Setup up to step 7's commit and its push, recorded, with step 7 not finished: the push failed.
function stoppedAtPush(world) {
  const { folder, settings } = world;
  world.register();
  const run = startRun({ folder, now: NOW });
  const r = recorder(run.id);
  r.key(6, settings, ['cleanupPeriodDays'], 30);
  r.folder(3, path.join(folder, '.git'), { origin: `https://github.com/${REPO}.git`, branch: 'main' });
  writeText(path.join(folder, '.git', 'refs', 'heads', 'main'), `${'b'.repeat(40)}\n`);
  writeText(path.join(folder, '.claude', 'settings.json'), '{}\n');
  r.key(7, path.join(folder, '.claude', 'settings.json'), ['extraKnownMarketplaces'], { wheelhouse: { ref: 'v1' } });
  r.file(7, path.join(folder, 'CLAUDE.md'), '# Compact instructions\n');
  const pin = r.add(7, { kind: 'process', target: 'claude plugin install superpowers@wheelhouse --scope project', before: null, after: { plugin: 'superpowers@wheelhouse', scope: 'project', folder } });
  r.key(7, path.join(folder, '.claude', 'settings.json'), ['enabledPlugins', 'other@wheelhouse'], false);
  writeText(path.join(folder, '.claude', 'settings.json'), `${JSON.stringify({ ...readJson(path.join(folder, '.claude', 'settings.json')), enabledPlugins: { ...readJson(path.join(folder, '.claude', 'settings.json')).enabledPlugins, 'superpowers@wheelhouse': true } }, null, 2)}\n`);
  r.add(7, { kind: 'host', target: `${REPO} main`, before: { branch: 'main', sha: 'a'.repeat(40) }, after: { action: 'commit', branch: 'main', message: 'Set up Wheelhouse', files: [], folder } });
  r.add(7, { kind: 'host', target: `${REPO} main`, before: { branch: 'main', sha: 'a'.repeat(40) }, after: { action: 'push', branch: 'main', sha: 'b'.repeat(40) } });
  markStep(run.id, 7, 'failed', { now: NOW, reason: 'the setup commit could not be pushed' });
  return { run, r, pin };
}

test('a push recorded but never made plans no pull request: setup\'s files and pin are put back here, and the commit kept (Review Focus 1)', async () => {
  await withHome(async () => {
    const world = makeWorld();
    const { pin } = stoppedAtPush(world);
    const got = await plan(world);
    assert.equal(got.changes.some((c) => c.put === 'pull-request' || c.put === 'in-pull-request'), false);
    const files = of(got, 'files');
    assert.ok(files.every((c) => c.put === 'reverse'));
    assert.deepEqual(files.map((c) => (c.change.key ?? [path.basename(c.change.target)]).join('.')), ['enabledPlugins.other@wheelhouse', 'enabledPlugins.superpowers@wheelhouse', 'CLAUDE.md', 'extraKnownMarketplaces']);
    // The pin is switched off by its key, as a json-key change reverseChange can put back.
    const pinEntry = files.find((c) => c.ids[0] === pin.id);
    assert.deepEqual(pinEntry.change.key, ['enabledPlugins', 'superpowers@wheelhouse']);
    assert.ok(got.keep.some((k) => /setup's commit on main, never pushed/.test(k.what)));
    assert.match(got.card.checks, /protection stays as it is/);
    for (const c of files) assert.deepEqual(reverseChange(c.change), { put: true }, JSON.stringify(c.change.key));
    assert.deepEqual(readJson(path.join(world.folder, '.claude', 'settings.json')), { enabledPlugins: {} });
    assert.equal(fs.existsSync(path.join(world.folder, 'CLAUDE.md')), false);
    assert.deepEqual(accounted(got), recordedIds());
  });
});

test('a push counts as made once step 7 finished, recorded a later change, or the folder\'s copy of the branch holds it', async () => {
  for (const shows of ['done', 'later', 'tracked']) {
    await withHome(async () => {
      const world = makeWorld();
      const { run, r } = stoppedAtPush(world);
      if (shows === 'done') markStep(run.id, 7, 'doneAt', { now: NOW });
      if (shows === 'later') r.add(7, { kind: 'host', target: `${REPO} protection`, before: { on: false, available: true }, after: { action: 'protect', branch: 'main', on: true } });
      if (shows === 'tracked') fs.writeFileSync(path.join(world.folder, '.git', 'packed-refs'), `# pack-refs with: peeled\n${'b'.repeat(40)} refs/remotes/origin/main\n`);
      const got = await plan(world);
      assert.ok(got.changes.some((c) => c.put === 'pull-request'), shows);
      assert.ok(got.changes.some((c) => c.put === 'in-pull-request' && c.change.kind === 'process'), shows);
    });
  }
});

test('a commit recorded but never made is settled, not named as kept in the folder', async () => {
  await withHome(async () => {
    const world = makeWorld();
    world.register();
    const run = startRun({ folder: world.folder, now: NOW });
    const r = recorder(run.id);
    writeText(path.join(world.folder, '.git', 'refs', 'heads', 'main'), `${'a'.repeat(40)}\n`);
    const made = r.add(7, { kind: 'host', target: `${REPO} main`, before: { branch: 'main', sha: 'a'.repeat(40) }, after: { action: 'commit', branch: 'main', message: 'Set up Wheelhouse', files: [], folder: world.folder } });
    const got = await plan(world);
    assert.equal(got.keep.some((k) => /commit/.test(k.what)), false);
    assert.deepEqual(got.done, [{ ids: [made.id], why: 'the commit was never made' }]);
    // Made, then not pushed: kept, and named.
    writeText(path.join(world.folder, '.git', 'refs', 'heads', 'main'), `${'b'.repeat(40)}\n`);
    assert.ok((await plan(world)).keep.some((k) => /setup's commit on main, never pushed/.test(k.what)));
  });
});

test('an uninstall cut short after putting back, before marking, finds those put back already, never changed since setup', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    const first = await plan(world);
    const reverse = first.changes.filter((c) => c.put === 'reverse');
    for (const c of reverse) reverseChange(c.change);
    // The account variable unset too, and none of it marked.
    const next = await plan(world, { run: launchEnv({}) });
    assert.equal(next.changes.some((c) => c.put === 'reverse' || c.put === 'unset-env'), false);
    assert.equal(next.keep.some((k) => k.why === 'changed since setup'), false);
    assert.doesNotMatch(next.card.what, /Left as you changed them/);
    const already = next.done.filter((d) => d.why === 'already put back').flatMap((d) => d.ids).sort();
    const expected = [...reverse.flatMap((c) => c.ids), ...first.changes.filter((c) => c.put === 'unset-env').flatMap((c) => c.ids)].sort();
    assert.deepEqual(already, expected);
    assert.deepEqual(accounted(next), recordedIds());
  });
});

test('a key retried twice, then changed by the director, is kept and named, never put back (Review Focus 2)', async () => {
  await withHome(async () => {
    const world = makeWorld();
    const run = startRun({ folder: world.folder, now: NOW });
    const r = recorder(run.id);
    const a = r.key(6, world.settings, ['cleanupPeriodDays'], 30);
    const b = r.key(6, world.settings, ['cleanupPeriodDays'], 30);
    writeText(world.settings, `${JSON.stringify({ ...readJson(world.settings), cleanupPeriodDays: 14 }, null, 2)}\n`);
    const got = await plan(world);
    assert.equal(got.changes.some((c) => c.change?.key?.[0] === 'cleanupPeriodDays'), false);
    const kept = got.keep.find((k) => k.brief === 'cleanupPeriodDays');
    assert.deepEqual(kept.ids.sort(), [a.id, b.id].sort());
    assert.match(got.card.what, /cleanupPeriodDays/);
  });
});

test('a value the director changed between two retries: the newer link is put back, the older one kept and named', async () => {
  await withHome(async () => {
    const world = makeWorld();
    const run = startRun({ folder: world.folder, now: NOW });
    const r = recorder(run.id);
    const first = r.key(6, world.settings, ['cleanupPeriodDays'], 30);
    writeText(world.settings, `${JSON.stringify({ ...readJson(world.settings), cleanupPeriodDays: 14 }, null, 2)}\n`);
    const second = r.key(6, world.settings, ['cleanupPeriodDays'], 30);
    assert.equal(second.before, 14);
    const got = await plan(world);
    assert.deepEqual(got.changes.filter((c) => c.change?.key?.[0] === 'cleanupPeriodDays').map((c) => c.ids[0]), [second.id]);
    assert.deepEqual(got.keep.find((k) => k.brief === 'cleanupPeriodDays').ids, [first.id]);
    assert.match(got.card.what, /cleanupPeriodDays/);
    reverseChange(second);
    assert.equal(readJson(world.settings).cleanupPeriodDays, 14, 'the director\'s value stays');
  });
});

test('the own app the director recorded since setup is kept and named; setup\'s, or one never confirmed, is put back', async () => {
  await withHome(async () => {
    const world = makeWorld();
    world.register();
    const run = startRun({ folder: world.folder, now: NOW });
    const setupApp = { clientId: 'Iv1.setupapp01', slug: 'mine', owner: 'o' };
    recorder(run.id).add(3, { kind: 'host', target: PROFILE_TARGET, before: null, after: setupApp });
    const views = (value) => writeText(path.join(wheelhouseHome(), 'profile-views', 'settings.json'), JSON.stringify({ 'own-github-app': { value } }));
    views(setupApp);
    assert.ok((await plan(world)).changes.some((c) => c.put === 'put-back-own-app'));
    views({ clientId: 'Iv1.theirapp01', slug: 'theirs', owner: 'o' });
    const got = await plan(world);
    assert.equal(got.changes.some((c) => c.put === 'put-back-own-app'), false);
    assert.equal(got.keep.find((k) => k.brief === 'own-github-app').why, 'changed since setup');
  });
});

test('a folder half set up elsewhere keeps this computer\'s things: the last project counts open setup runs (ruling R114)', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    const half = fs.realpathSync.native(tempFolder('wh-half '));
    const other = startRun({ folder: half, now: NOW });
    const got = await plan(world);
    assert.equal(got.last, false);
    assert.equal(got.changes.some((c) => c.what === 'helper' || c.put === 'delete-key' || c.change?.step === 6), false);
    closeRun(other.id, { at: NOW, by: 'uninstall' });
    assert.equal((await plan(world)).last, true);
  });
});

test('a Lean project on this computer keeps this computer\'s key, id and trusted list: the last project counts Lean projects (ruling P5-47)', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    writeText(signingKeyFile(), 'key');
    writeText(enrolledFile(), '[]\n');
    const lean = fs.realpathSync.native(tempFolder('wh-lean shop '));
    registerLean({ project: 'lean-shop', folder: lean, now: NOW });
    const got = await plan(world);
    assert.equal(got.last, false);
    assert.equal(got.changes.some((c) => c.what === 'helper' || c.put === 'delete-key' || c.change?.step === 6), false);
    const targets = got.changes.map((c) => c.target);
    for (const kept of [signingKeyFile(), enrolledFile(), keysDir(), path.join(wheelhouseHome(), 'projects', 'lean-shop')]) {
      assert.equal(targets.includes(kept), false, kept);
    }
    // Uninstall in the Lean folder, or a folder inside it, plans nothing and says why in one line.
    fs.mkdirSync(path.join(lean, 'src'));
    for (const folder of [lean, path.join(lean, 'src')]) {
      await assert.rejects(uninstallPlan({ folder, userHome: world.userHome, platform: 'darwin', run: launchEnv({}) }), (e) => e.message === LEAN_FOLDER);
    }
    // With the Lean project gone, the Claude Code project is the last again, as before.
    fs.rmSync(path.join(wheelhouseHome(), 'projects', 'lean-shop'), { recursive: true });
    assert.equal((await plan(world)).last, true);
  });
});

test('nothing recorded is left out of the plan: a folder setup didn\'t make, and a variable that held setup\'s value before, are settled', async () => {
  await withHome(async () => {
    const world = makeWorld();
    world.register();
    const run = startRun({ folder: world.folder, now: NOW });
    const r = recorder(run.id);
    const theirs = path.join(world.folder, 'theirs');
    fs.mkdirSync(theirs);
    r.add(3, { kind: 'folder', target: theirs, before: {}, after: { made: false } });
    r.add(6, { kind: 'env', target: 'X_VAR', before: '1', after: '1', where: 'launchctl' });
    const got = await plan(world);
    assert.deepEqual(got.done.map((d) => d.why).sort(), ['it held this before setup', 'not made by setup']);
    assert.deepEqual(accounted(got), recordedIds());
  });
});

// ---- Fix round 2 ----

test('an account variable that can\'t be read is kept with why, never taken for one already unset', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    const got = await plan(world, { run: launchEnv({}, { failing: true }) });
    assert.equal(got.changes.some((c) => c.put === 'unset-env'), false);
    assert.equal(got.done.some((d) => d.why === 'already put back'), false);
    const kept = got.keep.find((k) => k.brief === 'CLAUDE_CODE_ENABLE_TELEMETRY');
    assert.match(kept.why, /^could not read CLAUDE_CODE_ENABLE_TELEMETRY: launchctl could not be reached/);
    assert.equal(kept.ids.length, 1);
    // Unset, read cleanly: put back already.
    const unset = await plan(world, { run: launchEnv({}) });
    assert.ok(unset.done.some((d) => d.why === 'already put back' && d.ids.includes(kept.ids[0])));
  });
});

test('a folder setup made that can\'t be read is kept with why, never settled as gone', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  await withHome(async () => {
    const world = makeWorld();
    world.register();
    const run = startRun({ folder: world.folder, now: NOW });
    const shut = path.join(world.folder, 'shut');
    const inner = path.join(shut, 'made');
    fs.mkdirSync(inner, { recursive: true });
    const made = recorder(run.id).add(3, { kind: 'folder', target: inner, before: null, after: { made: true } });
    fs.chmodSync(shut, 0o000);
    try {
      const got = await plan(world);
      assert.equal(got.done.some((d) => d.ids.includes(made.id)), false);
      assert.match(got.keep.find((k) => k.ids?.includes(made.id)).why, /^could not read it: EACCES/);
    } finally {
      fs.chmodSync(shut, 0o755);
    }
  });
});

test('a pin whose project settings can\'t be read as JSON is kept with why, and one setup\'s key edits cover is settled', async () => {
  await withHome(async () => {
    const world = makeWorld();
    const { pin } = stoppedAtPush(world);
    fs.writeFileSync(path.join(world.folder, '.claude', 'settings.json'), 'not json');
    const got = await plan(world);
    assert.equal(got.done.some((d) => d.ids.includes(pin.id)), false);
    assert.equal(got.keep.find((k) => k.ids?.includes(pin.id)).why, 'changed since setup');
  });
  await withHome(async () => {
    const world = makeWorld();
    const { pin, r } = stoppedAtPush(world);
    r.key(7, path.join(world.folder, '.claude', 'settings.json'), ['enabledPlugins', 'superpowers@wheelhouse'], true);
    const got = await plan(world);
    assert.deepEqual(got.done.find((d) => d.ids.includes(pin.id)).why, 'its key goes back with the project\'s settings');
  });
});

test('only protection recorded after the push counts it as made: a later attempt\'s file change doesn\'t', async () => {
  await withHome(async () => {
    const world = makeWorld();
    const { r } = stoppedAtPush(world);
    r.file(7, path.join(world.folder, '.claude', 'wheelhouse.json'), '{}\n');
    const got = await plan(world);
    assert.equal(got.changes.some((c) => c.put === 'pull-request'), false);
  });
});

// ---- Applying the plan (Task 15b) ----
// The plan is applied for real against a scratch home, a stand-in host (bare repositories on this
// computer, reached through setup's own git with a local path) and fakes for what must never run
// here: launchctl, the password prompt (osascript), the host's tool (the adapter), the stops.

const READY = () => new Date('2026-10-20T03:05:00.000Z');
const ROOM_URL = 'https://github.com/o/Cafe-Menu/pull/12';

// Every recorded change but the answers, with whether it is marked.
const unmarked = () => readJournal().runs.flatMap((r) => r.changes).filter((c) => c.kind !== 'answer' && c.putBack === undefined);
const markOf = (id) => readJournal().runs.flatMap((r) => r.changes).find((c) => c.id === id)?.putBack;

// The fakes: `run` keeps launchctl's variables, plays the password prompt (removing Locked's files
// as the administrator step would, unless `cancel`), and passes git to the real git; everything
// else it refuses. `ops` record the stops, the pull request opened and the pages opened.
function fakes(world, { vars = { CLAUDE_CODE_ENABLE_TELEMETRY: '1' }, cancel = false, onPassword = () => {}, openPr } = {}) {
  const seen = { password: 0, unset: [], pages: [], prs: [], stops: [], closed: [] };
  const run = async (file, args, options) => {
    if (file === 'git') return realRun(file, args, options);
    if (file === 'launchctl' && args[0] === 'getenv') return { code: 0, stdout: Object.hasOwn(vars, args[1]) ? `${vars[args[1]]}\n` : '', stderr: '' };
    if (file === 'launchctl' && args[0] === 'unsetenv') {
      seen.unset.push(args[1]);
      delete vars[args[1]];
      return { code: 0, stdout: '', stderr: '' };
    }
    if (file === 'osascript') {
      seen.password += 1;
      onPassword();
      if (cancel) return { code: 1, stdout: '', stderr: 'execution error: User canceled. (-128)' };
      fs.rmSync(path.join(world.lockedDir, 'managed-settings.json'), { force: true });
      fs.rmSync(path.join(world.lockedDir, 'wheelhouse'), { recursive: true, force: true });
      return { code: 0, stdout: '', stderr: '' };
    }
    throw new Error(`nothing else is run: ${file} ${args.join(' ')}`);
  };
  const adapter = {
    openPr: openPr ?? (async (pr) => { seen.prs.push(pr); return { number: 12, url: ROOM_URL }; }),
    prState: async () => ({ state: 'closed' }),
    closePr: async (n) => { seen.closed.push(n); },
  };
  const stop = (what) => async () => { seen.stops.push(what); return { stopped: true }; };
  const ops = {
    findGit: async () => ({ ok: true, path: 'git' }),
    adapterFor: () => adapter,
    findOpenPr: async () => null,
    openPage: async (url) => { seen.pages.push(url); },
    stopForeman: stop('foreman'),
    stopWatcher: stop('watcher'),
    stopReceiver: stop('receiver'),
  };
  return { run, ops, seen };
}

// A stand-in host: the product's repository, holding on main what setup's commit left there and a
// trial branch.
async function standIn() {
  const product = await makeBareRemote({ repo: REPO });
  const work = tempFolder('wh-work ');
  await g(work, 'init', '-q', '-b', 'main');
  writeText(path.join(work, 'README.md'), '# Cafe menu\n');
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'First');
  const trial = await g(work, 'rev-parse', 'HEAD');
  await g(work, 'push', '-q', product.url, 'main', `HEAD:refs/heads/wheelhouse-health-check`);
  const cleanup = () => { product.cleanup(); };
  hosts.push(cleanup);
  return { product, work, trial, cleanup };
}
const hosts = [];
after(() => { for (const cleanup of hosts.splice(0)) cleanup(); });

// Setup's commit on the stand-in's main: the project's files as this folder holds them, with the
// pin the kits' install switched on.
async function pushSetupCommit(world, host) {
  const settings = readJson(path.join(world.folder, '.claude', 'settings.json'));
  settings.enabledPlugins['superpowers@wheelhouse'] = true;
  writeText(path.join(host.work, '.claude', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  writeText(path.join(host.work, '.claude', 'wheelhouse.json'), readText(path.join(world.folder, '.claude', 'wheelhouse.json')));
  writeText(path.join(host.work, 'CLAUDE.md'), readText(path.join(world.folder, 'CLAUDE.md')));
  await g(host.work, 'add', '-A');
  await g(host.work, 'commit', '-q', '-m', 'Set up Wheelhouse');
  await g(host.work, 'push', '-q', host.product.url, 'main');
  return g(host.work, 'rev-parse', 'HEAD');
}

// A world set up through `through`, ready for its plan to be applied: this computer's key enrolled,
// Locked on in a scratch folder, the project's address the stand-in's.
async function applyWorld({ through = 10, host } = {}) {
  const world = makeWorld();
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
  world.lockedDir = tempFolder('wh-locked ');
  writeText(path.join(world.lockedDir, 'managed-settings.json'), '{}\n');
  writeText(path.join(world.lockedDir, 'wheelhouse', 'installed.json'), '{}\n');
  writeText(path.join(world.lockedDir, 'wheelhouse', 'locked-projects.json'), `${JSON.stringify([world.folder])}\n`);
  world.before = readText(world.settings);
  const made = fullSetup(world, { through, lockedDir: world.lockedDir, trialSha: host.trial });
  if (through >= 3) {
    writeProject(SLUG, { folder: world.folder, remoteUrl: host.product.url, host: 'github', repo: REPO, connection: { host: 'github', mode: 'narrow', project: REPO, installationId: 77 } });
  }
  if (through >= 7) world.tip = await pushSetupCommit(world, host);
  return { world, ...made };
}

// The director's Delete it on the private record's own card, given once the card is shown, so the
// last phase can empty the projects folder.
async function deleteTheRecord(world, run, f) {
  const routes = uninstallRoutes({ now: READY, userHome: world.userHome, platform: 'darwin', run: f.run, ops: f.ops });
  const shown = await routes['/setup/uninstall/plan']({ folder: world.folder });
  answerAsk(run.id, shown.asks.find((a) => a.about === 'record'), 'Delete it');
}

const applyPlan = async (world, f, extra = {}) => {
  const got = await uninstallPlan({ folder: world.folder, userHome: world.userHome, platform: 'darwin', run: f.run });
  const done = await applyUninstall({ folder: world.folder, plan: got, now: READY, userHome: world.userHome, platform: 'darwin', run: f.run, ops: f.ops, ...extra });
  return { got, done };
};

const filesOn = async (url, ref) => {
  const listed = await realRun('git', ['ls-tree', '-r', '--name-only', ref], { cwd: url });
  return listed.code === 0 ? listed.stdout.split('\n').filter(Boolean).sort() : null;
};
const showOn = async (url, ref, rel) => (await realRun('git', ['show', `${ref}:${rel}`], { cwd: url })).stdout;

test('setup then uninstall leaves this computer\'s files as they were, the project\'s files out by a pull request, and the run closed last', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world } = await applyWorld({ host });
      // The app installed on two accounts: the last project names both installations.
      writeKey('github-app', { clientId: 'Iv1.x', installations: { o: 77, zoe: 88 } });
      writeText(path.join(trustDir(), 'shown.json'), '{}\n');
      writeText(seenFile(), '{"at":"2026-10-20T00:00:00.000Z","enrolments":[]}\n');
      const f = fakes(world);
      const { got, done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      // Stops first, in the list's order, and the helper stops once the answer is sent.
      assert.deepEqual(f.seen.stops, ['foreman', 'watcher', 'receiver']);
      assert.equal(done.helperStops, true);
      // This computer's files are as they were before setup.
      assert.equal(readText(world.settings), world.before);
      assert.equal(fs.existsSync(path.join(world.userHome, 'Library', 'LaunchAgents', 'wheelhouse.telemetry.plist')), false);
      assert.deepEqual(f.seen.unset, ['CLAUDE_CODE_ENABLE_TELEMETRY']);
      assert.equal(fs.existsSync(path.join(world.folder, '.claude', 'settings.local.json')), false, 'setup made it (ruling R138)');
      assert.equal(fs.existsSync(path.join(world.folder, '.git', 'info', 'exclude')), false);
      // Locked is left, with the password once.
      assert.equal(f.seen.password, 1);
      assert.equal(fs.existsSync(path.join(world.lockedDir, 'managed-settings.json')), false);
      // The project's files: one pull request from Wheelhouse's branch, holding main's files with
      // setup's taken out by their values before; the trial branch is deleted.
      assert.deepEqual(f.seen.prs, [{ head: UNINSTALL_BRANCH, base: 'main', title: UNINSTALL_TITLE, body: f.seen.prs[0].body }]);
      assert.deepEqual(await filesOn(host.product.url, UNINSTALL_BRANCH), ['.claude/settings.json', 'README.md']);
      assert.deepEqual(JSON.parse(await showOn(host.product.url, UNINSTALL_BRANCH, '.claude/settings.json')), { enabledPlugins: { 'wheelhouse@wheelhouse': true } });
      assert.equal((await g(host.product.url, 'rev-parse', `${UNINSTALL_BRANCH}^`)), world.tip);
      assert.equal(await filesOn(host.product.url, 'wheelhouse-health-check'), null);
      // The folder's own copy of the project's files is the pull request's to change.
      assert.ok(readJson(path.join(world.folder, '.claude', 'settings.json')).extraKnownMarketplaces);
      // Keys, and Wheelhouse's own folders and files, are gone; the journal stays.
      for (const p of [path.join(keysDir(), 'github-app.json'), signingKeyFile(), enrolledFile(), toolFolder('gh'), path.join(wheelhouseHome(), 'projects', SLUG, 'project.json'), clicksDir(), trustDir(), seenFile()]) {
        assert.equal(fs.existsSync(p), false, p);
      }
      // The project's private record, whose own card wasn't answered, stays, and the projects
      // folder with it; so do the director's settings.
      assert.deepEqual(fs.readdirSync(path.join(wheelhouseHome(), 'projects', SLUG)), ['record']);
      assert.ok(fs.existsSync(path.join(stateDir(SLUG), 'events', 'e1.json')));
      assert.ok(fs.existsSync(profileDir()));
      assert.ok(done.lines.includes('Kept: this project\'s private record on this computer, as its own card was not answered.'));
      // This computer's id, and the folders those were in, emptied, go too (ruling R138).
      for (const p of [path.join(wheelhouseHome(), 'computer.json'), keysDir(), path.dirname(toolFolder('gh'))]) {
        assert.equal(fs.existsSync(p), false, p);
      }
      assert.ok(fs.existsSync(journalFile()));
      // What the director does: merge the pull request, uninstall the app, remove the plugin.
      assert.deepEqual(done.pages.map((p) => p.url), [ROOM_URL, 'https://github.com/settings/installations/77', 'https://github.com/settings/installations/88']);
      assert.deepEqual(f.seen.pages, done.pages.map((p) => p.url));
      assert.ok(done.lines.includes(`${PLUGIN_LINE}.`));
      // Every recorded change is marked, and only then is the run closed, by uninstall.
      assert.deepEqual(unmarked(), []);
      const run = readJournal().runs[0];
      assert.equal(run.closedBy, 'uninstall');
      assert.equal(run.closedAt, READY().toISOString());
      assert.equal(markOf(got.asks.find((a) => a.about === 'product').ids[0]).put, false);
    });
  } finally {
    host.cleanup();
  }
});

test('a change made after setup is left and named when uninstall is applied (Review Focus 2)', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world } = await applyWorld({ host });
      writeText(world.settings, `${JSON.stringify({ ...readJson(world.settings), cleanupPeriodDays: 14 }, null, 2)}\n`);
      const f = fakes(world);
      const { got, done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      assert.deepEqual(readJson(world.settings), { theme: 'dark', cleanupPeriodDays: 14 });
      const kept = got.keep.find((k) => k.what.startsWith('cleanupPeriodDays'));
      assert.deepEqual(markOf(kept.ids[0]), { at: READY().toISOString(), put: false, why: 'changed since setup' });
    });
  } finally {
    host.cleanup();
  }
});

test('uninstall from a setup stopped at step 4 puts back only what was done (Review Focus 1)', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world } = await applyWorld({ through: 4, host });
      const f = fakes(world);
      const { done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      assert.equal(readText(world.settings), world.before, 'step 6 never ran: its settings are untouched');
      assert.equal(fs.existsSync(path.join(world.folder, '.claude', 'settings.local.json')), false, 'setup made it (ruling R138)');
      assert.equal(fs.existsSync(toolFolder('gh')), false);
      assert.deepEqual(f.seen.prs, []);
      assert.equal(f.seen.password, 0);
      assert.deepEqual(f.seen.unset, []);
      assert.deepEqual(await filesOn(host.product.url, 'main'), ['README.md']);
      assert.deepEqual(unmarked(), []);
    });
  } finally {
    host.cleanup();
  }
});

test('Locked is left with the password before anything else is removed, and a cancelled password stops uninstall there', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world } = await applyWorld({ host });
      let at = null;
      const f = fakes(world, {
        onPassword: () => {
          at = {
            record: fs.existsSync(path.join(wheelhouseHome(), 'projects', SLUG, 'project.json')),
            keys: fs.existsSync(path.join(keysDir(), 'github-app.json')),
            settings: readJson(world.settings).cleanupPeriodDays,
            prs: f.seen.prs.length,
            trial: null,
          };
        },
      });
      const { done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      assert.deepEqual(at, { record: true, keys: true, settings: 30, prs: 0, trial: null });
    });
    await withHome(async () => {
      const { world, run } = await applyWorld({ host: await standIn() });
      const f = fakes(world, { cancel: true });
      const { got, done } = await applyPlan(world, f);
      assert.equal(done.ok, false);
      assert.match(done.refused, /^Uninstall stopped: Locked was not left \(The password prompt was cancelled, so nothing was changed\), so nothing else was removed/);
      assert.equal(readJson(world.settings).cleanupPeriodDays, 30);
      assert.ok(fs.existsSync(path.join(wheelhouseHome(), 'projects', SLUG, 'project.json')));
      assert.deepEqual(f.seen.prs, []);
      assert.equal(markOf(got.changes.find((c) => c.put === 'leave-locked').ids[0]), undefined);
      assert.equal(readJournal().runs.find((r) => r.id === run.id).closedAt, undefined);
      // The next plan still leaves Locked first.
      const again = await uninstallPlan({ folder: world.folder, userHome: world.userHome, platform: 'darwin', run: f.run });
      assert.equal(again.changes.find((c) => c.phase !== 'stop').put, 'leave-locked');
    });
  } finally {
    host.cleanup();
  }
});

// The director's answer on a level 4 card, as the prompt record keeps it.
function answerAsk(runId, ask, label, at = new Date(READY().getTime() + 1000)) {
  keepAnswer(makeEvent({ kind: 'action', data: { action: 'setup-answer', runId, step: ASK_STEP, questionId: ask.id, question: ask.card.question, label, text: null }, now: () => at }));
}

test('the private record is deleted only on its own card\'s Delete it, and a repository only by the director', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world, run } = await applyWorld({ host });
      const f = fakes(world);
      const routes = uninstallRoutes({ now: READY, userHome: world.userHome, platform: 'darwin', run: f.run, ops: f.ops });
      const shown = await routes['/setup/uninstall/plan']({ folder: world.folder });
      assert.deepEqual(shown.asks.map((a) => a.about), ['product', 'record']);
      answerAsk(run.id, shown.asks.find((a) => a.about === 'record'), 'Delete it');
      const { got, done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      // The record, on Delete it, is deleted from this computer, and the project's folder with it.
      assert.equal(fs.existsSync(stateDir(SLUG)), false);
      assert.equal(fs.existsSync(path.join(wheelhouseHome(), 'projects')), false);
      assert.deepEqual(markOf(got.asks.find((a) => a.about === 'record').ids[0]).put, true);
      assert.ok(done.lines.includes('This project\'s private record is deleted from this computer.'));
      // The product's repository, whose card wasn't answered: kept, and no settings page opened.
      assert.equal(f.seen.pages.some((u) => /\/settings$/.test(u)), false);
    });
    await withHome(async () => {
      const second = await standIn();
      const { world, run } = await applyWorld({ host: second });
      const f = fakes(world);
      const routes = uninstallRoutes({ now: READY, userHome: world.userHome, platform: 'darwin', run: f.run, ops: f.ops });
      const shown = await routes['/setup/uninstall/plan']({ folder: world.folder });
      answerAsk(run.id, shown.asks.find((a) => a.about === 'product'), 'Delete it');
      answerAsk(run.id, shown.asks.find((a) => a.about === 'record'), 'Keep it');
      const { got, done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      // A repository is deleted only by the director, on its own settings page.
      assert.ok(f.seen.pages.includes(`https://github.com/${REPO}/settings`));
      assert.deepEqual(markOf(got.asks.find((a) => a.about === 'product').ids[0]).why, 'left for your own Delete on its settings page');
      // The record, kept as its card said.
      assert.deepEqual(markOf(got.asks.find((a) => a.about === 'record').ids[0]), { at: READY().toISOString(), put: false, why: 'kept, as its own card said' });
      assert.ok(fs.existsSync(path.join(stateDir(SLUG), 'events', 'e1.json')));
      second.cleanup();
    });
  } finally {
    host.cleanup();
  }
});

test('a second project keeps the helper, telemetry and the signing key when the first is uninstalled', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world } = await applyWorld({ host });
      const other = fs.realpathSync.native(tempFolder('wh-other '));
      world.register('o__Other', other, 'o/Other');
      const f = fakes(world);
      const { done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      assert.equal(done.helperStops, undefined);
      assert.deepEqual(f.seen.stops, ['foreman', 'watcher']);
      assert.deepEqual(f.seen.unset, []);
      assert.equal(readJson(world.settings).cleanupPeriodDays, 30, 'this computer\'s settings stay for the other project');
      for (const p of [signingKeyFile(), enrolledFile(), path.join(keysDir(), 'github-app.json'), toolFolder('gh'), profileDir()]) assert.ok(fs.existsSync(p), p);
      assert.deepEqual(fs.readdirSync(path.join(wheelhouseHome(), 'projects', SLUG)), ['record'], 'only the private record stays');
      assert.ok(fs.existsSync(path.join(wheelhouseHome(), 'projects', 'o__Other')));
      // The app's keys stay; its installation page is given to untick this repository.
      assert.ok(f.seen.pages.includes('https://github.com/settings/installations/77'));
      assert.ok(done.lines.some((l) => l.includes(`untick ${REPO}`)));
      assert.equal(readJournal().runs[0].closedBy, 'uninstall');
    });
  } finally {
    host.cleanup();
  }
});

test('uninstall on a company GitLab gives git the certificate for its address, and glab its host, for the pull request and the branches', async () => {
  const COMPANY = 'https://git.example.org:8443';
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world } = await applyWorld({ host });
      writeProject(SLUG, { folder: world.folder, remoteUrl: host.product.url, host: 'gitlab', repo: REPO, connection: { host: 'gitlab', mode: 'quick', project: REPO, baseUrl: COMPANY } });
      const file = caFile(wheelhouseHome());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'CERTIFICATES\n');
      const f = fakes(world);
      // The host work is setup's own: only git, glab and the pages are stood in for.
      delete f.ops.adapterFor;
      const gitEnvs = [];
      const glab = [];
      const inner = f.run;
      f.run = async (command, args = [], options = {}) => {
        if (path.basename(command) === 'git') gitEnvs.push({ args: [...args], env: options.env ?? {} });
        if (path.basename(command) === 'glab') {
          glab.push({ args: [...args], env: options.env });
          return { code: 0, stdout: `${COMPANY}/${REPO}/-/merge_requests/12\n`, stderr: '' };
        }
        return inner(command, args, options);
      };
      const asked = [];
      f.ops.findOpenPr = async (a) => { asked.push(a.baseUrl); return null; };
      const { done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      // The pull request was made through glab told the company's host.
      assert.ok(glab.some((c) => c.args[0] === 'mr' && c.args[1] === 'create'), JSON.stringify(glab));
      assert.ok(glab.every((c) => c.env?.GITLAB_HOST === 'git.example.org:8443'), JSON.stringify(glab.map((c) => c.env)));
      assert.deepEqual([...new Set(asked)], [COMPANY]);
      // Every git call that reached the host carried the certificate for that address.
      const carries = ({ env }) => Object.values(env).includes(`http.${COMPANY}/.sslCAInfo`);
      assert.ok(gitEnvs.some(carries), 'git was given the certificate');
      // Including the project's own fetch and push, which go over the network (the profile's are another address).
      const network = gitEnvs.filter(({ args }) => args.some((a) => ['fetch', 'push', 'ls-remote'].includes(a)) && args.includes(host.product.url));
      assert.ok(network.some(({ args }) => args.includes('fetch')) && network.some(({ args }) => args.includes('push')), JSON.stringify(network.map((c) => c.args)));
      assert.deepEqual(network.filter((c) => !carries(c)).map((c) => c.args), [], 'every fetch, push and ls-remote carried the certificate');
    });
  } finally {
    host.cleanup();
  }
});

test('an uninstall cut short resumes with a fresh plan and never puts anything back twice; the run is closed only once all is done', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world, run } = await applyWorld({ host });
      const f = fakes(world);
      // The account's variable can't be read at first: uninstall stops there.
      const failing = async (file, args, options) => (file === 'launchctl' ? { code: 1, stdout: '', stderr: 'launchctl could not be reached' } : f.run(file, args, options));
      const listed = await uninstallPlan({ folder: world.folder, userHome: world.userHome, platform: 'darwin', run: f.run });
      const first = { done: await applyUninstall({ folder: world.folder, plan: listed, now: READY, userHome: world.userHome, platform: 'darwin', run: failing, ops: f.ops }) };
      assert.equal(first.done.ok, false);
      assert.match(first.done.refused, /launchctl|CLAUDE_CODE_ENABLE_TELEMETRY/);
      assert.match(first.done.refused, /What it did before is marked/);
      assert.equal(readJournal().runs.find((r) => r.id === run.id).closedAt, undefined);
      // What came before the variable is done and marked: Locked, the pull request, step 7's own
      // changes here and step 6's file.
      assert.equal(fs.existsSync(path.join(world.userHome, 'Library', 'LaunchAgents', 'wheelhouse.telemetry.plist')), false);
      assert.deepEqual(f.seen.unset, []);
      const { got, done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      assert.equal(got.changes.some((c) => ['leave-locked', 'pull-request', 'delete-branch'].includes(c.put)), false);
      assert.deepEqual(of(got, 'computer').map((c) => c.put), ['unset-env', 'reverse', 'reverse', 'reverse']);
      assert.equal(f.seen.password, 1);
      assert.equal(f.seen.prs.length, 1);
      assert.deepEqual(f.seen.unset, ['CLAUDE_CODE_ENABLE_TELEMETRY']);
      assert.equal(readText(world.settings), world.before);
      assert.deepEqual(unmarked(), []);
      assert.equal(readJournal().runs.find((r) => r.id === run.id).closedBy, 'uninstall');
    });
  } finally {
    host.cleanup();
  }
});

test('a push the plan read as never made is looked for on the host first: there, the list is stale and nothing is put back', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const world = makeWorld();
      world.lockedDir = tempFolder('wh-locked ');
      world.register(SLUG, world.folder, REPO, { host: 'github', mode: 'quick', project: REPO });
      writeProject(SLUG, { folder: world.folder, remoteUrl: host.product.url, host: 'github', repo: REPO, connection: { host: 'github', mode: 'quick', project: REPO } });
      const run = startRun({ folder: world.folder, now: NOW });
      const r = recorder(run.id);
      writeText(path.join(world.folder, '.claude', 'settings.json'), '{}\n');
      r.key(7, path.join(world.folder, '.claude', 'settings.json'), ['extraKnownMarketplaces'], { wheelhouse: { ref: 'v1' } });
      const tip = await g(host.work, 'rev-parse', 'HEAD');
      r.add(7, { kind: 'host', target: `${REPO} main`, before: { branch: 'main', sha: tip }, after: { action: 'push', branch: 'main', sha: tip } });
      markStep(run.id, 7, 'failed', { now: NOW, reason: 'the setup commit could not be pushed' });
      const f = fakes(world);
      const { got, done } = await applyPlan(world, f);
      assert.ok(got.keep.some((k) => /never pushed/.test(k.what)));
      assert.equal(done.ok, false);
      assert.match(done.refused, /setup's commit is on main on GitHub after all, so the list has changed since the card/);
      assert.deepEqual(f.seen.stops, []);
      assert.ok(readJson(path.join(world.folder, '.claude', 'settings.json')).extraKnownMarketplaces, 'nothing put back');
      // A commit the host hasn't got: uninstall goes on, and puts setup's files back here.
      const work = tempFolder('wh-elsewhere ');
      await g(work, 'init', '-q', '-b', 'main');
      await g(work, 'commit', '-q', '--allow-empty', '-m', 'Only here');
      const elsewhere = await g(work, 'rev-parse', 'HEAD');
      r.add(7, { kind: 'host', target: `${REPO} main`, before: { branch: 'main', sha: tip }, after: { action: 'push', branch: 'main', sha: elsewhere } });
      const next = await applyPlan(world, f);
      assert.equal(next.done.ok, true, next.done.refused);
      assert.deepEqual(readJson(path.join(world.folder, '.claude', 'settings.json')), {});
    });
  } finally {
    host.cleanup();
  }
});

test('looking on a company GitLab for a push never made gives git the certificate for its address', async () => {
  const COMPANY = 'https://git.example.org:8443';
  const host = await standIn();
  try {
    await withHome(async () => {
      const world = makeWorld();
      world.lockedDir = tempFolder('wh-locked ');
      world.register(SLUG, world.folder, REPO, { host: 'gitlab', mode: 'quick', project: REPO, baseUrl: COMPANY });
      writeProject(SLUG, { folder: world.folder, remoteUrl: host.product.url, host: 'gitlab', repo: REPO, connection: { host: 'gitlab', mode: 'quick', project: REPO, baseUrl: COMPANY } });
      const file = caFile(wheelhouseHome());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'CERTIFICATES\n');
      const run = startRun({ folder: world.folder, now: NOW });
      const r = recorder(run.id);
      writeText(path.join(world.folder, '.claude', 'settings.json'), '{}\n');
      r.key(7, path.join(world.folder, '.claude', 'settings.json'), ['extraKnownMarketplaces'], { wheelhouse: { ref: 'v1' } });
      const tip = await g(host.work, 'rev-parse', 'HEAD');
      r.add(7, { kind: 'host', target: `${REPO} main`, before: { branch: 'main', sha: tip }, after: { action: 'push', branch: 'main', sha: tip } });
      markStep(run.id, 7, 'failed', { now: NOW, reason: 'the setup commit could not be pushed' });
      const f = fakes(world);
      const calls = [];
      const inner = f.run;
      f.run = async (command, args = [], options = {}) => {
        if (path.basename(command) === 'git') calls.push({ args: [...args], env: options.env ?? {} });
        return inner(command, args, options);
      };
      await applyPlan(world, f);
      const looked = calls.filter(({ args }) => args.includes('ls-remote') && args.includes(host.product.url));
      assert.ok(looked.length > 0, 'the host was asked');
      assert.deepEqual(looked.filter(({ env }) => !Object.values(env).includes(`http.${COMPANY}/.sslCAInfo`)), [], 'every ask carried the certificate');
    });
  } finally {
    host.cleanup();
  }
});

// The director's Remove it on uninstall's card, as the prompt record keeps it.
function removeIt(project, hash, at = new Date(READY().getTime() - 60 * 1000)) {
  const event = makeEvent({ kind: 'action', data: { action: 'uninstall', project, hash, question: uninstallLine(project, hash), label: UNINSTALL_LABEL }, now: () => at });
  keepUninstallClick(event);
  return event;
}

// A spawn that runs uninstall's own process here, with the fakes, as the helper would start it.
function inProcess(f, children) {
  return (file, args, options) => {
    assert.equal(file, process.execPath);
    assert.equal(args[0], UNINSTALL_RUN);
    assert.equal(options.detached, true);
    const handlers = {};
    children.push(runUninstall(args.slice(1), { now: READY, platform: 'darwin', run: f.run, ops: f.ops, exit: () => {} })
      .then((code) => { handlers.exit?.(code); return code; }));
    return { on: (event, handler) => { handlers[event] = handler; }, unref() {} };
  };
}

test('apply refuses a list changed since the click, a click for another project, a stale click, and under STOP; the card\'s own click starts it, and status gives how it ended', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world, r } = await applyWorld({ through: 2, host });
      const f = fakes(world);
      const children = [];
      let stop = false;
      const routes = uninstallRoutes({ now: READY, stopped: () => stop, userHome: world.userHome, platform: 'darwin', run: f.run, spawn: inProcess(f, children) });
      const plan = routes['/setup/uninstall/plan'];
      const apply = routes['/setup/uninstall/apply'];
      const status = routes['/setup/uninstall/status'];
      const shown = await plan({ folder: world.folder });
      const name = path.basename(world.folder);
      assert.equal(shown.card.question.split('\n').at(-1), uninstallLine(name, shown.hash));
      assert.equal(uninstallShownFor(world.folder).hash, shown.hash);
      // Only the folder and the hash are taken.
      await assert.rejects(apply({ folder: world.folder, hash: shown.hash, changes: [] }), { message: UNINSTALL_OWN_LIST });
      // Another hash than the list's.
      removeIt(name, 'ab'.repeat(32));
      await assert.rejects(apply({ folder: world.folder, hash: 'ab'.repeat(32) }), { message: UNINSTALL_CHANGED });
      // A click for another project, and one too old, don't count.
      removeIt('another-project', shown.hash);
      removeIt(name, shown.hash, new Date(READY().getTime() - 11 * 60 * 1000));
      await assert.rejects(apply({ folder: world.folder, hash: shown.hash }), { message: UNINSTALL_NEEDS_CLICK });
      // Under STOP nothing is removed, and the click isn't used.
      const click = removeIt(name, shown.hash);
      stop = true;
      assert.deepEqual(await apply({ folder: world.folder, hash: shown.hash }), UNINSTALL_STOP);
      stop = false;
      assert.equal(fs.existsSync(path.join(usedDir(), click.id)), false, 'the click is not used under STOP');
      // The list changed since the card: a change recorded since.
      const extra = r.key(2, path.join(world.folder, '.claude', 'settings.local.json'), ['spinnerTips'], false);
      await assert.rejects(apply({ folder: world.folder, hash: shown.hash }), { message: UNINSTALL_CHANGED });
      // The list worked out now, with a click on its hash, but the card shown for the folder named
      // the old list: refused, and the click left unused.
      const now = await uninstallPlan({ folder: world.folder, userHome: world.userHome, platform: 'darwin', run: f.run });
      const unshown = removeIt(name, now.hash);
      await assert.rejects(apply({ folder: world.folder, hash: now.hash }), { message: UNINSTALL_CHANGED });
      assert.equal(fs.existsSync(path.join(usedDir(), unshown.id)), false);
      assert.deepEqual(children, []);
      // Shown again, with its new list, and clicked: it starts in its own process.
      const again = await plan({ folder: world.folder });
      assert.equal(again.hash, now.hash);
      const started = await apply({ folder: world.folder, hash: again.hash });
      assert.deepEqual(started, { ok: true, started: true });
      assert.deepEqual(await Promise.all(children), [0]);
      assert.equal(markOf(extra.id).put, true);
      assert.equal(readJournal().runs[0].closedBy, 'uninstall');
      // Status gives how it ended, what it said, and its pages.
      const ended = await status({ folder: world.folder });
      assert.equal(ended.lines[0], 'Uninstall is done.');
      assert.equal(ended.uninstall.state, 'done');
      assert.ok(ended.lines.includes(`${PLUGIN_LINE}.`));
      assert.deepEqual(ended.uninstall.lines, readProgress(world.folder).lines);
      // The same click can't start anything again.
      await assert.rejects(apply({ folder: world.folder, hash: again.hash }));
    });
  } finally {
    host.cleanup();
  }
});

test('uninstall\'s own process acts only for its click and hash, stops at its deadline, and a stopped one\'s status gives why, what it did, its pages and what is left', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world } = await applyWorld({ host });
      const f = fakes(world);
      const got = await uninstallPlan({ folder: world.folder, userHome: world.userHome, platform: 'darwin', run: f.run });
      const clickedAt = new Date(READY().getTime() - 60 * 1000).toISOString();
      const deadline = new Date(Date.parse(clickedAt) + 20 * 60 * 1000).toISOString();
      const record = { folder: world.folder, project: SLUG, hash: got.hash, clickedAt, deadline, startedAt: READY().toISOString(), state: 'running', lines: [], pages: [] };
      const argv = (hash = got.hash, at = clickedAt) => [world.folder, hash, at, deadline, world.userHome];
      const deps = { now: READY, platform: 'darwin', run: f.run, ops: f.ops, exit: () => {} };
      // No record, another click or another hash: nothing is done.
      assert.equal(await runUninstall(argv(), deps), 1);
      writeProgress(world.folder, record);
      // While it runs, status says so and a second apply is refused; past its deadline it reads as
      // not finished, and a fresh card may start another.
      const routes = uninstallRoutes({ now: READY, userHome: world.userHome, platform: 'darwin', run: f.run });
      assert.match((await routes['/setup/uninstall/status']({ folder: world.folder })).lines[0], /^Uninstall is running, started at /);
      await assert.rejects(routes['/setup/uninstall/apply']({ folder: world.folder, hash: got.hash }), { message: UNINSTALL_RUNNING });
      const later = uninstallRoutes({ now: () => new Date(Date.parse(deadline) + 1000), userHome: world.userHome, platform: 'darwin', run: f.run });
      const stuck = await later['/setup/uninstall/status']({ folder: world.folder });
      assert.match(stuck.lines[0], /^Uninstall did not finish: it started at .*, more than 20 minutes ago/);
      assert.equal(stuck.uninstall.state, 'stuck');
      await assert.rejects(later['/setup/uninstall/apply']({ folder: world.folder, hash: got.hash }), { message: UNINSTALL_CHANGED });
      assert.equal(await runUninstall(argv('ab'.repeat(32)), deps), 1);
      assert.equal(await runUninstall(argv(got.hash, READY().toISOString()), deps), 1);
      assert.equal(readProgress(world.folder).state, 'running');
      assert.deepEqual(f.seen.stops, []);
      // Started past its deadline: it records itself stopped, and changes nothing.
      assert.equal(await runUninstall(argv(), { ...deps, now: () => new Date(Date.parse(deadline) + 1000) }), 1);
      assert.match(readProgress(world.folder).refused, /more than 20 minutes after the click, so nothing was changed/);
      assert.deepEqual(f.seen.stops, []);
      // Stopped part-way (the app's installation page can't be opened): status gives why, what it
      // did before, the pull request's page, and what is left.
      writeProgress(world.folder, record);
      const opened = f.ops.openPage;
      f.ops.openPage = async (url) => { if (/installations/.test(url)) throw new Error('the browser could not be reached'); return opened(url); };
      assert.equal(await runUninstall(argv(), deps), 1);
      const { lines, uninstall } = await routes['/setup/uninstall/status']({ folder: world.folder });
      assert.equal(uninstall.state, 'stopped');
      assert.match(lines[0], /^Uninstall stopped: something went wrong: the browser could not be reached/);
      assert.equal(lines[1], 'Done before it stopped:');
      assert.ok(lines.includes(`Open the pull request: ${ROOM_URL}`));
      assert.ok(lines.includes('What is left:'));
      assert.ok(lines.some((l) => /remove the Wheelhouse plugin from this project/.test(l)));
      // Once a card is shown again, status gives the list.
      await routes['/setup/uninstall/plan']({ folder: world.folder });
      assert.match((await routes['/setup/uninstall/status']({ folder: world.folder })).lines[0], /^Uninstall of /);
    });
  } finally {
    host.cleanup();
  }
});

test('status gives the whole list as lines, and plan keeps the card as it is sent', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world, { through: 7 });
    const run = launchEnv({ CLAUDE_CODE_ENABLE_TELEMETRY: '1' });
    const routes = uninstallRoutes({ now: READY, userHome: world.userHome, platform: 'darwin', run });
    const { lines } = await routes['/setup/uninstall/status']({ folder: world.folder });
    const got = await plan(world);
    assert.deepEqual(lines, planLines(got, world.folder, world.userHome));
    assert.match(lines[0], new RegExp(`^Uninstall of ${SLUG} `));
    assert.ok(lines.some((l) => /a pull request taking setup's files and pins out of main/.test(l)));
    assert.ok(lines.some((l) => l.startsWith('Stays: ')));
    const shown = await routes['/setup/uninstall/plan']({ folder: world.folder });
    assert.equal(uninstallShownFor(world.folder).card.question, shown.card.question);
    await assert.rejects(routes['/setup/uninstall/status']({ folder: world.folder, hash: got.hash }), { message: UNINSTALL_OWN_LIST });
  });
});

test('the own app proposed again as it was (ruling R115) has nothing to put back', async () => {
  await withHome(async () => {
    const world = makeWorld();
    world.register();
    const run = startRun({ folder: world.folder, now: NOW });
    const app = { clientId: 'Iv1.mine', slug: 'zoe-wheelhouse', owner: 'zoe' };
    const again = recorder(run.id).add(3, { kind: 'host', target: PROFILE_TARGET, before: app, after: app });
    const got = await plan(world);
    assert.equal(got.changes.some((c) => c.put === 'put-back-own-app'), false);
    assert.equal(got.done.find((d) => d.ids.includes(again.id)).why, 'it held this before setup');
  });
});

test('the list\'s hash covers the folder: two folders of one name with nothing recorded get different hashes', async () => {
  await withHome(async () => {
    const a = path.join(fs.realpathSync.native(tempFolder('wh-a ')), 'Shop');
    const b = path.join(fs.realpathSync.native(tempFolder('wh-b ')), 'Shop');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    const one = await uninstallPlan({ folder: a, platform: 'darwin', run: launchEnv({}) });
    const two = await uninstallPlan({ folder: b, platform: 'darwin', run: launchEnv({}) });
    assert.deepEqual(one.changes, two.changes);
    assert.notEqual(one.hash, two.hash);
  });
});

test('through the helper, uninstall runs in its own process, and the helper stops once the status answer giving its end has gone', async () => {
  const home = shortHome();
  const user = fs.realpathSync.native(tempFolder('wh-user zoë '));
  const folder = path.join(user, 'Projects', 'Shop');
  fs.mkdirSync(folder, { recursive: true });
  // The helper and uninstall's own process run host tools by name with the real `run`, so stand-ins
  // come first on the PATH (tests/helpers/host-stand-ins.js), and the test asserts none ran.
  const tools = standInTools();
  try {
    await as(home, async () => {
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
      let stopped = false;
      // The list of a folder nothing was set up in, on the last project: the receiver's stop (no
      // receiver runs in this home), setup's own records removed, the plugin's line, the helper.
      const helper = await startHelper({
        run: hostGuard,
        address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({}), userHome: user,
        onStop: (close) => { stopped = true; return close(); },
      });
      try {
        const client = helperClient({ address: helper.address });
        const shown = await client.setup.uninstall.plan({ folder });
        assert.equal(shown.ok, true, shown.refused);
        assert.equal(shown.last, true);
        removeIt('Shop', shown.hash, new Date(Date.now() - 60 * 1000));
        assert.deepEqual(await client.setup.uninstall.apply({ folder, hash: shown.hash }), { ok: true, started: true });
        const got = await until(async () => {
          const now = await client.setup.uninstall.status({ folder });
          return now.uninstall?.state === 'running' ? null : now;
        }, { what: 'the uninstall to end' });
        assert.equal(got.ok, true, got.refused);
        assert.equal(got.uninstall.state, 'done', got.lines.join('\n'));
        assert.equal(got.helperStops, true);
        assert.ok(got.lines.includes('The usage receiver: not running.'));
        assert.ok(got.lines.includes(`${PLUGIN_LINE}.`));
        assert.equal(await until(() => stopped, { what: 'the helper to stop' }), true);
        assert.equal((await client.health()).ok, false, 'the helper no longer answers');
        // The answer is kept: the record says the helper was stopped for it.
        assert.equal(typeof readProgress(folder).helperStoppedAt, 'string');
        assert.deepEqual(tools.calls(), [], 'no host tool ran');
      } finally {
        await helper.close();
      }
    });
  } finally {
    tools.restore();
  }
});

test('a finished last uninstall nobody asks about stops the helper a while after its process ended', async () => {
  await withHome(async () => {
    const user = fs.realpathSync.native(tempFolder('wh-user '));
    const folder = path.join(user, 'Projects', 'Shop');
    fs.mkdirSync(folder, { recursive: true });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
    let stops = 0;
    const children = [];
    const f = { run: launchEnv({}), ops: { stopReceiver: async () => ({ stopped: false, why: 'not running' }) } };
    const routes = uninstallRoutes({ now: READY, userHome: user, platform: 'darwin', run: f.run, spawn: inProcess(f, children), stopHelper: () => { stops += 1; }, lingerMs: 10 });
    const shown = await routes['/setup/uninstall/plan']({ folder });
    removeIt('Shop', shown.hash);
    await routes['/setup/uninstall/apply']({ folder, hash: shown.hash });
    assert.deepEqual(await Promise.all(children), [0]);
    await until(() => stops > 0, { what: 'the helper to be stopped' });
    assert.equal(stops, 1);
    // Status afterwards still gives its end, and asks no second stop.
    const got = await routes['/setup/uninstall/status']({ folder });
    assert.equal(got.uninstall.state, 'done');
    assert.equal(got.helperStops, undefined);
    assert.equal(stops, 1);
  });
});

test('a last uninstall that finishes while its status is being answered stops the helper only after an answer giving its end', async () => {
  await withHome(async () => {
    const user = fs.realpathSync.native(tempFolder('wh-user '));
    const folder = path.join(user, 'Projects', 'Shop');
    fs.mkdirSync(folder, { recursive: true });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
    // The process is started but never runs here: the test writes how it ends, at the moment
    // status has read the record as running and is still working out its answer.
    let finishing = false;
    const now = () => {
      if (finishing) {
        finishing = false;
        writeProgress(folder, { ...readProgress(folder), state: 'done', helperStops: true, finishedAt: READY().toISOString() });
      }
      return READY();
    };
    const routes = uninstallRoutes({ now, userHome: user, platform: 'darwin', run: launchEnv({}), spawn: () => ({ on() {}, unref() {} }) });
    const shown = await routes['/setup/uninstall/plan']({ folder });
    removeIt('Shop', shown.hash);
    await routes['/setup/uninstall/apply']({ folder, hash: shown.hash });
    finishing = true;
    const during = await routes['/setup/uninstall/status']({ folder });
    assert.equal(during.uninstall.state, 'running');
    assert.equal(during.helperStops, undefined, 'an answer saying it still runs does not stop the helper');
    const after = await routes['/setup/uninstall/status']({ folder });
    assert.equal(after.uninstall.state, 'done');
    assert.equal(after.helperStops, true);
  });
});

test('a folder set up again after uninstall starts clean: setup\'s readers across runs pass over a closed run', async () => {
  await withHome(async () => {
    const world = makeWorld();
    const run = startRun({ folder: world.folder, now: NOW });
    const r = recorder(run.id);
    r.add(3, { kind: 'host', target: `github:${REPO}`, before: null, after: { repository: REPO, private: true, made: true } });
    r.add(3, { kind: 'folder', target: path.join(world.folder, '.git'), before: null, after: { joined: REPO } });
    r.add(2, { kind: 'process', target: 'xcode-select --install', before: null, after: { tool: 'git', startedAt: NOW().toISOString() } });
    const pgrep = async (file) => (file === 'pgrep' ? { code: 0, stdout: '4321\n', stderr: '' } : { code: 1, stdout: '', stderr: '' });
    assert.equal(madeBySetup(`github:${REPO}`), true);
    assert.equal(joinedFolder(world.folder), REPO);
    assert.ok(await openInstaller('git', { platform: 'darwin', run: pgrep }));
    closeRun(run.id, { at: NOW, by: 'uninstall' });
    assert.equal(madeBySetup(`github:${REPO}`), false);
    assert.equal(joinedFolder(world.folder), null);
    assert.equal(await openInstaller('git', { platform: 'darwin', run: pgrep }), null);
  });
});

test('a GitLab key is revoked through the API, then deleted; one GitLab won\'t revoke stops uninstall with its file kept; the token never leaves the header', async () => {
  const world = { };
  const setUp = (kind) => {
    world.w = makeWorld();
    const run = startRun({ folder: world.w.folder, now: NOW });
    recorder(run.id).add(3, { kind: 'host', target: 'key gitlab-project-5', before: null, after: { key: 'gitlab-project-5', project: REPO, kind } });
    writeKey('gitlab-project-5', { token: 'glpat-secret0123456789', kind, id: 9 });
    return run;
  };
  const answering = (statuses) => {
    const asked = [];
    const fetch = async (url, init) => {
      asked.push({ url, method: init.method, token: init.headers['PRIVATE-TOKEN'] });
      return { status: statuses.shift(), text: async () => '' };
    };
    return { asked, fetch };
  };
  await withHome(async () => {
    setUp('pasted-token');
    const f = fakes(world.w);
    const api = answering([204]);
    const { done } = await applyPlan(world.w, f, { fetch: api.fetch });
    assert.equal(done.ok, true, done.refused);
    assert.deepEqual(api.asked, [{ url: 'https://gitlab.com/api/v4/personal_access_tokens/self', method: 'DELETE', token: 'glpat-secret0123456789' }]);
    assert.equal(readKey('gitlab-project-5'), null);
    assert.ok(done.lines.includes('The GitLab token you pasted is revoked, which stops it everywhere it is used.'));
    assert.equal(JSON.stringify(done).includes('glpat-secret'), false);
    assert.deepEqual(unmarked(), []);
  });
  await withHome(async () => {
    const run = setUp('project-key');
    const f = fakes(world.w);
    const api = answering([403, 500]);
    const { done } = await applyPlan(world.w, f, { fetch: api.fetch });
    assert.equal(done.ok, false);
    assert.match(done.refused, /GitLab did not revoke the project key \(HTTP 500\), so its file was kept: open https:\/\/gitlab\.com\/o\/Cafe-Menu\/-\/settings\/access_tokens/);
    assert.deepEqual(api.asked.map((a) => a.url), ['https://gitlab.com/api/v4/personal_access_tokens/self', 'https://gitlab.com/api/v4/projects/5/access_tokens/9']);
    assert.ok(readKey('gitlab-project-5'));
    assert.equal(readJournal().runs.find((r) => r.id === run.id).closedAt, undefined);
    assert.equal(JSON.stringify(done).includes('glpat-secret'), false);
    // GitLab no longer accepting it means it works nowhere: its file goes, and uninstall finishes.
    const again = answering([401]);
    const next = await applyPlan(world.w, f, { fetch: again.fetch });
    assert.equal(next.done.ok, true, next.done.refused);
    assert.equal(readKey('gitlab-project-5'), null);
  });
});

test('a Delete it given before its card was last asked counts for nothing: the card is asked again, and the record stays (ruling R117)', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world, run } = await applyWorld({ host });
      const f = fakes(world);
      const first = uninstallRoutes({ now: READY, userHome: world.userHome, platform: 'darwin', run: f.run });
      const shown = await first['/setup/uninstall/plan']({ folder: world.folder });
      const record = shown.asks.find((a) => a.about === 'record');
      answerAsk(run.id, record, 'Delete it');
      // The director didn't go ahead; later the plan is asked for again, and its cards with it.
      const later = new Date(READY().getTime() + 60 * 60 * 1000);
      const second = uninstallRoutes({ now: () => later, userHome: world.userHome, platform: 'darwin', run: f.run });
      const again = await second['/setup/uninstall/plan']({ folder: world.folder });
      assert.equal(again.asks.find((a) => a.about === 'record').card.question, record.card.question, 'the same card, asked again');
      const { done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      assert.ok(fs.existsSync(stateDir(SLUG)), 'the old Delete it deleted nothing');
      assert.ok(done.lines.some((l) => l.startsWith("Kept: this project's private record on this computer")));
    });
  } finally {
    host.cleanup();
  }
});

test('a first push to a repository with no branch yet never landed: the host re-check finds no branch and uninstall goes on here (ruling R118)', async () => {
  const empty = await makeBareRemote({ repo: REPO });
  try {
    await withHome(async () => {
      const world = makeWorld();
      writeProject(SLUG, { folder: world.folder, remoteUrl: empty.url, host: 'github', repo: REPO, connection: { host: 'github', mode: 'quick', project: REPO } });
      const run = startRun({ folder: world.folder, now: NOW });
      const r = recorder(run.id);
      writeText(path.join(world.folder, '.claude', 'settings.json'), '{}\n');
      r.key(7, path.join(world.folder, '.claude', 'settings.json'), ['extraKnownMarketplaces'], { wheelhouse: { ref: 'v1' } });
      r.add(7, { kind: 'host', target: `${REPO} main`, before: { branch: 'main', sha: 'a'.repeat(40) }, after: { action: 'push', branch: 'main', sha: 'b'.repeat(40) } });
      markStep(run.id, 7, 'failed', { now: NOW, reason: 'the setup commit could not be pushed' });
      const f = fakes(world);
      const { done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      assert.deepEqual(readJson(path.join(world.folder, '.claude', 'settings.json')), {});
      // A host that can't be reached stops it, with a line saying so.
      await withHome(async () => {
        const w = makeWorld();
        writeProject(SLUG, { folder: w.folder, remoteUrl: path.join(empty.root, 'gone', `${REPO}.git`), host: 'github', repo: REPO, connection: { host: 'github', mode: 'quick', project: REPO } });
        const run2 = startRun({ folder: w.folder, now: NOW });
        recorder(run2.id).add(7, { kind: 'host', target: `${REPO} main`, before: { branch: 'main', sha: 'a'.repeat(40) }, after: { action: 'push', branch: 'main', sha: 'b'.repeat(40) } });
        const stopped = await applyPlan(w, fakes(w));
        assert.equal(stopped.done.ok, false);
        assert.match(stopped.done.refused, /GitHub could not be reached with your sign-in to see whether setup's commit is on main, so uninstall did not go on/);
      });
    });
  } finally {
    empty.cleanup();
  }
});

test('a trial branch whose commit setup never recorded is left, not deleted at whatever it holds', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const world = makeWorld();
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
      writeProject(SLUG, { folder: world.folder, remoteUrl: host.product.url, host: 'github', repo: REPO, connection: { host: 'github', mode: 'quick', project: REPO } });
      const run = startRun({ folder: world.folder, now: NOW });
      const trial = recorder(run.id).add(10, { kind: 'host', target: `${REPO} branch wheelhouse-health-check`, before: null, after: { branch: 'wheelhouse-health-check' } });
      const f = fakes(world);
      const { done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      assert.ok(await filesOn(host.product.url, 'wheelhouse-health-check'));
      assert.equal(markOf(trial.id).why, 'its commit was never recorded, so it stays');
    });
  } finally {
    host.cleanup();
  }
});

// ---- Part 4's fix wave (rulings R122 to R124) ----

// Step 7 as far as its push, on a world set up through step 6, stopped before it recorded
// protection or finished: the project's files written here, and the push of `sha` recorded.
function stepSevenToPush(world, r, sha, before) {
  const settings = path.join(world.folder, '.claude', 'settings.json');
  writeText(settings, `${JSON.stringify({ enabledPlugins: { 'wheelhouse@wheelhouse': true } }, null, 2)}\n`);
  r.key(7, settings, ['extraKnownMarketplaces'], { wheelhouse: { ref: 'v1' } });
  r.file(7, path.join(world.folder, '.claude', 'wheelhouse.json'), '{}\n');
  r.file(7, path.join(world.folder, 'CLAUDE.md'), '# Compact instructions\n');
  r.add(7, { kind: 'process', target: 'claude plugin install superpowers@wheelhouse --scope project', before: null, after: { plugin: 'superpowers@wheelhouse', scope: 'project', folder: world.folder } });
  return (pushed) => r.add(7, { kind: 'host', target: `${REPO} main`, before: { branch: 'main', sha: before }, after: { action: 'push', branch: 'main', sha: pushed ?? sha } });
}

test('a commit on the host the folder\'s tracking ref never showed: the push is marked as on the host, and the next plan plans the pull request, applied to the end (ruling R122)', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world, run, r } = await applyWorld({ through: 6, host });
      const record = stepSevenToPush(world, r, null, host.trial);
      const tip = await pushSetupCommit(world, host);
      const push = record(tip);
      markStep(run.id, 7, 'failed', { now: NOW, reason: 'All stop came on before the push was fetched back' });
      const f = fakes(world);
      const first = await applyPlan(world, f);
      assert.ok(first.got.keep.some((k) => k.why === NEVER_PUSHED));
      assert.equal(first.done.ok, false);
      assert.match(first.done.refused, /setup's commit is on main on GitHub after all, so the list has changed since the card/);
      assert.deepEqual(f.seen.stops, [], 'nothing else was done');
      // The push is marked as on the host, never as put back.
      const marked = readJournal().runs.flatMap((x) => x.changes).find((c) => c.id === push.id);
      assert.deepEqual(marked.onHost, { at: READY().toISOString() });
      assert.equal(marked.putBack, undefined);
      // The next plan reads the push as made: a pull request, not the same card again.
      const { got, done } = await applyPlan(world, f);
      assert.notEqual(got.hash, first.got.hash);
      assert.ok(got.changes.some((c) => c.put === 'pull-request'));
      assert.equal(got.keep.some((k) => k.why === NEVER_PUSHED), false);
      assert.equal(done.ok, true, done.refused);
      assert.equal(f.seen.prs.length, 1);
      assert.deepEqual(await filesOn(host.product.url, UNINSTALL_BRANCH), ['.claude/settings.json', 'README.md']);
      assert.deepEqual(unmarked(), []);
      assert.equal(readJournal().runs.find((x) => x.id === run.id).closedBy, 'uninstall');
    });
  } finally {
    host.cleanup();
  }
});

test('a commit never pushed is marked kept once setup\'s files are put back here, so a resume after the project\'s record is gone carries on (ruling R122)', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world, run, r } = await applyWorld({ through: 6, host });
      // A commit made only in this folder: the host has never had it.
      const work = tempFolder('wh-only-here ');
      await g(work, 'init', '-q', '-b', 'main');
      await g(work, 'commit', '-q', '--allow-empty', '-m', 'Only here');
      const push = stepSevenToPush(world, r, await g(work, 'rev-parse', 'HEAD'), host.trial)();
      markStep(run.id, 7, 'failed', { now: NOW, reason: 'the setup commit could not be pushed' });
      const f = fakes(world);
      await deleteTheRecord(world, run, f);
      // STOP comes on just after the last phase removed the project's own folder, its record.
      const projectDir = path.join(wheelhouseHome(), 'projects', SLUG);
      const first = await applyPlan(world, f, { stopped: () => !fs.existsSync(projectDir) });
      assert.ok(first.got.keep.some((k) => k.why === NEVER_PUSHED));
      assert.equal(first.done.ok, false);
      assert.match(first.done.refused, /All stop came on/);
      assert.equal(fs.existsSync(projectDir), false);
      assert.deepEqual(markOf(push.id), { at: READY().toISOString(), put: false, why: NEVER_PUSHED });
      assert.equal(fs.existsSync(path.join(world.folder, 'CLAUDE.md')), false, 'setup\'s files were put back here');
      // The resumed plan no longer lists the commit, and the apply needs no project record.
      const { got, done } = await applyPlan(world, f);
      assert.equal(got.project, null);
      assert.equal(got.keep.some((k) => k.why === NEVER_PUSHED), false);
      assert.equal(done.ok, true, done.refused);
      assert.deepEqual(unmarked(), []);
      assert.equal(readJournal().runs.find((x) => x.id === run.id).closedBy, 'uninstall');
      // The rule itself: once nothing before the last phase is left, a commit still listed as never
      // pushed is not looked for without the record; it is marked kept and uninstall carries on.
      await withHome(async () => {
        const w = makeWorld();
        const run2 = startRun({ folder: w.folder, now: NOW });
        const left = recorder(run2.id).add(7, { kind: 'host', target: `${REPO} main`, before: { branch: 'main', sha: 'a'.repeat(40) }, after: { action: 'push', branch: 'main', sha: 'b'.repeat(40) } });
        const p = await plan(w);
        assert.ok(p.changes.every((c) => c.put === 'stop' || c.phase === 'last'));
        const got2 = await applyUninstall({ folder: w.folder, plan: p, now: READY, userHome: w.userHome, platform: 'darwin', run: fakes(w).run, ops: fakes(w).ops });
        assert.equal(got2.ok, true, got2.refused);
        assert.equal(markOf(left.id).why, NEVER_PUSHED);
      });
    });
  } finally {
    host.cleanup();
  }
});

test('the trusted-keys list and the signing key go last of all: an uninstall cut short in its last phase can still be clicked and resumed (ruling R123)', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world, run } = await applyWorld({ host });
      const f = fakes(world);
      await deleteTheRecord(world, run, f);
      const projectDir = path.join(wheelhouseHome(), 'projects', SLUG);
      const first = await applyPlan(world, f, { stopped: () => !fs.existsSync(projectDir) });
      assert.equal(first.done.ok, false);
      assert.match(first.done.refused, /All stop came on/);
      // The keys phase is done, the project's record gone, and this computer can still sign.
      assert.equal(fs.existsSync(path.join(keysDir(), 'github-app.json')), false);
      for (const p of [signingKeyFile(), enrolledFile()]) assert.ok(fs.existsSync(p), p);
      const again = await plan(world, { run: f.run });
      const click = removeIt(again.card.target.project, again.hash);
      assert.deepEqual(freshUninstallClicks({ project: again.card.target.project, hash: again.hash, now: READY }).map((e) => e.id), [click.id]);
      assert.deepEqual(again.changes.slice(-7).map((c) => c.target ?? c.what), [
        enrolledFile(), path.join(wheelhouseHome(), 'computer.json'), path.join(wheelhouseHome(), 'projects'), path.dirname(toolFolder('gh')), signingKeyFile(), keysDir(), 'helper',
      ]);
      const { done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      for (const p of [signingKeyFile(), enrolledFile()]) assert.equal(fs.existsSync(p), false, p);
      assert.equal(readJournal().runs.find((x) => x.id === run.id).closedBy, 'uninstall');
    });
  } finally {
    host.cleanup();
  }
});

test('the last uninstall takes this computer\'s id and Wheelhouse\'s emptied folders out, but leaves a folder still holding something (ruling R138)', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world, run } = await applyWorld({ host });
      // Something not setup's in the keys folder: it is left, and the folder with it.
      writeText(path.join(keysDir(), 'theirs.txt'), 'kept\n');
      const f = fakes(world);
      await deleteTheRecord(world, run, f);
      const { got, done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      assert.deepEqual(got.changes.filter((c) => c.put === 'remove-empty').map((c) => c.target), [path.join(wheelhouseHome(), 'projects'), path.dirname(toolFolder('gh')), keysDir()]);
      assert.equal(fs.existsSync(path.join(wheelhouseHome(), 'computer.json')), false);
      assert.deepEqual(fs.readdirSync(keysDir()), ['theirs.txt']);
      assert.equal(fs.existsSync(path.join(wheelhouseHome(), 'projects')), false);
      assert.deepEqual(unmarked(), []);
    });
  } finally {
    host.cleanup();
  }
});

test('STOP read after the trusted-keys list is removed never stops uninstall before its runs are closed (ruling R123)', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world, run } = await applyWorld({ host });
      const f = fakes(world);
      const { done } = await applyPlan(world, f, { stopped: () => !fs.existsSync(enrolledFile()) });
      assert.equal(done.ok, true, done.refused);
      assert.equal(fs.existsSync(signingKeyFile()), false);
      assert.equal(readJournal().runs.find((x) => x.id === run.id).closedBy, 'uninstall');
    });
  } finally {
    host.cleanup();
  }
});

test('the trusted-keys list goes before the signing key: a failed removal of the list leaves the key, and the resume\'s click is accepted and finishes (ruling R128)', async (t) => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world, run } = await applyWorld({ host });
      const f = fakes(world);
      // The list can't be removed this once, as a file held open by another program on Windows.
      const rmSync = fs.rmSync;
      const failing = t.mock.method(fs, 'rmSync', (target, ...rest) => {
        if (target === enrolledFile()) throw Object.assign(new Error(`EBUSY: resource busy or locked, rm '${target}'`), { code: 'EBUSY' });
        return rmSync(target, ...rest);
      });
      const first = await applyPlan(world, f);
      failing.mock.restore();
      assert.equal(first.done.ok, false);
      assert.match(first.done.refused, /EBUSY/);
      // Both are still here, so this computer can still sign, and the run is still open.
      for (const p of [enrolledFile(), signingKeyFile()]) assert.ok(fs.existsSync(p), p);
      const tail = first.got.changes.slice(first.got.changes.findIndex((c) => c.target === enrolledFile()));
      assert.deepEqual(tail.slice(0, 2).map((c) => c.target), [enrolledFile(), path.join(wheelhouseHome(), 'computer.json')]);
      assert.equal(tail.at(-1).what, 'helper');
      assert.equal(readJournal().runs.find((x) => x.id === run.id).closedAt, undefined);
      const again = await plan(world, { run: f.run });
      assert.deepEqual(again.changes.slice(-7).map((c) => c.target ?? c.what), [
        enrolledFile(), path.join(wheelhouseHome(), 'computer.json'), path.join(wheelhouseHome(), 'projects'), path.dirname(toolFolder('gh')), signingKeyFile(), keysDir(), 'helper',
      ]);
      const click = removeIt(again.card.target.project, again.hash);
      assert.deepEqual(freshUninstallClicks({ project: again.card.target.project, hash: again.hash, now: READY }).map((e) => e.id), [click.id]);
      const { done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      for (const p of [enrolledFile(), signingKeyFile()]) assert.equal(fs.existsSync(p), false, p);
      assert.equal(readJournal().runs.find((x) => x.id === run.id).closedBy, 'uninstall');
    });
  } finally {
    host.cleanup();
  }
});

// Ruling R142 (from R140 (b)): the last phase removes the trusted-keys list, this computer's id and
// the emptied folders before the signing key, and from the list's removal on a click made in this
// session can't count. So a removal that fails from there on is left, named in what uninstall says
// (and so in its status), and uninstall still closes its run: nothing then needs a Remove it this
// computer can no longer sign. The keys folder goes after the key it held. The key's own removal
// failing is R128's second case (Task R review M4).
const LEFT_AT = {
  'this computer\'s id': { rm: () => path.join(wheelhouseHome(), 'computer.json') },
  'the projects folder': { rmdir: () => path.join(wheelhouseHome(), 'projects') },
  'the tools folder': { rmdir: () => path.dirname(toolFolder('gh')) },
  'the signing key': { rm: () => signingKeyFile() },
  'the keys folder': { rmdir: () => keysDir() },
};
for (const [where, cut] of Object.entries(LEFT_AT)) {
  test(`a removal that fails in the last phase at ${where}, after the trusted-keys list went, is left and named, and uninstall finishes (rulings R142, R128)`, async (t) => {
    const host = await standIn();
    try {
      await withHome(async () => {
        const { world, run } = await applyWorld({ host });
        const f = fakes(world);
        await deleteTheRecord(world, run, f);
        const target = (cut.rm ?? cut.rmdir)();
        const busy = (p) => Object.assign(new Error(`EBUSY: resource busy or locked, '${p}'`), { code: 'EBUSY' });
        const { rmSync, rmdirSync } = fs;
        const mock = cut.rm
          ? t.mock.method(fs, 'rmSync', (p, ...rest) => { if (p === target) throw busy(p); return rmSync(p, ...rest); })
          : t.mock.method(fs, 'rmdirSync', (p, ...rest) => { if (p === target) throw busy(p); return rmdirSync(p, ...rest); });
        const { got, done } = await applyPlan(world, f);
        mock.mock.restore();
        assert.equal(done.ok, true, done.refused);
        assert.equal(readJournal().runs.find((x) => x.id === run.id).closedBy, 'uninstall', 'the run is closed');
        // What could not be removed is left, and named once, with why and what to do.
        assert.ok(fs.existsSync(target), 'left');
        const left = done.lines.filter((l) => l.startsWith('Left: '));
        assert.equal(left.length, 1, left.join('\n'));
        assert.ok(left[0].includes(path.basename(target)), left[0]);
        assert.match(left[0], /EBUSY/);
        assert.match(left[0], /remove it yourself, or it goes with the next uninstall\.$/);
        // Everything else of the last phase is gone: the keys folder stays only while it holds the key.
        const rest = [enrolledFile(), signingKeyFile(), path.join(wheelhouseHome(), 'computer.json'), path.join(wheelhouseHome(), 'projects'), path.dirname(toolFolder('gh')), keysDir()]
          .filter((p) => p !== target && !(target === signingKeyFile() && p === keysDir()));
        for (const p of rest) assert.equal(fs.existsSync(p), false, p);
        // Its status, once done, names it too.
        const clickedAt = new Date(READY().getTime() - 60 * 1000).toISOString();
        writeProgress(world.folder, {
          folder: world.folder, project: got.card.target.project, hash: got.hash, clickedAt, deadline: new Date(Date.parse(clickedAt) + 20 * 60 * 1000).toISOString(),
          startedAt: READY().toISOString(), state: 'done', lines: done.lines, pages: done.pages,
        });
        const routes = uninstallRoutes({ now: READY, userHome: world.userHome, platform: 'darwin', run: f.run });
        const status = await routes['/setup/uninstall/status']({ folder: world.folder });
        assert.equal(status.lines[0], 'Uninstall is done.');
        assert.ok(status.lines.includes(left[0]));
      });
    } finally {
      host.cleanup();
    }
  });
}

// Ruling R142: after the signing key has gone, only the run's own close can stop uninstall. Its
// status then says, first, to start a new session and then ask again (as it does for an uninstall
// cut short there, once its time is up), since no Remove it clicked in this session can count. The
// next session start in the folder, still being set up while its run is open, makes a key (and an
// id) and enrols it; the director's click on the new card is signed by it, and uninstall finishes.
test('an uninstall whose run\'s close fails after the signing key went says in its status to start a new session, and finishes on resume with the key that session makes (rulings R142, R140)', async (t) => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world, run } = await applyWorld({ host });
      const f = fakes(world);
      await deleteTheRecord(world, run, f);
      const { renameSync } = fs;
      const mock = t.mock.method(fs, 'renameSync', (from, to, ...rest) => {
        if (to === journalFile() && fs.readFileSync(from, 'utf8').includes('"closedBy"')) throw Object.assign(new Error(`EBUSY: resource busy or locked, '${to}'`), { code: 'EBUSY' });
        return renameSync(from, to, ...rest);
      });
      const first = await applyPlan(world, f);
      mock.mock.restore();
      assert.equal(first.done.ok, false);
      assert.match(first.done.refused, /EBUSY/);
      assert.equal(fs.existsSync(signingKeyFile()), false, 'cut short after the signing key went');
      assert.equal(readJournal().runs.find((x) => x.id === run.id).closedAt, undefined, 'the run still open');

      // Its status says to start a new session first, and so does one cut short there and past its time.
      const clickedAt = new Date(READY().getTime() - 60 * 1000).toISOString();
      const deadline = new Date(Date.parse(clickedAt) + 20 * 60 * 1000).toISOString();
      const record = {
        folder: world.folder, project: first.got.card.target.project, hash: first.got.hash, clickedAt, deadline,
        startedAt: READY().toISOString(), state: 'stopped', refused: first.done.refused, lines: first.done.lines, pages: first.done.pages,
      };
      writeProgress(world.folder, record);
      const routes = uninstallRoutes({ now: READY, userHome: world.userHome, platform: 'darwin', run: f.run });
      const stopped = await routes['/setup/uninstall/status']({ folder: world.folder });
      assert.equal(stopped.lines[0], UNINSTALL_NEW_SESSION);
      assert.match(stopped.lines[1], /^Uninstall stopped: something went wrong: EBUSY/);
      assert.doesNotMatch(stopped.lines[1], /ask for uninstall's plan again/, 'not before a new session');
      const { refused, ...running } = record; // eslint-disable-line no-unused-vars
      writeProgress(world.folder, { ...running, state: 'running' });
      const later = uninstallRoutes({ now: () => new Date(Date.parse(deadline) + 1000), userHome: world.userHome, platform: 'darwin', run: f.run });
      const stuck = await later['/setup/uninstall/status']({ folder: world.folder });
      assert.equal(stuck.lines[0], UNINSTALL_NEW_SESSION);
      assert.match(stuck.lines[1], /^Uninstall did not finish/);
      writeProgress(world.folder, record);

      // The next session start in the folder: it is still being set up, so a key is made and enrolled.
      await sessionStart({ cwd: world.folder, session_id: 's1', hook_event_name: 'SessionStart' }, {
        client: { health: async () => ({ ok: true }) }, spawn: () => { throw new Error('nothing is started'); }, dir: tempFolder('wh-managed-'),
      });
      assert.ok(fs.existsSync(signingKeyFile()), 'a new key');
      // Now a click here counts, so status no longer says to start a new session.
      assert.match((await routes['/setup/uninstall/status']({ folder: world.folder })).lines[0], /^Uninstall stopped: /);
      const again = await plan(world, { run: f.run });
      const click = removeIt(again.card.target.project, again.hash);
      assert.deepEqual(freshUninstallClicks({ project: again.card.target.project, hash: again.hash, now: READY }).map((e) => e.id), [click.id], 'signed with the new key, and counted');
      const { done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      assert.equal(readJournal().runs.find((x) => x.id === run.id).closedBy, 'uninstall');
      for (const p of [signingKeyFile(), enrolledFile(), path.join(wheelhouseHome(), 'computer.json'), keysDir(), path.join(wheelhouseHome(), 'projects'), path.dirname(toolFolder('gh'))]) {
        assert.equal(fs.existsSync(p), false, p);
      }
    });
  } finally {
    host.cleanup();
  }
});

// Ruling R146: a director who asks for uninstall again in that session, past status's new-session
// line, is given the same line by plan, and no card to click: a Remove it there could not be signed,
// so asking it would only begin the click loop. Plan writes nothing then, and once the next session
// start has made and enrolled a key, it gives the card again.
test('uninstall\'s plan, after an uninstall stopped past the trusted-keys list\'s removal, leads with the new-session line and gives no card, writing nothing (rulings R146, R142)', async (t) => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world } = await applyWorld({ host });
      const f = fakes(world);
      const routes = uninstallRoutes({ now: READY, userHome: world.userHome, platform: 'darwin', run: f.run });
      // The card the director clicked, shown as plan gives it while a click here can count.
      const shownFirst = await routes['/setup/uninstall/plan']({ folder: world.folder });
      assert.equal(typeof shownFirst.hash, 'string');
      assert.equal(shownFirst.lines, undefined);
      const { renameSync } = fs;
      const mock = t.mock.method(fs, 'renameSync', (from, to, ...rest) => {
        if (to === journalFile() && fs.readFileSync(from, 'utf8').includes('"closedBy"')) throw Object.assign(new Error(`EBUSY: resource busy or locked, '${to}'`), { code: 'EBUSY' });
        return renameSync(from, to, ...rest);
      });
      const first = await applyPlan(world, f);
      mock.mock.restore();
      assert.equal(first.done.ok, false);
      assert.equal(fs.existsSync(signingKeyFile()), false, 'cut short after the signing key went');
      const clickedAt = new Date(READY().getTime() - 60 * 1000).toISOString();
      const deadline = new Date(Date.parse(clickedAt) + 20 * 60 * 1000).toISOString();
      const record = {
        folder: world.folder, project: first.got.card.target.project, hash: first.got.hash, clickedAt, deadline,
        startedAt: READY().toISOString(), state: 'stopped', refused: first.done.refused, lines: first.done.lines, pages: first.done.pages,
      };
      writeProgress(world.folder, record);
      const status = await routes['/setup/uninstall/status']({ folder: world.folder });
      assert.equal(status.lines[0], UNINSTALL_NEW_SESSION);

      // Asked again in this session: the same line first, the same lines as status, and no card.
      const shownBefore = uninstallShownFor(world.folder);
      const journalBefore = fs.readFileSync(journalFile(), 'utf8');
      const again = await routes['/setup/uninstall/plan']({ folder: world.folder });
      assert.equal(again.ok, true);
      assert.equal(again.lines[0], UNINSTALL_NEW_SESSION);
      assert.deepEqual(again.lines, status.lines);
      for (const k of ['hash', 'card', 'asks', 'last']) assert.equal(again[k], undefined, k);
      assert.deepEqual(uninstallShownFor(world.folder), shownBefore, 'no card noted as shown');
      assert.equal(fs.readFileSync(journalFile(), 'utf8'), journalBefore, 'no card asked');
      assert.deepEqual(readProgress(world.folder), record);
      // So, too, for one cut short there and past its time.
      const { refused, ...running } = record; // eslint-disable-line no-unused-vars
      writeProgress(world.folder, { ...running, state: 'running' });
      const later = uninstallRoutes({ now: () => new Date(Date.parse(deadline) + 1000), userHome: world.userHome, platform: 'darwin', run: f.run });
      const stuck = await later['/setup/uninstall/plan']({ folder: world.folder });
      assert.equal(stuck.lines[0], UNINSTALL_NEW_SESSION);
      assert.equal(stuck.card, undefined);
      writeProgress(world.folder, record);

      // The next session start makes and enrols a key: plan gives the card again.
      await sessionStart({ cwd: world.folder, session_id: 's1', hook_event_name: 'SessionStart' }, {
        client: { health: async () => ({ ok: true }) }, spawn: () => { throw new Error('nothing is started'); }, dir: tempFolder('wh-managed-'),
      });
      const fresh = await routes['/setup/uninstall/plan']({ folder: world.folder });
      assert.equal(fresh.lines, undefined);
      assert.equal(typeof fresh.hash, 'string');
      assert.equal(typeof fresh.card.question, 'string');
    });
  } finally {
    host.cleanup();
  }
});

// A computer that joined the project another computer set up (step 3's join answer): registered,
// with the app's keys, its own private record opened, its own key trusted.
function joiningWorld(host) {
  const world = makeWorld();
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
  writeProject(SLUG, { folder: world.folder, remoteUrl: host.product.url, host: 'github', repo: REPO, connection: { host: 'github', mode: 'narrow', project: REPO, installationId: 77 } });
  const run = startRun({ folder: world.folder, now: NOW });
  const r = recorder(run.id);
  r.add(3, { kind: 'answer', target: 'step 3', before: null, after: { joined: REPO } });
  r.folder(3, path.join(world.folder, '.git'), { origin: host.product.url, branch: 'main', joined: REPO });
  writeText(path.join(world.folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  r.add(3, { kind: 'host', target: 'key github-app', before: null, after: { key: 'github-app', clientId: 'Iv1.x', app: 'wheelhouse' } });
  writeKey('github-app', { clientId: 'Iv1.x', installations: { o: 77 } });
  r.folder(3, stateDir(SLUG), { record: true }, { before: null });
  writeText(path.join(stateDir(SLUG), 'events', 'e1.json'), '{}');
  r.file(3, path.join(world.folder, '.claude', 'settings.json'), '{"committed":true}\n');
  r.key(7, path.join(world.folder, '.claude', 'settings.local.json'), ['statusLine'], { type: 'command' });
  return { world, run };
}

test('a joining computer\'s uninstall leaves the app\'s installation to the other computers, offers only its own record\'s card, and says so truly (ruling R124)', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world, run } = joiningWorld(host);
      // While another project stays here: no untick, and the app's access is named as staying.
      const other = fs.realpathSync.native(tempFolder('wh-other '));
      world.register('o__Other', other, 'o/Other');
      const notLast = await plan(world);
      assert.equal(notLast.shared, true);
      assert.equal(notLast.changes.some((c) => c.put === 'untick-repository' || c.put === 'delete-key'), false);
      assert.ok(notLast.keep.some((k) => k.what === `the GitHub app's access to ${REPO}` && /other computers/.test(k.why)));
      fs.rmSync(path.join(wheelhouseHome(), 'projects', 'o__Other'), { recursive: true });
      // The last project here: the keys go from this computer, the installation stays.
      const got = await plan(world);
      assert.equal(got.last, true);
      assert.equal(got.changes.some((c) => c.put === 'untick-repository'), false);
      assert.deepEqual(got.changes.filter((c) => c.put === 'delete-key').map((c) => c.shared), [true]);
      // The record is this computer's own, so its card is offered; nothing on the host is.
      assert.deepEqual(got.asks.map((a) => a.about), ['record']);
      assert.doesNotMatch(got.card.checks, /no longer guard/);
      assert.match(got.card.checks, /other computers keep the checks/);
      assert.match(got.card.why, /stays on GitHub for your other computers/);
      assert.match(planLines(got, world.folder, world.userHome).join('\n'), /the app stays installed for your other computers/);
      assert.deepEqual(accounted(got), recordedIds());
      const f = fakes(world);
      const { done } = await applyPlan(world, f);
      assert.equal(done.ok, true, done.refused);
      assert.deepEqual(done.pages, [], 'no installation page: nothing to untick or uninstall');
      assert.ok(done.lines.includes('The GitHub app\'s keys are deleted from this computer. The app stays installed on GitHub, as your other computers use it.'));
      assert.equal(done.lines.some((l) => /click Uninstall|untick/.test(l)), false);
      assert.ok(fs.existsSync(stateDir(SLUG)), 'the record stays without its card');
      assert.equal(readText(path.join(world.folder, '.claude', 'settings.json')), '{"committed":true}\n');
      assert.equal(readJournal().runs.find((x) => x.id === run.id).closedBy, 'uninstall');
    });
  } finally {
    host.cleanup();
  }
});

test('a first computer that trusts another computer\'s key treats the project as shared: its files stay as committed, nothing on the host is offered for deletion, the app is left installed (ruling R124)', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
    // Alone, it is not shared: the pull request, the Delete cards and the checks line as before.
    const alone = await plan(world);
    assert.equal(alone.shared, false);
    assert.ok(alone.changes.some((c) => c.put === 'pull-request'));
    assert.deepEqual(alone.asks.map((a) => a.about), ['product', 'record']);
    assert.match(alone.card.checks, /no longer guard/);
    enrol({ computer: 'ffff0000', publicKey: 'AAAA', enrolledAt: '2026-10-19T01:00:00.000Z' });
    const got = await plan(world);
    assert.equal(got.shared, true);
    assert.equal(got.changes.some((c) => ['pull-request', 'in-pull-request'].includes(c.put)), false);
    assert.equal(got.changes.some((c) => c.phase === 'files' && c.put === 'reverse'), false, 'the project\'s files stay as committed');
    assert.ok(got.keep.some((k) => k.what === 'setup\'s commit on main' && /other computers/.test(k.why)));
    assert.ok(got.keep.some((k) => /CLAUDE\.md$/.test(k.what) && /as committed/.test(k.why)));
    assert.ok(got.keep.some((k) => /superpowers/.test(k.what)));
    assert.deepEqual(got.asks.map((a) => a.about), ['record'], 'only this computer\'s own record');
    assert.ok(got.keep.some((k) => k.what === `${REPO} on GitHub` && /other computers/.test(k.why)));
    assert.deepEqual(got.changes.filter((c) => c.put === 'delete-key').map((c) => c.shared), [true]);
    // The trial's branch, this computer's own, is still cleared.
    assert.ok(got.changes.some((c) => c.put === 'delete-branch' && c.branch === 'wheelhouse-health-check'));
    assert.doesNotMatch(got.card.checks, /no longer guard/);
    assert.deepEqual(accounted(got), recordedIds());
    const { question } = composeCard(got.card);
    assert.ok(question.question.length <= CARD.chars, `${question.question.length}`);
    assert.deepEqual(cardProblems(question.question), []);
    // While another project stays here: no untick either.
    world.register('o__Other', fs.realpathSync.native(tempFolder('wh-other ')), 'o/Other');
    const notLast = await plan(world);
    assert.equal(notLast.changes.some((c) => c.put === 'untick-repository'), false);
  });
});

// Ruling R131: step 7's `.wheelhouse/` exclude line stays while the project's .wheelhouse/ folder
// (the front desk's and the foreman's files) is there, named on the card as kept with it; the
// folder's files are never touched. Without the folder, the line goes as the others do.
test('the .wheelhouse/ exclude line stays while the project\'s .wheelhouse/ folder is there, named on the card; without the folder it goes (ruling R131)', async () => {
  await withHome(async () => {
    const world = makeWorld();
    world.register();
    world.lockedDir = tempFolder('wh-locked ');
    const run = startRun({ folder: world.folder, now: NOW });
    const r = recorder(run.id);
    // Step 7's two lines, as it writes them: the one for this computer's settings, then Wheelhouse's own.
    const exclude = path.join(world.folder, '.git', 'info', 'exclude');
    const before = '# git ls-files --others --exclude-from=.git/info/exclude\n';
    writeText(exclude, before);
    const settingsLine = r.file(7, exclude, `${before}${EXCLUDE_LINE}\n`, { line: EXCLUDE_LINE });
    const ownLine = r.file(7, exclude, `${before}${EXCLUDE_LINE}\n${WHEELHOUSE_LINE}\n`, { line: WHEELHOUSE_LINE });
    const frontDesk = path.join(world.folder, '.wheelhouse', 'front-desk.json');
    writeText(frontDesk, '{"command":"status"}\n');
    writeText(path.join(world.folder, '.wheelhouse', 'foreman', 'wakes', 'w1.json'), '{}\n');

    const got = await plan(world);
    const stays = got.keep.filter((k) => /\.wheelhouse\//.test(k.what));
    assert.equal(stays.length, 2, 'the line and the folder, each named as kept');
    assert.deepEqual(stays.find((k) => k.ids !== undefined).ids, [ownLine.id]);
    assert.ok(stays.every((k) => /First Mate's and the Bosun's files/.test(k.why)), JSON.stringify(stays));
    assert.match(got.card.what, / \.wheelhouse\/ stays, out of git: the First Mate's and Bosun's files\. /);
    assert.ok(planLines(got, world.folder, world.userHome).some((l) => /^Stays: \.wheelhouse\/ in /.test(l)));
    // Only the settings line is put back, Wheelhouse's own staying where it was.
    const reversing = got.changes.filter((c) => c.put === 'reverse' && c.change.target === exclude);
    assert.deepEqual(reversing.map((c) => c.ids), [[settingsLine.id]]);
    assert.equal(reversing[0].change.before, `${before}${WHEELHOUSE_LINE}\n`);
    assert.deepEqual(accounted(got), recordedIds());

    const f = fakes(world);
    const done = await applyUninstall({ folder: world.folder, plan: got, now: READY, userHome: world.userHome, platform: 'darwin', run: f.run, ops: f.ops });
    assert.equal(done.ok, true, done.refused);
    assert.equal(readText(exclude), `${before}${WHEELHOUSE_LINE}\n`);
    assert.equal(readText(frontDesk), '{"command":"status"}\n', 'nothing in the folder is touched');
    assert.ok(fs.existsSync(path.join(world.folder, '.wheelhouse', 'foreman', 'wakes', 'w1.json')));
    assert.equal(markOf(settingsLine.id).put, true);
    assert.equal(markOf(ownLine.id).put, false);
    assert.match(markOf(ownLine.id).why, /First Mate's and the Bosun's files/);
  });

  await withHome(async () => {
    const world = makeWorld();
    world.register();
    const run = startRun({ folder: world.folder, now: NOW });
    const r = recorder(run.id);
    const exclude = path.join(world.folder, '.git', 'info', 'exclude');
    const before = '# git ls-files --others --exclude-from=.git/info/exclude\n';
    writeText(exclude, before);
    r.file(7, exclude, `${before}${EXCLUDE_LINE}\n`, { line: EXCLUDE_LINE });
    r.file(7, exclude, `${before}${EXCLUDE_LINE}\n${WHEELHOUSE_LINE}\n`, { line: WHEELHOUSE_LINE });
    // With the folder there the card is one list; the folder gone before the click, it is another.
    fs.mkdirSync(path.join(world.folder, '.wheelhouse'));
    const withFolder = await plan(world);
    fs.rmdirSync(path.join(world.folder, '.wheelhouse'));
    const got = await plan(world);
    assert.notEqual(got.hash, withFolder.hash);
    assert.equal(got.keep.some((k) => /\.wheelhouse\//.test(k.what)), false);
    assert.doesNotMatch(got.card.what, /\.wheelhouse\//);
    assert.equal(got.changes.filter((c) => c.put === 'reverse' && c.change.target === exclude).length, 2);
    world.lockedDir = tempFolder('wh-locked ');
    const f = fakes(world);
    const done = await applyUninstall({ folder: world.folder, plan: got, now: READY, userHome: world.userHome, platform: 'darwin', run: f.run, ops: f.ops });
    assert.equal(done.ok, true, done.refused);
    assert.equal(readText(exclude), before, 'the line goes as before');
  });
});

// Setup's .env lines (step 7) keep secrets out of git and cost nothing: uninstall never takes them
// out, in the project's .gitignore (made or added to by setup) or in a joining computer's own list,
// and names them as kept with a short reason.
test('setup\'s .env lines stay in a .gitignore setup made or added to, alone or shared, and are named as kept', async () => {
  for (const shared of [false, true]) {
    await withHome(async () => {
      const world = makeWorld();
      world.register();
      world.lockedDir = tempFolder('wh-locked ');
      if (shared) enrol({ computer: 'ffff0000', publicKey: 'AAAA', enrolledAt: '2026-10-19T01:00:00.000Z' });
      const run = startRun({ folder: world.folder, now: NOW });
      const r = recorder(run.id);
      // One .gitignore setup made whole, one it added to.
      const made = path.join(world.folder, '.gitignore');
      const lineOne = r.file(7, made, '.env\n', { line: '.env' });
      const lineTwo = r.file(7, made, '.env\n.env.*\n', { line: '.env.*' });
      const exclude = path.join(world.folder, '.git', 'info', 'exclude');
      const before = '# git ls-files --others --exclude-from=.git/info/exclude\n';
      writeText(exclude, before);
      const settingsLine = r.file(7, exclude, `${before}${EXCLUDE_LINE}\n`, { line: EXCLUDE_LINE });
      const envLine = r.file(7, exclude, `${before}${EXCLUDE_LINE}\n.env\n`, { line: '.env' });
      const got = await plan(world);
      const stays = got.keep.filter((k) => /\.env/.test(k.what));
      assert.equal(stays.length, 2, JSON.stringify(stays));
      assert.ok(stays.every((k) => k.why === ENV_STAYS));
      assert.deepEqual(stays.flatMap((k) => k.ids).sort(), [lineOne.id, lineTwo.id, envLine.id].sort());
      // The made file is not offered for deletion or reversal; the settings line alone is put back in the list.
      assert.equal(got.changes.some((c) => c.change?.target === made), false);
      const reversing = got.changes.filter((c) => c.put === 'reverse' && c.change.target === exclude);
      assert.deepEqual(reversing.map((c) => c.ids), [[settingsLine.id]]);
      assert.equal(reversing[0].change.before, `${before}.env\n`);
      assert.deepEqual(accounted(got), recordedIds());
      const f = fakes(world);
      const done = await applyUninstall({ folder: world.folder, plan: got, now: READY, userHome: world.userHome, platform: 'darwin', run: f.run, ops: f.ops });
      assert.equal(done.ok, true, done.refused);
      assert.equal(readText(made), '.env\n.env.*\n', 'the .gitignore setup made is kept with its lines');
      assert.equal(readText(exclude), `${before}.env\n`, 'the settings line goes, the .env line stays');
    });
  }
});

test('a .gitignore setup added .env.* to keeps its own text and the line', async () => {
  await withHome(async () => {
    const world = makeWorld();
    world.register();
    world.lockedDir = tempFolder('wh-locked ');
    const run = startRun({ folder: world.folder, now: NOW });
    const r = recorder(run.id);
    const file = path.join(world.folder, '.gitignore');
    writeText(file, 'node_modules\n');
    r.file(7, file, 'node_modules\n.env.*\n', { line: '.env.*' });
    const got = await plan(world);
    assert.ok(got.keep.some((k) => /\.env\.\*/.test(k.what) && k.why === ENV_STAYS));
    const f = fakes(world);
    const done = await applyUninstall({ folder: world.folder, plan: got, now: READY, userHome: world.userHome, platform: 'darwin', run: f.run, ops: f.ops });
    assert.equal(done.ok, true, done.refused);
    assert.equal(readText(file), 'node_modules\n.env.*\n');
  });
});

// Rulings R131, R134: uninstall's card always composes within the composer's limit, whatever the
// world: a full setup (Locked, the pull request, the trial, the keys) with the .wheelhouse/ folder,
// a 40-character project, one setting or thirty changed since setup, alone and shared. What the
// card has no room for is in `uninstall status`, and the hash covers the whole list.
test('uninstall\'s card composes within the limit for a full setup with a long name, alone and shared, and leaves out only what status lists (rulings R131, R134)', async () => {
  const slug = `o__${'b'.repeat(37)}`;
  for (const changedCount of [1, 30]) {
    await withHome(async () => {
      const world = makeWorld();
      const { r } = fullSetup(world, { slug });
      const exclude = path.join(world.folder, '.git', 'info', 'exclude');
      r.file(7, exclude, `${readText(exclude)}${WHEELHOUSE_LINE}\n`, { line: WHEELHOUSE_LINE });
      writeText(path.join(world.folder, '.wheelhouse', 'front-desk.json'), '{}\n');
      const settings = readJson(world.settings);
      const theirs = {};
      for (let i = 0; i < changedCount; i++) {
        r.key(6, world.settings, [`someLongSettingName${i}`], i);
        theirs[`someLongSettingName${i}`] = 'theirs';
      }
      writeText(world.settings, `${JSON.stringify({ ...settings, ...theirs }, null, 2)}\n`);
      for (const trusting of [false, true]) {
        if (trusting) enrol({ computer: 'ffff0000', publicKey: 'AAAA', enrolledAt: '2026-10-19T01:00:00.000Z' });
        const got = await plan(world);
        const at = `${changedCount} changed, ${trusting ? 'shared' : 'alone'}`;
        assert.equal(got.project, slug, at);
        assert.equal(got.shared, trusting, at);
        assert.ok(got.changes.some((c) => c.put === 'leave-locked'), at);
        assert.equal(got.changes.some((c) => c.put === 'pull-request'), !trusting, at);
        assert.ok(got.changes.some((c) => c.put === 'delete-branch'), at);
        const { question, card } = composeCard(got.card);
        assert.ok(question.question.length <= CARD.chars, `${at}: ${question.question.length}`);
        assert.deepEqual(cardProblems(question.question), [], at);
        assert.equal(card.line, uninstallLine(slug, got.hash), at);
        assert.match(got.card.what, /\.wheelhouse\/ stays, out of git/, at);
        // A card that leaves out any of them says where they are read.
        const all = Array.from({ length: changedCount }, (_, i) => `someLongSettingName${i}`).every((k) => got.card.what.includes(k));
        if (!all) assert.match(got.card.what, /cli\.js uninstall status/, at);
        // Nothing is dropped from what the click covers: every change setup recorded is in the
        // list the hash names, and status lists each one left as the director changed it.
        assert.deepEqual(accounted(got), recordedIds(), at);
        const lines = planLines(got, world.folder, world.userHome);
        for (let i = 0; i < changedCount; i++) assert.ok(lines.some((l) => l.includes(`someLongSettingName${i}`) && /changed since setup/.test(l)), `${at}: ${i}`);
      }
    });
  }
});

// Task R N3: the two shortest of uninstall's card texts, reached by the longest names. GitHub's
// longest slug is 141 characters (a 39-character owner, "__", a 100-character repository). With the
// .wheelhouse/ folder and a setting changed since setup, a 100-character slug takes "What stays, and
// why" alone and the whole list's pointer shared, and a 141-character slug takes the whole list's
// pointer both ways. Each composes within the composer's limit and points to `uninstall status`.
test('uninstall\'s two shortest card texts are reached by the longest names, and compose within the limit (Task R N3)', async () => {
  // The card's text holds no options, so the longest text fits for any name: the full one is reached even by the longest names, and the shorter ones are kept for a longer list.
  const FULL = /^Remove Wheelhouse from [^\n]*: stop its jobs, [^\n]* Left as you changed them: /;
  const STAYS = /^Remove Wheelhouse from [^\n]*: stop its jobs, [^\n]* What stays, and why: cli\.js uninstall status\./;
  const WHOLE = /^Remove Wheelhouse from [^\n]*: the whole list is in cli\.js uninstall status\./;
  const reached = [];
  for (const [owner, repo] of [['o', 'c'.repeat(97)], ['o'.repeat(39), 'c'.repeat(100)]]) {
    const slug = `${owner}__${repo}`;
    await withHome(async () => {
      const world = makeWorld();
      const { r } = fullSetup(world, { slug });
      const exclude = path.join(world.folder, '.git', 'info', 'exclude');
      r.file(7, exclude, `${readText(exclude)}${WHEELHOUSE_LINE}\n`, { line: WHEELHOUSE_LINE });
      writeText(path.join(world.folder, '.wheelhouse', 'front-desk.json'), '{}\n');
      r.key(6, world.settings, ['someLongSettingName'], 1);
      writeText(world.settings, `${JSON.stringify({ ...readJson(world.settings), someLongSettingName: 'theirs' }, null, 2)}\n`);
      for (const trusting of [false, true]) {
        if (trusting) enrol({ computer: 'ffff0000', publicKey: 'AAAA', enrolledAt: '2026-10-19T01:00:00.000Z' });
        const got = await plan(world);
        const at = `${slug.length}, ${trusting ? 'shared' : 'alone'}`;
        assert.equal(got.project, slug, at);
        const { question, card } = composeCard(got.card);
        assert.ok(question.question.length <= CARD.chars, `${at}: ${question.question.length}`);
        assert.deepEqual(cardProblems(question.question), [], at);
        assert.equal(card.line, uninstallLine(slug, got.hash), at);
        reached.push([at, FULL.test(got.card.what) ? 'full' : STAYS.test(got.card.what) ? 'stays' : WHOLE.test(got.card.what) ? 'whole' : got.card.what]);
      }
    });
  }
  assert.deepEqual(reached, [['100, alone', 'full'], ['100, shared', 'full'], ['141, alone', 'full'], ['141, shared', 'full']]);
});

// Review 1 Minor 3: where the .wheelhouse/ line came first (an earlier step 7 added it before the
// settings line), the settings line is still put back, and the .wheelhouse/ line stays where it is.
test('the .wheelhouse/ line kept where it is when it came before setup\'s settings line (ruling R131)', async () => {
  await withHome(async () => {
    const world = makeWorld();
    world.register();
    world.lockedDir = tempFolder('wh-locked ');
    const run = startRun({ folder: world.folder, now: NOW });
    const r = recorder(run.id);
    const exclude = path.join(world.folder, '.git', 'info', 'exclude');
    const before = '# git ls-files --others --exclude-from=.git/info/exclude\n';
    writeText(exclude, before);
    const ownLine = r.file(7, exclude, `${before}${WHEELHOUSE_LINE}\n`, { line: WHEELHOUSE_LINE });
    const settingsLine = r.file(7, exclude, `${before}${WHEELHOUSE_LINE}\n${EXCLUDE_LINE}\n`, { line: EXCLUDE_LINE });
    fs.mkdirSync(path.join(world.folder, '.wheelhouse'));
    const got = await plan(world);
    assert.deepEqual(got.changes.filter((c) => c.put === 'reverse' && c.change.target === exclude).map((c) => c.ids), [[settingsLine.id]]);
    assert.equal(got.keep.some((k) => k.why === 'changed since setup'), false);
    const f = fakes(world);
    const done = await applyUninstall({ folder: world.folder, plan: got, now: READY, userHome: world.userHome, platform: 'darwin', run: f.run, ops: f.ops });
    assert.equal(done.ok, true, done.refused);
    assert.equal(readText(exclude), `${before}${WHEELHOUSE_LINE}\n`);
    assert.equal(markOf(settingsLine.id).put, true);
    assert.equal(markOf(ownLine.id).put, false);
  });
});

// ---- The other agent setup's instructions, put back from the archive (plan rulings P5, P6) ----
// The archive is on the default branch as the archive's own commit leaves it: each file moved under
// .wheelhouse-archive/ at its own path, with archived.json listing the moves and a README. The plan
// reads it from the folder's copy of the branch as last fetched; the apply reads it again from the
// host, and goes ahead only when the two agree.

const ARCHIVED = { 'AGENTS.md': '# Agents\nWrite small changes.\n', '.claude/agents/writer.md': '# Writer\nKeep it short.\n', '.cursorrules': 'Be brief.\n' };
const movesOf = (froms) => froms.map((from) => ({ from, to: `${ARCHIVE}/${from}` }));
// Where each move goes, without what it puts there (its mode and object).
const placesOf = (moves) => moves.map(({ from, to }) => ({ from, to }));
const manifestText = (moved) => `${JSON.stringify({ v: 1, moved }, null, 2)}\n`;
const gitHere = async () => ({ ok: true, path: 'git' });

// Writes the archive into a work folder and commits it, with `extra` files beside it.
async function commitArchive(work, { manifest = manifestText(movesOf(Object.keys(ARCHIVED))), files = ARCHIVED, extra = {} } = {}) {
  for (const [rel, text] of Object.entries(files)) writeText(path.join(work, ARCHIVE, ...rel.split('/')), text);
  if (manifest !== null) writeText(path.join(work, ARCHIVE, 'archived.json'), manifest);
  writeText(path.join(work, ARCHIVE, 'README.md'), '# Archive\nWhat another agent setup used here.\n');
  for (const [rel, text] of Object.entries(extra)) writeText(path.join(work, ...rel.split('/')), text);
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Archive the other agent setup\'s instructions');
}
// The archive merged on the stand-in's main.
async function archiveOnHost(host, options) {
  await commitArchive(host.work, options);
  await g(host.work, 'push', '-q', host.product.url, 'main');
}
// The folder's copy of main, fetched from `from` as the folder last saw it. Without
// --no-auto-maintenance, fetch leaves a detached `git maintenance run --auto` behind that holds
// .git/objects/maintenance.lock for a moment, so a snapshot of the folder straight after could
// catch the lock and the next one miss it.
async function fetchToFolder(world, from) {
  if (!fs.existsSync(path.join(world.folder, '.git', 'objects'))) await g(world.folder, 'init', '-q', '-b', 'main');
  await g(world.folder, 'fetch', '-q', '--no-auto-maintenance', from, '+refs/heads/main:refs/remotes/origin/main');
}
const planHere = (world, f) => uninstallPlan({ folder: world.folder, userHome: world.userHome, platform: 'darwin', run: f.run, findGit: gitHere });
const applyHere = async (world, f) => {
  const got = await planHere(world, f);
  const done = await applyUninstall({ folder: world.folder, plan: got, now: READY, userHome: world.userHome, platform: 'darwin', run: f.run, ops: f.ops });
  return { got, done };
};
const archiveOf = (got) => got.changes.find((c) => c.put === 'pull-request')?.archive;

test('uninstall\'s pull request puts the other agent setup\'s instructions back where they were and takes the archive folder out (ruling P6)', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world } = await applyWorld({ host });
      await archiveOnHost(host);
      await fetchToFolder(world, host.product.url);
      const f = fakes(world);
      const got = await planHere(world, f);
      // Each move names the plain file it puts back, by its mode and object, so the hash covers it.
      for (const m of archiveOf(got).moves) {
        assert.equal(m.mode, '100644');
        assert.equal(m.sha, await g(host.product.url, 'rev-parse', `main:${m.to}`));
      }
      assert.deepEqual({ ...archiveOf(got), moves: placesOf(archiveOf(got).moves) }, {
        moves: movesOf(['AGENTS.md', '.claude/agents/writer.md', '.cursorrules']), taken: [], missing: [],
        folder: ['.wheelhouse-archive/.claude/agents/writer.md', '.wheelhouse-archive/.cursorrules', '.wheelhouse-archive/AGENTS.md', '.wheelhouse-archive/README.md', '.wheelhouse-archive/archived.json'],
      });
      assert.match(got.card.what, /the other agent setup's instructions, back where they were/);
      assert.doesNotMatch(got.card.what, /\b(commit|branch|worktree)\b/i);
      const { question } = composeCard(got.card);
      assert.ok(question.question.length <= CARD.chars);
      assert.ok(planLines(got, world.folder, world.userHome).some((l) => /in it: the other agent setup's instructions, back where they were: AGENTS\.md/.test(l)));
      const { done } = await applyHere(world, f);
      assert.equal(done.ok, true, done.refused);
      // The moved files are back at their own paths, as main holds them; the archive folder is gone.
      assert.deepEqual(await filesOn(host.product.url, UNINSTALL_BRANCH), ['.claude/agents/writer.md', '.claude/settings.json', '.cursorrules', 'AGENTS.md', 'README.md']);
      for (const [rel, text] of Object.entries(ARCHIVED)) assert.equal(await showOn(host.product.url, UNINSTALL_BRANCH, rel), text, rel);
      assert.ok(done.lines.some((l) => /the other agent setup's instructions, back where they were/.test(l)));
      assert.match(f.seen.prs[0].body, /back where they were/);
      // The director's folder is not changed: its files are the pull request's to change.
      assert.equal(fs.existsSync(path.join(world.folder, 'AGENTS.md')), false);
    });
  } finally {
    host.cleanup();
  }
});

test('a moved file whose place is taken on the default branch stays in the archive, named on the card; one the archive no longer holds is left out', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world } = await applyWorld({ host });
      const moved = [...movesOf(Object.keys(ARCHIVED)), { from: '.windsurfrules', to: `${ARCHIVE}/.windsurfrules` }];
      // Since the archive, the project has a .cursorrules of its own again.
      await archiveOnHost(host, { manifest: manifestText(moved), extra: { '.cursorrules': 'A new rule.\n' } });
      await fetchToFolder(world, host.product.url);
      const f = fakes(world);
      const got = await planHere(world, f);
      assert.deepEqual(placesOf(archiveOf(got).moves), movesOf(['AGENTS.md', '.claude/agents/writer.md']));
      assert.deepEqual(archiveOf(got).taken, ['.cursorrules']);
      assert.deepEqual(archiveOf(got).missing, ['.windsurfrules']);
      assert.match(got.card.what, /Left in \.wheelhouse-archive\/, as its place is taken: \.cursorrules\./);
      const { done } = await applyHere(world, f);
      assert.equal(done.ok, true, done.refused);
      assert.deepEqual(await filesOn(host.product.url, UNINSTALL_BRANCH), [
        '.claude/agents/writer.md', '.claude/settings.json', '.cursorrules', '.wheelhouse-archive/.cursorrules', '.wheelhouse-archive/README.md', '.wheelhouse-archive/archived.json', 'AGENTS.md', 'README.md',
      ]);
      assert.equal(await showOn(host.product.url, UNINSTALL_BRANCH, '.cursorrules'), 'A new rule.\n');
      assert.equal(await showOn(host.product.url, UNINSTALL_BRANCH, `${ARCHIVE}/.cursorrules`), ARCHIVED['.cursorrules']);
      // The archive's list names only what stays in it, so putting it back later still works.
      assert.deepEqual(JSON.parse(await showOn(host.product.url, UNINSTALL_BRANCH, `${ARCHIVE}/archived.json`)), { v: 1, moved: movesOf(['.cursorrules']) });
      assert.ok(done.lines.some((l) => /\.cursorrules/.test(l) && /taken/.test(l)));
    });
  } finally {
    host.cleanup();
  }
});

test('an archive whose list can\'t be read, names a path outside the project or outside the archive, or names one twice, is refused: nothing is moved, and why is given', async () => {
  const work = tempFolder('wh-archive-work ');
  await g(work, 'init', '-q', '-b', 'main');
  writeText(path.join(work, 'README.md'), '# Project\n');
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'First');
  const git = (args) => realRun('git', args, { cwd: work });
  // No archive, and a ref that can't be read: nothing to put back.
  assert.equal(await archiveAt(git, 'HEAD'), null);
  assert.equal(await archiveAt(git, 'refs/remotes/origin/nowhere'), null);
  const one = (from, to = `${ARCHIVE}/${from}`) => manifestText([{ from, to }]);
  const cases = [
    ['not JSON', '{ v: 1', ARCHIVE_UNREAD],
    ['another version', `${JSON.stringify({ v: 2, moved: [] })}\n`, ARCHIVE_UNREAD],
    ['no list of moves', `${JSON.stringify({ v: 1 })}\n`, ARCHIVE_UNREAD],
    ['a move that is not a pair of paths', `${JSON.stringify({ v: 1, moved: [{ from: 'AGENTS.md' }] })}\n`, ARCHIVE_UNREAD],
    ['a parent folder', one('../outside.md', `${ARCHIVE}/outside.md`), ARCHIVE_OUTSIDE],
    ['a parent folder inside the path', one('docs/../../outside.md', `${ARCHIVE}/outside.md`), ARCHIVE_OUTSIDE],
    ['an absolute path', one('/etc/hosts', `${ARCHIVE}/hosts`), ARCHIVE_OUTSIDE],
    ['a Windows drive', one('C:/Users/x.md', `${ARCHIVE}/x.md`), ARCHIVE_OUTSIDE],
    ['backslashes', one('docs\\..\\..\\x.md', `${ARCHIVE}/x.md`), ARCHIVE_OUTSIDE],
    ['a dot folder', one('docs/./x.md', `${ARCHIVE}/x.md`), ARCHIVE_OUTSIDE],
    ['git\'s own folder, in another case', one('.GIT/config', `${ARCHIVE}/config`), ARCHIVE_OUTSIDE],
    ['git\'s own folder, with a dot Windows drops', one('docs/.git./hooks/x', `${ARCHIVE}/x`), ARCHIVE_OUTSIDE],
    ['git\'s own folder, by its short name', one('GIT~1/config', `${ARCHIVE}/config`), ARCHIVE_OUTSIDE],
    ['git\'s own folder, with a character macOS ignores', one('.g\u200cit/config', `${ARCHIVE}/config`), ARCHIVE_OUTSIDE],
    ['the archive folder itself, in another case', one('.Wheelhouse-Archive/x.md', `${ARCHIVE}/x.md`), ARCHIVE_OUTSIDE],
    ['a move from outside the archive', one('x.md', 'AGENTS.md'), ARCHIVE_OUTSIDE],
    ['a move from the archive\'s parent', one('x.md', `${ARCHIVE}/../AGENTS.md`), ARCHIVE_OUTSIDE],
    ['the archive\'s own list', one('x.md', `${ARCHIVE}/archived.json`), ARCHIVE_OUTSIDE],
    ['one place twice, in another case', manifestText([{ from: 'AGENTS.md', to: `${ARCHIVE}/AGENTS.md` }, { from: 'agents.md', to: `${ARCHIVE}/agents.md` }]), ARCHIVE_TWICE],
    ['one place inside another', manifestText([{ from: '.claude/skills/x', to: `${ARCHIVE}/.claude/skills/x` }, { from: '.claude/skills/X/y.md', to: `${ARCHIVE}/.claude/skills/X/y.md` }]), ARCHIVE_TWICE],
    ['a file that is not another setup\'s instructions', one('docs/notes.md'), ARCHIVE_OUTSIDE],
    ['a workflow, not instructions', one('.github/workflows/x.yml'), ARCHIVE_OUTSIDE],
    ['a move to another place in the archive', one('AGENTS.md', `${ARCHIVE}/other.md`), ARCHIVE_OUTSIDE],
    ['a move to the same name in another case', one('AGENTS.md', `${ARCHIVE}/agents.md`), ARCHIVE_OUTSIDE],
    ['a move to a folder deeper in the archive', one('AGENTS.md', `${ARCHIVE}/old/AGENTS.md`), ARCHIVE_OUTSIDE],
    ['no list at all', null, ARCHIVE_UNREAD],
  ];
  for (const [what, manifest, why] of cases) {
    await g(work, 'rm', '-r', '-q', '--ignore-unmatch', ARCHIVE);
    await commitArchive(work, { manifest, files: { 'AGENTS.md': ARCHIVED['AGENTS.md'] } });
    const got = await archiveAt(git, 'HEAD');
    assert.equal(got?.view.refused, why, what);
    assert.equal(got.view.moves, undefined, what);
    assert.ok(got.view.folder.includes(`${ARCHIVE}/AGENTS.md`), what);
  }
  // Another setup's instruction files match in any case, each moved to its own path in the archive.
  await g(work, 'rm', '-r', '-q', '--ignore-unmatch', ARCHIVE);
  const files = { '.Claude/Agents/checker.md': '# Checker\n', 'agents.md': '# agents\n', '.github/copilot-instructions.md': 'Be kind.\n' };
  await commitArchive(work, { manifest: manifestText(movesOf(Object.keys(files))), files });
  assert.deepEqual(placesOf((await archiveAt(git, 'HEAD')).view.moves), movesOf(Object.keys(files)));
  // A link, or another repository, where a moved file should be refuses the whole archive: only a
  // plain file is ever put back.
  for (const [what, mode, sha] of [['a link', '120000', await (async () => { writeText(path.join(work, 'target.txt'), '/etc/hosts'); return g(work, 'hash-object', '-w', 'target.txt'); })()], ['another repository', '160000', 'e'.repeat(40)]]) {
    await g(work, 'rm', '-r', '-q', '--ignore-unmatch', ARCHIVE);
    await commitArchive(work, { manifest: manifestText(movesOf(['AGENTS.md'])), files: {} });
    await g(work, 'update-index', '--add', '--cacheinfo', `${mode},${sha},${ARCHIVE}/AGENTS.md`);
    await g(work, 'commit', '-q', '-m', what);
    const got = await archiveAt(git, 'HEAD');
    assert.equal(got?.view.refused, ARCHIVE_OUTSIDE, what);
    assert.equal(got.view.moves, undefined, what);
  }
});

test('a moved file\'s text changed between card and click is a new card: the hash covers what is put back, not only where', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world } = await applyWorld({ host });
      await archiveOnHost(host);
      await fetchToFolder(world, host.product.url);
      const f = fakes(world);
      const first = await planHere(world, f);
      writeText(path.join(host.work, ARCHIVE, 'AGENTS.md'), '# Agents\nSomething else entirely.\n');
      await g(host.work, 'commit', '-q', '-am', 'Another AGENTS.md in the archive');
      await g(host.work, 'push', '-q', host.product.url, 'main');
      // Not fetched: the apply's own look at the host finds it isn't the card's.
      const stale = await applyUninstall({ folder: world.folder, plan: first, now: READY, userHome: world.userHome, platform: 'darwin', run: f.run, ops: f.ops });
      assert.equal(stale.ok, false);
      assert.match(stale.refused, /isn't as this folder last saw it/);
      assert.deepEqual(f.seen.stops, []);
      const second = await planHere(world, f);
      assert.notEqual(second.hash, first.hash);
      assert.deepEqual(placesOf(archiveOf(second).moves), placesOf(archiveOf(first).moves));
    });
  } finally {
    host.cleanup();
  }
});

test('a refused archive stays as it is in uninstall\'s pull request, and the card says why', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world } = await applyWorld({ host });
      await archiveOnHost(host, { manifest: manifestText([{ from: '../outside.md', to: `${ARCHIVE}/AGENTS.md` }]) });
      await fetchToFolder(world, host.product.url);
      const f = fakes(world);
      const got = await planHere(world, f);
      assert.equal(archiveOf(got).refused, ARCHIVE_OUTSIDE);
      assert.match(got.card.what, /\.wheelhouse-archive\/ stays as it is: /);
      assert.doesNotMatch(got.card.what, /back where they were/);
      const { done } = await applyHere(world, f);
      assert.equal(done.ok, true, done.refused);
      const files = await filesOn(host.product.url, UNINSTALL_BRANCH);
      assert.ok(files.includes(`${ARCHIVE}/archived.json`) && files.includes(`${ARCHIVE}/AGENTS.md`));
      assert.equal(files.some((p) => p === 'AGENTS.md' || p.startsWith('..')), false);
    });
  } finally {
    host.cleanup();
  }
});

test('the list\'s hash covers the moves: an archive changed between card and click is a new card, and one this folder hasn\'t seen yet stops uninstall before anything is done', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world } = await applyWorld({ host });
      await archiveOnHost(host);
      await fetchToFolder(world, host.product.url);
      const f = fakes(world);
      const first = await planHere(world, f);
      // A move taken out of the archive's list on main, and fetched: the hash is another.
      writeText(path.join(host.work, ARCHIVE, 'archived.json'), manifestText(movesOf(['AGENTS.md', '.claude/agents/writer.md'])));
      await g(host.work, 'commit', '-q', '-am', 'Keep .cursorrules archived');
      await g(host.work, 'push', '-q', host.product.url, 'main');
      await fetchToFolder(world, host.product.url);
      const second = await planHere(world, f);
      assert.notEqual(second.hash, first.hash);
      // Changed again on main, not fetched: the apply reads the host's, which isn't the card's.
      writeText(path.join(host.work, 'AGENTS.md'), '# The project\'s own now\n');
      await g(host.work, 'add', '-A');
      await g(host.work, 'commit', '-q', '-m', 'An AGENTS.md of the project\'s own');
      await g(host.work, 'push', '-q', host.product.url, 'main');
      const stale = await applyUninstall({ folder: world.folder, plan: second, now: READY, userHome: world.userHome, platform: 'darwin', run: f.run, ops: f.ops });
      assert.equal(stale.ok, false);
      assert.match(stale.refused, /isn't as this folder last saw it, so the list has changed since the card/);
      assert.deepEqual(f.seen.stops, [], 'nothing else was done');
      assert.equal(f.seen.password, 0);
      assert.equal(await filesOn(host.product.url, UNINSTALL_BRANCH), null);
      // The folder's copy of main is brought up to date, so the next plan is the host's.
      assert.equal(await g(world.folder, 'rev-parse', 'refs/remotes/origin/main'), await g(host.product.url, 'rev-parse', 'main'));
      const { got, done } = await applyHere(world, f);
      assert.notEqual(got.hash, second.hash);
      assert.deepEqual(archiveOf(got).taken, ['AGENTS.md']);
      assert.equal(done.ok, true, done.refused);
      assert.equal(await showOn(host.product.url, UNINSTALL_BRANCH, 'AGENTS.md'), '# The project\'s own now\n');
      assert.equal(await showOn(host.product.url, UNINSTALL_BRANCH, '.claude/agents/writer.md'), ARCHIVED['.claude/agents/writer.md']);
    });
  } finally {
    host.cleanup();
  }
});

test('an archive this folder has never fetched stops uninstall before anything is done, and the next plan lists it', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world } = await applyWorld({ host });
      await archiveOnHost(host);
      await g(world.folder, 'init', '-q', '-b', 'main');
      const f = fakes(world);
      const { got: first, done: stale } = await applyHere(world, f);
      assert.equal(archiveOf(first), undefined);
      assert.equal(stale.ok, false);
      assert.match(stale.refused, /isn't as this folder last saw it/);
      assert.deepEqual(f.seen.stops, []);
      const { got, done } = await applyHere(world, f);
      assert.equal(archiveOf(got).moves.length, 3);
      assert.equal(done.ok, true, done.refused);
      assert.ok((await filesOn(host.product.url, UNINSTALL_BRANCH)).includes('AGENTS.md'));
    });
  } finally {
    host.cleanup();
  }
});

test('a shared project leaves the archive as it is, and names it', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
    enrol({ computer: 'ffff0000', publicKey: 'AAAA', enrolledAt: '2026-10-19T01:00:00.000Z' });
    const work = tempFolder('wh-shared-work ');
    await g(work, 'init', '-q', '-b', 'main');
    await commitArchive(work);
    await fetchToFolder(world, work);
    const f = fakes(world);
    const before = snapshot(world);
    const got = await planHere(world, f);
    assert.equal(got.shared, true);
    assert.equal(got.changes.some((c) => c.put === 'pull-request'), false);
    assert.ok(got.keep.some((k) => /\.wheelhouse-archive\//.test(k.what) && /other computers/.test(k.why)));
    assert.deepEqual(snapshot(world), before, 'the plan changed nothing');
  });
});

test('uninstall removes the login start', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world, { through: 6 });
    const entry = loginEntry({ platform: 'darwin', node: '/usr/local/bin/node', root: '/opt/wheelhouse', script: 'scripts/agents/copilot/start-helper.js', home: world.userHome });
    await installLoginStart({ entry, run: async () => ({ code: 1, stdout: '', stderr: 'not run' }), now: NOW });
    const got = await plan(world);
    assert.deepEqual(of(got, 'computer').filter((c) => c.put === 'remove-login-start'), [{ phase: 'computer', put: 'remove-login-start', kind: 'launch-agent', target: entry.path }]);
    assert.equal(loginStartRecord().path, entry.path);
  });
});

// ---- The build engine (Archon design, section 14; part 3d) ----

// The engine's parts as setup leaves them on the Mac: step 2's engine folder (its Bun and Archon) and the broker's
// launcher, step 6's plugin at user scope, step 7's policy file and the project's fetch-mirror rule, and Archon's
// own run history, which setup never records.
function engineSetup(world, r) {
  r.folder(2, path.join(engineDir(), 'bun'), { tool: 'bun', version: '1.4.3' }, { before: null });
  writeText(path.join(engineDir(), 'bun', 'bin', 'bun'), 'program');
  r.folder(2, path.join(engineDir(), 'archon'), { tool: 'archon', version: 'v0.13.0' }, { before: null });
  r.add(2, { kind: 'file', target: brokerLauncher(), before: null, after: { tool: 'broker' } });
  writeText(brokerLauncher(), '#!/bin/sh\n');
  r.add(6, { kind: 'plugin-scope', target: installedPluginsFile(path.join(world.userHome, '.claude')), before: null, after: { plugin: 'wheelhouse@wheelhouse', scope: 'user' } });
  r.file(7, path.join(world.folder, ...POLICY_FILE.split('/')), '["o"]\n', { engine: true });
  r.key(7, mirrorRulesFile(), [SLUG], `https://github.com/${REPO}.git`);
  writeText(path.join(archonHome(), 'archon.db'), 'runs');
}
const ENGINE_FILE = (world) => path.join(world.folder, ...POLICY_FILE.split('/'));

test('uninstall cancels runs before removing the engine folder', async () => {
  await withHome(async () => {
    const world = makeWorld();
    const { r } = fullSetup(world);
    engineSetup(world, r);
    try {
      const got = await plan(world);
      assert.deepEqual(of(got, 'stop').map((c) => c.what), ['engine', 'foreman', 'watcher', 'receiver']);
      const engineAt = got.changes.findIndex((c) => c.put === 'remove' && c.target === engineDir());
      assert.ok(engineAt > got.changes.findIndex((c) => c.what === 'engine'), 'the engine folder goes after its runs are cancelled');
      assert.equal(got.changes[engineAt].phase, 'last');
      // The plugin at user scope is taken back on the computer's phase; the broker goes with the engine's folder.
      assert.deepEqual(got.changes.filter((c) => c.put === 'remove-plugin-scope').map((c) => c.phase), ['computer']);
      assert.equal(got.keep.some((k) => /gh$|broker|bun|archon$/.test(k.what)), false, 'nothing of the engine is named as kept');
      assert.deepEqual(accounted(got), recordedIds());
    } finally {
      fs.rmSync(archonHome(), { recursive: true, force: true });
    }
  });
});

test('a second project\'s uninstall leaves the engine but takes its own mirror rule back', async () => {
  await withHome(async () => {
    const world = makeWorld();
    const { r } = fullSetup(world);
    engineSetup(world, r);
    writeProject('o__Other', { folder: tempFolder('wh-other '), remoteUrl: 'https://github.com/o/Other.git', host: 'github', repo: 'o/Other', connection: { host: 'github', mode: 'narrow', project: 'o/Other' } });
    try {
      const got = await plan(world);
      assert.equal(got.last, false);
      assert.equal(got.changes.some((c) => c.what === 'engine' || c.target === engineDir() || c.put === 'remove-plugin-scope'), false);
      assert.ok(got.changes.some((c) => c.put === 'reverse' && c.change.target === mirrorRulesFile()));
      assert.equal(got.asks.some((a) => a.about === 'engine'), false);
    } finally {
      fs.rmSync(archonHome(), { recursive: true, force: true });
    }
  });
});

test('uninstall\'s run-history card is level 4 with Keep it recommended', async () => {
  await withHome(async () => {
    const world = makeWorld();
    const { r } = fullSetup(world);
    engineSetup(world, r);
    try {
      const got = await plan(world);
      const ask = got.asks.find((a) => a.about === 'engine');
      assert.ok(ask, 'a card for the run history');
      assert.equal(ask.put, 'delete-engine-history');
      assert.equal(ask.target, archonHome());
      assert.equal(ask.card.level, 4);
      assert.equal(ask.card.recommend, 'Keep it');
      assert.deepEqual(ask.card.options.map((o) => o.label), ['Keep it', 'Delete it']);
      assert.deepEqual(got.asks.map((a) => a.about), ['product', 'engine', 'record']);
      const { question } = composeCard(ask.card);
      assert.ok(question.question.length <= CARD.chars, `${question.question.length}`);
      assert.deepEqual(cardProblems(question.question), []);
    } finally {
      fs.rmSync(archonHome(), { recursive: true, force: true });
    }
  });
});

test('uninstall\'s pull request removes the project\'s .archon file, and the engine goes from this computer', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const made = await (async () => {
        const world = makeWorld();
        const { computer, publicKey } = makeSigningKey();
        enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
        world.lockedDir = tempFolder('wh-locked ');
        writeText(path.join(world.lockedDir, 'managed-settings.json'), '{}\n');
        world.before = readText(world.settings);
        const { run, r } = fullSetup(world, { lockedDir: world.lockedDir, trialSha: host.trial });
        engineSetup(world, r);
        writeProject(SLUG, { folder: world.folder, remoteUrl: host.product.url, host: 'github', repo: REPO, connection: { host: 'github', mode: 'narrow', project: REPO, installationId: 77 } });
        writeText(path.join(host.work, ...POLICY_FILE.split('/')), readText(ENGINE_FILE(world)));
        world.tip = await pushSetupCommit(world, host);
        return { world, run };
      })();
      const { world, run } = made;
      const f = fakes(world);
      const scopes = [];
      const engineStops = [];
      f.ops.stopEngine = async () => { engineStops.push(fs.existsSync(engineDir())); f.seen.stops.push('engine'); return { stopped: true }; };
      f.ops.removePluginScope = async (change) => { scopes.push(change.after); return { removed: true }; };
      try {
        const routes = uninstallRoutes({ now: READY, userHome: world.userHome, platform: 'darwin', run: f.run, ops: f.ops });
        const shown = await routes['/setup/uninstall/plan']({ folder: world.folder });
        answerAsk(run.id, shown.asks.find((a) => a.about === 'engine'), 'Delete it');
        const { done } = await applyPlan(world, f);
        assert.equal(done.ok, true, done.refused);
        assert.deepEqual(f.seen.stops, ['engine', 'foreman', 'watcher', 'receiver']);
        assert.deepEqual(engineStops, [true], 'runs cancelled while the engine is still there');
        assert.equal((await filesOn(host.product.url, UNINSTALL_BRANCH)).includes(POLICY_FILE), false);
        assert.ok((await filesOn(host.product.url, 'main')).includes(POLICY_FILE));
        assert.equal(fs.existsSync(engineDir()), false);
        assert.deepEqual(scopes, [{ plugin: 'wheelhouse@wheelhouse', scope: 'user' }]);
        assert.equal(fs.existsSync(archonHome()), false, 'deleted on its own card\'s Delete it');
        assert.ok(done.lines.includes('Archon\'s run history is deleted from this computer.'));
        assert.deepEqual(unmarked(), []);
      } finally {
        fs.rmSync(archonHome(), { recursive: true, force: true });
      }
    });
  } finally {
    host.cleanup();
  }
});

test('uninstall stops, and keeps the engine folder, when the engine\'s runs don\'t stop', async () => {
  const host = await standIn();
  try {
    await withHome(async () => {
      const { world, r } = await applyWorld({ host });
      engineSetup(world, r);
      const f = fakes(world);
      f.ops.stopEngine = async () => ({ stopped: false, why: '1 of its runs or processes are still going' });
      f.ops.removePluginScope = async () => ({ removed: true });
      try {
        const { done } = await applyPlan(world, f);
        assert.equal(done.ok, false);
        assert.match(done.refused, /still going/);
        assert.ok(fs.existsSync(engineDir()), 'the engine stays while its runs do');
        assert.deepEqual(f.seen.stops, [], 'nothing else was stopped or removed');
      } finally {
        fs.rmSync(archonHome(), { recursive: true, force: true });
      }
    });
  } finally {
    host.cleanup();
  }
});
