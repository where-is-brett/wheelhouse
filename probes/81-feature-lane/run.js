// probes/81-feature-lane/run.js
// Check 81: one real two-slice feature run (Archon design, section 7.2; part 4.4's Done) on the throwaway private
// repository where-is-brett/wheelhouse-merge-trial, set up as check 80 left it (its `prepare`: the engine, the mirror
// rule, the registration, the signing key, the hello trial). `seed` writes what the First Mate and the director's
// clicks would: the design with its slices block, committed to `main`, the feature lane put on the engine as a
// confirmed setting, the feature work and the director's approval of the design. `run` starts the real helper, with
// the real GitHub adapter and Archon, and leaves the rest to its own dispatcher: the slices one after the other, the
// merge queue, the feature's own run. This process only watches, and stands in for two things: CI (a `ci` success on
// each open pull request's head and on main's), and the director's switch-on click, which it signs only for the card
// naming the feature's own pull request at its head. Past 90% of the ceiling it sets All stop and cancels every run.
//
//   WH_ROOT=<wheelhouse checkout> WHEELHOUSE_HOME=<short home> node probes/81-feature-lane/run.js <seed|run> [--ceiling 8]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.WH_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (rel) => import(path.join(ROOT, rel));
const { run } = await at('scripts/lib/run.js');
const { engineDir, projectSlug, stateDir, helperAddress } = await at('scripts/lib/paths.js');
const { setStop } = await at('scripts/lib/stop.js');
const { makeEvent, eventPath, confirmationFor, listEvents } = await at('scripts/state/events.js');
const { briefHash } = await at('scripts/feature/files.js');
const { SLICES_FENCE } = await at('scripts/engine/feature.js');
const { startHelper, envForConnection } = await at('scripts/host/helper.js');
const { makeAdapter } = await at('scripts/host/adapter.js');
const { packedArchon } = await at('scripts/host/helper-main.js');
const { runCost } = await at('scripts/engine/spend.js');
const { engineDirOf } = await at('scripts/engine/routes.js');

const REPO = 'where-is-brett/wheelhouse-merge-trial';
const PROJECT = projectSlug('where-is-brett', 'wheelhouse-merge-trial');
const HOME = process.env.WHEELHOUSE_HOME;
if (!HOME) throw new Error('Give a scratch WHEELHOUSE_HOME');
const FOLDER = path.join(path.dirname(fs.realpathSync(HOME)), 'projects', 'wheelhouse-merge-trial');
const EVIDENCE = path.join(path.dirname(fs.realpathSync(HOME)), 'evidence-81');
const CEILING = Number(process.argv[process.argv.indexOf('--ceiling') + 1]) || 8;
const WORK = 'card-81';
const DOC = `docs/designs/${WORK}.md`;
const MOST_MS = 3 * 60 * 60 * 1000;
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
const gh = async (...args) => JSON.parse(await must('gh', args));

// A record in the project's history, signed with this computer's key, as the First Mate or the director's click writes it.
function put(kind, data) {
  const event = makeEvent({ kind, data });
  const file = path.join(stateDir(PROJECT), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
  return event;
}

// The approved design: a greeting with a formal form behind the `formal-greeting` switch, in two slices.
function design() {
  const block = {
    goal: 'The trial project greets people, and can greet them formally once the formal-greeting switch is on',
    flag: { name: 'formal-greeting' },
    demo: 'end',
    slices: [
      {
        title: 'Greet by name',
        goal: 'Add greet(name) in a new src/greet.js: "Hello, <name>!" while the formal-greeting switch is off, and "Good day, <name>." once it is on. The switch is read from config/feature-flags.json each call, and is off when the file or key is missing',
        done: [{ command: 'node --test', expect: 0 }],
        notInScope: ['A farewell'],
      },
      {
        title: 'Say goodbye',
        goal: 'Add farewell(name) to src/greet.js: "Bye, <name>!" while the formal-greeting switch is off, and "Farewell, <name>." once it is on, read the same way as greet',
        done: [{ command: 'node --test', expect: 0 }],
      },
    ],
  };
  return `<!-- ${DOC} -->\n\n# A greeting, with a formal form\n\nThe trial project greets people by name and says goodbye. A formal form of both sits behind the \`formal-greeting\` switch, off until the director switches it on. Each function has its own tests, with the switch off and on.\n\n\`\`\`${SLICES_FENCE}\n${JSON.stringify(block, null, 2)}\n\`\`\`\n`;
}

async function seed() {
  await git('pull', '-q', '--ff-only', 'origin', 'main');
  const text = design();
  fs.mkdirSync(path.dirname(path.join(FOLDER, DOC)), { recursive: true });
  fs.writeFileSync(path.join(FOLDER, DOC), text);
  if ((await git('status', '--porcelain')) !== '') {
    await git('add', DOC);
    await git('commit', '-q', '-m', 'Add the design for check 81');
    await git('push', '-q', 'origin', 'HEAD:main');
    log('seed: the design went up to main');
  }
  const hash = briefHash(text);
  const setting = put('setting', { key: 'engineLanes', value: ['quick', 'small', 'bug', 'feature'] });
  put('confirmation', confirmationFor(setting).data);
  put('work', { id: WORK, title: 'A greeting, with a formal form', lane: 'feature', visible: false, dependsOn: [], doc: { path: DOC, hash } });
  put('action', { action: 'approve-work', question: `Approve ${WORK} (feature lane) as written`, label: 'Approve', work: WORK, lane: 'feature', hash, shownFirst: false });
  log(`seed: the feature work and its approval, design ${hash.slice(0, 12)}`);
}

// A stand-in CI: a `ci` success on main's head and on each open pull request's head that has none.
async function standInCi() {
  const heads = (await gh('pr', 'list', '-R', REPO, '--state', 'open', '--json', 'number,headRefOid')).map((p) => [`#${p.number}`, p.headRefOid]);
  heads.push(['main', (await gh('api', `repos/${REPO}/commits/main`)).sha]);
  for (const [name, sha] of heads) {
    const statuses = await gh('api', `repos/${REPO}/commits/${sha}/statuses`);
    if (statuses.some((s) => s.context === 'ci')) continue;
    await must('gh', ['api', '-X', 'POST', `repos/${REPO}/statuses/${sha}`, '-f', 'state=success', '-f', 'context=ci', '-f', 'description=check 81 stand-in']);
    log(`ci: success on ${name} at ${sha.slice(0, 7)}`);
  }
}

const records = (kind) => listEvents(stateDir(PROJECT), { report: () => {} }).filter((e) => kind === undefined || e.kind === kind);
const ordersDir = () => path.join(engineDirOf(stateDir(PROJECT)), 'orders');
const orderOf = (runId) => { try { return JSON.parse(fs.readFileSync(path.join(ordersDir(), `${runId}.json`), 'utf8')); } catch { return null; } };

async function go() {
  const archon = packedArchon();
  // `--since <time>` carries on a watch begun earlier, counting the spend and records from then.
  const at = process.argv.indexOf('--since');
  const since = at > 0 && process.argv[at + 1] ? new Date(process.argv[at + 1]).toISOString() : new Date().toISOString();
  const helper = await startHelper({
    address: helperAddress(),
    adapterFor: (project, { env }) => makeAdapter({ host: 'github', repo: REPO, run, env }),
    envFor: envForConnection(() => ({ host: 'github', mode: 'quick', project: REPO }), {}),
    engineFor: (project) => (project === PROJECT ? archon : null),
  });
  const seen = new Set();
  const approved = new Set();
  let stopping = false;
  const runsSince = () => {
    const latest = new Map();
    for (const r of records('run')) if (r.at >= since && typeof r.data?.runId === 'string') latest.set(r.data.runId, r.data);
    const file = path.join(engineDirOf(stateDir(PROJECT)), 'dispatch.json');
    let merges = [];
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); merges = [d.mergeRun, ...(d.mergeRuns ?? []).map((m) => m?.runId ?? m)].filter((x) => typeof x === 'string'); } catch { /* none yet */ }
    for (const id of merges) if (!latest.has(id)) latest.set(id, { runId: id, work: 'merge-queue' });
    return latest;
  };
  const stopEverything = async (why) => {
    if (stopping) return;
    stopping = true;
    log(`stop: ${why}`);
    setStop({ by: 'prompt' });
    for (const [id, data] of runsSince()) if (data.state !== 'ended') log(`cancel ${id}`, JSON.stringify(await archon.act(id, { cancel: { reason: why } }).catch((e) => ({ error: e.message }))));
  };
  process.on('SIGINT', () => { stopEverything('stopped by hand').finally(() => helper.close().then(() => process.exit(1))); });
  const until = Date.now() + MOST_MS;
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 60 * 1000));
      for (const e of records()) {
        if (e.at < since || seen.has(e.id)) continue;
        seen.add(e.id);
        log(`record ${e.kind}`, JSON.stringify(e.data).slice(0, 1200));
      }
      // Spend: every run since the start, ended (its cost record) or going (its record now).
      let dollars = 0;
      const lines = [];
      const costs = new Map(records('cost').filter((c) => c.at >= since).map((c) => [c.data.runId, c.data]));
      for (const [id, data] of runsSince()) {
        let cost = costs.get(id);
        if (!cost) { const inspect = await archon.inspect(id).catch(() => null); cost = runCost(inspect); data.state = inspect?.status === 'ended' ? 'ended' : data.state; }
        dollars += cost?.floorDollars ?? cost?.dollars ?? 0;
        const order = orderOf(id);
        lines.push(`${id.slice(0, 8)} ${data.work} ${order?.lane ?? ''}${order?.slice ? ` ${order.slice.n}/${order.slice.of}` : ''} ${data.state ?? ''} pr ${data.pr ?? '-'} $${(cost?.floorDollars ?? cost?.dollars ?? 0).toFixed(3)}`);
      }
      log(`spend $${dollars.toFixed(3)} | ${lines.join(' | ')}`);
      if (dollars > CEILING * 0.9) await stopEverything(`spend $${dollars.toFixed(2)} is near the $${CEILING} ceiling`);
      if (Date.now() > until) await stopEverything('three hours passed');
      try { await standInCi(); } catch (error) { log(`ci: ${error.message}`); }
      // The director's switch-on click: only for the card naming the feature's own pull request at its head.
      // A paused run's records name no pull request yet, so it is read from the helper's own record of what each run opened.
      let opened = {};
      try { opened = JSON.parse(fs.readFileSync(path.join(engineDirOf(stateDir(PROJECT)), 'verdicts.json'), 'utf8')).opened ?? {}; } catch { opened = {}; }
      const finishPrs = Object.entries(opened).filter(([, o]) => orderOf(o?.runId)?.lane === 'feature').map(([pr]) => Number(pr));
      for (const card of records('card')) {
        const pr = finishPrs.find((n) => (card.data.question ?? '').includes(`#${n}`));
        if (!pr || approved.has(card.id)) continue;
        const head = (await gh('pr', 'view', String(pr), '-R', REPO, '--json', 'headRefOid')).headRefOid;
        if (!card.data.question.includes(head.slice(0, 12))) { log(`switch-on card for #${pr} names another head than ${head.slice(0, 12)}`); continue; }
        approved.add(card.id);
        put('approval', { pr, commit: head });
        log(`approve: the switch-on of #${pr} at ${head.slice(0, 12)}`);
      }
      const report = records('report').find((r) => r.data.work === WORK && r.at >= since);
      if (report) { log(`report ${JSON.stringify(report.data)}`); break; }
      if (stopping && [...runsSince().values()].every((d) => d.state === 'ended')) break;
    }
  } finally {
    await helper.close();
  }
}

const phase = process.argv[2];
if (phase === 'seed') await seed();
else if (phase === 'run') await go();
else throw new Error('Give seed or run');
