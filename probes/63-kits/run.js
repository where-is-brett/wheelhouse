// probes/63-kits/run.js
// Check 63: do the pinned kits (Superpowers and Matt Pocock's skills) run under Copilot with the Wheelhouse override first?
// The probe fetches each kit at its pinned commit (lineage/manifest.json; the same shallow fetch lineage uses), checks the
// copies against the manifest's fingerprints, and copies the skills Wheelhouse uses into a scratch Copilot home's skills/
// folder (the place Copilot reads personal skills from; `copilot skill list` is run to show what it sees). Then six model
// runs, each a fresh headless Copilot in its own scratch project (a 20-line Node.js script, package.json, one test), each
// with the override (templates/brief/override.md) first in the prompt, then the toy brief, then the stage:
//   brainstorm-to-plan  brainstorming, then wherever it hands off to, stopping when a plan is written (nothing is built)
//   writing-plans       writing-plans alone, from a hand-made spec file
//   subagent-driven     subagent-driven-development alone, from a hand-made plan (the likely break: dispatching subagents)
//   executing-plans     executing-plans alone, from the same plan
//   tdd-superpowers     test-driven-development
//   tdd-matt            Matt Pocock's tdd
// Every run uses --allow-all-tools --no-ask-user, in its scratch project. --disallow-temp-dir is NOT used: the home that
// holds the skills (and their companion prompt files) is under the temporary folder, so shutting the folder off would
// stop a skill reading its own files. Judged from Copilot's own tool events (name, success, failure code), with the
// skill hand-offs read from the skill tool's calls and from views of SKILL.md files; the debug log of each run is kept.
//
// Usage: node probes/63-kits/run.js              the full run, from outside any sandbox (needs network to GitHub)
//        node probes/63-kits/run.js --dry-run    the same plumbing against a stand-in Copilot and stand-in kits
// Options: --bin <path>, --timeout-ms <n> (one run, default 900000; subagent-driven gets double), --only <id,id>,
//          --results-dir <dir>
//
// Model runs: 6. Everything it makes is under the temporary folder and is removed when it ends (also on Ctrl-C), except
// the debug logs, copied into <results-dir>/63-kits.logs/. It never reads or writes the real ~/.copilot or ~/.wheelhouse.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LOGIN_HOME, copilotBin, defaultPrefix, runCopilot, scratchCopilotHome } from '../lib/copilot.js';
import { assertUnderTmp, makeScratchProject } from '../lib/scratch.js';
import { authFailed, copilotArgs, describeEnv, listFiles, offeredTools, replyOf, sessionIdOf, toolCalls } from '../61-sessions/run.js';
import { fingerprintTree } from '../../scripts/lineage/fingerprint.js';
import { fetchUpstream, readManifest } from '../../scripts/lineage/manifest.js';

export const CHECK = '63-kits';
const FAKE = fileURLToPath(new URL('./fake-copilot.js', import.meta.url));
const REPO = fileURLToPath(new URL('../..', import.meta.url));
export const ID_ORDER = ['brainstorm-to-plan', 'writing-plans', 'subagent-driven', 'executing-plans', 'tdd-superpowers', 'tdd-matt'];

// ------------------------------------------------------------------ options

export function parseOptions(argv) {
  const options = { dryRun: false, bin: '', timeoutMs: 900_000, only: null, resultsDir: path.join(os.tmpdir(), 'wheelhouse-probe-results') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--bin') options.bin = argv[++i] ?? '';
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
    else if (arg === '--only') options.only = String(argv[++i] ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    else if (arg === '--results-dir') options.resultsDir = argv[++i] ?? '';
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('--timeout-ms is a number of milliseconds');
  if (!options.resultsDir) throw new Error('--results-dir needs a folder');
  if (options.only) {
    const unknown = options.only.filter((id) => !ID_ORDER.includes(id));
    if (unknown.length) throw new Error(`--only names no such run: ${unknown.join(', ')}`);
  }
  return options;
}

export const selectRuns = (only) => (only ? ID_ORDER.filter((id) => only.includes(id)) : [...ID_ORDER]);

// ------------------------------------------------------------- the toy project

export const TOY_SCRIPT = `#!/usr/bin/env node
// greet.js
// Prints a greeting for each name given, or for the world when none is given.
const names = process.argv.slice(2);

export function greeting(name) {
  return \`Hello, \${name}!\`;
}

export function run(args) {
  const list = args.length > 0 ? args : ['world'];
  return list.map(greeting).join('\\n');
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  console.log(run(names));
}
`;
export const TOY_PACKAGE = JSON.stringify({ name: 'toy-greet', version: '1.2.3', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n';
export const TOY_TEST = `// greet.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greeting, run } from './greet.js';

test('greets by name', () => assert.equal(greeting('Sam'), 'Hello, Sam!'));
test('greets the world when no name is given', () => assert.equal(run([]), 'Hello, world!'));
`;

export const BRIEF = 'The brief: add a `--version` flag to greet.js, a 20-line Node.js script in this folder. `node greet.js --version` should print the version from package.json and exit, instead of greeting. Keep the existing tests passing and add a test for the new flag.';

export const FIXTURE_SPEC = `# --version flag for greet.js

greet.js prints a greeting for each name given. Add a \`--version\` flag.

- \`node greet.js --version\` prints the "version" field of package.json (one line, nothing else) and exits with code 0.
- Without the flag nothing changes.
- greet.test.js gains a test for the flag; \`npm test\` passes.
`;
export const FIXTURE_PLAN = `# --version flag Implementation Plan

**Goal:** \`node greet.js --version\` prints package.json's version and exits.
**Tech stack:** Node.js (ESM), node:test. Run tests with \`npm test\`.

### Task 1: Read the version
**Files:** Modify \`greet.js\`; Modify \`greet.test.js\`
- [ ] Step 1: Add a failing test in greet.test.js: a \`version()\` function exported from greet.js returns the "version" field of package.json.
- [ ] Step 2: Run \`npm test\`; the new test fails.
- [ ] Step 3: Add and export \`version()\` to greet.js (read package.json next to the script). Run \`npm test\`; it passes.
- [ ] Step 4: Commit.

### Task 2: Wire the flag
**Files:** Modify \`greet.js\`; Modify \`greet.test.js\`
- [ ] Step 1: Add a failing test that running \`node greet.js --version\` prints the version and nothing else.
- [ ] Step 2: Make the script print \`version()\` and stop when \`--version\` is the first argument.
- [ ] Step 3: Run \`npm test\`; all pass. Commit.
`;

const toyFiles = (extra = {}) => ({ 'greet.js': TOY_SCRIPT, 'package.json': TOY_PACKAGE, 'greet.test.js': TOY_TEST, ...extra });

// ----------------------------------------------------------------- the override

// The override's text without its path comment, as the prompt starts with it.
export function overrideText(root = REPO) {
  const text = fs.readFileSync(path.join(root, 'templates', 'brief', 'override.md'), 'utf8');
  return text.replace(/^<!--[^\n]*-->\s*\n/, '').trim();
}

const NOBODY = 'Nobody is reading this session: do not wait for an answer in chat. Where a skill would ask a question, choose the option it recommends and write the choice down. Work only in the current folder; do not push, open a pull request or reach any network.';

const STAGES = {
  'brainstorm-to-plan': {
    skill: 'brainstorming',
    prompt: `${BRIEF}\n\nStart with the brainstorming skill and follow it, and then each skill it hands off to, until an implementation plan is written to a file. Stop there: do not build anything.`,
  },
  'writing-plans': {
    skill: 'writing-plans',
    prompt: `${BRIEF}\n\nThe approved spec is docs/superpowers/specs/version-flag.md. Use the writing-plans skill to write the implementation plan from it. Stop when the plan is written: do not build anything.`,
    files: { 'docs/superpowers/specs/version-flag.md': FIXTURE_SPEC },
  },
  'subagent-driven': {
    skill: 'subagent-driven-development',
    prompt: `${BRIEF}\n\nThe approved plan is docs/superpowers/plans/version-flag.md. Use the subagent-driven-development skill to carry it out, task by task, as that skill describes.`,
    files: { 'docs/superpowers/plans/version-flag.md': FIXTURE_PLAN },
    timeoutFactor: 2,
  },
  'executing-plans': {
    skill: 'executing-plans',
    prompt: `${BRIEF}\n\nThe approved plan is docs/superpowers/plans/version-flag.md. Use the executing-plans skill to carry it out in this session.`,
    files: { 'docs/superpowers/plans/version-flag.md': FIXTURE_PLAN },
  },
  'tdd-superpowers': {
    skill: 'test-driven-development',
    prompt: `${BRIEF}\n\nUse the test-driven-development skill to build it.`,
  },
  'tdd-matt': {
    skill: 'tdd',
    prompt: `${BRIEF}\n\nUse the tdd skill to build it.`,
  },
};

export function stagePrompt(id, { override = overrideText() } = {}) {
  const stage = STAGES[id];
  if (!stage) throw new Error(`No such run: ${id}`);
  return `${override}\n\n---\n\n${NOBODY}\n\n${stage.prompt}`;
}
export const stageSkill = (id) => STAGES[id].skill;
export const stageFiles = (id) => toyFiles(STAGES[id].files);

// ---------------------------------------------------------------- the kits

// The kits' pins, from the manifest: [{ name, repo, ref, sha, folders: [{ path, hash }] }].
export function pinnedKits(root = REPO) {
  return readManifest(root).upstreams.map((u) => ({ name: u.name, repo: u.repo, ref: u.ref, sha: u.sha, folders: u.folders }));
}

// Fetches each kit at its pinned commit into a new folder under `work`, checks every folder against the manifest's
// fingerprint, and copies each skill folder to <skillsDir>/<its name>. Returns what was installed and what matched.
export async function installKits({ kits, work, skillsDir, fetchTo = fetchUpstream }) {
  const installed = [];
  const names = new Map();
  for (const kit of kits) {
    const dir = path.join(work, `kit-${kit.name}`);
    fs.mkdirSync(dir, { recursive: true });
    await fetchTo({ name: kit.name, repo: kit.repo, sha: kit.sha }, dir);
    for (const folder of kit.folders) {
      const from = path.join(dir, ...folder.path.split('/'));
      const name = path.basename(folder.path);
      if (!fs.existsSync(path.join(from, 'SKILL.md'))) throw new Error(`${kit.name}: ${folder.path} has no SKILL.md at ${kit.sha}`);
      if (names.has(name)) throw new Error(`Two kits both have a skill named ${name}`);
      names.set(name, kit.name);
      const fingerprint = fingerprintTree(from).hash;
      fs.cpSync(from, path.join(skillsDir, name), { recursive: true });
      installed.push({ skill: name, kit: kit.name, sha: kit.sha, path: folder.path, matchesManifest: fingerprint === folder.hash });
    }
  }
  return installed;
}

// ------------------------------------------------------------------ analysis

const SKILL_TOOL = /skill/i;
const SUBAGENT_TOOL = /^(task|agent|subagent|dispatch|spawn|delegate|run_?agent)|sub-?agent|read_agent|list_agents/i;
const SKILL_FILE = /skills[\\/]+([A-Za-z0-9_-]+)[\\/]+SKILL\.md/;

const argsOf = (call) => {
  if (call.arguments === null || call.arguments === undefined) return '';
  return String(call.arguments);
};

// The skills a run loaded, in order: from calls of a skill tool (its argument names the skill) and from views of a
// SKILL.md file. [{ skill, via: 'skill-tool'|'view', success }]
export function skillsLoaded(calls, known = []) {
  const out = [];
  for (const call of calls) {
    const args = argsOf(call);
    if (SKILL_TOOL.test(call.tool ?? '')) {
      let name = null;
      try { const parsed = JSON.parse(args); name = parsed.skill ?? parsed.name ?? parsed.skillName ?? null; } catch { /* clipped or plain text */ }
      if (!name) name = known.find((k) => new RegExp(`(^|[^A-Za-z0-9_-])${k}([^A-Za-z0-9_-]|$)`).test(args)) ?? args.slice(0, 60);
      out.push({ skill: String(name).replace(/^.*:/, ''), via: 'skill-tool', success: call.success });
    } else {
      const match = SKILL_FILE.exec(args);
      if (match) out.push({ skill: match[1], via: 'view', success: call.success });
    }
  }
  return out;
}

// Calls that look like dispatching a subagent, and what became of each.
export function subagentCalls(calls) {
  return calls.filter((call) => SUBAGENT_TOOL.test(call.tool ?? '')).map((call) => ({ tool: call.tool, arguments: call.arguments, success: call.success, code: call.code, error: call.error }));
}

// Every distinct tool name used, with how many calls and how many failed.
export function toolTally(calls) {
  const tally = {};
  for (const call of calls) {
    const entry = (tally[call.tool ?? 'unknown'] ??= { calls: 0, failed: 0, codes: [] });
    entry.calls += 1;
    if (call.success === false) { entry.failed += 1; if (call.code && !entry.codes.includes(call.code)) entry.codes.push(call.code); }
  }
  return tally;
}

export function eventTypeCounts(events) {
  const counts = {};
  for (const event of events) counts[event?.type ?? 'unknown'] = (counts[event?.type ?? 'unknown'] ?? 0) + 1;
  return counts;
}

// Events whose type mentions a skill or a subagent, kept whole but clipped (these are the hand-off records).
export function handoffEvents(events, { max = 60, width = 400 } = {}) {
  return events.filter((event) => /skill|subagent|agent\.|task/i.test(event?.type ?? '')).slice(0, max)
    .map((event) => { const text = JSON.stringify(event); return text.length > width ? `${text.slice(0, width)}...` : text; });
}

// Lines of the debug log that mention a skill, a subagent or a task, with the home and temporary paths made short.
export function logExcerpt(dir, { max = 150, width = 300, scrub = [] } = {}) {
  const lines = [];
  let names = [];
  try { names = fs.readdirSync(dir).sort(); } catch { return lines; }
  for (const name of names) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!/skill|sub-?agent|task tool|dispatch/i.test(line)) continue;
      let clean = line;
      for (const [from, to] of scrub) if (from) clean = clean.split(from).join(to);
      lines.push(clean.slice(0, width));
      if (lines.length >= max) return lines;
    }
  }
  return lines;
}

const sh = (cmd, args, cwd, timeout = 60_000) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout });
  return { code: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
};

const filesUnder = (dir, sub) => {
  try { return fs.readdirSync(path.join(dir, sub)).sort(); } catch { return []; }
};

// What a run left in its project: whether the flag works, the tests, the commits, the docs.
export function projectChecks(project, { baseline }) {
  const version = sh(process.execPath, ['greet.js', '--version'], project);
  const plain = sh(process.execPath, ['greet.js', 'Sam'], project);
  const tests = sh(process.execPath, ['--test'], project, 120_000);
  const log = sh('git', ['log', '--format=%s'], project).stdout.split('\n').filter(Boolean);
  const status = sh('git', ['status', '--porcelain'], project).stdout.split('\n').filter(Boolean);
  return {
    versionPrinted: version.stdout,
    versionIsPackageVersion: version.code === 0 && version.stdout === '1.2.3',
    greetingStillWorks: plain.stdout === 'Hello, Sam!',
    testsPass: tests.code === 0,
    commitsAdded: Math.max(0, log.length - baseline.commits),
    uncommittedFiles: status.length,
    specs: filesUnder(project, 'docs/superpowers/specs'),
    plans: filesUnder(project, 'docs/superpowers/plans'),
    testFileLines: (() => { try { return fs.readFileSync(path.join(project, 'greet.test.js'), 'utf8').split('\n').length; } catch { return null; } })(),
  };
}

// ---------------------------------------------------------------- summary

export function summarise(results) {
  const out = [];
  out.push(`Check ${CHECK}${results.dryRun ? ' (dry run, against a stand-in)' : ''}: ${results.runs.length} model run(s), Copilot ${results.copilotVersion || 'version unknown'}`);
  if (results.kits?.length) {
    const odd = results.kits.filter((kit) => !kit.matchesManifest);
    out.push(`Kits: ${results.kits.length} skills installed at the pinned commits; ${odd.length === 0 ? 'every folder matches the manifest' : `NOT matching the manifest: ${odd.map((k) => k.skill).join(', ')}`}`);
  }
  if (results.skillList) out.push(`Copilot lists these personal skills: ${results.skillList.join(', ') || 'none'}`);
  for (const run of results.runs) {
    out.push(`${run.id.padEnd(20)} exit ${String(run.code).padEnd(4)}${run.timedOut ? ' TIMED OUT' : ''} ${(run.durationMs / 1000).toFixed(1)}s`);
    out.push(`${' '.repeat(20)} skills: ${run.skillsLoaded.map((s) => `${s.skill}(${s.via}${s.success === false ? ',failed' : ''})`).join(' > ') || 'none'}`);
    out.push(`${' '.repeat(20)} tools: ${Object.entries(run.toolTally).map(([name, t]) => `${name} x${t.calls}${t.failed ? ` (${t.failed} failed${t.codes.length ? `: ${t.codes.join('/')}` : ''})` : ''}`).join(', ') || 'none'}`);
    if (run.subagentCalls.length) out.push(`${' '.repeat(20)} subagent dispatches: ${run.subagentCalls.map((c) => `${c.tool}:${c.success === null ? '?' : c.success ? 'ok' : c.code ?? 'failed'}`).join(' ')}`);
    const c = run.project;
    if (c) out.push(`${' '.repeat(20)} project: --version ${c.versionIsPackageVersion ? 'works' : `prints ${JSON.stringify(c.versionPrinted)}`}, tests ${c.testsPass ? 'pass' : 'fail'}, +${c.commitsAdded} commits, specs ${c.specs.length}, plans ${c.plans.length}`);
  }
  if (results.error) out.push(`STOPPED EARLY: ${String(results.error).split('\n')[0]}`);
  return out.join('\n');
}

// ------------------------------------------------------------------- main

function fakeBin(dir) {
  const bin = path.join(dir, 'copilot');
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  return bin;
}

// Stand-in kits for --dry-run: one SKILL.md per skill Wheelhouse uses, so the copying is exercised without a network.
export async function standInFetch(upstream, dir, kits) {
  const kit = kits.find((k) => k.name === upstream.name);
  for (const folder of kit.folders) {
    const target = path.join(dir, ...folder.path.split('/'));
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), `---\nname: ${path.basename(folder.path)}\ndescription: Stand-in for ${folder.path}\n---\nStand-in.\n`);
  }
}

export async function main(argv = process.argv.slice(2), { out = console.log, kits = pinnedKits() } = {}) {
  const options = parseOptions(argv);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-kits-work-'));
  assertUnderTmp(work);
  const undo = [() => fs.rmSync(work, { recursive: true, force: true })];
  const cleanup = () => { for (const step of undo.splice(0).reverse()) { try { step(); } catch { /* keep undoing the rest */ } } };
  const onSignal = (signal) => { cleanup(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const logsDir = path.join(options.resultsDir, `${CHECK}${options.dryRun ? '.dry-run' : ''}.logs`);
  const results = {
    check: CHECK, dryRun: options.dryRun, startedAt: new Date().toISOString(), node: process.version, platform: process.platform,
    options: { timeoutMs: options.timeoutMs, only: options.only }, copilotVersion: '', bin: '', pins: kits.map((k) => ({ name: k.name, ref: k.ref, sha: k.sha })),
    kits: [], skillList: null, skillListRaw: null, layout: {}, runs: [], error: null,
  };

  try {
    const bin = options.bin || (options.dryRun ? fakeBin(work) : copilotBin(defaultPrefix()));
    results.bin = bin;
    if (!fs.existsSync(bin)) throw new Error(`There is no Copilot at ${bin}. Install the pinned version first (installCopilot in probes/lib/copilot.js).`);

    const home = options.dryRun ? scratchCopilotHome() : scratchCopilotHome({ signedInFrom: LOGIN_HOME });
    undo.push(() => home.remove());
    const skillsDir = path.join(home.dir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    results.kits = await installKits({
      kits, work, skillsDir,
      fetchTo: options.dryRun ? (upstream, dir) => standInFetch(upstream, dir, kits) : fetchUpstream,
    });
    results.layout = {
      home: 'a scratch COPILOT_HOME under the temporary folder, holding config.json (the sign-in) and skills/<name>/ for each kit skill',
      projects: 'one scratch git project per run under the temporary folder: greet.js, package.json (version 1.2.3), greet.test.js',
      flags: '--allow-all-tools --no-ask-user (no --disallow-temp-dir: the skills live in the temporary folder)',
    };
    const override = overrideText();
    results.overrideChars = override.length;

    const version = await runCopilot({ args: ['--version'], cwd: work, home: home.dir, bin, timeoutMs: 60_000 });
    results.copilotVersion = version.stdout.trim().split('\n')[0] ?? '';
    const listing = await runCopilot({ args: ['skill', 'list'], cwd: work, home: home.dir, bin, timeoutMs: 60_000 });
    results.skillListRaw = (listing.stdout + listing.stderr).split('\n').slice(0, 80);
    const personal = (listing.stdout.split(/^Builtin skills:/m)[0] ?? '').split('\n').map((l) => /^\s+([A-Za-z0-9_-]+)\s+-/.exec(l)?.[1]).filter(Boolean);
    results.skillList = personal;

    const scrub = [[home.dir, '<home>'], [work, '<work>'], [fs.realpathSync(os.tmpdir()), '<tmp>'], [os.tmpdir(), '<tmp>'], [os.homedir(), '~']];
    const knownSkills = results.kits.map((k) => k.skill);
    fs.mkdirSync(logsDir, { recursive: true });

    for (const id of selectRuns(options.only)) {
      const stage = STAGES[id];
      const project = await makeScratchProject({ name: `kits-${id}`, files: stageFiles(id) });
      undo.push(() => fs.rmSync(project.dir, { recursive: true, force: true }));
      const baseline = { commits: sh('git', ['log', '--format=%s'], project.dir).stdout.split('\n').filter(Boolean).length };
      const logDir = path.join(work, `copilot-log-${id}`);
      const prompt = stagePrompt(id, { override });
      const args = copilotArgs({ prompt, logDir, noAsk: true, extra: ['--allow-all-tools'] });
      const env = { COPILOT_ALLOW_ALL: undefined };
      const t0 = Date.now();
      const result = await runCopilot({ args, cwd: project.dir, env, home: home.dir, bin, timeoutMs: options.timeoutMs * (stage.timeoutFactor ?? 1) });
      const durationMs = Date.now() - t0;
      const calls = toolCalls(result.events);
      const reply = replyOf(result.events);
      const runLogs = path.join(logsDir, id);
      try { fs.cpSync(logDir, runLogs, { recursive: true }); } catch { /* no log written */ }
      results.runs.push({
        id, expectedSkill: stage.skill, args: args.map((a) => (a === prompt ? '<prompt>' : a)), promptChars: prompt.length, promptStartsWithOverride: prompt.startsWith(override.slice(0, 40)),
        cwd: project.dir, env: describeEnv({ env, home: home.dir }), code: result.code, timedOut: result.timedOut, durationMs,
        stderr: result.stderr.slice(0, 2000), result: result.events.find((e) => e?.type === 'result') ?? null, sessionId: sessionIdOf(result.events),
        authFailed: authFailed({ code: result.code, reply }), reply: reply.slice(0, 4000),
        skillsLoaded: skillsLoaded(calls, knownSkills), expectedSkillLoaded: skillsLoaded(calls, knownSkills).some((s) => s.skill === stage.skill),
        subagentCalls: subagentCalls(calls), toolCalls: calls, toolTally: toolTally(calls), offeredTools: offeredTools(result.events),
        eventTypes: eventTypeCounts(result.events), handoffEvents: handoffEvents(result.events),
        logExcerpt: logExcerpt(logDir, { scrub }), logFiles: listFiles(runLogs, { max: 20 }),
        project: projectChecks(project.dir, { baseline }),
        projectFiles: listFiles(project.dir, { max: 60 }).filter((l) => !l.startsWith('.git/')),
      });
      if (authFailed({ code: result.code, reply })) throw new Error(`Run ${id} failed before the model answered (is the Copilot sign-in done?): ${result.stderr.trim().split('\n')[0] ?? ''}`);
    }
  } catch (error) {
    results.error = error?.stack ?? String(error);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    cleanup();
    results.finishedAt = new Date().toISOString();
  }

  fs.mkdirSync(options.resultsDir, { recursive: true });
  const file = path.join(options.resultsDir, `${CHECK}${options.dryRun ? '.dry-run' : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
  out(summarise(results));
  out(`Raw results: ${file}`);
  out(`Debug logs: ${logsDir}`);
  return { results, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { results } = await main();
  if (results.error) process.exitCode = 1;
}
