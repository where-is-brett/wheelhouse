// probes/19-setup-time/rehearsal.js
// Rehearsal of setup (docs/evals/setup-rehearsal-2026-10-27.md): a real Claude Code session takes
// setup through one of three paths on the setup e2e world (a real helper on a scratch socket, a
// stand-in host of bare repositories, stood-in installs). Cards are answered by a permission host
// on stdio, as the director would. Real sessions cost tokens, so it is run on purpose, never by
// `npm test`:
//   REHEARSAL_PATH=new       an empty product folder, the first message a product request
//   REHEARSAL_PATH=underway  a project under way: a feature line, changes not committed
//   REHEARSAL_PATH=parked    a run v0.1.1 parked at step 9 (Later), carried on after the update
//                            (REHEARSAL_V011: an unpacked copy of the v0.1.1 tag)
// REHEARSAL_OUT is the folder for its records; REHEARSAL_PLUGIN the plugin as `claude plugin
// install` left it in a scratch CLAUDE_CONFIG_DIR; REHEARSAL_CLAUDE the real claude, by its full
// path (the world's own stand-in comes first on the PATH); REHEARSAL_KEYS_HOOK the full path of
// rehearsal-keys-hook.js; REHEARSAL_MODEL the model alias (sonnet unless given). Run from a copy
// of the checkout: node --test --test-timeout=10800000 probes/19-setup-time/rehearsal.js
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  standInHost, makeClock, makeComputer, shimTools, shutOutGitConfig, listing, STEPS_MODULE,
} from '../../tests/helpers/setup-e2e.js';
import { g } from '../../tests/helpers/git-fixture.js';
import { tempFolder, testAddress } from '../../tests/helpers/homes.js';
import { SESSION_SETTINGS, EVAL_DENY_COMMANDS, EVAL_DENY_READ, sessionEnv, DENIED_TOOLS, turnAwayScript, turnAwayEntry, TURNED_AWAY } from '../../scripts/eval/harness.js';
import { lockFile } from '../../scripts/watcher/main.js';
import { startHelper, envForConnection } from '../../scripts/host/helper.js';
import { readProject } from '../../scripts/lib/projects.js';
import { runStep } from '../../scripts/setup/run-step.js';
import { RUN_STEP } from '../../scripts/setup/engine.js';
import { findRun } from '../../scripts/setup/journal.js';

process.env.TMPDIR = fs.realpathSync(os.tmpdir());
const OUT = process.env.REHEARSAL_OUT;
const WHICH = process.env.REHEARSAL_PATH ?? 'new';
const MODEL = process.env.REHEARSAL_MODEL ?? 'sonnet';
// The plugin as the install commands left it in the scratch Claude Code folder.
const PLUGIN = process.env.REHEARSAL_PLUGIN;
const V011 = process.env.REHEARSAL_V011;
const KEYS_HOOK = process.env.REHEARSAL_KEYS_HOOK;

const log = (line) => { fs.appendFileSync(path.join(OUT, 'driver.log'), `${new Date().toISOString()} ${line}\n`); };
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const words = (s) => String(s ?? '').split(/\s+/).filter(Boolean).length;

const UNDERWAY_REPO = 'a-director/recipe-box';
const UNDERWAY_FILES = {
  'README.md': '# Recipe Box\n\nRecipe Box keeps a family\'s recipes in one place: add a recipe, scale it for more people, and print a shopping list.\n',
  'CLAUDE.md': '# CLAUDE.md\n\n## Rules\n\n- Use American English in the interface.\n- Keep commits small, one change each.\n- Run `npm test` before every commit.\n',
  '.gitignore': 'node_modules/\n.env\n',
  'package.json': `${JSON.stringify({ name: 'recipe-box', version: '0.3.0', type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
  'src/recipes.js': 'export function scale(recipe, people) {\n  return { ...recipe, serves: people };\n}\n',
};

// The director's card answers, by what the card offers; anything else takes the recommendation.
function choose(q, { parkAtPhone = false } = {}) {
  const labels = (q.options ?? []).map((o) => o.label);
  const has = (l) => labels.includes(l);
  let label = null;
  let why = 'rule';
  if (parkAtPhone && has('Later')) label = 'Later';
  else if (has('Go ahead')) label = 'Go ahead';
  else if (has('Skip for now')) label = 'Skip for now';
  else if (has('Yes, real users')) label = 'Yes, real users';
  else if (has('GitHub') && has('GitLab')) label = 'GitHub';
  else if (has('Locked') && has('Standard')) label = 'Standard';
  else if (has('Quick')) label = 'Quick';
  else if (has('The README\'s words')) label = 'The README\'s words';
  else if (has('No live data')) label = 'No live data';
  else if (has('No') && has('Yes, it signs apps')) label = 'No';
  else if (has('Ready') && has('Later')) label = 'Ready';
  else if (has('It arrived')) label = 'It arrived';
  if (label === null) {
    why = 'recommended';
    const rec = (q.options ?? []).find((o) => /\(Recommended\)|^Recommended/i.test(`${o.label} ${o.description ?? ''}`));
    label = rec ? rec.label : labels[0];
  }
  return { label, why };
}

// A computer whose home and folder another version of the world made: main's helper over them.
function adopt(old, host, clock) {
  const a = { home: old.home, user: old.user, config: old.config, folder: old.folder, calls: old.calls, refused: old.refused, helper: null, watcher: null, children: [] };
  const spawnHere = (file, args) => {
    const handlers = {};
    if (args[0] !== RUN_STEP) throw new Error(`nothing else is started: ${args[0]}`);
    const done = runStep(args.slice(1), { now: clock.now, exit: () => {}, tickMs: 1000 });
    a.children.push(done.then((code) => { handlers.exit?.(code); return code; }));
    return { on: (event, handler) => { handlers[event] = handler; }, unref() {} };
  };
  a.start = async () => {
    a.helper = await startHelper({
      address: testAddress(a.home), adapterFor: async (project) => host.adapter(readProject(project)?.repo ?? ''),
      envFor: envForConnection((project) => readProject(project)?.connection), profileEnvFor: async () => ({ mode: 'quick', env: {} }),
      now: clock.now, run: old.run, fetch: async (url) => { throw new Error(`nothing is fetched: ${url}`); }, setupSteps: STEPS_MODULE, userHome: old.user, spawn: spawnHere,
      onStop: (close) => { a.helper = null; return close(); },
    });
  };
  a.setupRun = async () => findRun(a.folder);
  a.standInWatcher = (project) => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: 'ignore' });
    a.watcher = child;
    fs.mkdirSync(path.dirname(lockFile(project)), { recursive: true });
    fs.writeFileSync(lockFile(project), String(child.pid));
  };
  a.cleanup = async () => {
    while (a.children.length > 0) await Promise.all(a.children.splice(0));
    if (a.helper) await a.helper.close();
    a.watcher?.kill();
  };
  return a;
}

test(`rehearsal: setup, path ${WHICH}, driven by a real session`, { timeout: 3 * 60 * 60 * 1000 }, async () => {
  const gitConfig = shutOutGitConfig();
  const offset = { ms: 0 };
  const clock = { now: () => new Date(Date.now() + offset.ms), tick: (ms = 1000) => { offset.ms += ms; } };
  let shims = null;
  let a;
  let host;
  let slug = null;
  const prep = {};

  if (WHICH === 'parked') {
    // v0.1.1's own world and setup, through step 8, then Later on its phone card.
    const v = await import(pathToFileURL(path.join(V011, 'tests', 'helpers', 'setup-e2e.js')).href);
    host = v.standInHost({ shims: { calls: () => shims?.calls() ?? [] } });
    shims = shimTools();
    host.shims = shims;
    const old = v.makeComputer(host, clock, { name: 'Tides' });
    process.env.WHEELHOUSE_HOME = old.home;
    process.env.CLAUDE_CONFIG_DIR = old.config;
    await old.start();
    await old.sessionStart();
    const parked = [];
    await v.follow(old, { through: 8, answer: (id, plan) => { const { label } = choose(plan.ask.card); parked.push([plan.step, id, label]); return label; } });
    const resumed = await old.cli('resume');
    if (resumed.plan?.step !== 9 || !resumed.plan.ask) throw new Error(`v0.1.1 did not reach the phone card: ${JSON.stringify(resumed.plan).slice(0, 300)}`);
    await old.click(resumed.plan.ask.card, 'Later');
    parked.push([9, resumed.plan.ask.id, 'Later']);
    prep.parked = { cards: parked, run: await old.setupRun(), resume: await old.cliTry('resume') };
    await old.stop();
    a = adopt(old, host, clock);
    slug = Object.keys(listing(path.join(old.home, 'projects'))).find((k) => !k.includes('/')) ?? null;
    log(`v0.1.1 parked: ${JSON.stringify(parked)}`);
  } else {
    host = standInHost({ shims: { calls: () => shims?.calls() ?? [] } });
    if (WHICH === 'underway') {
      await host.seed(UNDERWAY_REPO, UNDERWAY_FILES);
      shims = shimTools({ answer: { gh: [{ args: ['repo', 'view'], stdout: `${JSON.stringify({ defaultBranchRef: { name: 'main' } })}\n` }, { args: ['pr', 'list'], stdout: '[]\n' }] } });
    } else shims = shimTools();
    host.shims = shims;
    a = makeComputer(host, clock, { name: WHICH === 'underway' ? 'recipe-box' : 'Tides' });
    if (WHICH === 'underway') {
      await g(a.folder, 'init', '-q', '-b', 'main');
      await g(a.folder, 'remote', 'add', 'origin', host.url({ repo: UNDERWAY_REPO }));
      await g(a.folder, 'fetch', '-q', 'origin');
      await g(a.folder, 'reset', '-q', '--hard', 'origin/main');
      await g(a.folder, 'branch', '-q', '--set-upstream-to=origin/main', 'main');
      await g(a.folder, 'remote', 'set-url', 'origin', `https://github.com/${UNDERWAY_REPO}.git`);
      await g(a.folder, 'checkout', '-q', '-b', 'ingredient-units');
      fs.writeFileSync(path.join(a.folder, 'src', 'units.js'), "export const UNITS = ['g', 'kg', 'cup'];\n");
      await g(a.folder, 'add', '-A');
      await g(a.folder, 'commit', '-q', '-m', 'Start ingredient units');
      fs.appendFileSync(path.join(a.folder, 'src', 'recipes.js'), '\n// TODO: convert units when scaling\n');
      fs.writeFileSync(path.join(a.folder, 'notes.md'), '# Notes\n\nUnits: ask about cups vs grams.\n');
      // The install commands' lines in the project's own settings (`.claude/settings.json` is new here).
      prep.before = { status: await g(a.folder, 'status', '--porcelain', '-b') };
    }
    process.env.WHEELHOUSE_HOME = a.home;
    process.env.CLAUDE_CONFIG_DIR = a.config;
  }
  await a.start();
  const watch = setInterval(() => {
    const projects = path.join(a.home, 'projects');
    let names = [];
    try { names = fs.readdirSync(projects); } catch { /* none yet */ }
    if (a.watcher === null && names.length > 0) { slug = names[0]; a.standInWatcher(slug); log(`watcher stood in for ${slug}`); }
  }, 500);
  log(`world ready (${WHICH}): folder ${a.folder} home ${a.home}`);

  // The session's settings: no sandbox yet, reads of the director's own places denied, the phone push turned away.
  const pushHook = path.join(tempFolder('wh-push-'), 'push.js');
  fs.writeFileSync(pushHook, turnAwayScript(TURNED_AWAY.PushNotification));
  const settings = { ...SESSION_SETTINGS, permissions: { deny: [...SESSION_SETTINGS.permissions.deny, ...EVAL_DENY_COMMANDS, ...EVAL_DENY_READ.filter((p) => !p.includes('scratchpad')).map((p) => `Read(${p.startsWith('~') ? p : `/${p}`}/**)`)] } };
  settings.sandbox = { filesystem: { denyRead: ['~/.wheelhouse'] } };
  settings.hooks = { PreToolUse: [turnAwayEntry('PushNotification', pushHook), { matcher: 'Bash', hooks: [{ type: 'command', command: `node "${KEYS_HOOK}"` }] }] };
  const sFile = path.join(tempFolder('wh-settings-'), 'settings.json');
  fs.writeFileSync(sFile, JSON.stringify(settings, null, 2));

  const env = { ...sessionEnv(), WHEELHOUSE_HOME: a.home };
  delete env.CLAUDE_CONFIG_DIR;
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  const sessionShims = tempFolder('wh-session-shims-');
  for (const name of fs.readdirSync(shims.dir)) {
    if (name !== 'security') fs.symlinkSync(path.join(shims.dir, name), path.join(sessionShims, name));
  }
  env.PATH = env.PATH.split(path.delimiter).map((p) => (p === shims.dir ? sessionShims : p)).join(path.delimiter);
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'default', '--permission-prompt-tool', 'stdio', '--max-turns', '300',
    '--setting-sources', 'project,local', '--strict-mcp-config', '--settings', sFile,
    '--disallowedTools', DENIED_TOOLS.filter((t) => t !== 'PushNotification').join(','),
    '--plugin-dir', PLUGIN, '--model', MODEL];
  const child = spawn(process.env.REHEARSAL_CLAUDE ?? 'claude', args, { cwd: a.folder, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const t0 = Date.now();
  const sessionStartedAt = new Date(t0).toISOString();
  const events = fs.createWriteStream(path.join(OUT, 'events.jsonl'));
  const results = [];
  const cards = [];
  const marks = [];
  let buffered = '';
  let exited = false;
  const prompts = [];
  child.stdout.on('data', (chunk) => {
    buffered += chunk.toString('utf8');
    let nl;
    while ((nl = buffered.indexOf('\n')) >= 0) {
      const lineText = buffered.slice(0, nl);
      buffered = buffered.slice(nl + 1);
      let event;
      try { event = JSON.parse(lineText); } catch { continue; }
      const t = Date.now() - t0;
      events.write(`${JSON.stringify({ t, ...event })}\n`);
      if (event.type === 'result') results.push(event);
      if (event.type === 'user') {
        for (const b of event.message?.content ?? []) {
          const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
          if (b.type === 'tool_result' && /"briefing"\s*:/.test(text)) marks.push({ t, what: 'briefing given to the session' });
        }
      }
      if (event.type === 'assistant') {
        for (const b of event.message?.content ?? []) {
          if (b.type === 'tool_use' && b.name === 'Skill') marks.push({ t, what: `skill ${b.input?.skill}` });
          if (b.type === 'tool_use' && b.name === 'Bash') marks.push({ t, what: `bash ${String(b.input?.command ?? '').replace(/^.*cli\.js"?/, 'cli.js').slice(0, 90)}` });
        }
      }
      if (event.type === 'control_request' && event.request?.subtype === 'can_use_tool') {
        const input = event.request.input ?? {};
        let updatedInput = input;
        const tool = event.request.tool_name;
        if (tool === 'AskUserQuestion') {
          const answers = {};
          for (const q of input.questions ?? []) {
            const { label, why } = choose(q);
            answers[q.question] = label;
            const w = words(q.question) + (q.options ?? []).reduce((n, o) => n + words(o.label) + words(o.description), 0) + words(q.header);
            cards.push({ t, header: q.header, question: q.question, options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description })), answered: label, why, words: w, together: (input.questions ?? []).length });
            log(`CARD t=${Math.round(t / 1000)}s [${why}] ${JSON.stringify(q.header)} -> ${label} (${w} words) :: ${String(q.question).split('\n')[0].slice(0, 160)}`);
          }
          updatedInput = { ...input, answers };
        } else if (tool === 'Bash' && !String(input.command ?? '').includes(PLUGIN)) {
          log(`REFUSED Bash ${JSON.stringify(input).slice(0, 300)}`);
          prompts.push({ t, tool, input, refused: true });
          child.stdin.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: event.request_id, response: { behavior: 'deny', message: 'The director declined this command.' } } })}\n`);
          continue;
        } else {
          prompts.push({ t, tool, input });
          log(`PERMISSION ${tool} ${JSON.stringify(input).slice(0, 200)}`);
        }
        child.stdin.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: event.request_id, response: { behavior: 'allow', updatedInput } } })}\n`);
      }
    }
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000); });
  child.on('close', () => { exited = true; });
  child.stdin.on('error', () => {});

  const turnEnded = (last, how) => log(`TURN END${how} t=${Math.round((Date.now() - t0) / 1000)}s ${last ? `${last.subtype} turns=${last.num_turns} cost=${last.total_cost_usd}` : 'none'} :: ${String(last?.result ?? '').slice(0, 900).replace(/\n/g, ' | ')}`);
  const send = async (text, ms = 60 * 60 * 1000) => {
    const before = results.length;
    log(`DIRECTOR says t=${Math.round((Date.now() - t0) / 1000)}s: ${text}`);
    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })}\n`);
    const end = Date.now() + ms;
    while (results.length === before && !exited && Date.now() < end) await sleep(500);
    turnEnded(results.at(-1), '');
  };
  const finished = async () => {
    const run = await a.setupRun();
    const phone = run?.steps?.[9];
    return typeof run?.steps?.[10]?.doneAt === 'string' && (typeof phone?.doneAt === 'string' || typeof phone?.skippedAt === 'string' || JSON.stringify(phone ?? {}).includes('skip'));
  };

  const opening = {
    new: 'I want to build a tool that helps the fishers in my town plan their trips around the tides: a simple page showing this week\'s tide times for our harbour, and a warning when the bar crossing is unsafe. Can you look into what exists already and get started?',
    underway: 'Set up Wheelhouse for this project.',
    parked: 'Carry on with setup.',
  }[WHICH];
  const replies = (process.env.REHEARSAL_REPLIES ?? 'Yes, carry on.|Carry on with setup.|Carry on.').split('|');
  try {
    await send(opening);
    for (const reply of [...replies, null]) {
      if (exited) break;
      for (;;) {
        const before = results.length;
        const end = Date.now() + 240 * 1000;
        while (results.length === before && !exited && Date.now() < end) await sleep(500);
        if (results.length === before) break;
        turnEnded(results.at(-1), ' (by itself)');
      }
      if (exited || reply === null) break;
      if (await finished()) {
        // One more turn after setup's end, so the request's hand-over shows.
        if (WHICH === 'new' && !marks.some((m) => m.what === 'skill wheelhouse:front-desk')) await send('Thanks. What happens with my tide tool now?');
        break;
      }
      await send(reply);
    }
  } finally {
    child.stdin.end();
    const killer = setTimeout(() => child.kill('SIGKILL'), 60000);
    while (!exited) await sleep(500);
    clearTimeout(killer);
    events.end();
    const run = await a.setupRun();
    fs.writeFileSync(path.join(OUT, 'stderr.txt'), stderr);
    fs.writeFileSync(path.join(OUT, 'cards.json'), JSON.stringify(cards, null, 2));
    fs.writeFileSync(path.join(OUT, 'after.json'), JSON.stringify({
      which: WHICH, sessionStartedAt, wall: Date.now() - t0, marks, prompts, prep, run,
      status: await g(a.folder, 'status', '--porcelain', '-b').catch(() => null),
      calls: a.calls, refused: a.refused, shimCalls: shims.calls(), pulls: host.pulls(),
    }, null, 2));
    log('done');
    clearInterval(watch);
    await a.cleanup();
    shims.restore?.();
    gitConfig.restore();
  }
});
