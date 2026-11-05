// tests/helpers/director-world.js
// The world the director-path tests play in (tests/e2e/director-paths.test.js): a project in git alone with a terminal
// surface and no pane, built on the engine scenarios' world (scripts/eval/engine-world.js): the real helper on its
// socket, the fake engine, a real folder, a home and the engine's mirror. Over it, the real commands that the agents
// and the director's side run, each reached the way a session reaches it:
//   - `desk(argv, input)`: the front desk's command (scripts/frontdesk/cli.js), run in the sandbox stand-in, so a
//     file call into the Wheelhouse home fails the test;
//   - `press(card, label)`: the director's click on a card, through the card check and the prompt record, the hooks a
//     click goes through in a terminal, which sign it with this computer's key;
//   - `watch()`: one observation of the watcher, its waker in Shape 2, which starts nothing and prints its wakes;
//   - `tick()`: the helper's dispatcher and card router, one tick;
//   - `terminalTick()`: the mod's tick for a terminal session, which is how the courier wakes the front desk.
// An agent's decisions (the front desk recording work, the foreman acting) are the same commands their sessions run,
// called here by the script; the fake engine stands in for the model that would build.
import fs from 'node:fs';
import path from 'node:path';
import { openWorld, PROJECT } from '../../scripts/eval/engine-world.js';
import { helperClient } from '../../scripts/host/helper-client.js';
import { helperAddress, stateDir } from '../../scripts/lib/paths.js';
import { main as cli } from '../../scripts/frontdesk/cli.js';
import { decide as cardCheck } from '../../scripts/hooks/card-check.js';
import { decide as promptRecord } from '../../scripts/hooks/prompt-record.js';
import { handle as bridge } from '../../scripts/mod/bridge.js';
import { runWatcher, projectConfig, lockFile } from '../../scripts/watcher/main.js';
import { makeWaker } from '../../scripts/watcher/waker.js';
import { readHandled } from '../../scripts/watcher/handled.js';
import { BUNDLE_MS } from '../../scripts/lib/build-loop.js';
import { loadRecordings } from '../../scripts/engine/fake.js';
import { listEvents } from '../../scripts/state/events.js';
import { sandboxed } from './sandbox-wall.js';
import { tempFolder } from './homes.js';

import { homeDir } from '../../scripts/host/local/home.js';
import { run } from '../../scripts/lib/run.js';
import { main as doneCheck } from '../../scripts/engine/done-check.js';
import { main as protectedCheck } from '../../scripts/engine/protected-check.js';
import { main as controlCheck } from '../../scripts/engine/control-check.js';
import { withTicket } from '../../scripts/engine/ticket.js';
import { until as waitUntil } from './until.js';

export { PROJECT };
const WHO = ['-c', 'user.name=Builder', '-c', 'user.email=builder@example.invalid'];
const REVIEW_CLEAN = JSON.stringify({ verdict: 'CLEAN', findings: [], summary: 'Read it.', blocked: false, assumptions: [] });
const untilTrue = (check, what) => waitUntil(check, { what, within: 30000 });
// Git in `cwd`: its trimmed output, or '' on a failure when `quiet`.
export async function git(args, cwd, quiet = false) {
  const got = await run('git', args, { cwd });
  if (got.code !== 0 && !quiet) throw new Error(`git ${args.join(' ')} failed: ${got.stderr}`);
  return got.code === 0 ? got.stdout.trim() : '';
}
export const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures', 'engine');
// A folder that is never created, so no managed copy of the hooks is found.
const NO_MANAGED = path.join(tempFolder('wh-no-managed-'), 'absent');
const SECOND = 1000;

// The fake engine's recordings by name: 'quick-lane', 'small-lane' and the others of tests/fixtures/engine.
export const recordingsNamed = (...names) => {
  const all = loadRecordings(FIXTURES);
  return Object.fromEntries(names.map((name) => [name, all[name]]));
};

// openDirectorWorld({ recordings, says, lanes }) -> the world, with a terminal session ('desk-session') for the front desk.
// `lanes` are the lanes the project has put on the engine, as its confirmed setting; the quick lane alone by default.
export async function openDirectorWorld({ recordings = {}, says, lanes = ['quick', 'small'], adapt } = {}) {
  const clock = { base: Date.parse('2026-11-05T09:00:00.000Z'), from: Date.now() };
  const now = () => new Date(clock.base + (Date.now() - clock.from));
  const world = await openWorld({ place: 'git-alone', recordings, now, ...(says ? { says } : {}), ...(adapt ? { adapt } : {}) });
  const client = helperClient({ address: helperAddress({ home: world.home }) });
  const walls = [...new Set([path.resolve(world.home), fs.realpathSync.native(world.home)])];
  const lines = [];
  const session = { id: 'desk-session', said: [] };
  Object.assign(world, {
    client, lines, session, now, recordings,
    // Every line given to the director so far (the commands' output, the card text, the wakes), and the document hashes recorded.
    told: [], hashes: {},
    // The project's home repository, where the main version is kept (`home` is the Wheelhouse home folder).
    gitHome: homeDir(PROJECT),
    // Moves the world's clock on by `ms`.
    at(ms) { clock.base += ms; },
    // The front desk's command, run as a sandboxed command is: resolves { code, out, err, json }.
    async desk(argv, input) {
      const said = { out: '', err: '' };
      const code = await sandboxed(walls, () => cli(argv, {
        cwd: world.folder, client, now, env: { CLAUDE_CODE_SESSION_ID: session.id },
        ...(input === undefined ? { input: '' } : { input: JSON.stringify(input) }),
        out: (t) => { said.out += t; }, err: (t) => { said.err += t; },
      }));
      let json;
      try { json = JSON.parse(said.out); } catch { json = undefined; }
      world.told.push(said.out, said.err);
      return { code, out: said.out, err: said.err, json };
    },
    // The director's click on `question` (a card as the chat is given it), through the hooks a click goes through.
    async press(question, label) {
      const call = { session_id: session.id, cwd: world.folder, permission_mode: 'default', tool_name: 'AskUserQuestion' };
      const problem = await cardCheck({ ...call, hook_event_name: 'PreToolUse', tool_input: { questions: [question] } }, { dir: NO_MANAGED, now });
      if (problem !== undefined) throw new Error(`the card check stopped the card: ${JSON.stringify(problem)}`);
      await promptRecord({
        ...call, hook_event_name: 'PostToolUse', tool_use_id: `toolu_${Math.random().toString(36).slice(2)}`,
        tool_input: { questions: [question], answers: { [question.question]: label } },
        tool_response: { questions: [question], answers: { [question.question]: label } },
      }, { client, now, dir: NO_MANAGED });
    },
    // One observation of the watcher, as the process runs it: what it saw, then a minute's wait for the bundle, then what
    // was gathered goes out. Resolves with the wake lines the waker printed (Shape 2 prints; it starts nothing).
    async watch() {
      const from = lines.length;
      const read = await projectConfig(PROJECT, client);
      if (read.config === null) throw new Error(`no configuration for the watcher: ${read.why}`);
      const config = { ...read.config, watcherShape: 2 };
      const waker = makeWaker({ shape: 2, project: PROJECT, config, print: (line) => lines.push(line), now });
      const result = await runWatcher({
        project: PROJECT, client, config, waker, now,
        sleep: async () => { clock.base += BUNDLE_MS + SECOND; },
        intervals: { state: 0, features: 0, prs: 0, testMerge: 0 },
        loops: 2, handled: () => readHandled(PROJECT), log: () => {},
      });
      if (result.started !== true) throw new Error(`the watcher did not start (${JSON.stringify(result)}, lock ${fs.existsSync(lockFile(PROJECT)) ? fs.readFileSync(lockFile(PROJECT), 'utf8').trim() : 'none'} mine ${process.pid})`);
      return lines.slice(from);
    },
    // The mod's tick for a terminal session in the project's folder: { submit, woken } when the courier wakes the front desk.
    async terminalTick(extra = {}) {
      const got = await bridge({ cmd: 'tick', session: session.id, cwd: world.folder, idle: true, surface: 'terminal', ...extra }, {
        now,
        // The tick starts a watcher process of its own when none runs; this world's watcher is the one `watch` runs.
        watchTick: async () => ({ watcher: 'running', submit: [] }),
      });
      world.told.push(...(got.submit ?? []), got.status ?? '', got.pane?.verdict ?? '', ...(got.pane?.cards ?? []).map((c) => c.text));
      return got;
    },
    // The fake build of a run the dispatcher started for `work`: its change committed in a worktree (the line `add` added
    // to README.md, which the project's own test reads), the run's three guard checks run as the pack runs them against
    // the helper (done, protected, and control), the pull request opened through the helper, and the reviews signed CLEAN.
    // With `ready: false` it stops before the change is marked ready. Resolves { runId, pr, head, worktree }.
    // The branch and worktree of `work`'s change with its one commit, made apart from any run: { worktree, head }. A scenario
    // whose recorded run asks about the change names its head in the recording, so the commit is made first.
    async branchFor(work, { add = 'A line the work added.', text = null, files = null, branch = `wh/${work}` } = {}) {
      const worktree = path.join(world.folder, '.wheelhouse', 'worktrees', branch.replaceAll('/', '-'));
      const exists = (await git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`], world.folder, true)) !== '';
      // A run's worktree is made from the main version the helper holds, not from where the folder's own branch is.
      if (!exists) await git(['fetch', '-q', world.gitHome, 'refs/heads/main'], world.folder);
      if (!fs.existsSync(worktree)) await git(exists ? ['worktree', 'add', '-q', worktree, branch] : ['worktree', 'add', '-q', '-b', branch, worktree, 'FETCH_HEAD'], world.folder);
      if (!exists) {
        if (files !== null) {
          for (const [name, body] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(worktree, name)), { recursive: true });
            fs.writeFileSync(path.join(worktree, name), body);
          }
          await git(['add', '-A'], worktree);
        } else if (text === null) fs.appendFileSync(path.join(worktree, 'README.md'), `\n${add}\n`);
        else fs.writeFileSync(path.join(worktree, 'README.md'), text);
        await git([...WHO, 'commit', '-q', '-am', 'The work'], worktree);
      }
      return { worktree, head: await git(['rev-parse', 'HEAD'], worktree) };
    },
    async build(work, { add, text, files, ready = true, branch } = {}) {
      const runId = await untilTrue(() => world.engine.liveRunOf({ work })?.runId, `a run of ${work}`);
      const art = world.engine.artefactsOf(runId);
      const { worktree, head } = await world.branchFor(work, { ...(add ? { add } : {}), ...(text ? { text } : {}), ...(files ? { files } : {}), ...(branch ? { branch } : {}) });
      const said = [];
      const out = (line) => said.push(line);
      const args = ['--run', runId, '--artefacts', art];
      const checks = {
        done: await doneCheck(args, { client, cwd: worktree, out }),
        protected: await protectedCheck([...args, '--base', 'main', '--json'], { client, cwd: worktree, out }),
        control: await controlCheck([...args, '--base', 'main', '--json'], { client, cwd: worktree, out }),
      };
      const ticketed = withTicket(client, ['--artefacts', art]);
      world.engine.setOutput(runId, 'lenses', JSON.stringify({ security: false, design: false, head, clean: true }));
      for (const step of ['review-standards', 'review-spec']) world.engine.setOutput(runId, step, REVIEW_CLEAN);
      const opened = await ticketed.engine.openPr({ runId, cwd: worktree, title: `The work ${work}`, body: 'A change.' });
      if (opened?.ok !== true) throw new Error(`the pull request wasn't opened: ${opened?.refused}`);
      world.engine.setOutput(runId, 'open-pr', JSON.stringify({ branch: opened.branch, pr: opened.pr, head }));
      for (const step of ['review-standards', 'review-spec']) {
        const signed = await ticketed.engine.review({ runId, step });
        if (signed?.ok !== true) throw new Error(`${step} wasn't signed: ${signed?.refused}`);
      }
      const made = { runId, pr: opened.pr, head, worktree, art, checks, said, ticketed };
      if (ready) {
        const marked = await ticketed.engine.ready({ runId });
        if (marked?.ok !== true) throw new Error(`the change wasn't marked ready: ${marked?.refused}`);
      }
      return made;
    },
    // Ticks until `found` gives something.
    tickUntil: (found, what) => untilTrue(async () => { await world.tick(); return found(); }, what),
    eventsOf: (kind) => listEvents(stateDir(PROJECT), { report: () => {} }).filter((e) => e.kind === kind),
    // A document the work names, in the folder's `.wheelhouse/work/`, which git leaves out.
    writeDoc(id, text = `The brief for ${id}.\n`) {
      const file = path.join(world.folder, '.wheelhouse', 'work', `${id}.md`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return `.wheelhouse/work/${id}.md`;
    },
  });
  if (lanes.length > 0 && !(lanes.length === 1 && lanes[0] === 'quick')) {
    // The project's own setting, as confirmed when the lanes were put on the engine (not a click this scenario guards).
    const { confirmationFor } = await import('../../scripts/state/events.js');
    const setting = world.put('setting', { key: 'engineLanes', value: lanes });
    world.put('confirmation', confirmationFor(setting).data);
  }
  return world;
}

// Runs `fn` with a director's world and closes it afterwards.
export async function inDirectorWorld(options, fn) {
  const world = await openDirectorWorld(options);
  try {
    return await fn(world);
  } finally {
    await world.close();
  }
}
