// probes/74-archon-copilot/lanes.js
// Check 74's real run (Archon design, section 13; the Done of part 4.9): a project on Copilot builds a quick change
// and a small change on real Archon, and the meter's estimate of premium requests is checked against GitHub's own
// figure. On the throwaway private repository where-is-brett/wheelhouse-merge-trial (check 80's), with the engine
// built and Copilot's program and clean home added as setup's step 2 adds them for a Copilot project, into a scratch
// Wheelhouse home. The clean home is signed in from the probes' login home. Every tier is bound to Copilot's Auto
// (the account's only model, check 74). This process watches each run: the records the helper writes, Archon's
// record and GitHub's count of premium requests, and it cancels a run once GitHub's count since `prepare` reaches the
// ceiling. A stand-in CI status (context `ci`) goes on each pull request's head, so no Actions minutes are spent.
//
//   WHEELHOUSE_HOME=<short home> node probes/74-archon-copilot/lanes.js <prepare|quick|small|meter> [--ceiling 13]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.WH_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (rel) => import(path.join(ROOT, rel));
const { run } = await at('scripts/lib/run.js');
const { engineDir, projectSlug, stateDir, helperAddress, computerId } = await at('scripts/lib/paths.js');
const { writeProject } = await at('scripts/lib/projects.js');
const { enrol, makeSigningKey, readEnrolled } = await at('scripts/state/signing.js');
const { engineChanges, applyEngine, mirrorRulesFile } = await at('scripts/setup/engine-parts.js');
const { applyAgentEngine } = await at('scripts/agents/engine-parts.js');
const { writeEngineHome } = await at('scripts/agents/copilot/engine-home.js');
const { EXCLUDE_LINE } = await at('scripts/setup/project-files.js');
const { startHelper, envForConnection } = await at('scripts/host/helper.js');
const { helperClient } = await at('scripts/host/helper-client.js');
const { makeAdapter } = await at('scripts/host/adapter.js');
const { packedArchon } = await at('scripts/host/helper-main.js');
const { workOrder } = await at('scripts/engine/order.js');
const { engineRouting } = await at('scripts/agents/engine-parts.js');
const { runCost } = await at('scripts/engine/spend.js');
const { listEvents } = await at('scripts/state/events.js');
const { readGitHubFigure } = await at('scripts/engine/archon/copilot-meter.js');

const REPO = 'where-is-brett/wheelhouse-merge-trial';
const REMOTE = `https://github.com/${REPO}.git`;
const PROJECT = projectSlug('where-is-brett', 'wheelhouse-merge-trial');
const HOME = process.env.WHEELHOUSE_HOME;
if (!HOME) throw new Error('Give a scratch WHEELHOUSE_HOME');
const FOLDER = path.join(path.dirname(fs.realpathSync(HOME)), 'projects', 'wheelhouse-merge-trial');
const EVIDENCE = path.join(path.dirname(fs.realpathSync(HOME)), 'evidence');
const BASELINE = path.join(EVIDENCE, 'baseline.json');
const LOGIN_HOME = path.join(os.homedir(), '.wheelhouse-probes', 'login-home');
const flag = (name, fallback) => (process.argv.includes(name) ? Number(process.argv[process.argv.indexOf(name) + 1]) : fallback);
const CEILING = flag('--ceiling', 13);
// The run's own estimate at which it is cancelled too, since GitHub's count comes a request or two behind.
const RUN_CEILING = flag('--run-ceiling', Infinity);
const GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false'];
// The project's configuration, this computer's own and kept out of git: Copilot for this computer, Auto every role.
const CONFIG = '.claude/wheelhouse.json';

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
const figure = () => readGitHubFigure({ run });

async function prepare() {
  if (!fs.existsSync(FOLDER)) {
    fs.mkdirSync(path.dirname(FOLDER), { recursive: true });
    await must('gh', ['repo', 'clone', REPO, FOLDER, '--', '-q']);
  }
  await git('fetch', '-q', 'origin');
  await git('checkout', '-q', 'main');
  await git('reset', '-q', '--hard', 'origin/main');
  const config = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], testCommand: 'node --test', agents: { [computerId()]: 'copilot' } };
  fs.mkdirSync(path.join(FOLDER, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(FOLDER, CONFIG), `${JSON.stringify(config, null, 2)}\n`);
  const exclude = path.join(FOLDER, '.git', 'info', 'exclude');
  let kept = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  for (const line of [EXCLUDE_LINE, `/${CONFIG}`]) {
    if (kept.split('\n').includes(line)) continue;
    kept = `${kept}${kept === '' || kept.endsWith('\n') ? '' : '\n'}${line}\n`;
  }
  fs.writeFileSync(exclude, kept);
  const rules = mirrorRulesFile();
  fs.mkdirSync(path.dirname(rules), { recursive: true });
  fs.writeFileSync(rules, `${JSON.stringify({ [PROJECT]: REMOTE }, null, 2)}\n`);
  writeProject(PROJECT, { folder: fs.realpathSync(FOLDER), remoteUrl: REMOTE, host: 'github', repo: REPO, connection: { host: 'github', mode: 'quick', project: REPO } });
  if (readEnrolled().length === 0) enrol({ ...makeSigningKey(), enrolledAt: new Date().toISOString() });
  // Setup's step 2 for a project on Copilot: the engine, Archon's settings, the broker, Copilot's program and its clean
  // home, signed in from the probes' login home.
  const changes = engineChanges({ agent: 'copilot' });
  log('prepare: engine changes', JSON.stringify(changes.map((c) => c.action + (c.part ? `:${c.part}` : ''))));
  const journal = [];
  await applyEngine(changes, {
    record: (c) => journal.push(c), run,
    agentApply: (change, options) => applyAgentEngine(change, { ...options, writeHome: (o) => writeEngineHome({ ...o, signedInFrom: LOGIN_HOME }) }),
  });
  fs.writeFileSync(path.join(EVIDENCE, 'journal.json'), `${JSON.stringify(journal, null, 2)}\n`);
  log('prepare: engine changes left', JSON.stringify(engineChanges({ agent: 'copilot' }).map((c) => c.action)));
  const health = await packedArchon().health();
  log('prepare: health', JSON.stringify(health));
  if (!fs.existsSync(BASELINE)) {
    const base = await figure();
    fs.writeFileSync(BASELINE, `${JSON.stringify({ at: new Date().toISOString(), ...base }, null, 2)}\n`);
    log('prepare: GitHub\'s figure', JSON.stringify(base));
  }
}

// A stand-in CI: a `ci` success on each open pull request's head that has none.
async function standInCi() {
  const prs = JSON.parse(await must('gh', ['pr', 'list', '-R', REPO, '--state', 'open', '--json', 'number,headRefOid']));
  for (const pr of prs) {
    const statuses = JSON.parse(await must('gh', ['api', `repos/${REPO}/commits/${pr.headRefOid}/statuses`]));
    if (statuses.some((s) => s.context === 'ci')) continue;
    await must('gh', ['api', '-X', 'POST', `repos/${REPO}/statuses/${pr.headRefOid}`, '-f', 'state=success', '-f', 'context=ci', '-f', 'description=check 74 stand-in']);
    log(`ci: success on #${pr.number} at ${pr.headRefOid.slice(0, 7)}`);
  }
}

const LANES = {
  quick: { id: 'card-74q', lane: 'quick', level: 1, goal: 'Add a double(n) function to src/add.js that returns n times two, with a test for it under tests/' },
  small: { id: 'card-74s', lane: 'small', level: 2, goal: 'Add a square(n) function in a new src/square.js and a cube(n) function in a new src/cube.js, each with its own test under tests/' },
};

async function go(name) {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
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
    // The routing as the dispatcher gives it (orderFor): the project's own, from its configuration on this computer.
    const config = JSON.parse(fs.readFileSync(path.join(FOLDER, CONFIG), 'utf8'));
    const routing = engineRouting({ config, agent: 'copilot' });
    log('routing', JSON.stringify(routing));
    const order = workOrder({ work: { ...LANES[name], done: [{ command: 'node --test', expect: 0 }] }, config: { testCommand: 'node --test' }, routing });
    const started = await helper.engine.start({ project: PROJECT, order });
    log('start', JSON.stringify(started));
    if (!started.ok) return;
    runId = started.runId;
    for (;;) {
      await new Promise((r) => setTimeout(r, 30 * 1000));
      for (const e of listEvents(stateDir(PROJECT), { report: () => {} })) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        log(`record ${e.kind}`, JSON.stringify(e.data).slice(0, 1500));
      }
      const inspect = await archon.inspect(runId);
      const cost = runCost(inspect);
      const estimate = (inspect?.steps ?? []).reduce((n, s) => n + (Number.isFinite(s.requests) ? s.requests : 0), 0);
      const now = await figure();
      const used = now ? now.used - base.used : null;
      log(`run ${inspect?.status} ${inspect?.outcome ?? ''} estimate ${estimate} github +${used} tokens ${cost.tokens}`);
      fs.writeFileSync(path.join(EVIDENCE, `inspect-${name}.json`), `${JSON.stringify(inspect, null, 2)}\n`);
      if (used !== null && used >= CEILING) await stop(`GitHub counts ${used} premium requests since the start, at the ${CEILING} ceiling`);
      if (estimate >= RUN_CEILING) await stop(`the run's estimate is ${estimate} premium requests, at its ${RUN_CEILING} ceiling`);
      try { await standInCi(); } catch (error) { log(`ci: ${error.message}`); }
      if (inspect?.status === 'ended') break;
      if (inspect?.status === 'paused') log('run paused at an ask: see the records above');
    }
  } finally {
    await helper.close();
  }
}

// The meter as the helper keeps it: the cost records' estimated requests against GitHub's count since `prepare`.
async function meter() {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const costs = listEvents(stateDir(PROJECT), { report: () => {} }).filter((e) => e.kind === 'cost');
  const estimate = costs.reduce((n, e) => n + (Number.isFinite(e.data?.premiumRequests) ? e.data.premiumRequests : 0), 0);
  const now = await figure();
  const archon = packedArchon();
  const kept = { at: base.at, baseline: base.used, estimateAt: 0, resets: base.resets, last: base.used };
  const checked = await archon.checkRequests({ estimate: () => estimate, kept, now: new Date(Date.parse(base.at) + 24 * 60 * 60 * 1000) });
  log('meter', JSON.stringify({ costs: costs.map((e) => e.data), estimate, github: now, since: now ? now.used - base.used : null, checked }));
}

const phase = process.argv[2];
if (phase === 'prepare') await prepare();
else if (phase === 'quick' || phase === 'small') await go(phase);
else if (phase === 'meter') await meter();
else throw new Error('Give prepare, quick, small or meter');
