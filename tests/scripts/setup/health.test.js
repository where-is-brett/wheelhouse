// tests/scripts/setup/health.test.js
// Step 10, the health check (design section 15, rulings R41, R44, R67 and R68). The helper's part,
// a long Go-ahead step, tries the merge gate on a throwaway pull request, STOP with the real stop
// guard under a scratch home, the installed skills and the host's protection, and leaves the pull
// request open for the session's trials; the session's trial lines are handed in through
// `cli.js health`, which then closes the pull request and deletes its branch; healthCheck joins
// them with the board's health lines; and only a green board marks setup finished, once, starting
// the foreman and giving the first briefing. Step 7 isn't built yet, so the steps before 10 are marked done
// here, the host is a bare repository with a stand-in adapter, and nothing reaches a real host or
// the director's own home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  healthStep, healthCheck, mergeTrial, stopTrial, removeTrialLeftover, finishSetup, closeOpenTrial, openTrial,
  HELPER_CHECKS, SESSION_CHECKS, HEALTH_BRANCH,
} from '../../../scripts/setup/health.js';
import { healthGreen, firstUnfinished } from '../../../scripts/lib/setup-run.js';
import { STEPS } from '../../../scripts/setup/steps.js';
import { setupRoutes } from '../../../scripts/setup/engine.js';
import { startRun, markStep, addChanges, newId, readJournal } from '../../../scripts/setup/journal.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop, liftStop, stopState } from '../../../scripts/lib/stop.js';
import { TRIAL_MARKER } from '../../../scripts/health/trials.js';
import { STOPPED } from '../../../scripts/setup/host.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { readSurveyAt, readSeen } from '../../../scripts/briefing/seen.js';
import { LOCKED_WOULD_LINE } from '../../../scripts/lib/platform-lines.js';
import { setLineOf, setupLine } from '../../../scripts/state/card-lines.js';
import { makeBareRemote, g } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';
import { stateDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { caFile, gitCaConfig } from '../../../scripts/host/company-ca.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { withProject, lay, transcript, typed, T0, REPO, SLUG } from '../../helpers/setup-answers.js';

// The session's seven trial lines, every one as expected.
const GREEN_LINES = Object.entries(SESSION_CHECKS).map(([name, c]) => `${name}: ${c.expected} / ${c.expected}`);
// The helper's checks, every one passed.
const GREEN_CHECKS = Object.entries(HELPER_CHECKS).map(([name, c]) => ({ name, expected: c.expected, result: c.expected, ok: true }));

const TRIAL_SHA = 'a'.repeat(40);

// The run of this folder with steps 1 to `upTo` done, as if each had run, but for those in `skip`;
// with `checks`, step 10's record of the helper's part, for pull request 12, left open for the
// session's trials unless `open` is false.
function runWith(folder, { upTo = 10, checks, failed, open = true, skip = [] } = {}) {
  const run = startRun({ folder, now: () => T0 });
  for (let n = 1; n <= upTo; n += 1) if (!skip.includes(n)) markStep(run.id, n, 'doneAt', { now: () => T0 });
  if (failed) {
    markStep(run.id, 10, 'clickedAt', { now: () => T0 });
    markStep(run.id, 10, 'failed', { now: () => T0, reason: failed });
  }
  if (checks) {
    addChanges(run.id, [{
      id: newId('chg'), step: 10, kind: 'answer', target: 'step 10', before: null,
      after: { health: { project: SLUG, pr: 12, branch: HEALTH_BRANCH, sha: TRIAL_SHA, checks, open } },
    }]);
  }
  return readJournal().runs.find((r) => r.id === run.id);
}

// Board inputs as loadBoardInputs gives them, with these health lines.
const boardWith = (health) => async () => ({ project: SLUG, model: { project: SLUG, builtAt: T0.toISOString(), director: { health }, build: {}, missing: [] } });
const OK_BOARD = boardWith([{ level: 'ok', text: 'Protection: Standard' }]);

// ---- The step and its card ----

test('step 10 is filled by health.js: long, after Locked and the project\'s files; the phone comes after it', () => {
  const step = STEPS.find((s) => s.n === 10);
  assert.equal(step.title, 'Health check');
  assert.equal(step.long, true);
  assert.deepEqual(step.after, [7, 8]);
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
    assert.match(first.card.what, /session/);
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
// open until closePr closes it (or `merged` once the gate let it through). `closeFails` makes
// closePr throw.
function standIn(remote, { merged = () => false, closeFails = false, onOpen = () => {} } = {}) {
  const calls = { open: [], close: [], state: [] };
  let closed = false;
  let next = 12;
  const adapter = {
    defaultBranch: async () => 'main',
    openPr: async (args) => {
      onOpen();
      calls.open.push({ ...args, onRemote: lsRemote(remote, `refs/heads/${HEALTH_BRANCH}`) });
      closed = false;
      const number = next;
      next += 1;
      return { number, url: `https://example.invalid/pull/${number}` };
    },
    prState: async (n) => { calls.state.push(n); return { state: merged() ? 'merged' : (closed ? 'closed' : 'open') }; },
    closePr: async (n) => {
      calls.close.push(n);
      if (closeFails) throw new Error('gh pr close failed');
      closed = true;
      return { number: n };
    },
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
const GIT = async () => ({ ok: true, path: 'git' });

// The step's ctx on a real run of the folder (steps 1 to 9 done), keeping each change recorded in
// the journal as the engine does, with whether the branch was on the remote then.
function ctxFor(folder, remote, { stopped = () => false } = {}) {
  const setupRun = runWith(folder, { upTo: 9 });
  const recorded = [];
  return {
    recorded,
    setupRun,
    ctx: {
      folder, step: 10, runId: setupRun.id, now: () => T0, platform: process.platform, answers: {}, stopped,
      record: (c) => {
        const list = [c].flat().map((one) => ({ ...one, step: 10 }));
        addChanges(setupRun.id, list);
        for (const one of list) recorded.push({ ...one, onRemote: lsRemote(remote, `refs/heads/${HEALTH_BRANCH}`) });
      },
    },
  };
}

const merges = (answer) => {
  const asked = [];
  return { asked, client: { merge: async (a) => { asked.push(a); return typeof answer === 'function' ? answer(a) : answer; } } };
};
const REFUSED = { ok: false, refused: 'the lock is held; CI has not passed', reasons: ['the lock is held', 'CI has not passed'] };
const stepWith = (adapter, client, extra = {}) => healthStep({
  adapterFor: () => adapter, client, findGit: GIT, trySTOP: async () => ({ write: 'refused', read: 'allowed' }), checkPins: () => 'match', readProtection: async () => 'on', ...extra,
});
const cleanups = (recorded) => recorded.filter((c) => c.kind === 'answer' && c.after?.cleanup).map((c) => c.after.cleanup);

test('step 10 reads the host\'s protection knowing whether the project has real users', async () => {
  for (const launched of [false, true]) {
    await withProject(async ({ folder }) => {
      if (launched) {
        const file = path.join(stateDir(SLUG), 'events', '2026', 'phase.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ v: 1, id: '0f1e2d3c-0000-4000-8000-000000000009', at: '2026-10-19T00:00:00.000Z', computer: 'c-first', kind: 'setting', data: { key: 'phase', value: 'launched' } }));
      }
      const { remote } = await productOnRemote(folder);
      const { adapter } = standIn(remote);
      const { client } = merges(REFUSED);
      const seen = [];
      const step = stepWith(adapter, client, { readProtection: async (asked) => { seen.push(asked); return 'on'; } });
      const { changes } = await step.plan({ folder });
      const { ctx } = ctxFor(folder, remote);
      await step.apply(ctx, changes);
      assert.deepEqual(seen, [{ host: 'github', repo: REPO, realUsers: launched }]);
    });
  }
});

test('step 10 on a company GitLab uses the company address for the adapter, git\'s certificate pair and the protection read', async () => {
  const COMPANY = 'https://git.example.org:8443';
  await withProject(async ({ folder }) => {
    const { remote } = await productOnRemote(folder);
    writeProject(SLUG, { folder, remoteUrl: remote, host: 'gitlab', repo: REPO, connection: { baseUrl: COMPANY } });
    const file = caFile(wheelhouseHome());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'CERTIFICATES\n');
    const { adapter } = standIn(remote);
    const bases = [];
    const glab = [];
    const gitEnvs = [];
    const run = async (command, args = [], options = {}) => {
      const name = path.basename(command);
      if (name === 'git') { gitEnvs.push(options.env ?? {}); return realRun(command, args, options); }
      if (name === 'glab') {
        glab.push({ args: [...args], env: options.env });
        return { code: 0, stdout: 'Token found: glpat-made-up-0001\n', stderr: '' };
      }
      return { code: 1, stdout: '', stderr: 'not run in this test' };
    };
    const asked = [];
    const fetched = globalThis.fetch;
    globalThis.fetch = async (url) => { asked.push(String(url)); return new Response('{}', { status: 404 }); };
    try {
      const step = healthStep({
        run, adapterFor: ({ base }) => { bases.push(base); return adapter; }, client: merges(REFUSED).client, findGit: GIT,
        trySTOP: async () => ({ write: 'refused', read: 'allowed' }), checkPins: () => 'match',
      });
      const { changes } = await step.plan({ folder });
      const { ctx } = ctxFor(folder, remote);
      await step.apply(ctx, changes).catch(() => null);
    } finally {
      globalThis.fetch = fetched;
    }
    // The adapter is made for the company's address (here and for the leftover trial's closing).
    assert.ok(bases.length >= 1 && bases.every((b) => b === COMPANY), JSON.stringify(bases));
    // Git carries the certificate for that address, and no check is switched off.
    const pairs = gitEnvs.flatMap((env) => Object.entries(env).filter(([k]) => /^GIT_CONFIG_KEY_\d+$/.test(k)).map(([, key]) => key));
    // The certificate's setting as this system has it: on Windows git's own store (schannel), elsewhere the file.
    assert.ok(gitEnvs.length > 0 && pairs.includes(gitCaConfig(COMPANY, file)[0].key), JSON.stringify(pairs));
    // The protection read is made at the company's address, with glab told the host.
    assert.ok(asked.length > 0 && asked.every((u) => u.startsWith(`${COMPANY}/api/v4/`)), JSON.stringify(asked));
    assert.ok(glab.length > 0 && glab.every((c) => c.env?.GITLAB_HOST === 'git.example.org:8443'), JSON.stringify(glab));
  });
});

test('the helper\'s part: an empty commit on main\'s tip, the gate refuses it, STOP holds, and the pull request is left open for the session', async () => {
  await withProject(async ({ folder }) => {
    const { remote, main, tree } = await productOnRemote(folder);
    const { adapter, calls } = standIn(remote);
    const { asked, client } = merges(REFUSED);
    // The real stop guard, as a child under a scratch home.
    const step = stepWith(adapter, client, { trySTOP: undefined });
    const { changes } = await step.plan({ folder });
    const { ctx, recorded, setupRun } = ctxFor(folder, remote);
    assert.deepEqual(await step.apply(ctx, changes), []);

    // One empty commit on main's tip, recorded before it was pushed.
    const pushed = recorded[0].after.sha;
    assert.equal(recorded[0].kind, 'host');
    assert.equal(recorded[0].before, null);
    assert.equal(recorded[0].onRemote, '', 'recorded before it was pushed');
    const body = execFileSync('git', ['--git-dir', remote, 'cat-file', '-p', pushed], { encoding: 'utf8' });
    assert.match(body, new RegExp(`^tree ${tree}\nparent ${main}\n`));
    // The pull request recorded as pending just before it was opened, then by its number.
    assert.deepEqual([recorded[1].target, recorded[1].before, recorded[1].after], [`${REPO} pull request from ${HEALTH_BRANCH}`, null, { state: 'opening', branch: HEALTH_BRANCH }]);
    assert.match(calls.open[0].onRemote, new RegExp(`^${pushed}`));
    assert.deepEqual([calls.open[0].head, calls.open[0].base], [HEALTH_BRANCH, 'main']);
    assert.equal(recorded[2].target, `${REPO} pull request 12`);
    // The gate asked with no approval, as the foreman would.
    assert.deepEqual(asked, [{ project: SLUG, number: 12, stop: false, bypass: false, approvalRequired: true }]);
    // Left open, with its branch, for the session's merge trial (ruling R68).
    assert.deepEqual(calls.close, []);
    assert.match(lsRemote(remote, `refs/heads/${HEALTH_BRANCH}`), new RegExp(`^${pushed}`));
    assert.equal(lsRemote(remote, 'refs/heads/main').split('\t')[0], main, 'main is as it was');
    const answer = recorded.at(-1);
    assert.equal(answer.after.health.open, true);
    assert.equal(answer.after.health.pr, 12);
    assert.deepEqual(answer.after.health.checks.map((c) => [c.name, c.result, c.ok]), [
      ['merge without approval', 'refused', true],
      ['write under stop', 'refused', true],
      ['read under stop', 'allowed', true],
      ['installed skills', 'match', true],
      ['host protection', 'on', true],
    ]);
    const after = readJournal().runs.find((r) => r.id === setupRun.id);
    assert.deepEqual(openTrial(after), { project: SLUG, pr: 12, branch: HEALTH_BRANCH, sha: pushed });
    assert.deepEqual(fs.readdirSync(path.join(folder, '.git')), [], 'the director\'s folder is untouched');
    assert.equal(stopState().on, false, 'STOP was tried under a scratch home, never this one');

    // Closed and deleted by the health route's cleanup, each recorded before it was made, with what came of it.
    const closing = [];
    const done = await closeOpenTrial({ setupRun: after, record: (c) => { closing.push({ ...c, onRemote: lsRemote(remote, `refs/heads/${HEALTH_BRANCH}`) }); }, adapterFor: () => adapter, findGit: GIT });
    assert.deepEqual(done, { pr: 12, branch: HEALTH_BRANCH, closed: true, deleted: true });
    assert.deepEqual(calls.close, [12]);
    assert.equal(lsRemote(remote, `refs/heads/${HEALTH_BRANCH}`), '');
    assert.deepEqual(closing.map((c) => [c.kind, c.target]), [['host', `${REPO} pull request 12`], ['host', `${REPO} branch ${HEALTH_BRANCH}`], ['answer', 'step 10']]);
    assert.ok(closing[1].onRemote.startsWith(pushed), 'the deletion recorded while the branch was still there');
    assert.deepEqual(closing[2].after, { cleanup: { pr: 12, branch: HEALTH_BRANCH, closed: true, deleted: true } });
  });
});

test('step 10 run again closes the trial its last attempt left open before opening another', async () => {
  await withProject(async ({ folder }) => {
    const { remote } = await productOnRemote(folder);
    const { adapter, calls } = standIn(remote);
    const step = stepWith(adapter, merges(REFUSED).client);
    const { changes } = await step.plan({ folder });
    const { ctx, recorded } = ctxFor(folder, remote);
    await step.apply(ctx, changes);
    await step.apply(ctx, changes);
    assert.deepEqual(calls.close, [12]);
    assert.ok(recorded.findIndex((c) => c.after?.cleanup?.pr === 12) < recorded.findIndex((c) => c.after?.state === 'opening' && recorded.indexOf(c) > 3));
    assert.equal(recorded.at(-1).after.health.pr, 13);
  });
});

test('a merge the gate lets through fails the step, named, and the trial is cleaned up at once', async () => {
  await withProject(async ({ folder }) => {
    const { remote } = await productOnRemote(folder);
    let through = false;
    const { adapter, calls } = standIn(remote, { merged: () => through });
    const { client } = merges(() => { through = true; return { ok: true, merged: true }; });
    const step = stepWith(adapter, client);
    const { ctx, recorded } = ctxFor(folder, remote);
    await assert.rejects(step.apply(ctx, (await step.plan({ folder })).changes), /merge without approval/);
    const health = recorded.filter((c) => c.after?.health).at(-1).after.health;
    assert.deepEqual(health.checks.find((c) => c.name === 'merge without approval'), { name: 'merge without approval', expected: 'refused', result: 'MERGED (unexpected)', ok: false });
    assert.equal(health.open, false);
    assert.deepEqual(calls.close, [12]);
    assert.equal(lsRemote(remote, `refs/heads/${HEALTH_BRANCH}`), '');
  });
});

test('a close or delete that fails is recorded as failed, never as done', async () => {
  await withProject(async ({ folder }) => {
    const { remote } = await productOnRemote(folder);
    const { adapter } = standIn(remote, { closeFails: true });
    const step = stepWith(adapter, merges(REFUSED).client, { checkPins: () => 'differ' });
    const { ctx, recorded } = ctxFor(folder, remote);
    await assert.rejects(step.apply(ctx, (await step.plan({ folder })).changes), /installed skills/);
    assert.deepEqual(cleanups(recorded), [{ pr: 12, branch: HEALTH_BRANCH, closed: false, deleted: true }]);
  });
});

test('STOP coming on stops step 10 before anything is pushed', async () => {
  await withProject(async ({ folder }) => {
    const { remote } = await productOnRemote(folder);
    const { adapter, calls } = standIn(remote);
    const { asked, client } = merges(REFUSED);
    const step = stepWith(adapter, client);
    const { ctx, recorded } = ctxFor(folder, remote, { stopped: () => true });
    await assert.rejects(step.apply(ctx, (await step.plan({ folder })).changes), (e) => e.message === STOPPED);
    assert.equal(asked.length, 0);
    assert.equal(calls.open.length, 0);
    assert.equal(recorded.filter((c) => c.kind === 'host').length, 0);
  });
});

// Cleaning up setup's own trial is no new work: it runs after a STOP halt too.
test('after STOP halts step 10, its own trial pull request is still closed and its branch deleted', async () => {
  await withProject(async ({ folder }) => {
    const { remote } = await productOnRemote(folder);
    let opened = false;
    const { adapter, calls } = standIn(remote, { onOpen: () => { opened = true; } });
    const { asked, client } = merges(REFUSED);
    const step = stepWith(adapter, client);
    const { ctx, recorded } = ctxFor(folder, remote, { stopped: () => opened });
    await assert.rejects(step.apply(ctx, (await step.plan({ folder })).changes), (e) => e.message === STOPPED);
    assert.equal(asked.length, 0, 'the gate is not asked once STOP is on');
    assert.deepEqual(calls.close, [12]);
    assert.equal(lsRemote(remote, `refs/heads/${HEALTH_BRANCH}`), '');
    assert.deepEqual(cleanups(recorded), [{ pr: 12, branch: HEALTH_BRANCH, closed: true, deleted: true }]);
  });
});

test('a git command that fails names its subcommand, never a setting\'s value', async () => {
  await withProject(async ({ folder }) => {
    const { remote } = await productOnRemote(folder);
    const { adapter } = standIn(remote);
    const real = (await import('../../../scripts/lib/run.js')).run;
    const run = (file, args, options) => (args.includes('commit-tree') ? Promise.resolve({ code: 1, stdout: '', stderr: 'no' }) : real(file, args, options));
    const step = stepWith(adapter, merges(REFUSED).client, { run });
    const { ctx } = ctxFor(folder, remote);
    await assert.rejects(step.apply(ctx, (await step.plan({ folder })).changes), (e) => e.message === 'git commit-tree failed for the trial branch');
  });
});

test('step 10\'s git shuts out git\'s global and system config, with hooks off, and looks for a setting that would run a program before each call (rulings R109, R110)', async () => {
  await withProject(async ({ folder }) => {
    const { remote } = await productOnRemote(folder);
    const { adapter } = standIn(remote);
    const real = (await import('../../../scripts/lib/run.js')).run;
    const gits = [];
    const run = (file, args, options) => {
      if (path.basename(file).replace(/\.exe$/, '') === 'git') gits.push({ args: [...args], env: options?.env ?? {} });
      return real(file, args, options);
    };
    const step = stepWith(adapter, merges(REFUSED).client, { run });
    const { ctx } = ctxFor(folder, remote);
    await step.apply(ctx, (await step.plan({ folder })).changes).catch(() => {});
    const CHECK = 'config --includes --name-only --list -z';
    const own = gits.filter((c) => c.args.join(' ') !== CHECK);
    assert.ok(own.some((c) => c.args.includes('commit-tree')));
    assert.equal(gits.length, own.length * 2, 'each call after a look at the repository\'s settings');
    for (const c of gits) {
      assert.equal(c.env.GIT_CONFIG_NOSYSTEM, '1');
      assert.equal(c.env.GIT_CONFIG_GLOBAL, '/dev/null');
    }
    for (const c of own) {
      const pairs = Array.from({ length: Number(c.env.GIT_CONFIG_COUNT) }, (_, i) => `${c.env[`GIT_CONFIG_KEY_${i}`]}=${c.env[`GIT_CONFIG_VALUE_${i}`]}`);
      assert.ok(pairs.includes('core.hooksPath=/dev/null') && pairs.includes('core.fsmonitor=false'), pairs.join(' '));
    }
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
  // A pull request that isn't open shows nothing of the gate (ruling R68).
  assert.equal(await trial({ ok: false, refused: 'pull request 12 is not open' }, 'closed'), 'could not run');
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

// Cleans the trial up as the route does, with a stand-in adapter and git that never reach a host.
const quietGit = async () => ({ code: 0, stdout: '', stderr: '' });
const closer = (closes = []) => (args) => closeOpenTrial({
  ...args, adapterFor: () => ({ closePr: async (n) => { closes.push(n); return { number: n }; } }), findGit: GIT, run: quietGit,
});
const cleaned = (folder, run) => closer()({ setupRun: run, record: (c) => addChanges(run.id, [{ ...c, step: 10 }]) })
  .then(() => readJournal().runs.find((r) => r.id === run.id));

test('a green run gives a green board', async () => {
  await withProject(async ({ folder }) => {
    const run = await cleaned(folder, runWith(folder, { checks: GREEN_CHECKS }));
    const got = await healthCheck({ folder, run, reported: GREEN_LINES, load: OK_BOARD });
    assert.equal(got.green, true, got.lines.join('\n'));
    assert.deepEqual(got.trials, { pr: 12, project: SLUG });
    const helper = got.lines.filter((l) => l.startsWith('Passed:') && !l.endsWith('(reported by the session)'));
    const session = got.lines.filter((l) => l.endsWith('(reported by the session)'));
    assert.equal(helper.length, Object.keys(HELPER_CHECKS).length + 1, 'and the clean-up');
    assert.equal(session.length, Object.keys(SESSION_CHECKS).length);
    assert.ok(session.every((l) => l.startsWith('Passed:')));
    assert.ok(got.lines.includes('Board: Protection: Standard'));
    assert.match(got.board, /Wheelhouse's board/);
    const checks = Object.keys(HELPER_CHECKS).length + Object.keys(SESSION_CHECKS).length;
    assert.equal(got.verdict, `All ${checks} checks passed. Wheelhouse is ready.`);
    assert.equal(got.lines.at(-1), got.verdict, 'one verdict ends the lines');
    assert.equal(got.lines.filter((l) => /checks passed\./.test(l)).length, 1);
    const watched = await healthCheck({ folder, run, reported: GREEN_LINES, load: boardWith([{ level: 'watch', text: 'Your profile isn\'t backed up off this computer yet' }]) });
    assert.equal(watched.green, true);
  });
});

test('a failed trial is named with what to do, and what to do can be done', async () => {
  await withProject(async ({ folder }) => {
    const checks = GREEN_CHECKS.map((c) => (c.name === 'write under stop' ? { ...c, result: 'allowed', ok: false } : c));
    const run = await cleaned(folder, runWith(folder, { checks }));
    const reported = GREEN_LINES.map((l) => (l.startsWith('read .env.local') ? 'read .env.local: refused / allowed' : l))
      .map((l) => (l.startsWith('helper health') ? 'helper health: reached / could not run' : l));
    const got = await healthCheck({ folder, run, reported, load: OK_BOARD });
    assert.equal(got.green, false);
    assert.ok(got.lines.includes('Failed: With STOP on, an agent\'s change was not refused (refused was expected, allowed came back). Reload this project in Claude Desktop so Wheelhouse\'s checks run in it, then run step 10 again.'), got.lines.join('\n'));
    assert.ok(got.lines.includes('Failed: An agent could read a .env.local file (refused was expected, allowed came back). The sandbox isn\'t on in this session: reload this project in Claude Desktop, then run step 10 again. (reported by the session)'), got.lines.join('\n'));
    assert.ok(got.lines.some((l) => /^Failed: setup couldn't try reaching the helper\. Run step 10 again.*\(reported by the session\)$/.test(l)), got.lines.join('\n'));
    assert.equal(got.lines.filter((l) => /^(Passed|Failed|Watch):/.test(l)).length, Object.keys(HELPER_CHECKS).length + 1 + Object.keys(SESSION_CHECKS).length);
    const every = Object.keys(HELPER_CHECKS).length + Object.keys(SESSION_CHECKS).length;
    assert.equal(got.verdict, `${every - 3} of ${every} checks passed. Here is what to do.`);
    assert.equal(got.lines.at(-1), got.verdict);
  });
});

// The trial looks where setup finds gh; on GitHub, where setup uses gh, "not installed" means the
// trial missed it, so it fails rather than reading green untried. On GitLab there is none to run.
test('on a GitHub project, a gh the trial couldn\'t find is a failure; on GitLab it passes', async () => {
  await withProject(async ({ folder }) => {
    const run = await cleaned(folder, runWith(folder, { checks: GREEN_CHECKS }));
    const reported = GREEN_LINES.map((l) => (l.startsWith('run gh') ? 'run gh: refused / not installed' : l));
    const hub = await healthCheck({ folder, run, reported, load: OK_BOARD });
    assert.equal(hub.green, false);
    assert.ok(hub.lines.some((l) => /^Failed: .*GitHub sign-in.*not installed came back.*\(reported by the session\)$/.test(l)), hub.lines.join('\n'));
    writeProject(SLUG, { folder, remoteUrl: 'https://gitlab.com/o/Cafe-Menu.git', host: 'gitlab', repo: REPO, connection: {} });
    const lab = await healthCheck({ folder, run, reported, load: OK_BOARD });
    assert.equal(lab.green, true, lab.lines.join('\n'));
  });
});

test('trials not handed in, lines that aren\'t trials\', a step 10 that failed, an open trial and a STOP board line each hold the board', async () => {
  await withProject(async ({ folder }) => {
    const run = await cleaned(folder, runWith(folder, { checks: GREEN_CHECKS }));
    const short = await healthCheck({ folder, run, reported: [...GREEN_LINES.slice(1), 'read .env.local refused', 'surprise: refused / refused'], load: OK_BOARD });
    assert.equal(short.green, false);
    assert.ok(short.lines.some((l) => l.startsWith('Not reported by the session: reading .env.local.')), short.lines.join('\n'));
    assert.ok(short.lines.includes('Left out: 2 lines the session handed in that aren\'t trials\'.'), short.lines.join('\n'));
    const stopped = await healthCheck({ folder, run, reported: GREEN_LINES, load: boardWith([{ level: 'stop', text: 'STOP is on' }]) });
    assert.equal(stopped.green, false);
    assert.ok(stopped.lines.includes('Board: STOP is on'));
  });
  await withProject(async ({ folder }) => {
    const open = await healthCheck({ folder, run: runWith(folder, { checks: GREEN_CHECKS }), reported: GREEN_LINES, load: OK_BOARD });
    assert.equal(open.green, false, 'the trial pull request is still open');
    assert.ok(open.lines.some((l) => l.startsWith('Waiting: the trial pull request, number 12, is open for this session\'s trials')), open.lines.join('\n'));
  });
  await withProject(async ({ folder }) => {
    const run = runWith(folder, { upTo: 9, checks: GREEN_CHECKS.slice(0, 1), failed: 'git push failed for the trial branch', open: false });
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

test('the verdict counts only the checks that print a line, so its figures match the lines shown', async () => {
  const sessionChecks = Object.keys(SESSION_CHECKS).length;
  const every = Object.keys(HELPER_CHECKS).length + sessionChecks;
  await withProject(async ({ folder }) => {
    // Step 10 not run: no helper record, so the helper's checks print nothing and are not counted;
    // the line saying step 10 hasn't run is.
    const got = await healthCheck({ folder, run: runWith(folder, { upTo: 9 }), reported: GREEN_LINES, load: OK_BOARD });
    assert.equal(got.lines.filter((l) => /^(Passed|Failed|Not yet):/.test(l)).length, sessionChecks + 1, got.lines.join('\n'));
    assert.equal(got.verdict, `${sessionChecks} of ${sessionChecks + 1} checks passed. Here is what to do.`);
  });
  await withProject(async ({ folder }) => {
    // A STOP line on the board is shown and counted, once.
    const run = await cleaned(folder, runWith(folder, { checks: GREEN_CHECKS }));
    const stopped = await healthCheck({ folder, run, reported: GREEN_LINES, load: boardWith([{ level: 'stop', text: 'STOP is on' }]) });
    assert.equal(stopped.verdict, `${every} of ${every + 1} checks passed. Here is what to do.`);
  });
  await withProject(async ({ folder }) => {
    // Step 10 marked done with no record of its checks: one line says so, and it is counted.
    const got = await healthCheck({ folder, run: runWith(folder), reported: GREEN_LINES, load: OK_BOARD });
    assert.equal(got.green, false);
    assert.ok(got.lines.some((l) => l.startsWith('Failed: step 10\'s record of its checks is missing.')), got.lines.join('\n'));
    assert.equal(got.verdict, `${sessionChecks} of ${sessionChecks + 1} checks passed. Here is what to do.`);
  });
});

test('a trial pull request left open by a failed close is a watch line, not a failure', async () => {
  await withProject(async ({ folder }) => {
    const run = runWith(folder, { checks: GREEN_CHECKS });
    addChanges(run.id, [{ id: newId('chg'), step: 10, kind: 'answer', target: 'step 10', before: null, after: { cleanup: { pr: 12, branch: HEALTH_BRANCH, closed: false, deleted: true } } }]);
    const got = await healthCheck({ folder, run: readJournal().runs.find((r) => r.id === run.id), reported: GREEN_LINES, load: OK_BOARD });
    assert.equal(got.green, true, got.lines.join('\n'));
    assert.ok(got.lines.some((l) => /^Watch: The trial pull request, or its branch, was left on the host .*Close the pull request/.test(l)), got.lines.join('\n'));
  });
});

test('with the real board, STOP on the computer holds it', async () => {
  await withProject(async ({ folder }) => {
    const run = await cleaned(folder, runWith(folder, { checks: GREEN_CHECKS }));
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

// ---- The helper's /setup/health route, and the end of setup (rulings R44, R67, R68) ----

// `copied` takes each copy of the run's records into the project's state (ruling R45); `copy`
// stands in for that copy when given.
function routesFor(user, { stopped = () => false, load = OK_BOARD, finished = [], closes = [], copied = [], copy, writeSurvey } = {}) {
  return setupRoutes({
    now: () => T0, userHome: user, stopped, writeSurvey,
    health: (args) => healthCheck({ ...args, load }),
    finish: async (args) => { finished.push(args); return { started: 'The foreman\'s watcher is started.', briefing: 'The briefing.' }; },
    closeTrial: closer(closes),
    copy: copy ?? (async (runId, folder) => { copied.push([runId, folder]); return { copied: 0, skipped: 0, failed: 0 }; }),
  });
}
const runOf = (folder) => readJournal().runs.filter((r) => r.folder === folder).at(-1);

test('the trial stays open until the session\'s lines are in; then it is closed, and a green board finishes setup once', async () => {
  await withProject(async ({ folder, user }) => {
    runWith(folder, { checks: GREEN_CHECKS });
    const finished = [];
    const closes = [];
    const copied = [];
    const route = routesFor(user, { finished, closes, copied })['/setup/health'];
    // Asked with no lines, it names the trial for the session, and leaves it open.
    const asked = await route({ folder });
    assert.equal(asked.green, false);
    assert.deepEqual(asked.trials, { pr: 12, project: SLUG });
    assert.deepEqual(closes, []);
    assert.equal(firstUnfinished(runOf(folder)), 10, 'step 10 is not finished before the board is green');

    const green = await route({ folder, lines: GREEN_LINES });
    assert.equal(green.ok, true, green.refused);
    assert.equal(green.green, true, green.lines.join('\n'));
    assert.deepEqual(closes, [12]);
    assert.deepEqual(finished, [{ project: SLUG }]);
    assert.equal(green.started, 'The foreman\'s watcher is started.');
    assert.equal(green.briefing, 'The briefing.');
    // The verdict and the first briefing come next, from step 10's plan, once, before the phone card.
    const routes = routesFor(user);
    assert.equal((await routes['/setup/status']({ folder })).ask, 10);
    assert.deepEqual(await routes['/setup/plan']({ folder, step: 10 }), { ok: true, done: true, said: `${green.lines.at(-1)}\n\nThe briefing.` });
    assert.notEqual((await routes['/setup/status']({ folder })).ask, 10, 'given once');
    await assert.rejects(routes['/setup/plan']({ folder, step: 10 }), /already done/);
    assert.equal(healthGreen(runOf(folder)), true);
    assert.equal(firstUnfinished(runOf(folder)), null, 'setup is finished once the board is green');
    // The run's last clicks and answers are copied into the project's state as it finishes (ruling R45).
    assert.deepEqual(copied, [[runOf(folder).id, folder]]);

    // Asked again, green or with made-up lines: it only reads.
    const kept = JSON.stringify(readJournal());
    const again = await route({ folder, lines: GREEN_LINES });
    const madeUp = await route({ folder, lines: GREEN_LINES.map((l) => l.replace(/ \/ .*$/, ' / allowed')) });
    assert.equal(again.started, undefined);
    assert.equal(madeUp.started, undefined);
    assert.equal(finished.length, 1, 'setup\'s ending runs once per run');
    assert.deepEqual(closes, [12]);
    assert.equal(copied.length, 1);
    assert.equal(JSON.stringify(readJournal()), kept, 'nothing written after the green mark');
  });
});

// Step 10's Go ahead waits only for steps 7 to 9, so a step 10 card asked out of order can be run
// with an earlier step not done: its green board then neither marks setup finished nor runs its
// ending, and the trial stays open for the same lines to be handed in again once that step is done.
test('with step 5 or step 6 not done, a green board gives no green mark, no ending and no copy', async () => {
  for (const missing of [5, 6]) {
    await withProject(async ({ folder, user }) => {
      const run = runWith(folder, { checks: GREEN_CHECKS, skip: [missing] });
      const finished = [];
      const closes = [];
      const copied = [];
      const route = routesFor(user, { finished, closes, copied })['/setup/health'];
      const early = await route({ folder, lines: GREEN_LINES });
      assert.equal(early.ok, true, early.refused);
      assert.equal(early.green, false, `step ${missing} is not done`);
      assert.ok(early.lines.some((l) => l.startsWith(`Not yet: step ${missing} (`)), early.lines.join('\n'));
      assert.deepEqual([finished, copied, closes], [[], [], []]);
      assert.equal(healthGreen(runOf(folder)), false);
      assert.equal(firstUnfinished(runOf(folder)), missing);

      // Once it is done, the same lines close the trial and finish setup, once.
      markStep(run.id, missing, 'doneAt', { now: () => T0 });
      const green = await route({ folder, lines: GREEN_LINES });
      assert.equal(green.green, true, green.lines.join('\n'));
      assert.deepEqual(closes, [12]);
      assert.deepEqual(finished, [{ project: SLUG }]);
      assert.deepEqual(copied, [[run.id, folder]]);
      assert.equal(firstUnfinished(runOf(folder)), null);
    });
  }
});

test('a copy of the run\'s records that fails never stops setup\'s ending', async () => {
  await withProject(async ({ folder, user }) => {
    runWith(folder, { checks: GREEN_CHECKS });
    const finished = [];
    const route = routesFor(user, { finished, copy: async () => { throw new Error('the helper could not be reached'); } })['/setup/health'];
    const green = await route({ folder, lines: GREEN_LINES });
    assert.equal(green.green, true, green.lines.join('\n'));
    assert.deepEqual(finished, [{ project: SLUG }]);
    assert.equal(healthGreen(runOf(folder)), true);
  });
});

test('a red board closes the trial, leaves step 10 unfinished, and a fresh card runs it again', async () => {
  await withProject(async ({ folder, user, plan }) => {
    runWith(folder, { checks: GREEN_CHECKS });
    const finished = [];
    const closes = [];
    // While the trial is open, step 10's plan tells the session to run the trials.
    const waiting = await plan(10);
    assert.equal(waiting.ok, true, waiting.refused);
    assert.ok(waiting.wait > 0);
    assert.match(waiting.why, /cli\.js health/);
    const red = await routesFor(user, { finished, closes })['/setup/health']({ folder, lines: GREEN_LINES.slice(1) });
    assert.equal(red.green, false);
    assert.deepEqual(closes, [12]);
    assert.deepEqual(finished, []);
    assert.equal(healthGreen(runOf(folder)), false);
    assert.equal(firstUnfinished(runOf(folder)), 10);
    // Not "already done": a fresh Go-ahead card for step 10.
    const card = await plan(10);
    assert.equal(card.ok, true, card.refused);
    assert.equal(setLineOf(card.card.question), setupLine(10, card.hash));
    // A new click is a new attempt: the old finish no longer counts.
    const run = runOf(folder);
    markStep(run.id, 10, 'clickedAt', { now: () => T0 });
    assert.equal(runOf(folder).steps[10].doneAt, undefined);
  });
});

test('under STOP the health route only reads: no close, no removal, no green mark, no ending', async () => {
  await withProject(async ({ folder, user }) => {
    runWith(folder, { checks: GREEN_CHECKS });
    const finished = [];
    const closes = [];
    const env = path.join(folder, '.env.local');
    fs.writeFileSync(env, TRIAL_MARKER);
    const kept = JSON.stringify(readJournal());
    const got = await routesFor(user, { finished, closes, stopped: () => true })['/setup/health']({ folder, lines: GREEN_LINES });
    assert.equal(got.ok, true, 'a reading form, answered under STOP');
    assert.deepEqual([finished, closes], [[], []]);
    assert.equal(fs.readFileSync(env, 'utf8'), TRIAL_MARKER);
    assert.equal(JSON.stringify(readJournal()), kept);
  });
});

test('the health route takes only trial lines, and removes only a trial\'s own leftover .env.local', async () => {
  await withProject(async ({ folder, user }) => {
    runWith(folder, { checks: GREEN_CHECKS });
    const route = routesFor(user, { load: boardWith([{ level: 'stop', text: 'STOP is on' }]) })['/setup/health'];
    await assert.rejects(route({ folder, lines: ['read .env.local: refused / refused; rm -rf x'] }), /trial/);
    await assert.rejects(route({ folder, lines: 'read .env.local: refused / refused' }), /trial/);
    await assert.rejects(route({ folder, lines: GREEN_LINES, changes: [] }), /folder/);
    await assert.rejects(route({ folder, lines: Array.from({ length: 13 }, () => GREEN_LINES[0]) }), /trial/);
    const env = path.join(folder, '.env.local');
    fs.writeFileSync(env, TRIAL_MARKER);
    await route({ folder, lines: GREEN_LINES });
    assert.equal(fs.existsSync(env), false);
    fs.writeFileSync(env, `${TRIAL_MARKER}SECRET=1\n`);
    await route({ folder, lines: GREEN_LINES });
    assert.equal(fs.readFileSync(env, 'utf8'), `${TRIAL_MARKER}SECRET=1\n`, 'the director\'s own is never touched');
    assert.equal(removeTrialLeftover(path.join(folder, 'missing')), false);
  });
});

// A survey with nothing in it, as one taken where nothing is under way.
const EMPTY_SURVEY = {
  v: 1, hostReached: true, requests: [], pushed: [], local: [], more: { pushed: false, local: false },
  instructions: { files: [], sections: [] }, scheduled: 0, secrets: 0, rules: [],
};
// The helper's own survey writer, noting each survey as { project, kind, data }.
const writesTo = (writes, answer = { ok: true, id: 'e1' }) => async (project, data) => {
  const args = { project, kind: 'survey', data };
  writes.push(args);
  return typeof answer === 'function' ? answer(args) : answer;
};

test('finishSetup starts the foreman and gives the briefing, and says plainly when it can\'t', async () => {
  const done = await finishSetup({ project: SLUG, writeSurvey: writesTo([]), look: async () => EMPTY_SURVEY, start: async () => 'started', brief: async () => 'The first briefing.' });
  assert.deepEqual(done, { started: 'started', briefing: 'The first briefing.' });
  const failed = await finishSetup({ project: SLUG, writeSurvey: writesTo([]), look: async () => EMPTY_SURVEY, start: async () => { throw new Error('no'); }, brief: async () => { throw new Error('no'); } });
  assert.match(failed.started, /next session start/);
  assert.equal(failed.briefing, null);
});

test('finishing setup records exactly one survey, before the first briefing (plan ruling P1)', async () => {
  const order = [];
  const writes = [];
  const writeSurvey = writesTo(writes, (args) => { order.push(`write ${args.kind}`); return { ok: true, id: 'e1' }; });
  const found = { ...EMPTY_SURVEY, local: [{ name: 'prices', head: 'a'.repeat(40), commits: 1, subject: 'Prices', at: '' }] };
  const done = await finishSetup({
    project: SLUG, writeSurvey, look: async () => { order.push('look'); return found; },
    start: async () => { order.push('start'); return 'started'; }, brief: async () => { order.push('brief'); return 'The first briefing.'; },
  });
  assert.deepEqual(done, { started: 'started', briefing: 'The first briefing.' });
  assert.deepEqual(writes, [{ project: SLUG, kind: 'survey', data: found }]);
  assert.deepEqual(order, ['look', 'write survey', 'start', 'brief']);
});

test('a survey that fails, or that the state refuses, never stops setup finishing: it is recorded as one that missed the host', async () => {
  const missed = { ...EMPTY_SURVEY, hostReached: false };
  const writes = [];
  const thrown = await finishSetup({ project: SLUG, writeSurvey: writesTo(writes), look: async () => { throw new Error('the host could not be reached'); }, start: async () => 'started', brief: async () => 'B.' });
  assert.deepEqual(thrown, { started: 'started', briefing: 'B.' });
  assert.deepEqual(writes.splice(0).map((w) => w.data), [missed]);
  // A survey the state refuses (its secret scan, say) is written again as one that missed.
  const refusedOnce = (args) => (args.data.hostReached ? { ok: false, refused: 'the event file was refused because it matched: github-token' } : { ok: true, id: 'e2' });
  const refused = await finishSetup({ project: SLUG, writeSurvey: writesTo(writes, refusedOnce), look: async () => EMPTY_SURVEY, start: async () => 'started', brief: async () => 'B.' });
  assert.deepEqual(refused, { started: 'started', briefing: 'B.' });
  assert.deepEqual(writes.splice(0).map((w) => w.data.hostReached), [true, false]);
  // A helper that can't be asked at all.
  const gone = await finishSetup({ project: SLUG, writeSurvey: async () => { throw new Error('gone'); }, look: async () => EMPTY_SURVEY, start: async () => 'started', brief: async () => 'B.' });
  assert.deepEqual(gone, { started: 'started', briefing: 'B.' });
});

test('finishSetup\'s own survey reads the project\'s folder and asks the host through the adapter it is given', async () => {
  await withProject(async ({ folder }) => {
    const writes = [];
    const asked = [];
    const adapterFor = async (record) => { asked.push(record.repo); return { defaultBranch: async () => 'main', openRequests: async () => { throw new Error('unreachable'); } }; };
    await finishSetup({ project: SLUG, writeSurvey: writesTo(writes), adapterFor, start: async () => 'started', brief: async () => 'B.' });
    assert.deepEqual(asked, [REPO]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].data.hostReached, false, 'a host that can\'t be reached is said so');
  });
});

test('finishSetup puts the rules found into the survey, as the run\'s past words give them, each as words and source', async () => {
  await withProject(async ({ folder, config }) => {
    lay(folder, { 'CLAUDE.md': '- Never push straight to main.\n- Keep commits small.\n', 'AGENTS.md': 'Always write tests.\n' });
    transcript(config, 'past', 'a', [typed(folder, 'And keep commits small, thanks!', '2026-10-19T00:00:00.000Z')]);
    // Said after the run began, in the run's own session: not past words.
    transcript(config, 'setup', 'b', [typed(folder, 'Please never push straight to main!', '2026-10-20T03:05:00.000Z')]);
    startRun({ folder, now: () => T0 });
    const writes = [];
    await finishSetup({ project: SLUG, writeSurvey: writesTo(writes), look: async ({ rules }) => ({ ...EMPTY_SURVEY, rules }), start: async () => 'started', brief: async () => 'B.' });
    assert.deepEqual(writes[0].data.rules, [
      { words: 'Never push straight to main.', source: { file: 'CLAUDE.md', line: 1 } },
      { words: 'And keep commits small, thanks!', source: { file: 'CLAUDE.md', line: 2 } },
      { words: 'Always write tests.', source: { file: 'AGENTS.md', line: 1 } },
    ]);
  });
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
    const done = await finishSetup({ project: SLUG, client, spawn, now: () => T0, look: async () => EMPTY_SURVEY });
    assert.equal(spawned.length, 1);
    assert.ok(spawned[0].args[0].endsWith(path.join('scripts', 'watcher', 'main.js')));
    assert.deepEqual(spawned[0].args.slice(1), [SLUG]);
    assert.match(done.started, /watcher is started/);
    assert.equal(typeof done.briefing, 'string');
    assert.ok(done.briefing.length > 0);
    const shape2 = await finishSetup({ project: SLUG, client: { ...client, config: async () => ({ ok: true, config: { ...CONFIG, watcherShape: 2 } }) }, spawn, now: () => T0, look: async () => EMPTY_SURVEY });
    assert.equal(spawned.length, 1, 'Shape 2\'s foreman is a terminal session the helper can\'t open');
    assert.match(shape2.started, /terminal/);
  });
});

test('setup\'s ending hands finishSetup the helper\'s own survey writer', async () => {
  await withProject(async ({ folder, user }) => {
    runWith(folder, { checks: GREEN_CHECKS });
    const finished = [];
    const writeSurvey = async () => ({ ok: true });
    const route = routesFor(user, { finished, writeSurvey })['/setup/health'];
    assert.equal((await route({ folder, lines: GREEN_LINES })).green, true);
    assert.deepEqual(finished, [{ project: SLUG, writeSurvey }]);
  });
});

test('a host that never answers doesn\'t stop setup finishing: the survey gives up at its deadline as one that missed the host', async () => {
  await withProject(async () => {
    const writes = [];
    const never = new Promise(() => {});
    const began = Date.now();
    const done = await finishSetup({
      project: SLUG, writeSurvey: writesTo(writes), adapterFor: async () => ({ defaultBranch: () => never, openRequests: () => never }),
      surveyDeadlineMs: 300, start: async () => 'started', brief: async () => 'B.',
    });
    assert.deepEqual(done, { started: 'started', briefing: 'B.' });
    assert.ok(Date.now() - began < 5000);
    assert.deepEqual(writes.map((w) => w.data.hostReached), [false]);
  });
});

// ---- The first briefing mentions the survey, and the carry-on card (ruling A9) ----

// A survey that found work in flight: one request on GitHub and two pieces of work on this computer.
const IN_FLIGHT = {
  ...EMPTY_SURVEY,
  requests: [{ number: 4, title: 'Add prices', draft: false }],
  local: ['prices', 'menu'].map((name) => ({ name, head: 'a'.repeat(40), commits: 1, subject: 'Work', at: '' })),
};
// Board inputs with the Autonomy in force, as loadBoardInputs gives the settings.
const boardAt = (autonomy) => async () => ({
  project: SLUG, model: { project: SLUG, builtAt: T0.toISOString(), director: { health: [] }, build: {}, missing: [] },
  settings: autonomy === undefined ? {} : { autonomy: { value: autonomy, from: 'project' } },
});
// A client that records each write as the helper's /state/write would, giving each an id.
function writingClient(writes, answer = (body) => ({ ok: true, id: `e${writes.length}` })) {
  return { state: { write: async (body) => { writes.push(body); return answer(body); } } };
}
// The Autonomy is read on its own (`autonomy`), as the settings views give it; the board inputs carry it too.
const finishWith = (survey, { autonomy, client, load = boardAt(autonomy) }) => finishSetup({
  project: SLUG, writeSurvey: async () => ({ ok: true, id: 'survey-1' }), look: async () => survey, start: async () => 'started', client, load, now: () => T0,
  autonomy: () => autonomy ?? 'balanced',
});
const CARD_ASK = 'Wheelhouse found work already under way in Cafe-Menu: 1 change waiting to be merged on GitHub, and 2 pieces of unfinished work on this computer. Shall I carry them on?';
// The briefing's plain words may say "merged" in other words, as the board-context hook gives it.
const TRUSTING_LINE = /Already under way here: 1 change waiting to be \w+ on GitHub, and 2 pieces of unfinished work on this computer\. I'm carrying them on, one brief each; say stop if you'd rather I didn't\./;

// From the rehearsal on a project under way: setup's first briefing said "Locked would protect it more"
// minutes after the director chose Standard. It holds the line back and starts the weekly rhythm, so
// the line comes back at the next week's first briefing.
test('setup\'s first briefing holds Locked\'s line back and starts the weekly rhythm', async () => {
  await withProject(async () => {
    const load = async () => ({
      project: SLUG,
      model: { project: SLUG, builtAt: T0.toISOString(), director: { health: [{ level: 'watch', text: LOCKED_WOULD_LINE }] }, build: {}, missing: [] },
      settings: { autonomy: { value: 'balanced', from: 'project' } },
    });
    const done = await finishWith(EMPTY_SURVEY, { autonomy: 'balanced', client: writingClient([]), load });
    assert.equal(typeof done.briefing, 'string');
    assert.doesNotMatch(done.briefing, /Locked/);
    assert.equal(readSeen(SLUG, { now: T0 }).weeklyAt, T0.toISOString());
  });
});

test('at Cautious and Balanced, setup ends with the carry-on card, recorded as a front-desk card and asked, and the briefing leaves out its line', async () => {
  for (const autonomy of ['cautious', 'balanced', undefined]) {
    await withProject(async ({ folder }) => {
      const writes = [];
      const done = await finishWith(IN_FLIGHT, { autonomy, client: writingClient(writes) });
      assert.equal(done.card.question.question.split('\n')[0], CARD_ASK);
      assert.deepEqual(done.card.question.options.map((o) => o.label), ['Carry on with it', 'Leave it for now']);
      assert.deepEqual(writes.map((w) => [w.cwd, w.kind]), [[folder, 'card'], [folder, 'asked']]);
      assert.equal(writes[0].data.topic, 'under-way');
      assert.equal(writes[0].data.question, done.card.question.question, 'the click\'s plain answer quotes the question the card holds');
      assert.deepEqual(writes[1].data, { cards: [done.card.id] });
      assert.equal(done.card.id, 'e1');
      assert.doesNotMatch(done.briefing, /under way/);
      // The card said the survey's one line, so the survey counts as mentioned.
      assert.equal(readSurveyAt(SLUG), 'survey-1');
    });
  }
});

test('at Trusting there is no card: the briefing says the work is being carried on', async () => {
  await withProject(async () => {
    const writes = [];
    const done = await finishWith(IN_FLIGHT, { autonomy: 'trusting', client: writingClient(writes) });
    assert.equal(done.card, undefined);
    assert.deepEqual(writes, []);
    assert.match(done.briefing, TRUSTING_LINE);
    assert.equal(readSurveyAt(SLUG), 'survey-1');
  });
});

test('at Trusting, board inputs that fail to load still ask no card', async () => {
  await withProject(async () => {
    const writes = [];
    const done = await finishWith(IN_FLIGHT, { autonomy: 'trusting', client: writingClient(writes), load: async () => { throw new Error('no inputs'); } });
    assert.equal(done.card, undefined);
    assert.deepEqual(writes, []);
  });
});

test('no work in flight, no card; the survey\'s other lines are still in the first briefing, and marked as mentioned', async () => {
  await withProject(async () => {
    const writes = [];
    const other = { ...EMPTY_SURVEY, instructions: { files: ['AGENTS.md'], sections: [] } };
    const done = await finishWith(other, { autonomy: 'balanced', client: writingClient(writes) });
    assert.equal(done.card, undefined);
    assert.deepEqual(writes, []);
    assert.match(done.briefing, /This project also has instructions for another agent setup \(AGENTS\.md\)/);
    assert.equal(readSurveyAt(SLUG), 'survey-1');
  });
});

test('a card the helper won\'t record leaves the line in the first briefing, as A2 has it, marked as mentioned', async () => {
  await withProject(async () => {
    const done = await finishWith(IN_FLIGHT, { autonomy: 'balanced', client: writingClient([], () => ({ ok: false, refused: 'no' })) });
    assert.equal(done.card, undefined);
    assert.match(done.briefing, /Already under way here: 1 change waiting to be \w+ on GitHub, and 2 pieces of unfinished work on this computer\. Say if you'd like me to carry any of them on\./);
    assert.equal(readSurveyAt(SLUG), 'survey-1');
  });
});

// The rehearsal of 27 October 2026: a session ran `resume` with its output cut short, then again,
// and asked the second card. The phone's first card opens with the verdict and the first briefing
// each time it is planned, until the director answers it.
test('after a green board the phone card opens with the verdict and the briefing each time it is planned', async () => {
  await withProject(async ({ folder, user }) => {
    runWith(folder, { checks: GREEN_CHECKS, skip: [9] });
    const routes = routesFor(user);
    const green = await routes['/setup/health']({ folder, lines: GREEN_LINES });
    assert.equal(green.green, true, green.lines.join('\n'));
    const opening = [green.lines.at(-1), 'The briefing.'];
    assert.equal((await routes['/setup/status']({ folder })).ask, 9);
    for (let i = 0; i < 2; i += 1) {
      const planned = await routes['/setup/plan']({ folder, step: 9 });
      assert.match(planned.ask.id, /^phone-ready/);
      assert.deepEqual(planned.ask.card.question.split('\n').slice(0, 2), opening, `planned ${i + 1} times`);
    }
    // While a phone card is left, step 10 gives no `said` of its own (tests/e2e/setup.test.js follows
    // the card's answer: after it, nothing opens with the briefing again).
    assert.equal((await routes['/setup/status']({ folder })).ask, 9);
  });
});
