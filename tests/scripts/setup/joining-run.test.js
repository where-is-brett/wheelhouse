// tests/scripts/setup/joining-run.test.js
// A second computer's whole setup run through the helper's /setup routes (rulings R74, R77, R78):
// steps 1, 2, 3, 6, 7, 8 and 9, in order, on an empty folder, against a project a first computer
// set up on a stand-in host. Every card is planned by the routes and every Go ahead is a signed
// click; the long steps run in this process (run-step.js's runStep, through a stand-in spawn).
// The run ends finished with no green mark, and its last records are copied into the project's
// state. Nothing real is signed in, installed or pushed: `gh` and `claude` are stand-ins, git runs
// for real only against bare remotes in temporary folders, and every home is a scratch folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupRoutes } from '../../../scripts/setup/engine.js';
import { runStep } from '../../../scripts/setup/run-step.js';
import { findRun } from '../../../scripts/setup/journal.js';
import { keepClick, keepAnswer } from '../../../scripts/lib/setup-clicks.js';
import { stepsFor, joinedRepo, firstUnfinished, healthGreen, JOINING_STEPS } from '../../../scripts/lib/setup-run.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { readProject } from '../../../scripts/lib/projects.js';
import { stateDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { buildManifest, MARKETPLACE } from '../../../scripts/lineage/manifest.js';
import { starterConfig } from '../../../scripts/setup/project-files.js';
import { LIVE_DATA } from '../../../scripts/setup/questions.js';
import { HOST_LABELS, WAYS, fromOtherComputer } from '../../../scripts/setup/host.js';
import { READY, ARRIVED, READY_ID, ARRIVED_ID } from '../../../scripts/setup/notify.js';
import { PUSH_TEST_WAIT_MS } from '../../../scripts/lib/setup-numbers.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { guardedRun } from '../../helpers/host-stand-ins.js';

// Setup's own runs: git and what the test fakes; any other host tool is refused and noted here.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));
import { g } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';
import { withProject, T0 } from '../../helpers/setup-answers.js';

const JOIN_STEPS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'helpers', 'setup-join-steps.js');
const USER = 'a-director';
const REPO = `${USER}/Cafe-Menu`;
const INSTALLED = '{"enabledPlugins":{"wheelhouse@wheelhouse":true}}\n';
const SHA = { superpowers: 'a'.repeat(40), 'mattpocock-skills': 'b'.repeat(40) };

// The first computer's project on the stand-in host: main with its committed files, and the state
// branch.
async function seedProject(dir) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await realRun('git', ['init', '--bare', '-q', '-b', 'main', dir]);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-seed-'));
  try {
    await g(work, 'init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(work, '.claude'));
    fs.writeFileSync(path.join(work, 'README.md'), '# Cafe menu\n');
    fs.writeFileSync(path.join(work, 'CLAUDE.md'), '# Cafe menu\n');
    fs.writeFileSync(path.join(work, '.claude', 'settings.json'), `${JSON.stringify({ enabledPlugins: { 'wheelhouse@wheelhouse': true, [`superpowers@${MARKETPLACE}`]: true } }, null, 2)}\n`);
    fs.writeFileSync(path.join(work, '.claude', 'wheelhouse.json'), `${JSON.stringify(starterConfig({ answers: { '4.live-data': { label: LIVE_DATA.no } } }), null, 2)}\n`);
    await g(work, 'add', '-A');
    await g(work, 'commit', '-q', '-m', 'Set up Wheelhouse');
    await g(work, 'push', '-q', dir, 'main');
    await g(work, 'checkout', '-q', '--orphan', 'wheelhouse-state');
    await g(work, 'rm', '-rqf', '.');
    fs.writeFileSync(path.join(work, 'README.md'), '# Wheelhouse state\n');
    await g(work, 'add', '-A');
    await g(work, 'commit', '-q', '-m', 'Start the state branch');
    await g(work, 'push', '-q', dir, 'wheelhouse-state');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// The pinned kits, and a stand-in install that puts them where Claude Code would and rewrites the
// project's settings in a layout of its own.
function kits(root) {
  const upstreams = ['superpowers', 'mattpocock-skills'].map((name) => ({
    name, plugin: name, repo: `https://example.invalid/${name}.git`, ref: 'v1.0.0', sha: SHA[name], folders: ['skills/one'], files: ['LICENSE'],
  }));
  const roots = {};
  for (const u of upstreams) {
    roots[u.name] = path.join(root, 'pristine', u.name);
    fs.mkdirSync(path.join(roots[u.name], 'skills', 'one'), { recursive: true });
    fs.writeFileSync(path.join(roots[u.name], 'skills', 'one', 'SKILL.md'), `${u.name}\n`);
    fs.writeFileSync(path.join(roots[u.name], 'LICENSE'), 'licence\n');
  }
  return { manifest: buildManifest({ roots, version: '1.4.0', upstreams }), roots };
}

test('a second computer runs steps 1, 2, 3, 6, 7 (this computer\'s files only), 8 and 9 through the helper\'s routes, and finishes with no green mark', async () => {
  await withProject(async ({ folder, user, config }) => {
    // The stand-in host, `claude` and git.
    const hostRoot = tempFolder('wh-host-');
    const hostUrl = ({ repo }) => path.join(hostRoot, `${repo}.git`);
    await seedProject(hostUrl({ repo: REPO }));
    await realRun('git', ['init', '--bare', '-q', '-b', 'main', hostUrl({ repo: `${USER}/wheelhouse-profile` })]);
    const repos = { [REPO]: 41, [`${USER}/wheelhouse-profile`]: 42 };
    const claudeHome = path.join(tempFolder('wh-claude '), 'claude config');
    fs.mkdirSync(claudeHome, { recursive: true });
    const k = kits(tempFolder('wh-kits-'));
    const calls = [];
    const answer = (stdout, code = 0, stderr = '') => ({ code, stdout, stderr });
    const run = async (file, args = [], options = {}) => {
      const name = path.basename(file).replace(/\.(exe|cmd)$/, '');
      if (name === 'gh') {
        calls.push(args);
        if (args[0] === 'auth' && args[1] === 'status') return answer('', 0, 'Logged in');
        if (args[0] === 'api' && args[1] === 'user') return answer(JSON.stringify({ login: USER, id: 4242 }));
        if (args[0] === 'api' && args[1].startsWith('user/memberships/orgs')) return answer('[]');
        if (args[0] === 'api' && args[1].startsWith('repos/')) {
          const repo = args[1].slice('repos/'.length);
          return repos[repo] ? answer(JSON.stringify({ full_name: repo, id: repos[repo], default_branch: 'main', private: true })) : answer('', 1, 'gh: Not Found (HTTP 404)');
        }
        return answer('', 1, 'unknown command');
      }
      if (name === 'claude') {
        calls.push(['claude', ...args]);
        const [plugin, marketplace] = args[2].split('@');
        const into = path.join(claudeHome, 'plugins', 'cache', marketplace, plugin);
        fs.cpSync(k.roots[plugin], into, { recursive: true });
        const file = path.join(claudeHome, 'plugins', 'installed_plugins.json');
        let record = { version: 2, plugins: {} };
        try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* the first */ }
        record.plugins[args[2]] = [{ scope: 'project', projectPath: options.cwd, installPath: into, version: '1.0.0', gitCommitSha: SHA[plugin] }];
        fs.writeFileSync(file, JSON.stringify(record));
        const settings = path.join(options.cwd, '.claude', 'settings.json');
        fs.writeFileSync(settings, JSON.stringify(JSON.parse(fs.readFileSync(settings, 'utf8'))));
        return answer(`Successfully installed plugin: ${args[2]} (scope: project)\n`);
      }
      return hostGuard(file, args, options);
    };
    // setup-quiet-steps.js, whose fake computer steps 2 and 6 run on, reads its own world as it loads.
    fs.mkdirSync(wheelhouseHome(), { recursive: true });
    fs.writeFileSync(path.join(wheelhouseHome(), 'quiet-world.json'), JSON.stringify({ pluginRoot: '/Applications/Wheel house/plugin', config, floor: '2.1.100', port: 14318 }));
    globalThis.wheelhouseJoiningWorld = {
      run, hostUrl, pluginRoot: '/Applications/Wheel house/plugin', config, claudeHome, manifest: k.manifest,
      managedDir: tempFolder('wh-managed-'), address: path.join(user, 'helper.sock'),
    };

    // The helper's routes, on a clock the test moves; a long step runs here, as its own process would.
    let clock = T0;
    const now = () => clock;
    const started = [];
    const spawn = (_node, [, ...args]) => {
      started.push(runStep(args, { now, exit: () => {}, tickMs: 1000 }));
      return { on: () => {}, unref: () => {} };
    };
    const copied = [];
    const routes = setupRoutes({ now, userHome: user, platform: process.platform, stepsModule: JOIN_STEPS, spawn, copy: async (...args) => { copied.push(args); } });
    const plan = (step) => routes['/setup/plan']({ folder, step });
    const tick = (ms = 1000) => { clock = new Date(clock.getTime() + ms); };
    const runId = () => findRun(folder).id;
    // The director's answer to a question card, and Go ahead on a step's card, signed as the prompt
    // record keeps them.
    const say = (asked, label, text = null) => {
      keepAnswer(makeEvent({ kind: 'action', data: { action: 'setup-answer', runId: runId(), step: asked.step, questionId: asked.id, question: asked.card.question, label, text }, now }));
      tick();
    };
    const goAhead = async (n, planned) => {
      keepClick(makeEvent({ kind: 'action', data: { action: 'setup', runId: runId(), step: n, hash: planned.hash, question: planned.card.question, label: 'Go ahead' }, now }));
      tick();
      const applied = await routes['/setup/apply']({ folder, step: n, hash: planned.hash });
      assert.equal(applied.ok, true, applied.refused);
      await Promise.all(started.splice(0));
      assert.equal(findRun(folder).steps[n]?.doneAt !== undefined, true, `step ${n}: ${findRun(folder).steps[n]?.failed}`);
    };
    const status = async () => routes['/setup/status']({ folder });
    const order = [];

    // Step 1 settles from the session's start; step 2 lists setup's own allow rule.
    assert.deepEqual(await plan(1), { ok: true, done: true });
    order.push(1);
    const two = await plan(2);
    assert.ok(two.hash, JSON.stringify(two));
    await goAhead(2, two);
    order.push(2);

    // Step 3: the join question, the host and the connection, then its Go ahead.
    assert.equal((await status()).ask, 3);
    const answers = { join: fromOtherComputer('Cafe-Menu'), host: HOST_LABELS.github, connection: WAYS.quick };
    let three = await plan(3);
    const asked = [];
    while (three.ask) {
      asked.push(three.ask.id.replace(/-[0-9a-f]{10}$/, ''));
      say(three.ask, answers[asked.at(-1)]);
      three = await plan(3);
    }
    assert.deepEqual(asked, ['join', 'host', 'connection']);
    await goAhead(3, three);
    order.push(3);
    assert.equal(joinedRepo(findRun(folder)), REPO);
    assert.equal(await g(folder, 'config', '--get', 'remote.origin.url'), hostUrl({ repo: REPO }));

    // From here only the joining computer's steps are asked; 4, 5 and 10 are refused.
    for (const n of [4, 5, 10]) await assert.rejects(plan(n), /a computer joining a project set up on another runs only steps 1, 2, 3, 6, 7, 8, 9/);
    assert.equal((await status()).ask, 6);

    // Step 6, the changes to this computer.
    const six = await plan(6);
    await goAhead(6, six);
    order.push(6);

    // Step 7, this computer's files only: no commit, no protection.
    const tip = await g(hostUrl({ repo: REPO }), 'rev-parse', 'main');
    const seven = await plan(7);
    assert.ok(!seven.changes.some((c) => c.kind === 'host'), 'no commit, no protection');
    await goAhead(7, seven);
    order.push(7);
    assert.equal(await g(hostUrl({ repo: REPO }), 'rev-parse', 'main'), tip, 'nothing went up');
    assert.equal(await g(folder, 'status', '--porcelain', '--', '.claude/settings.json', '.claude/wheelhouse.json', 'CLAUDE.md'), '', 'the shared files exactly as committed');

    // Step 8: not launched, so it settles as not Locked.
    assert.deepEqual(await plan(8), { ok: true, done: true });
    order.push(8);
    // Setup is finished: the phone comes after and holds nothing up (design section 15.1), so the
    // run's records are copied into the state now.
    assert.deepEqual(copied, [[findRun(folder).id, folder]], 'finished at step 8');

    // Step 9: Ready, the wait while the playbook pushes, then It arrived; its answers are copied too.
    const ready = await plan(9);
    assert.equal(ready.ask.id, READY_ID);
    say(ready.ask, READY.ready);
    assert.ok((await plan(9)).wait > 0);
    tick(PUSH_TEST_WAIT_MS);
    const arrived = await plan(9);
    assert.equal(arrived.ask.id, ARRIVED_ID);
    say(arrived.ask, ARRIVED.yes);
    assert.deepEqual(await plan(9), { ok: true, done: true });
    order.push(9);

    // Finished, in that order, with no green mark; the last records copied into the state once.
    const finished = findRun(folder);
    assert.deepEqual(order, JOINING_STEPS.map((s) => s.n));
    assert.equal(stepsFor(finished), JOINING_STEPS);
    assert.equal(firstUnfinished(finished), null);
    assert.equal(healthGreen(finished), false);
    assert.ok(!Object.hasOwn(finished.steps, 10) && !Object.hasOwn(finished.steps, 4) && !Object.hasOwn(finished.steps, 5));
    assert.deepEqual(copied, [[finished.id, folder], [finished.id, folder]]);
    assert.match((await status()).lines.at(-1), /Every step is done/);
    assert.equal(readProject('a-director__Cafe-Menu').folder, folder);
    assert.ok(fs.existsSync(path.join(stateDir('a-director__Cafe-Menu'), '.git')));
    assert.deepEqual(calls.filter((c) => c[0] === 'claude').map((c) => c[3]), [`superpowers@${MARKETPLACE}`, `mattpocock-skills@${MARKETPLACE}`]);
    delete globalThis.wheelhouseJoiningWorld;
  }, { files: { '.claude/settings.json': INSTALLED }, connected: false });
});
