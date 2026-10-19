// tests/scripts/setup/health.test.js
// Step 10, the health check (design section 15, rulings R41 and R44). The helper's part, a long
// Go-ahead step, tries the merge gate on a throwaway pull request, STOP with the real stop guard
// under a scratch home, the installed skills and the host's protection, then closes the pull
// request and deletes its branch; the session's trial lines are handed in through `cli.js health`;
// healthCheck joins them with the board's health lines; and only a green board starts the foreman
// and gives the first briefing. Step 7 isn't built yet, so the steps before 10 are marked done
// here, the host is a bare repository with a stand-in adapter, and nothing reaches a real host or
// the director's own home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  healthStep, healthCheck, mergeTrial, stopTrial, removeTrialLeftover, finishSetup, HELPER_CHECKS, SESSION_CHECKS, HEALTH_BRANCH,
} from '../../../scripts/setup/health.js';
import { STEPS } from '../../../scripts/setup/steps.js';
import { setupRoutes } from '../../../scripts/setup/engine.js';
import { startRun, markStep, addChanges, newId, readJournal } from '../../../scripts/setup/journal.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop, liftStop, stopState } from '../../../scripts/lib/stop.js';
import { TRIAL_MARKER } from '../../../scripts/health/trials.js';
import { STOPPED } from '../../../scripts/setup/host.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { setLineOf, setupLine } from '../../../scripts/state/card-lines.js';
import { makeBareRemote, g } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';
import { withProject, T0, REPO, SLUG } from '../../helpers/setup-answers.js';

// The session's seven trial lines, every one as expected.
const GREEN_LINES = Object.entries(SESSION_CHECKS).map(([name, c]) => `${name}: ${c.expected} / ${c.expected}`);
// The helper's checks, every one passed.
const GREEN_CHECKS = Object.entries(HELPER_CHECKS).map(([name, c]) => ({ name, expected: c.expected, result: c.expected, ok: true }));

// The run of this folder with steps 1 to `upTo` done, as if each had run; with `checks`, step 10's
// record of the helper's part, for pull request 12.
function runWith(folder, { upTo = 10, checks, failed } = {}) {
  const run = startRun({ folder, now: () => T0 });
  for (let n = 1; n <= upTo; n += 1) markStep(run.id, n, 'doneAt', { now: () => T0 });
  if (failed) {
    markStep(run.id, 10, 'clickedAt', { now: () => T0 });
    markStep(run.id, 10, 'failed', { now: () => T0, reason: failed });
  }
  if (checks) {
    addChanges(run.id, [{
      id: newId('chg'), step: 10, kind: 'answer', target: 'step 10', before: null, after: { health: { project: SLUG, pr: 12, branch: HEALTH_BRANCH, checks } },
    }]);
  }
  return readJournal().runs.find((r) => r.id === run.id);
}

// Board inputs as loadBoardInputs gives them, with these health lines.
const boardWith = (health) => async () => ({ project: SLUG, model: { project: SLUG, builtAt: T0.toISOString(), director: { health }, build: {}, missing: [] } });
const OK_BOARD = boardWith([{ level: 'ok', text: 'Protection: Standard' }]);

// ---- The step and its card ----

test('step 10 is filled by health.js: long, after Locked, the project\'s files and the phone', () => {
  const step = STEPS.find((s) => s.n === 10);
  assert.equal(step.title, 'Health check');
  assert.equal(step.long, true);
  assert.deepEqual(step.after, [7, 8, 9]);
});

test('step 10\'s plan waits for the project, then lists the trial branch and its pull request, the same each time', async () => {
  await withProject(async ({ folder }) => {
    const step = healthStep();
    const first = await step.plan({ folder });
    assert.deepEqual(first.changes.map((c) => c.kind), ['host']);
    assert.equal(first.changes[0].branch, HEALTH_BRANCH);
    assert.equal(first.changes[0].project, SLUG);
    assert.match(first.changes[0].target, new RegExp(REPO));
    assert.deepEqual((await step.plan({ folder })).changes, first.changes);
    assert.match(first.card.what, /^Setup step 10, Health check:/);
    assert.match(first.card.what, /without your approval/);
    assert.match(first.card.what, /STOP/);
    assert.match(first.card.what, /closes the pull request and deletes the branch/);
    assert.equal(typeof first.director, 'string');
  }, { connected: true });
  await withProject(async ({ folder }) => {
    const waiting = await healthStep().plan({ folder });
    assert.ok(waiting.wait > 0);
    assert.match(waiting.why, /step 3/);
  }, { connected: false });
});

test('through the helper, step 10\'s card waits for steps 7 to 9, then composes with its set line', async () => {
  await withProject(async ({ folder, plan }) => {
    const run = runWith(folder, { upTo: 6 });
    const early = await plan(10);
    assert.equal(early.ok, true, early.refused);
    assert.ok(early.wait > 0);
    for (const n of [7, 8, 9]) markStep(run.id, n, 'doneAt', { now: () => T0 });
    const got = await plan(10);
    assert.equal(got.ok, true, got.refused);
    assert.equal(setLineOf(got.card.question), setupLine(10, got.hash));
    assert.ok(composeCard({ ...(await healthStep().plan({ folder })).card, target: { step: 10, hash: got.hash } }));
  });
});

// ---- The helper's part ----

// A stand-in adapter over a bare repository: openPr checks the branch is there, prState says
// open until closePr closes it (or `merged` once the gate let it through).
function standIn(remote, { merged = () => false } = {}) {
  const calls = { open: [], close: [], state: [] };
  let closed = false;
  const adapter = {
    defaultBranch: async () => 'main',
    openPr: async (args) => {
      calls.open.push({ ...args, onRemote: lsRemote(remote, `refs/heads/${HEALTH_BRANCH}`) });
      return { number: 12, url: 'https://example.invalid/pull/12' };
    },
    prState: async (n) => { calls.state.push(n); return { state: merged() ? 'merged' : (closed ? 'closed' : 'open') }; },
    closePr: async (n) => { calls.close.push(n); closed = true; return { number: n }; },
  };
  return { adapter, calls };
}

// A product on a bare repository, its main branch holding one commit, registered as this folder's.
async function productOnRemote(folder) {
  const remote = await makeBareRemote({ repo: REPO });
  const work = tempFolder('wh-health-work-');
  await g(work, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, 'README.md'), 'The product.\n');
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Base');
  await g(work, 'push', '-q', remote.url, 'HEAD:refs/heads/main');
  writeProject(SLUG, { folder, remoteUrl: remote.url, host: 'github', repo: REPO, connection: {} });
  return { remote: remote.url, main: await g(work, 'rev-parse', 'HEAD'), tree: await g(work, 'rev-parse', 'HEAD^{tree}') };
}

const lsRemote = (remote, ref) => execFileSync('git', ['ls-remote', remote, ref], { encoding: 'utf8' }).trim();

// The step's ctx, keeping each change recorded, and whether the branch was on the remote then.
function ctxFor(folder, remote, { stopped = () => false } = {}) {
  const recorded = [];
  return {
    recorded,
    ctx: {
      folder, step: 10, runId: 'run-x', now: () => T0, platform: process.platform, answers: {}, stopped,
      record: (c) => { for (const one of [c].flat()) recorded.push({ ...one, onRemote: lsRemote(remote, `refs/heads/${HEALTH_BRANCH}`) }); },
    },
  };
}

const merges = (answer) => {
  const asked = [];
  return { asked, client: { merge: async (a) => { asked.push(a); return typeof answer === 'function' ? answer(a) : answer; } } };
};
const REFUSED = { ok: false, refused: 'the lock is held; CI has not passed', reasons: ['the lock is held', 'CI has not passed'] };

test('the helper\'s part: an empty commit on main\'s tip, the gate refuses it, STOP holds, then the pull request is closed and the branch deleted', async () => {
  await withProject(async ({ folder }) => {
    const { remote, main, tree } = await productOnRemote(folder);
    const { adapter, calls } = standIn(remote);
    const { asked, client } = merges(REFUSED);
    const step = healthStep({ adapterFor: () => adapter, client, findGit: async () => ({ ok: true, path: 'git' }), checkPins: () => 'match', readProtection: async () => 'on' });
    const { changes } = await step.plan({ folder });
    const { ctx, recorded } = ctxFor(folder, remote);
    assert.deepEqual(await step.apply(ctx, changes), []);

    // One empty commit on main's tip, pushed before the pull request was opened.
    const pushed = recorded[0].after.sha;
    assert.equal(recorded[0].kind, 'host');
    assert.equal(recorded[0].before, null);
    assert.equal(recorded[0].onRemote, '', 'recorded before it was pushed');
    assert.match(calls.open[0].onRemote, new RegExp(`^${pushed}`));
    assert.equal(calls.open[0].head, HEALTH_BRANCH);
    assert.equal(calls.open[0].base, 'main');
    const body = execFileSync('git', ['--git-dir', remote, 'cat-file', '-p', pushed], { encoding: 'utf8' });
    assert.match(body, new RegExp(`^tree ${tree}\nparent ${main}\n`));
    // The gate asked with no approval, as the foreman would.
    assert.deepEqual(asked, [{ project: SLUG, number: 12, stop: false, bypass: false, approvalRequired: true }]);
    // Closed and deleted, each recorded before it was made.
    assert.deepEqual(calls.close, [12]);
    assert.equal(lsRemote(remote, `refs/heads/${HEALTH_BRANCH}`), '');
    assert.equal(lsRemote(remote, 'refs/heads/main').split('\t')[0], main, 'main is as it was');
    const hosts = recorded.filter((c) => c.kind === 'host');
    assert.deepEqual(hosts.map((c) => [c.target, c.before === null ? null : Object.keys(c.before)[0], c.after === null ? null : Object.keys(c.after)[0]]), [
      [`${REPO} branch ${HEALTH_BRANCH}`, null, 'branch'],
      [`${REPO} pull request 12`, null, 'number'],
      [`${REPO} pull request 12`, 'state', 'state'],
      [`${REPO} branch ${HEALTH_BRANCH}`, 'branch', null],
    ]);
    assert.ok(hosts[3].onRemote.startsWith(pushed), 'the deletion recorded while the branch was still there');
    // Every result recorded, all passed, the real stop guard among them.
    const answer = recorded.at(-1);
    assert.equal(answer.kind, 'answer');
    assert.equal(answer.after.health.pr, 12);
    assert.deepEqual(answer.after.health.checks.map((c) => [c.name, c.result, c.ok]), [
      ['merge without approval', 'refused', true],
      ['write under stop', 'refused', true],
      ['read under stop', 'allowed', true],
      ['installed skills', 'match', true],
      ['host protection', 'on', true],
      ['trial cleaned up', 'closed', true],
    ]);
    // The director's own folder was never a git repository's working copy for it.
    assert.deepEqual(fs.readdirSync(path.join(folder, '.git')), []);
    assert.equal(stopState().on, false, 'STOP was tried under a scratch home, never this one');
  });
});

test('a merge the gate lets through fails the step, named, and the trial is still cleaned up', async () => {
  await withProject(async ({ folder }) => {
    const { remote } = await productOnRemote(folder);
    let through = false;
    const { adapter, calls } = standIn(remote, { merged: () => through });
    const { client } = merges(() => { through = true; return { ok: true, merged: true }; });
    const step = healthStep({ adapterFor: () => adapter, client, findGit: async () => ({ ok: true, path: 'git' }), trySTOP: async () => ({ write: 'refused', read: 'allowed' }), checkPins: () => 'match', readProtection: async () => 'on' });
    const { ctx, recorded } = ctxFor(folder, remote);
    await assert.rejects(step.apply(ctx, (await step.plan({ folder })).changes), /merge without approval/);
    const checks = recorded.at(-1).after.health.checks;
    assert.deepEqual(checks.find((c) => c.name === 'merge without approval'), { name: 'merge without approval', expected: 'refused', result: 'MERGED (unexpected)', ok: false });
    assert.deepEqual(calls.close, [12]);
    assert.equal(lsRemote(remote, `refs/heads/${HEALTH_BRANCH}`), '');
  });
});

test('STOP coming on stops step 10 before anything is pushed', async () => {
  await withProject(async ({ folder }) => {
    const { remote } = await productOnRemote(folder);
    const { adapter, calls } = standIn(remote);
    const { asked, client } = merges(REFUSED);
    const step = healthStep({ adapterFor: () => adapter, client, findGit: async () => ({ ok: true, path: 'git' }) });
    const { ctx, recorded } = ctxFor(folder, remote, { stopped: () => true });
    await assert.rejects(step.apply(ctx, (await step.plan({ folder })).changes), (e) => e.message === STOPPED);
    assert.equal(asked.length, 0);
    assert.equal(calls.open.length, 0);
    assert.equal(recorded.length, 0);
  });
});

// Check 31's first change: any refusal that leaves the pull request unmerged counts.
test('the merge trial passes on any refusal that leaves the pull request unmerged', async () => {
  const adapter = (state) => ({ prState: async () => ({ state }) });
  const trial = (answer, state = 'open') => mergeTrial({ client: { merge: async () => answer }, adapter: adapter(state), project: SLUG, number: 12 });
  for (const refused of ['the lock is held', 'CI has not passed', 'no review yet', 'the director\'s approval is missing', 'STOP is on']) {
    assert.equal(await trial({ ok: false, refused, reasons: [refused] }), 'refused', refused);
  }
  assert.equal(await trial({ ok: false, refused: 'the lock is held' }, 'merged'), 'MERGED (unexpected)', 'the host says merged');
  assert.equal(await trial({ ok: true, merged: true }, 'merged'), 'MERGED (unexpected)');
  assert.equal(await trial({ ok: true, merged: false }), 'allowed');
  assert.equal(await trial({ ok: false, refused: 'the host helper could not be reached: is it running?' }), 'could not run');
  assert.equal(await trial({ ok: false, refused: 'the lock is held' }, 'unknown'), 'could not run', 'unmerged must be read back');
  assert.equal(await mergeTrial({ client: { merge: async () => { throw new Error('x'); } }, adapter: adapter('open'), project: SLUG, number: 12 }), 'could not run');
});

test('STOP is tried with the real stop guard under a scratch home: a write refused, a read allowed', async () => {
  assert.deepEqual(await stopTrial(), { write: 'refused', read: 'allowed' });
  // A guard that lets everything through, or denies everything for another reason, doesn't pass.
  const dir = tempFolder('wh-guards-');
  const open = path.join(dir, 'open.js');
  fs.writeFileSync(open, '// open.js\nprocess.stdin.resume();\nprocess.stdin.on(\'end\', () => {});\n');
  assert.deepEqual(await stopTrial({ script: open }), { write: 'allowed', read: 'allowed' });
  const shut = path.join(dir, 'shut.js');
  fs.writeFileSync(shut, `// shut.js\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Wheelhouse\'s check could not run' } }))});\n`);
  assert.deepEqual(await stopTrial({ script: shut }), { write: 'could not run', read: 'could not run' });
});

// ---- Joining the two parts ----

test('a green run gives a green board', async () => {
  await withProject(async ({ folder }) => {
    const run = runWith(folder, { checks: GREEN_CHECKS });
    const got = await healthCheck({ folder, run, reported: GREEN_LINES, load: OK_BOARD });
    assert.equal(got.green, true, got.lines.join('\n'));
    assert.deepEqual(got.trials, { pr: 12, project: SLUG });
    const helper = got.lines.filter((l) => l.startsWith('Passed:') && !l.endsWith('(reported by the session)'));
    const session = got.lines.filter((l) => l.endsWith('(reported by the session)'));
    assert.equal(helper.length, Object.keys(HELPER_CHECKS).length);
    assert.equal(session.length, Object.keys(SESSION_CHECKS).length);
    assert.ok(session.every((l) => l.startsWith('Passed:')));
    assert.ok(got.lines.includes('Board: Protection: Standard'));
    assert.match(got.board, /Wheelhouse's board/);
    // A watch line on the board is shown but holds nothing.
    const watched = await healthCheck({ folder, run, reported: GREEN_LINES, load: boardWith([{ level: 'watch', text: 'Your profile isn\'t backed up off this computer yet' }]) });
    assert.equal(watched.green, true);
  });
});

test('a failed trial is named with what to do', async () => {
  await withProject(async ({ folder }) => {
    const checks = GREEN_CHECKS.map((c) => (c.name === 'write under stop' ? { ...c, result: 'allowed', ok: false } : c));
    const run = runWith(folder, { checks });
    const reported = GREEN_LINES.map((l) => (l.startsWith('read .env.local') ? 'read .env.local: refused / allowed' : l))
      .map((l) => (l.startsWith('helper health') ? 'helper health: reached / could not run' : l));
    const got = await healthCheck({ folder, run, reported, load: OK_BOARD });
    assert.equal(got.green, false);
    assert.ok(got.lines.includes('Failed: With STOP on, an agent\'s change was not refused (refused was expected, allowed came back). Reload this project in Claude Desktop so Wheelhouse\'s checks run in it, then run step 10 again.'), got.lines.join('\n'));
    assert.ok(got.lines.includes('Failed: An agent could read a .env.local file (refused was expected, allowed came back). The sandbox isn\'t on in this session: reload this project in Claude Desktop, then run step 10 again. (reported by the session)'), got.lines.join('\n'));
    assert.ok(got.lines.some((l) => /^Failed: setup couldn't try reaching the helper\. Run step 10's trials again in this session.*\(reported by the session\)$/.test(l)), got.lines.join('\n'));
    // Never hidden: every check has its line.
    assert.equal(got.lines.filter((l) => /^(Passed|Failed|Watch):/.test(l)).length, Object.keys(HELPER_CHECKS).length + Object.keys(SESSION_CHECKS).length);
  });
});

test('trials not handed in, lines that aren\'t trials\', a step 10 that failed and a STOP board line each hold the board', async () => {
  await withProject(async ({ folder }) => {
    const run = runWith(folder, { checks: GREEN_CHECKS });
    const short = await healthCheck({ folder, run, reported: [...GREEN_LINES.slice(1), 'read .env.local refused', 'surprise: refused / refused'], load: OK_BOARD });
    assert.equal(short.green, false);
    assert.ok(short.lines.some((l) => l.startsWith('Not reported by the session: reading .env.local.')), short.lines.join('\n'));
    assert.ok(short.lines.includes('Left out: 2 lines the session handed in that aren\'t trials\'.'), short.lines.join('\n'));
    const stopped = await healthCheck({ folder, run, reported: GREEN_LINES, load: boardWith([{ level: 'stop', text: 'STOP is on' }]) });
    assert.equal(stopped.green, false);
    assert.ok(stopped.lines.includes('Board: STOP is on'));
  });
  await withProject(async ({ folder }) => {
    const run = runWith(folder, { upTo: 9, checks: GREEN_CHECKS.slice(0, 1), failed: 'git push failed for the trial branch' });
    const got = await healthCheck({ folder, run, reported: GREEN_LINES, load: OK_BOARD });
    assert.equal(got.green, false);
    assert.match(got.lines[0], /^Failed: step 10 did not finish: git push failed for the trial branch\. Run step 10 again/);
    assert.ok(got.lines.some((l) => l.startsWith('Failed: setup couldn\'t try STOP before step 10 stopped.')), got.lines.join('\n'));
  });
  await withProject(async ({ folder }) => {
    const got = await healthCheck({ folder, run: runWith(folder, { upTo: 9 }), reported: GREEN_LINES, load: OK_BOARD });
    assert.equal(got.green, false);
    assert.equal(got.trials, null);
    assert.match(got.lines[0], /^Not yet: step 10's checks haven't run/);
  });
});

test('a trial pull request left open is a watch line, not a failure', async () => {
  await withProject(async ({ folder }) => {
    const checks = GREEN_CHECKS.map((c) => (c.name === 'trial cleaned up' ? { ...c, result: 'left open', ok: false } : c));
    const got = await healthCheck({ folder, run: runWith(folder, { checks }), reported: GREEN_LINES, load: OK_BOARD });
    assert.equal(got.green, true);
    assert.ok(got.lines.some((l) => /^Watch: The trial pull request, or its branch, was left on the host .*Close the pull request/.test(l)), got.lines.join('\n'));
  });
});

test('with the real board, STOP on the computer holds it', async () => {
  await withProject(async ({ folder }) => {
    const run = runWith(folder, { checks: GREEN_CHECKS });
    const client = { health: async () => ({ ok: true }), lock: { read: async () => ({ ok: true, result: null }) }, host: { facts: async () => ({ ok: true, protection: 'on', ci: 'present' }) } };
    setStop({ by: 'prompt' });
    try {
      const got = await healthCheck({ folder, run, reported: GREEN_LINES, client, now: () => T0 });
      assert.equal(got.green, false);
      assert.ok(got.lines.some((l) => l.startsWith('Board: STOP is on')), got.lines.join('\n'));
      assert.match(got.board, /STOP is on/);
    } finally {
      liftStop();
    }
  });
});

// ---- The helper's /setup/health route, and the end of setup (ruling R44) ----

function routesFor(user, { stopped = () => false, load = OK_BOARD, finished = [] } = {}) {
  return setupRoutes({
    now: () => T0, userHome: user, stopped,
    health: (args) => healthCheck({ ...args, load }),
    finish: async (args) => { finished.push(args); return { started: 'The foreman\'s watcher is started.', briefing: 'The briefing.' }; },
  });
}

test('only a green board, and never under STOP, starts the foreman and gives the first briefing', async () => {
  await withProject(async ({ folder, user }) => {
    runWith(folder, { checks: GREEN_CHECKS });
    const finished = [];
    const green = await routesFor(user, { finished })['/setup/health']({ folder, lines: GREEN_LINES });
    assert.equal(green.ok, true, green.refused);
    assert.equal(green.green, true);
    assert.deepEqual(finished, [{ project: SLUG }]);
    assert.equal(green.started, 'The foreman\'s watcher is started.');
    assert.equal(green.briefing, 'The briefing.');
    assert.deepEqual(green.trials, { pr: 12, project: SLUG });

    const red = await routesFor(user, { finished })['/setup/health']({ folder, lines: GREEN_LINES.slice(1) });
    assert.equal(red.green, false);
    assert.equal(red.started, undefined);
    assert.equal(finished.length, 1);
    const asked = await routesFor(user, { finished })['/setup/health']({ folder });
    assert.equal(asked.green, false, 'no lines yet: the session runs its trials first');
    assert.deepEqual(asked.trials, { pr: 12, project: SLUG });
    const underStop = await routesFor(user, { finished, stopped: () => true })['/setup/health']({ folder, lines: GREEN_LINES });
    assert.equal(underStop.ok, true, 'a reading form, answered under STOP');
    assert.equal(underStop.started, undefined);
    assert.equal(finished.length, 1);
  });
});

test('the health route takes only trial lines, and removes only a trial\'s own leftover .env.local', async () => {
  await withProject(async ({ folder, user }) => {
    runWith(folder, { checks: GREEN_CHECKS });
    const route = routesFor(user)['/setup/health'];
    await assert.rejects(route({ folder, lines: ['read .env.local: refused / refused; rm -rf x'] }), /trial/);
    await assert.rejects(route({ folder, lines: 'read .env.local: refused / refused' }), /trial/);
    await assert.rejects(route({ folder, lines: GREEN_LINES, changes: [] }), /folder/);
    await assert.rejects(route({ folder, lines: Array.from({ length: 13 }, () => GREEN_LINES[0]) }), /trial/);

    const env = path.join(folder, '.env.local');
    fs.writeFileSync(env, TRIAL_MARKER);
    await routesFor(user, { stopped: () => true })['/setup/health']({ folder, lines: GREEN_LINES });
    assert.equal(fs.readFileSync(env, 'utf8'), TRIAL_MARKER, 'nothing removed under STOP');
    await route({ folder, lines: GREEN_LINES });
    assert.equal(fs.existsSync(env), false);
    fs.writeFileSync(env, `${TRIAL_MARKER}SECRET=1\n`);
    await route({ folder, lines: GREEN_LINES });
    assert.equal(fs.readFileSync(env, 'utf8'), `${TRIAL_MARKER}SECRET=1\n`, 'the director\'s own is never touched');
    assert.equal(removeTrialLeftover(path.join(folder, 'missing')), false);
  });
});

test('finishSetup starts the foreman and gives the briefing, and says plainly when it can\'t', async () => {
  const done = await finishSetup({ project: SLUG, start: async () => 'started', brief: async () => 'The first briefing.' });
  assert.deepEqual(done, { started: 'started', briefing: 'The first briefing.' });
  const failed = await finishSetup({ project: SLUG, start: async () => { throw new Error('no'); }, brief: async () => { throw new Error('no'); } });
  assert.match(failed.started, /next session start/);
  assert.equal(failed.briefing, null);
});

// The smallest configuration readConfig takes.
const CONFIG = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };

test('finishSetup starts Shape 1\'s watcher by start.js\'s own start, and gives a first briefing', async () => {
  await withProject(async ({ folder }) => {
    runWith(folder, { checks: GREEN_CHECKS });
    const spawned = [];
    const spawn = (file, args, options) => { spawned.push({ file, args, options }); return { on: () => {}, unref: () => {} }; };
    const client = {
      config: async () => ({ ok: true, config: CONFIG }),
      health: async () => ({ ok: true }), lock: { read: async () => ({ ok: true, result: null }) }, host: { facts: async () => ({ ok: true, protection: 'on', ci: 'present' }) },
    };
    const done = await finishSetup({ project: SLUG, client, spawn, now: () => T0 });
    assert.equal(spawned.length, 1);
    assert.ok(spawned[0].args[0].endsWith(path.join('scripts', 'watcher', 'main.js')));
    assert.deepEqual(spawned[0].args.slice(1), [SLUG]);
    assert.match(done.started, /watcher is started/);
    assert.equal(typeof done.briefing, 'string');
    assert.ok(done.briefing.length > 0);
    const shape2 = await finishSetup({ project: SLUG, client: { ...client, config: async () => ({ ok: true, config: { ...CONFIG, watcherShape: 2 } }) }, spawn, now: () => T0 });
    assert.equal(spawned.length, 1, 'Shape 2\'s foreman is a terminal session the helper can\'t open');
    assert.match(shape2.started, /terminal/);
  });
});
