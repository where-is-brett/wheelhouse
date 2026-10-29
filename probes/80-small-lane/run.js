// probes/80-small-lane/run.js
// Check 80: one real small-lane run (Archon design, section 7.2) on the throwaway private repository
// where-is-brett/wheelhouse-merge-trial. The engine is built as setup's step 2 builds it, into a scratch Wheelhouse home
// (WHEELHOUSE_HOME); the project's engine files, mirror rule and registration are as setup leaves them; the hello trial
// runs; then the real helper, with the real Archon adapter and the GitHub connection's quick mode, starts one small-lane
// work order and this process watches it: each record the helper writes, the run's spend (cancelled past the ceiling),
// and a stand-in CI status (context `ci`) on the pull request's head, so no Actions minutes are spent.
//
//   WHEELHOUSE_HOME=<short home> node probes/80-small-lane/run.js <prepare|run> [--ceiling 5]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.WH_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (rel) => import(path.join(ROOT, rel));
const { run } = await at('scripts/lib/run.js');
const { engineDir, projectSlug, stateDir, helperAddress } = await at('scripts/lib/paths.js');
const { writeProject } = await at('scripts/lib/projects.js');
const { enrol, makeSigningKey, readEnrolled } = await at('scripts/state/signing.js');
const { archonConfigText, mirrorRulesFile } = await at('scripts/setup/engine-parts.js');
const { ARCHON_CONFIG_FILE } = await at('scripts/engine/parts.js');
const { standardProjectSettings } = await at('scripts/eval/standard-project.js');
const { EXCLUDE_LINE } = await at('scripts/setup/project-files.js');
const { helloTrial } = await at('scripts/engine/hello.js');
const { startHelper, envForConnection } = await at('scripts/host/helper.js');
const { helperClient } = await at('scripts/host/helper-client.js');
const { makeAdapter } = await at('scripts/host/adapter.js');
const { packedArchon, ENGINE_CONFIG } = await at('scripts/host/helper-main.js');
const { workOrder } = await at('scripts/engine/order.js');
const { runCost } = await at('scripts/engine/spend.js');
const { listEvents } = await at('scripts/state/events.js');

const REPO = 'where-is-brett/wheelhouse-merge-trial';
const REMOTE = `https://github.com/${REPO}.git`;
const PROJECT = projectSlug('where-is-brett', 'wheelhouse-merge-trial');
const HOME = process.env.WHEELHOUSE_HOME;
if (!HOME) throw new Error('Give a scratch WHEELHOUSE_HOME');
const FOLDER = path.join(path.dirname(fs.realpathSync(HOME)), 'projects', 'wheelhouse-merge-trial');
const EVIDENCE = path.join(path.dirname(fs.realpathSync(HOME)), 'evidence');
const CEILING = Number(process.argv[process.argv.indexOf('--ceiling') + 1]) || 5;
const WORK = 'card-80';
const GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false'];

const log = (...parts) => {
  const line = `${new Date().toISOString()} ${parts.join(' ')}`;
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.appendFileSync(path.join(EVIDENCE, 'run.log'), `${line}\n`);
  process.stdout.write(`${line}\n`);
};
const must = async (cmd, args, opts = {}) => {
  const got = await run(cmd, args, opts);
  if (got.code !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${got.stderr || got.stdout}`);
  return got.stdout.trim();
};
const git = (...args) => must('git', [...GIT, ...args], { cwd: FOLDER });

// The project as setup leaves it: Archon's project settings, Standard's Claude settings, .wheelhouse/ kept out of git,
// the policy file (there since check 76), a test command; the mirror rule; the registration and the signing key.
async function prepare() {
  if (!fs.existsSync(FOLDER)) {
    fs.mkdirSync(path.dirname(FOLDER), { recursive: true });
    await must('gh', ['repo', 'clone', REPO, FOLDER, '--', '-q']);
  }
  const files = {
    [ARCHON_CONFIG_FILE]: archonConfigText(),
    '.claude/settings.json': `${JSON.stringify(standardProjectSettings(), null, 2)}\n`,
    '.gitignore': '.wheelhouse/\nnode_modules/\n',
    'package.json': `${JSON.stringify({ name: 'wheelhouse-merge-trial', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(FOLDER, rel)), { recursive: true });
    fs.writeFileSync(path.join(FOLDER, rel), text);
  }
  if ((await git('status', '--porcelain')) !== '') {
    await git('add', '-A');
    await git('commit', '-q', '-m', 'Set up Wheelhouse for check 80');
    await git('push', '-q', 'origin', 'HEAD:main');
    log('prepare: the setup commit went up to main');
  }
  // Setup keeps this computer's own settings out of git (EXCLUDE_LINE), in every worktree too.
  const exclude = path.join(FOLDER, '.git', 'info', 'exclude');
  const kept = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  if (!kept.split('\n').includes(EXCLUDE_LINE)) fs.appendFileSync(exclude, `${kept === '' || kept.endsWith('\n') ? '' : '\n'}${EXCLUDE_LINE}\n`);
  const rules = mirrorRulesFile();
  fs.mkdirSync(path.dirname(rules), { recursive: true });
  fs.writeFileSync(rules, `${JSON.stringify({ [PROJECT]: REMOTE }, null, 2)}\n`);
  writeProject(PROJECT, { folder: fs.realpathSync(FOLDER), remoteUrl: REMOTE, host: 'github', repo: REPO, connection: { host: 'github', mode: 'quick', project: REPO } });
  if (readEnrolled().length === 0) enrol({ ...makeSigningKey(), enrolledAt: new Date().toISOString() });
  const trial = await helloTrial({ packDir: path.join(engineDir(), 'pack'), configFile: ENGINE_CONFIG });
  log(`prepare: the hello trial gave ${trial}`);
}

// A stand-in CI: a `ci` success on each open pull request's head that has none.
async function standInCi() {
  const prs = JSON.parse(await must('gh', ['pr', 'list', '-R', REPO, '--state', 'open', '--json', 'number,headRefOid']));
  for (const pr of prs) {
    const statuses = JSON.parse(await must('gh', ['api', `repos/${REPO}/commits/${pr.headRefOid}/statuses`]));
    if (statuses.some((s) => s.context === 'ci')) continue;
    await must('gh', ['api', '-X', 'POST', `repos/${REPO}/statuses/${pr.headRefOid}`, '-f', 'state=success', '-f', 'context=ci', '-f', 'description=check 80 stand-in']);
    log(`ci: success on #${pr.number} at ${pr.headRefOid.slice(0, 7)}`);
  }
}

async function go() {
  const archon = packedArchon();
  const helper = await startHelper({
    address: helperAddress(),
    adapterFor: (project, { env }) => makeAdapter({ host: 'github', repo: REPO, run, env }),
    envFor: envForConnection(() => ({ host: 'github', mode: 'quick', project: REPO }), {}),
    engineFor: (project) => (project === PROJECT ? archon : null),
  });
  const client = helperClient({ address: helper.address });
  const seen = new Set();
  let runId = null;
  let stopped = false;
  const stop = async (why) => {
    if (stopped || !runId) return;
    stopped = true;
    log(`stop: ${why}`);
    log(JSON.stringify(await archon.act(runId, { cancel: { reason: why } })));
  };
  process.on('SIGINT', () => { stop('stopped by hand').finally(() => helper.close().then(() => process.exit(1))); });
  try {
    log('clone', JSON.stringify(await client.state.clone({ project: PROJECT })));
    log('lock', JSON.stringify(await client.lock.take({ project: PROJECT })));
    const order = workOrder({
      work: {
        id: WORK, lane: 'small', level: 2,
        goal: 'Add a subtract(a, b) function to src/add.js and a multiply(a, b) function in a new src/multiply.js, each with its own test under tests/',
        done: [{ command: 'node --test', expect: 0 }],
      },
      config: { testCommand: 'node --test' },
    });
    const started = await helper.engine.start({ project: PROJECT, order });
    log('start', JSON.stringify(started));
    if (!started.ok) return;
    runId = started.runId;
    for (;;) {
      await new Promise((r) => setTimeout(r, 60 * 1000));
      for (const e of listEvents(stateDir(PROJECT), { report: () => {} })) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        log(`record ${e.kind}`, JSON.stringify(e.data).slice(0, 1500));
      }
      const inspect = await archon.inspect(runId);
      const cost = runCost(inspect);
      log(`run ${inspect?.status} ${inspect?.digest ?? ''} $${cost.floorDollars} tokens ${cost.tokens}`);
      fs.writeFileSync(path.join(EVIDENCE, 'inspect.json'), `${JSON.stringify(inspect, null, 2)}\n`);
      if ((cost.floorDollars ?? 0) > CEILING * 0.9) await stop(`spend $${cost.floorDollars} is near the $${CEILING} ceiling`);
      try { await standInCi(); } catch (error) { log(`ci: ${error.message}`); }
      if (inspect?.status === 'ended') break;
      if (inspect?.status === 'paused') log('run paused at an ask: see the records above');
    }
  } finally {
    await helper.close();
  }
}

const phase = process.argv[2];
if (phase === 'prepare') await prepare();
else if (phase === 'run') await go();
else throw new Error('Give prepare or run');
