// probes/56-registration/run.js
// Check 56: where should Wheelhouse register its Copilot hooks so that they run once, in every folder a
// session runs in, and can't be switched off by a project file? The same logger is registered in five
// places, each with a tag of its own, on sessionStart and preToolUse:
//   plugin-agent     the plugin's com.github.copilot/hooks/hooks.json (root plugin.json format)
//   plugin-legacy    the plugin's hooks/hooks.json (.claude-plugin/plugin.json format)
//   claude-settings  the project's .claude/settings.json (Claude Code's format, PascalCase events)
//   github-hooks     the project's .github/hooks/probe.json
//   home-hooks       $COPILOT_HOME/hooks/probe.json
// Copilot runs once in each of three folders (the project, a git worktree of it, a plain copy with no
// .git), first as the folder is, then with a project hook file holding disableAllHooks: true; and each of
// those with and without --trust-folder, because a repository's hooks may load only in a folder Copilot
// trusts. The count of each tag per event, and the hooks' raw input, are the findings.
//
// Usage: node probes/56-registration/run.js              the trial, run from outside any sandbox
//        node probes/56-registration/run.js --dry-run    the same plumbing against a stand-in Copilot
// Options: --trust both|yes|no   which folder-trust settings to run (default both)
//          --bin <path>          the Copilot to run (default: the installed probe copy, or the stand-in)
//          --timeout-ms <n>      the longest one model run may take (default 180000)
//          --results-dir <dir>   where the findings go (default <tmp>/wheelhouse-probe-results)
//
// The real trial makes 12 model requests with the default --trust both (6 with yes or no): one short
// prompt per folder, per trust setting, with and without the off file. Everything it makes is under the
// temporary folder (a Copilot home, a project, a worktree, a copy, the plugin's copy) and is removed when
// it ends, also on Ctrl-C. It never reads or writes the real ~/.copilot or ~/.wheelhouse.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withoutGitVars } from '../../scripts/lib/run.js';
import { LOGIN_HOME, copilotBin, defaultPrefix, runCopilot, scratchCopilotHome } from '../lib/copilot.js';
import { assertUnderTmp, makeScratchProject } from '../lib/scratch.js';

export const CHECK = '56-registration';
export const EVENTS = ['sessionStart', 'preToolUse'];
export const TAGS = ['plugin-agent', 'plugin-legacy', 'claude-settings', 'github-hooks', 'home-hooks'];
export const FOLDERS = ['main', 'worktree', 'plain'];
export const PROMPT = 'Read README.md and say done';
// A hook file in the project that only switches hooks off.
export const OFF_FILE = Object.freeze({ version: 1, disableAllHooks: true });
export const OFF_PATH = path.join('.github', 'hooks', 'off.json');

const LOGGER = fileURLToPath(new URL('../lib/copilot-hook-logger.js', import.meta.url));
const PLUGIN_SOURCE = fileURLToPath(new URL('./plugin/', import.meta.url));
const FAKE = fileURLToPath(new URL('./fake-copilot.js', import.meta.url));
const RESULTS_NAME = CHECK;
const PLACEHOLDERS = { '__LOGGER__': 'logger', '__LOG__': 'log' };

// ------------------------------------------------------------------ options

export function parseOptions(argv, env = process.env) {
  const options = { dryRun: false, trust: 'both', bin: '', timeoutMs: 180_000, resultsDir: path.join(os.tmpdir(), 'wheelhouse-probe-results') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--trust') options.trust = argv[++i] ?? '';
    else if (arg === '--bin') options.bin = argv[++i] ?? '';
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
    else if (arg === '--results-dir') options.resultsDir = argv[++i] ?? '';
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!['both', 'yes', 'no'].includes(options.trust)) throw new Error('--trust is both, yes or no');
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('--timeout-ms is a number of milliseconds');
  if (!options.resultsDir) throw new Error('--results-dir needs a folder');
  return options;
}

// -------------------------------------------------------------- hook files

// The command every registration runs: the logger, told where to write, which file it was registered in
// and which event it was registered on.
export function hookCommand({ logger = LOGGER, log, tag, event }) {
  return `node "${logger}" "${log}" ${tag} ${event}`;
}

function entry(spec) {
  const command = hookCommand(spec);
  return { type: 'command', bash: command, powershell: command, timeoutSec: 30 };
}

// Copilot's own format (camelCase events), as .github/hooks/*.json and $COPILOT_HOME/hooks/*.json take it.
export function flatHooksFile({ logger, log, tag }) {
  return { version: 1, hooks: Object.fromEntries(EVENTS.map((event) => [event, [entry({ logger, log, tag, event })]])) };
}

// Claude Code's format (PascalCase events, a matcher group around each list of hooks), as .claude/settings.json takes it.
export function claudeSettingsFile({ logger, log, tag }) {
  const group = (event, matcher) => {
    const command = hookCommand({ logger, log, tag, event });
    return [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout: 30 }] }];
  };
  return { hooks: { SessionStart: group('sessionStart'), PreToolUse: group('preToolUse', '*') } };
}

// Copies the plugin fixture to `dest`, putting the logger's path and the log file's path where the
// fixture has __LOGGER__ and __LOG__. Every .json file is checked to still be JSON afterwards.
export function materialisePlugin({ source = PLUGIN_SOURCE, dest, logger = LOGGER, log }) {
  const values = { logger, log };
  const escaped = (text) => JSON.stringify(text).slice(1, -1);
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const item of fs.readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, item.name);
      const b = path.join(to, item.name);
      if (item.isDirectory()) { walk(a, b); continue; }
      let text = fs.readFileSync(a, 'utf8');
      for (const [placeholder, key] of Object.entries(PLACEHOLDERS)) text = text.split(placeholder).join(escaped(values[key]));
      if (item.name.endsWith('.json')) JSON.parse(text);
      fs.writeFileSync(b, text);
    }
  };
  walk(source, dest);
  return dest;
}

// ------------------------------------------------------------------ counts

export function readHookLog(file) {
  if (!fs.existsSync(file)) return [];
  const entries = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { entries.push({ unparsed: line }); }
  }
  return entries;
}

// { tag: { event: n } } for every tag and event, zeros included; a tag or event the probe didn't register is counted too.
export function countHooks(entries) {
  const counts = Object.fromEntries(TAGS.map((tag) => [tag, Object.fromEntries(EVENTS.map((event) => [event, 0]))]));
  for (const item of entries) {
    if (typeof item?.tag !== 'string' || typeof item?.event !== 'string') continue;
    counts[item.tag] ??= {};
    counts[item.tag][item.event] = (counts[item.tag][item.event] ?? 0) + 1;
  }
  return counts;
}

// The first entry seen for each tag and event across the runs, with the run it came from.
export function firstSeen(runs) {
  const seen = {};
  for (const run of runs) {
    for (const item of run.hookEntries ?? []) {
      if (typeof item?.tag !== 'string' || typeof item?.event !== 'string') continue;
      seen[item.tag] ??= {};
      seen[item.tag][item.event] ??= { run: run.id, entry: item };
    }
  }
  return seen;
}

// What Copilot's own log says about hooks and plugins, so a hook that didn't run can be explained.
const TOKEN = /\b(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,})\b/g;
export function hookLogLines(dir, { max = 300, width = 400 } = {}) {
  const lines = [];
  let names = [];
  try { names = fs.readdirSync(dir).sort(); } catch { return lines; }
  for (const name of names) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!/hook|plugin/i.test(line)) continue;
      lines.push(line.replace(TOKEN, '[redacted]').slice(0, width));
      if (lines.length >= max) return lines;
    }
  }
  return lines;
}

// ------------------------------------------------------------------ the plan

export function copilotArgs({ trusted, logDir }) {
  return [
    '-p', PROMPT,
    '--output-format', 'json', '--no-auto-update', '--no-ask-user', '--disable-builtin-mcps',
    '--allow-tool', 'view',
    '--log-dir', logDir, '--log-level', 'debug',
    ...(trusted ? ['--trust-folder'] : []),
  ];
}

// The runs in order: for each trust setting, every folder as it is, then every folder with the off file.
export function plan({ trust = 'both' } = {}) {
  const settings = trust === 'both' ? [false, true] : [trust === 'yes'];
  const runs = [];
  for (const trusted of settings) {
    for (const off of [false, true]) {
      for (const folder of FOLDERS) {
        runs.push({ id: `${folder}-${trusted ? 'trusted' : 'untrusted'}-${off ? 'off' : 'on'}`, folder, trusted, off });
      }
    }
  }
  return runs;
}

// -------------------------------------------------------------------- folders

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: withoutGitVars(process.env) });
}

async function makeFolders({ logger, log }) {
  const files = {
    'README.md': 'Wheelhouse probe 56. Nothing to do here.\n',
    [path.join('.github', 'hooks', 'probe.json')]: JSON.stringify(flatHooksFile({ logger, log, tag: 'github-hooks' }), null, 2) + '\n',
  };
  const main = await makeScratchProject({ name: 'registration', files, settings: claudeSettingsFile({ logger, log, tag: 'claude-settings' }) });
  const made = [main.dir];
  const remove = () => {
    for (const dir of made.splice(0).reverse()) {
      assertUnderTmp(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  try {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-registration-worktree-'));
    made.push(worktree);
    assertUnderTmp(worktree);
    git(main.dir, ['worktree', 'add', '--quiet', '-b', 'probe-worktree', worktree]);
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-registration-plain-'));
    made.push(plain);
    assertUnderTmp(plain);
    fs.cpSync(main.dir, plain, { recursive: true, filter: (source) => path.basename(source) !== '.git' });
    return { dirs: { main: main.dir, worktree, plain }, remove };
  } catch (error) {
    remove();
    throw error;
  }
}

// -------------------------------------------------------------------- summary

const SHORT = { sessionStart: 'start', preToolUse: 'tool' };

export function describeCounts(counts) {
  return Object.entries(counts)
    .map(([tag, byEvent]) => `${tag}[${Object.entries(byEvent).map(([event, n]) => `${SHORT[event] ?? event}=${n}`).join(' ')}]`)
    .join(' ');
}

// Tag and event pairs that fired more than once in a run.
export function twice(counts) {
  return Object.entries(counts).flatMap(([tag, byEvent]) => Object.entries(byEvent).filter(([, n]) => n > 1).map(([event, n]) => `${tag}:${event}x${n}`));
}

export function summarise(results) {
  const out = [];
  out.push(`Check ${CHECK}${results.dryRun ? ' (dry run, against a stand-in)' : ''}: ${results.runs.length} model run(s), Copilot ${results.copilotVersion || 'version unknown'}`);
  out.push(`Plugin install: exit ${results.install?.code ?? 'not run'}; installed plugins: ${(results.pluginList ?? []).join(', ') || 'none seen'}`);
  for (const run of results.runs) {
    out.push(`${run.id.padEnd(26)} exit ${String(run.code).padEnd(3)}${run.timedOut ? ' TIMED OUT' : ''} ${describeCounts(run.hookCounts)}`);
    const again = twice(run.hookCounts);
    if (again.length) out.push(`${''.padEnd(26)} more than once: ${again.join(', ')}`);
  }
  if (results.error) out.push(`STOPPED EARLY: ${String(results.error).split('\n')[0]}`);
  return out.join('\n');
}

// ----------------------------------------------------------------------- main

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function fakeBin(dir) {
  const bin = path.join(dir, 'copilot');
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  return bin;
}

export async function main(argv = process.argv.slice(2), { out = console.log, settleMs } = {}) {
  const options = parseOptions(argv);
  const settle = settleMs ?? (options.dryRun ? 0 : 500);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-registration-work-'));
  assertUnderTmp(work);
  const log = path.join(work, 'hooks.jsonl');
  const undo = [() => fs.rmSync(work, { recursive: true, force: true })];
  const cleanup = () => { for (const step of undo.splice(0).reverse()) { try { step(); } catch { /* keep undoing the rest */ } } };
  const onSignal = (signal) => { cleanup(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const results = {
    check: CHECK, dryRun: options.dryRun, startedAt: new Date().toISOString(), node: process.version, platform: process.platform,
    options: { trust: options.trust, timeoutMs: options.timeoutMs }, prompt: PROMPT, copilotVersion: '', bin: '',
    install: null, pluginList: [], pluginListRaw: null, runs: [], firstSeen: {}, error: null,
  };

  try {
    const bin = options.bin || (options.dryRun ? fakeBin(work) : copilotBin(defaultPrefix()));
    results.bin = bin;
    if (!fs.existsSync(bin)) throw new Error(`There is no Copilot at ${bin}. Install the pinned version first (installCopilot in probes/lib/copilot.js).`);

    const home = options.dryRun ? scratchCopilotHome() : scratchCopilotHome({ signedInFrom: LOGIN_HOME });
    undo.push(() => home.remove());

    const version = await runCopilot({ args: ['--version'], cwd: work, home: home.dir, bin, timeoutMs: 60_000 });
    results.copilotVersion = version.stdout.trim().split('\n')[0] ?? '';

    // The plugin, installed from a copy with the logger's paths filled in.
    const pluginDir = materialisePlugin({ dest: path.join(work, 'plugin'), log });
    const install = await runCopilot({ args: ['plugin', 'install', pluginDir], cwd: work, home: home.dir, bin, timeoutMs: 60_000 });
    results.install = { code: install.code, stdout: install.stdout, stderr: install.stderr, timedOut: install.timedOut };
    const list = await runCopilot({ args: ['plugin', 'list', '--json'], cwd: work, home: home.dir, bin, timeoutMs: 60_000 });
    results.pluginListRaw = { code: list.code, stdout: list.stdout, stderr: list.stderr };
    try {
      const parsed = JSON.parse(list.stdout);
      if (Array.isArray(parsed)) results.pluginList = parsed.map((p) => `${p.name}${p.enabled === false ? ' (disabled)' : ''}`);
    } catch { /* the raw text is kept */ }

    // The person's hooks, in the home.
    fs.mkdirSync(path.join(home.dir, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(home.dir, 'hooks', 'probe.json'), JSON.stringify(flatHooksFile({ logger: LOGGER, log, tag: 'home-hooks' }), null, 2) + '\n');

    const folders = await makeFolders({ logger: LOGGER, log });
    undo.push(() => folders.remove());

    for (const spec of plan({ trust: options.trust })) {
      const cwd = folders.dirs[spec.folder];
      const offFile = path.join(cwd, OFF_PATH);
      const logDir = path.join(work, `copilot-log-${spec.id}`);
      fs.writeFileSync(log, '');
      if (spec.off) {
        fs.mkdirSync(path.dirname(offFile), { recursive: true });
        fs.writeFileSync(offFile, JSON.stringify(OFF_FILE, null, 2) + '\n');
      }
      const args = copilotArgs({ trusted: spec.trusted, logDir });
      const started = Date.now();
      let result;
      try {
        result = await runCopilot({ args, cwd, home: home.dir, bin, timeoutMs: options.timeoutMs });
      } finally {
        if (spec.off) fs.rmSync(offFile, { force: true });
      }
      await sleep(settle);
      const hookEntries = readHookLog(log);
      results.runs.push({
        ...spec, args, cwd, code: result.code, timedOut: result.timedOut, durationMs: Date.now() - started,
        stdout: result.stdout, stderr: result.stderr,
        result: result.events.find((event) => event.type === 'result') ?? null,
        hookCounts: countHooks(hookEntries), hookEntries, copilotLogLines: hookLogLines(logDir),
      });
    }
    results.firstSeen = firstSeen(results.runs);
  } catch (error) {
    results.error = error?.stack ?? String(error);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    cleanup();
    results.finishedAt = new Date().toISOString();
  }

  fs.mkdirSync(options.resultsDir, { recursive: true });
  const file = path.join(options.resultsDir, `${RESULTS_NAME}${options.dryRun ? '.dry-run' : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
  out(summarise(results));
  out(`Raw results: ${file}`);
  return { results, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { results } = await main();
  if (results.error) process.exitCode = 1;
}
