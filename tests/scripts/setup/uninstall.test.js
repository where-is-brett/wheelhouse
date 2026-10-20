// tests/scripts/setup/uninstall.test.js
// What uninstall would put back, worked out without changing anything (Task 15a, rulings R85 to
// R89): every change the folder's runs recorded, grouped and in the binding order, what is kept and
// why, and the level 4 cards for deleting what can't come back. The journals are made by hand here,
// each change written to a scratch home and folder as the step would make it, so what the plan reads
// of the world is real. Applying the plan is Task 15b's; where a test puts changes back, it does so
// through reverseChange, as 15b will.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { uninstallPlan, PHASES, WHAT_CHARS, PLUGIN_LINE } from '../../../scripts/setup/uninstall.js';
import {
  startRun, addChanges, applyJsonKey, markPutBack, markStep, newId, readJournal, reverseChange, journalFile, closeRun,
} from '../../../scripts/setup/journal.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { wheelhouseHome, profileDir, stateDir, keysDir } from '../../../scripts/lib/paths.js';
import { toolFolder } from '../../../scripts/lib/host-tools.js';
import { clicksDir } from '../../../scripts/lib/setup-clicks.js';
import { enrolledFile, signingKeyFile } from '../../../scripts/state/signing.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';
import { CARD } from '../../../scripts/lib/front-desk.js';
import { uninstallLine } from '../../../scripts/state/card-lines.js';
import { PROFILE_TARGET } from '../../../scripts/setup/own-app.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

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
function fullSetup(world, { through = 10 } = {}) {
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
  // Step 3: the product's repository made, the folder connected, the profile made and cloned, the
  // app's keys, the project registered, its state cloned, this computer's enrolment published.
  r.add(3, { kind: 'host', target: `github:${REPO}`, before: null, after: { repository: REPO, private: true, made: true } });
  r.folder(3, path.join(folder, '.git'), { origin: `https://github.com/${REPO}.git`, branch: 'main' });
  writeText(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  r.add(3, { kind: 'host', target: 'github:o/wheelhouse-profile', before: null, after: { repository: 'o/wheelhouse-profile', private: true, made: true } });
  const profile = { remoteUrl: 'https://github.com/o/wheelhouse-profile.git', host: 'github', repo: 'o/wheelhouse-profile', connection: { host: 'github', mode: 'quick', project: 'o/wheelhouse-profile' } };
  r.file(3, path.join(wheelhouseHome(), 'profile.json'), `${JSON.stringify(profile, null, 2)}\n`);
  r.folder(3, profileDir(), { clone: profile.remoteUrl, branch: 'wheelhouse-profile' }, { before: null });
  writeText(path.join(profileDir(), 'events', 'e1.json'), '{}');
  r.add(3, { kind: 'host', target: 'key github-app', before: null, after: { key: 'github-app', clientId: 'Iv1.x', app: 'wheelhouse' } });
  writeText(path.join(keysDir(), 'github-app.json'), '{}');
  r.add(3, { kind: 'file', target: path.join(stateDir(SLUG), '..', 'project.json'), before: null, after: 'x' });
  register();
  r.folder(3, stateDir(SLUG), { clone: `https://github.com/${REPO}.git`, branch: 'wheelhouse-state' });
  writeText(path.join(stateDir(SLUG), 'events.json'), '[]');
  r.add(3, { kind: 'host', target: 'github:o/wheelhouse-profile:enrolments/abcd1234.json', before: null, after: '{"computer":"abcd1234"}\n' });
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
  r.add(8, { kind: 'locked', target: '/Library/Application Support/ClaudeCode/managed-settings.json', before: { exists: false, ours: false, projects: [] }, after: { project: SLUG, folder } });
  done(8);
  r.add(9, { kind: 'answer', target: 'step 9', before: null, after: { pushArrived: true } });
  done(9);
  if (through < 10) return { run, r };
  // Step 10: the trial's branch and pull request, the pull request closed, its branch left.
  r.add(10, { kind: 'host', target: `${REPO} branch wheelhouse-health-check`, before: null, after: { branch: 'wheelhouse-health-check', sha: 'c'.repeat(40) } });
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
      'remove-enrolment:github:o/wheelhouse-profile:enrolments/abcd1234.json',
      '2:permissions.allow',
    ]);
    // Step 2's allow rule is in the folder's own settings, so it is the project's, not this computer's.
    assert.equal(computer.at(-1).change.target, path.join(world.folder, '.claude', 'settings.local.json'));
    // Keys: the app's keys deleted on the last project, its installation page given; the signing
    // key and the trusted-keys list beside it removed.
    const keys = of(got, 'keys');
    assert.equal(keys[0].put, 'delete-key');
    assert.equal(keys[0].key, 'github-app');
    assert.deepEqual(keys.filter((c) => c.put === 'remove').map((c) => c.target), [signingKeyFile(), enrolledFile()].filter((f) => fs.existsSync(f)));
    // Last: the project's own folder, Wheelhouse's own folders and files, the plugin's line.
    const last = of(got, 'last');
    assert.equal(last[0].target, path.join(wheelhouseHome(), 'projects', SLUG));
    const removed = last.filter((c) => c.put === 'remove').map((c) => c.target);
    for (const p of [toolFolder('gh'), profileDir(), path.join(wheelhouseHome(), 'profile.json')]) assert.ok(removed.includes(p), p);
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
    const local = readJson(path.join(world.folder, '.claude', 'settings.local.json'));
    assert.equal(local.statusLine, undefined);
    assert.equal(local.permissions.allow, undefined);
    assert.equal(fs.existsSync(path.join(world.folder, '.git', 'info', 'exclude')), false);
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
    assert.ok(of(got, 'computer').some((c) => c.put === 'remove-enrolment'));
    assert.ok(got.asks.some((a) => a.target === `github:${REPO}`));
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

test('the state branch and the profile are kept unless their own card says delete, recommended Keep', async () => {
  await withHome(async () => {
    const world = makeWorld();
    fullSetup(world);
    const got = await plan(world);
    assert.deepEqual(got.asks.map((a) => [a.about, a.put, a.target]), [
      ['product', 'delete-repository', `github:${REPO}`],
      ['state', 'delete-branch', `github:${REPO}:wheelhouse-state`],
      ['profile', 'delete-repository', 'github:o/wheelhouse-profile'],
    ]);
    assert.equal(new Set(got.asks.map((a) => a.id)).size, 3);
    for (const ask of got.asks) {
      assert.equal(ask.phase, 'kept');
      assert.equal(ask.card.level, 4);
      assert.equal(ask.card.recommend, 'Keep it');
      const { question } = composeCard(ask.card);
      assert.match(question.question, /Keep it/);
    }
    // Nothing on the host is deleted by the plan itself.
    assert.equal(got.changes.some((c) => /delete-repository/.test(c.put)), false);
    assert.equal(got.changes.some((c) => c.put === 'delete-branch' && c.branch === 'wheelhouse-state'), false);
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
    assert.equal(got.changes.some((c) => c.put === 'unset-env' || c.put === 'remove-enrolment'), false);
    assert.equal(got.changes.some((c) => c.target === signingKeyFile() || c.target === profileDir() || c.target === toolFolder('gh')), false);
    // The app stays for the other project: this repository is unticked on its installation's page.
    assert.equal(got.changes.some((c) => c.put === 'delete-key'), false);
    assert.deepEqual(of(got, 'keys').map((c) => [c.put, c.repo]), [['untick-repository', REPO]]);
    // The project's own are still listed, and the profile isn't asked about.
    assert.ok(got.changes.some((c) => c.put === 'leave-locked'));
    assert.equal(got.asks.some((a) => a.target.includes('wheelhouse-profile')), false);
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

test('the profile clone is Wheelhouse\'s own, removed whole on the last uninstall, whatever its before', async () => {
  for (const before of [null, {}]) {
    await withHome(async () => {
      const world = makeWorld();
      const run = startRun({ folder: world.folder, now: NOW });
      const r = recorder(run.id);
      r.folder(3, profileDir(), { clone: 'x', branch: 'wheelhouse-profile' }, { before });
      writeText(path.join(profileDir(), 'events', 'e.json'), '{}');
      fs.mkdirSync(clicksDir(), { recursive: true });
      const got = await plan(world);
      const entry = got.changes.find((c) => c.target === profileDir());
      assert.equal(entry.put, 'remove');
      assert.equal(entry.phase, 'last');
      assert.equal(entry.ids.length, 1);
      assert.equal(got.keep.some((k) => k.what.includes('profile')), false, JSON.stringify(before));
      assert.ok(got.changes.some((c) => c.put === 'remove' && c.target === clicksDir()));
      // journal.json itself is kept.
      assert.equal(got.changes.some((c) => c.target === journalFile() || c.target === path.dirname(journalFile())), false);
    });
  }
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
    fullSetup(world);
    const got = await plan(world);
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
    assert.match(many.card.what, /and \d+ more: cli\.js uninstall status/);
    assert.ok(many.card.what.length + many.card.target.project.length <= WHAT_CHARS, `${many.card.what.length}`);
    // Each card composes as uninstall's own kind (Task 15c), within the composer's limit, and passes
    // the card check; its set line names the project and the list's hash.
    for (const one of [got, many]) {
      const { question, card: data } = composeCard(one.card);
      assert.ok(question.question.length <= CARD.chars, `${question.question.length}`);
      assert.deepEqual(cardProblems(question.question), []);
      assert.equal(data.line, uninstallLine(SLUG, one.hash));
      assert.equal(data.code, null);
      assert.match(question.question, /if STOP is on, lift it first/, 'the card says to lift STOP first (ruling R91)');
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
    for (const slug of [null, `o__${'a'.repeat(37)}`]) {
      if (slug !== null) writeProject(slug, { folder, remoteUrl: `https://github.com/o/${'a'.repeat(37)}.git`, host: 'github', repo: `o/${'a'.repeat(37)}`, connection: { host: 'github', mode: 'narrow' } });
      const got = await uninstallPlan({ folder, userHome: world.userHome, platform: 'darwin', run: launchEnv({}) });
      const { question } = composeCard(got.card);
      assert.ok(question.question.length <= CARD.chars, `${slug}: ${question.question.length}`);
      assert.deepEqual(cardProblems(question.question), []);
      assert.match(got.card.what, /and \d+ more: cli\.js uninstall status/);
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
