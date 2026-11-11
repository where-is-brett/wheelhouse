// adapters/copilot/sessions.js
// How a background Copilot session is started and woken (design sections 3.2 and 8, part 7; checks 56, 61, 64, 66 and
// 96): its command line, its own home and environment, and how its output is read afterwards. The waker
// (scripts/watcher/waker.js) and the foreman's start ask the project's adapter for these calls.
//
// Built here, but switched off: while BACKGROUND_SESSIONS_READY (scripts/agents/copilot/numbers.js) is false,
// checkForeman, checkFeature and every call refuse, so neither the waker nor the foreman's start starts a Copilot session.
// sessionsPart({ ready: true }) builds the part switched on, for tests to drive the waker with; nothing else passes it.
//
// Beside the contract's six members the part has three the waker asks for when they are there: `prepare` runs before
// every start (the version check, the kits, the session's own home), `afterRun` reads a run's whole output once it ends,
// and `pruneActivity` removes old activity; and `grantProofs`, the proofs a build-command grant must name.
//
// A session id is given up front (`--session-id`, check 96), so no call has `idFromRun`. On a plan where Auto is the only
// model choice (`auto-only`, the default) no call passes `--model`, and the environment never carries COPILOT_MODEL:
// Auto chooses, and the model it chose is read from the run's output into the session's record (afterRun). Every call has
// its rules spelt out (`--allow-tool=` and `--deny-tool=`), `--no-ask-user`, the temporary folder shut off, and never
// `--trust-folder` or an allow-everything flag: trust loads a project's hooks and `.mcp.json` servers, which run outside
// the permission rules, so background sessions run untrusted (checks 56 and 61). It imports nothing that reaches the hook
// kit, the waker or the registry, so each can load it without a cycle.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVITY_DAYS, BACKGROUND_SESSIONS_READY, LEVELS } from '../../scripts/agents/copilot/numbers.js';
import { activitySummary, finalAnswer, modelOfRun, monthRefusedIn, sessionIdOf, sessionUsage, eventsOf } from '../../scripts/agents/copilot/run-output.js';
import { recordRefusal, recordRun } from '../../scripts/agents/copilot/usage.js';
import { checkVersions, noSubsetRunner, readVersions } from '../../scripts/agents/copilot/versions.js';
import { PLUGIN_ROOT, foremanCommands } from '../../scripts/foreman/tools.js';
import { DEFAULT_BUILD_COMMANDS, isModelName } from '../../scripts/gate/guardrails.js';
import { quoteForCmd, resolveCommand } from '../../scripts/lib/claude.js';
import { commandPath } from '../../scripts/lib/command-path.js';
import { run as realRun } from '../../scripts/lib/run.js';
import { writeProvenance } from '../../scripts/lineage/check.js';
import { readManifest } from '../../scripts/lineage/manifest.js';
import { isConfiguredBuildCommand } from '../../scripts/protection/windows-builds.js';
import { recordRunUsage } from '../../scripts/usage/store.js';
import { file as hookFile } from './hooks.js';
import { levelAllowed, levelRules } from './permissions.js';
import { plainId, projectFolder, refuseLinkedPath, sessionHome, writeHomeWithKits } from './session-home.js';

export { sessionHome, SIGN_IN_KEYS, COPILOT_STATE, readCopilotConfig, signInOf, writeSessionHome, writeHomeWithKits } from './session-home.js';
export { eventsOf, finalAnswer, sessionIdOf } from '../../scripts/agents/copilot/run-output.js';

const HOME = path.join(path.dirname(fileURLToPath(import.meta.url)), 'home');
// The record of the one command the foreman may run (scripts/agents/copilot/home.js builds it from the foreman's playbook).
export const FOREMAN_RULES_FILE = path.join(HOME, 'rules', 'wheelhouse-foreman.json');
// The one rule it may hold: the wake script, `<wheelhouse-root>` standing for the folder Wheelhouse is in.
const WAKE_RULE = "node '<wheelhouse-root>/scripts/foreman/wake.js':*";

// The plans a Copilot account can be on (the `copilotPlan` setting). Anything else is taken as the first, which passes no model.
const PLANS = Object.freeze(['auto-only', 'credits', 'requests']);
export const DEFAULT_PLAN = 'auto-only';
const planOf = (plan) => (PLANS.includes(plan) ? plan : DEFAULT_PLAN);

// The variables a session keeps from the environment it is started from. No token variable: check 61 signed in through
// the keychain, found from config.json and the real HOME (a scratch HOME breaks it), so GH_TOKEN, GITHUB_TOKEN,
// COPILOT_GITHUB_TOKEN and the like are all dropped, as are COPILOT_ALLOW_ALL (which lets everything through),
// COPILOT_MODEL (a model is never passed by the environment) and every variable that steers what a session loads.
// Whether Windows also needs ComSpec, PATHEXT or APPDATA is the Windows sitting's (T6).
const KEPT_VARIABLES = ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'SystemRoot', 'WHEELHOUSE_HOME'];

// The longest command line cmd.exe runs; a .cmd start past it is refused before anything runs.
export const CMD_LINE_MOST = 8191;

// The flags no call ever carries, at any level: a level's "the shell allowed" is `--allow-tool=shell`, a rule, never a
// flag that lifts every rule.
export const WIDE_FLAGS = Object.freeze(['--trust-folder', '--allow-all', '--yolo', '--allow-all-tools', '--allow-all-paths', '--allow-all-urls', '--add-dir']);

const DAY_MS = 24 * 60 * 60 * 1000;

// Where a run's whole output is kept, as its activity: `<home>/projects/<p>/activity/<id>.jsonl`. A session's wakes
// append to `<session id>.jsonl`.
export function activityFile(project, id) {
  return path.join(projectFolder(project), 'activity', `${plainId(id, 'run or session id')}.jsonl`);
}

// The environment a session gets: only KEPT_VARIABLES (when set), and COPILOT_HOME, its own home. On Windows names are
// matched without regard to case, as Windows reads them, and keep the spelling they came with.
export function copilotSessionEnv(env, { home, platform = process.platform } = {}) {
  if (typeof home !== 'string' || home === '') throw new Error('A Copilot session runs from a home of its own, and none was given');
  const same = (a, b) => (platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const kept = Object.entries(env ?? {}).filter(([name, value]) => typeof value === 'string' && KEPT_VARIABLES.some((k) => same(k, name)));
  return { ...Object.fromEntries(kept), COPILOT_HOME: home };
}

// The model a role's session is given, or null for Auto. On an `auto-only` plan always null, whatever the configuration
// holds: Auto is the only choice there. On a plan with model choice, the routing table's Copilot column
// (`config.agentRouting.copilot.<role>`), or null for Copilot's own default. Claude Code's `routing` is never read here.
function modelOf(config, role, plan) {
  if (planOf(plan) === DEFAULT_PLAN) return null;
  const model = config?.agentRouting?.copilot?.[role] ?? null;
  if (model !== null && !isModelName(model)) throw new Error(`The ${role}'s model for Copilot can't be passed to copilot`);
  return model;
}

// The words the switch refuses with, while BACKGROUND_SESSIONS_READY is false.
export const NOT_SWITCHED_ON = "Copilot's background sessions aren't switched on yet: their first real run hasn't been seen";

function switchedOn(ready) {
  if (ready !== true) throw new Error(NOT_SWITCHED_ON);
}

// Whether a foreman session can be started under `config`: throws, in plain words, when the watcher's second shape is
// asked for (on Copilot the watcher wakes a fresh foreman for each wake), when its model can't be passed, and while the
// sessions aren't switched on.
function checkForemanAt(config, ready, plan) {
  if (config?.watcherShape === 2) throw new Error("On Copilot the watcher wakes a fresh foreman for each wake; the second shape isn't offered");
  modelOf(config, 'foreman', plan);
  switchedOn(ready);
}

// Whether a feature session can be started under `config`: throws, in plain words, when its model can't be passed, and
// while the sessions aren't switched on.
function checkFeatureAt(config, ready, plan) {
  modelOf(config, 'builder', plan);
  switchedOn(ready);
}

// The rules as given, each one argument: a plain line of text.
function rulesOf(list, what) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error(`The ${what} rules must be a list`);
  for (const rule of list) {
    if (typeof rule !== 'string' || rule === '' || rule.length > 500 || /[\u0000-\u001f\u007f]/.test(rule)) {
      throw new Error(`This ${what} rule can't be passed to copilot: ${JSON.stringify(rule)}`);
    }
  }
  return list;
}

// The arguments of one `copilot -p` session, the watcher's and the evaluation runner's alike: `prompt`, its `sessionId`
// (given up front, so the run's own events and the folder under session-state carry it; or `resume`, an id already
// checked), where its log and usage go, its agent (`--agent wheelhouse-<role>`), its model or null, and its rules in
// Copilot's syntax. Throws when an argument would start the session trusted or with every permission given, whatever a
// caller passes: the prompt is the one argument not read as a flag.
export function sessionArgs({ prompt, sessionId = null, resume = null, logDir, usageFile, role, model = null, allow = [], deny = [] }) {
  const args = [
    ...(resume === null ? [] : [`--resume=${resume}`]),
    ...(sessionId === null ? [] : ['--session-id', sessionId]),
    '-p', prompt, '--output-format', 'json', '--no-auto-update', '--disable-builtin-mcps', '--no-ask-user', '--disallow-temp-dir',
    '--log-dir', logDir, '--usage-output-file', usageFile, '--agent', `wheelhouse-${role}`,
    ...(model === null ? [] : ['--model', model]),
    ...allow.map((rule) => `--allow-tool=${rule}`),
    ...deny.map((rule) => `--deny-tool=${rule}`),
  ];
  const flags = args.filter((_, i) => args[i - 1] !== '-p');
  if (flags.some((arg) => WIDE_FLAGS.some((wide) => arg === wide || arg.startsWith(`${wide}=`)))) {
    throw new Error('A Copilot session is never started trusted or with every permission given');
  }
  return args;
}

// One session's call: `{ file, args, env, input, verbatim, home, usageFile, logDir, activityFile, output }`, `output` being
// the activity file again: the waker hands the child that file as its stdout. `rules` are `{ allow, deny }` in Copilot's
// syntax: the foreman's own command, or a feature's level's (featureRules); none given allows nothing, which fails closed
// (a tool no rule allows is refused at once, check 61). `copilot` is the program as resolveCommand finds it. Through a .cmd
// shim the whole line, the prompt included, goes through quoteForCmd: every prompt is Wheelhouse's own short text naming a
// file, and one quoteForCmd refuses fails the start in plain words. The home must already hold Wheelhouse's hook file
// (writeSessionHome), or the call refuses.
function sessionCall({ project, target, role, config, plan, prompt, sessionId = null, rules = {}, resume = null, runId = crypto.randomUUID(), env = process.env, platform = process.platform, copilot = null }) {
  if (typeof prompt !== 'string' || prompt === '') throw new Error('A session needs a prompt');
  if (prompt.startsWith('-')) throw new Error("A session's prompt can't start with a dash");
  const home = sessionHome(project, target);
  // No session starts from a home without Wheelhouse's guards (writeSessionHome writes them first).
  if (!fs.lstatSync(hookFile({ home }), { throwIfNoEntry: false })?.isFile()) {
    throw new Error("This session's Copilot home has no Wheelhouse hook file, so its guards wouldn't run: no session is started");
  }
  const model = modelOf(config, role, plan);
  const run = plainId(runId, 'run id');
  const named = resume === null ? plainId(sessionId ?? crypto.randomUUID(), 'session id') : plainId(resume, 'session id');
  const activity = path.dirname(activityFile(project, run));
  const logDir = path.join(activity, `${run}.logs`);
  const usageFile = path.join(activity, `${run}.usage.json`);
  const args = sessionArgs({
    prompt, sessionId: resume === null ? named : null, resume: resume === null ? null : named, logDir, usageFile, role, model,
    allow: rulesOf(rules.allow, 'allow'), deny: rulesOf(rules.deny, 'deny'),
  });
  const resolved = copilot ?? resolveCommand({ name: 'copilot', platform, env });
  let call;
  if (resolved.kind === 'cmd') {
    let line;
    try {
      line = [resolved.file, ...args].map(quoteForCmd).join(' ');
    } catch {
      throw new Error("This Copilot session can't be started through a .cmd program safely: an argument holds \", %, ! or a closing backslash, which cmd.exe would change");
    }
    call = { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
    if (['cmd.exe', ...call.args].join(' ').length > CMD_LINE_MOST) {
      throw new Error(`This Copilot session's command line is longer than the ${CMD_LINE_MOST} characters a .cmd program can be given, so it isn't started`);
    }
  } else {
    call = { file: resolved.file, args, verbatim: false };
  }
  return {
    ...call,
    env: copilotSessionEnv(env, { home, platform }),
    input: '',
    sessionId: named,
    home,
    usageFile,
    logDir,
    activityFile: activityFile(project, named),
    output: activityFile(project, named),
  };
}

// The foreman's one allow rule, as the session's `--allow-tool`: the command in adapters/copilot/home/rules/
// wheelhouse-foreman.json, which home.js builds from the foreman's playbook, with the folder Wheelhouse is in put where
// `<wheelhouse-root>` stands. The record may hold the wake script and nothing else, and the rule it gives must be the
// command the foreman's playbook is shown (foremanCommands), so the two can't drift. A record that can't be read, or holds
// anything else, refuses the start: with no rule the foreman could run nothing. The foreman's agent file holds `tools: []`
// (no tool); whether Copilot reads that as no tools is still open until the first real run (design section 3.2).
export function foremanAllow({ pluginRoot = PLUGIN_ROOT, platform = process.platform, rulesFile = FOREMAN_RULES_FILE } = {}) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
  } catch {
    throw new Error("The foreman's rule record can't be read, so no foreman is started");
  }
  if (record === null || typeof record !== 'object' || record.agent !== 'wheelhouse-foreman' || !Array.isArray(record.allow) || record.allow.length !== 1 || record.allow[0] !== WAKE_RULE) {
    throw new Error("The foreman's rule record allows more or less than its wake script, so no foreman is started");
  }
  const root = commandPath(pluginRoot, { platform }).slice(1, -1);
  const command = record.allow[0].replace('<wheelhouse-root>', root).slice(0, -':*'.length);
  if (command !== foremanCommands(pluginRoot, { platform }).wake) throw new Error("The foreman's rule record names a command the foreman's playbook doesn't, so no foreman is started");
  return [`shell(${command}:*)`];
}

// A fresh foreman for one wake, run in the project's main checkout, with the one command its record allows and no write.
// Copilot runs the watcher's first shape only, so there is no long foreman session, and asking for one refuses. The
// waker's `tools` (Claude Code's allow list) and the column's model, effort and fallback are ignored: the rule is the
// record's, and Auto chooses the model (on a plan with model choice, the Copilot column's).
function buildForemanCall({ config, project, prompt, plan, env, platform = process.platform, pluginRoot = PLUGIN_ROOT, copilot = null, runId, sessionId = null, long = false }) {
  if (long) throw new Error("Copilot's foreman runs one wake at a time; its long session isn't built");
  return sessionCall({ project, target: 'foreman', role: 'foreman', config, plan, prompt, sessionId, rules: { allow: foremanAllow({ pluginRoot, platform }) }, env, platform, copilot, runId });
}

// A feature session's level and rules, worked out here, never taken from the caller: `rules` and Claude Code's `allowed` are
// ignored. levelAllowed says which level runs, and only that level's rules are made (levelRules doesn't check the level
// itself): given no level, or one that can't be read, it is Ask with no grants (failing closed). The grants' commands count
// only while the configuration still lists them. `domains` are the project's web domains, its configuration's when not
// given. Throws when the worktree isn't a whole path.
export function featureRules({ config, level, grants, guardedCommand = null, worktree, domains, realUsers, keysUnreadable, hostApproval, unattendedConfirmed, platform = process.platform }) {
  const known = LEVELS.includes(level);
  const allowed = levelAllowed({ level: known ? level : 'ask', realUsers, keysUnreadable, hostApproval, unattendedConfirmed, platform });
  const commands = config?.buildCommands ?? DEFAULT_BUILD_COMMANDS;
  const given = (known && Array.isArray(grants) ? grants : [])
    .filter((g) => g !== null && typeof g === 'object' && Array.isArray(g.commands))
    .map((g) => ({ ...g, commands: g.commands.filter((c) => isConfiguredBuildCommand(c, commands)) }));
  const rules = levelRules({ level: allowed.level, grants: given, runner: guardedCommand, worktree, domains: domains ?? config?.webDomains ?? [], platform });
  return { level: allowed.level, rules };
}

// The inputs a feature call reads for its level, which never reach sessionCall.
function featureCall({ rules: _rules, allowed: _allowed, level, grants, guardedCommand, worktree, domains, realUsers, keysUnreadable, hostApproval, unattendedConfirmed, ...rest }, extra) {
  const feature = featureRules({ config: rest.config, level, grants, guardedCommand, worktree, domains, realUsers, keysUnreadable, hostApproval, unattendedConfirmed, platform: rest.platform });
  return { ...sessionCall({ ...rest, ...extra, rules: feature.rules }), level: feature.level };
}

// A feature's first session, run in its worktree, at the level levelAllowed lets run (`level` in the call's result). The
// waker's `sessionId` is the session's own, given to Copilot up front (check 96), so the waker keeps it before the run.
function buildFeatureStartCall({ project, work, ...rest }) {
  return featureCall(rest, { project, target: `feature-${work}`, role: 'builder' });
}

// A feature's session, woken: `--resume=<id>` in the feature's own home, never `--continue` (which takes the newest
// session in the home, check 61). Its rules are worked out afresh, so a grant spent by an earlier run is not given.
function buildFeatureResumeCall({ sessionId, project, work, ...rest }) {
  if (sessionId === undefined || sessionId === null) throw new Error('A wake needs the session id');
  return featureCall(rest, { project, target: `feature-${work}`, role: 'builder', resume: sessionId });
}

// Why a run GitHub refused for the month settles as it does.
export const WAITING_WHY = "GitHub has refused Copilot until the month's allowance resets";

// A note for the board when a Wheelhouse guard refused something in a run: one per run, naming the session and the tools,
// never what was refused (the activity record holds that).
function guardNote(refusals, work) {
  const tools = [...new Set(refusals.map((r) => r.tool))].slice(0, 5);
  const who = work === undefined ? "the foreman's run" : `the ${work} session's run`;
  const times = refusals.length === 1 ? 'one tool call' : `${refusals.length} tool calls`;
  return `A Wheelhouse guard refused ${times} in ${who} (${tools.join(', ')}). The run's activity record lists them.`;
}

// A credit is a billion of the `totalNanoAiu` unit (check 64 reads the name so; Copilot's output doesn't say it).
const NANO_AIU_PER_CREDIT = 1e9;

// What a run that named its session leaves on this computer once it ends: its use in the usage store and in Copilot's
// month ledger (with the model Auto chose), and the session's provenance for the pull requests it opens: the pinned kits'
// commits (the start checked them), the versions read before it started (`versions`, each null when not known) and the
// model it used. Each informs: one that can't be written is passed over, and the run still settles.
function recordRunOutcome({ project, sessionId, work, usage, model, versions, at }) {
  try {
    recordRunUsage({
      at, session: sessionId, project, role: work === undefined ? 'foreman' : 'feature', work, agent: 'copilot',
      credits: usage.totalNanoAiu === null ? null : usage.totalNanoAiu / NANO_AIU_PER_CREDIT,
      premiumRequests: usage.premiumRequests,
      premiumCost: usage.totalPremiumRequestCost,
      tokens: usage.tokens,
    });
  } catch { /* the run's use isn't counted */ }
  try {
    if (usage.premiumRequests !== null) recordRun({ at, session: sessionId, requests: usage.premiumRequests, model });
  } catch { /* the month's ledger misses the run */ }
  try {
    let upstreams = {};
    let ok = false;
    try {
      upstreams = Object.fromEntries(readManifest().upstreams.map((u) => [u.name, u.sha]));
      ok = true;
    } catch { /* no manifest: the kits can't be named, and the fingerprints don't match */ }
    writeProvenance({
      project, sessionId, upstreams, ok, agent: 'copilot',
      agentVersion: versions?.cli ?? null, editor: versions?.vscode ?? null, runtime: versions?.runtime ?? null, models: model === null ? [] : [model],
    });
  } catch { /* the session has no provenance, so its pull requests carry none */ }
}

// Removes the project's activity older than ACTIVITY_DAYS: each run's output, usage file and log folder, by when it was
// last written. A link is removed, never followed, and a link anywhere from Wheelhouse's home down to the activity folder
// refuses the whole prune. Returns the names removed.
export function pruneActivity({ project, now = () => new Date() }) {
  const dir = path.join(projectFolder(project), 'activity');
  refuseLinkedPath(dir);
  const cutoff = now().getTime() - ACTIVITY_DAYS * DAY_MS;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const removed = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (stat && stat.mtimeMs < cutoff) {
      fs.rmSync(file, { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed;
}

// What a run's whole output says once it ends, as `{ ok, why, sessionId, records }` (and `waiting: true` for a run GitHub
// refused for the month). A run with no `result` event failed, whatever its exit code (`code`, which is never read: a
// refusal exits 0, check 61); one with a result is done, refusals and all, and its refusals go into its activity record.
// `records` are what the waker writes to the state: the run's `activity`, with its use (sessionUsage, and in it the model
// Auto chose as `model`, null when the output names none) and, for a feature, its work; and, when a guard refused anything, one
// `note` for the board. `call` is what the waker kept of the call: its `output` and `usageFile`. Given the `project`, a run
// that named its session also records its use and the session's provenance (recordRunOutcome), with `versions`, the
// versions read before it started. A run GitHub refused because the month's allowance is gone is recorded in the month's
// ledger and settles as waiting, never as a fault; what holds the piece until the 1st is the month's own state (usage.js).
export function afterRun({ stdout = '', code: _code = null, call = {}, target, project, versions = null, at = new Date().toISOString() } = {}) {
  const finished = eventsOf(stdout).some((event) => event.type === 'result');
  const sessionId = sessionIdOf(stdout);
  const work = typeof target === 'string' && target.startsWith('feature-') ? target.slice('feature-'.length) : undefined;
  const summary = activitySummary(stdout);
  const usageFile = typeof call?.usageFile === 'string' ? call.usageFile : null;
  const usage = sessionUsage({ usageFile, stdout });
  const model = modelOfRun({ usageFile, stdout });
  const records = [{ kind: 'activity', data: { ...summary, role: work === undefined ? 'foreman' : 'builder', ...(work === undefined ? {} : { work }), usage: { ...usage, model }, at } }];
  const refused = monthRefusedIn(stdout);
  if (refused) {
    try {
      recordRefusal({ at, session: sessionId ?? (typeof call?.sessionId === 'string' ? call.sessionId : null) });
    } catch { /* the month's ledger misses the refusal */ }
    return { ok: false, why: WAITING_WHY, waiting: true, sessionId, records };
  }
  if (typeof project === 'string' && sessionId !== null) recordRunOutcome({ project, sessionId, work, usage, model, versions, at });
  const guards = summary.refusals.filter((r) => r.kind === 'guard');
  if (guards.length > 0) records.push({ kind: 'note', data: { text: guardNote(guards, work) } });
  return finished
    ? { ok: true, why: null, sessionId, records }
    : { ok: false, why: 'its session ended without a result', sessionId, records };
}

// The project's activity folder, made before a start so the waker can hand the child its output file there.
function activityFolder(project) {
  const dir = path.join(projectFolder(project), 'activity');
  refuseLinkedPath(dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  refuseLinkedPath(dir);
  return dir;
}

// The proofs an answer must name for its build-command grant to count (the waker's buildGrants): no Copilot hook signs, so
// only a click in the helper's own window counts.
export const GRANT_PROOFS = Object.freeze(['window']);

// The sessions part. `ready` is the switch (BACKGROUND_SESSIONS_READY unless a test builds the part switched on); `plan`
// is the Copilot plan (`copilotPlan`; the default passes no model); `kits` ({ manifest, fetchTo }) and `home`
// ({ signedInFrom, node, root }) are for tests, which never fetch from the network or read the person's Copilot home.
// `versions` ({ run, env, home, runSubset }) is how the versions are read and a new one checked: `run` starts `copilot
// --version`, and `runSubset` is the safety subset's runner. Given none, runSubset is noSubsetRunner, which fails, so a CLI
// at any version but the pin, or one whose version can't be read, holds Copilot work until the evaluation runner (part
// 10) gives a subset to run.
export function sessionsPart({ ready = BACKGROUND_SESSIONS_READY, plan: given = DEFAULT_PLAN, kits = {}, home = {}, versions: versionsFrom = {} } = {}) {
  const part = planOf(given);
  const { runSubset = noSubsetRunner, run = realRun, ...readFrom } = versionsFrom;
  // The versions read before this part's latest start, for that run's provenance.
  let lastVersions = null;
  const switched = (build) => (options = {}) => {
    switchedOn(ready);
    return build({ plan: part, ...options });
  };
  return Object.freeze({
    checkForeman: (config) => checkForemanAt(config, ready, part),
    checkFeature: (config) => checkFeatureAt(config, ready, part),
    foremanCall: switched(buildForemanCall),
    featureStartCall: switched(buildFeatureStartCall),
    featureResumeCall: switched(buildFeatureResumeCall),
    finalAnswer,
    // Before every start: the versions in use read, and any CLI but the pinned one held until it passes the safety
    // subset (checkVersions fails closed: a version that can't be read isn't the pin); the pinned kits fetched once and
    // checked; the activity folder; and the session's own home written afresh. A throw refuses the start; nothing has been
    // run. A version that fails, or a kit that differs, holds the project's work (its agent hold) and carries the lineage
    // hold's record; a check that passes again lifts that hold, and says so (`lifted`).
    async prepare({ project, target }) {
      switchedOn(ready);
      const versions = await readVersions({ ...readFrom, run });
      lastVersions = versions;
      const checked = await checkVersions({ project, versions, runSubset, ...(readFrom.home === undefined ? {} : { home: readFrom.home }) });
      activityFolder(project);
      const { lifted } = await writeHomeWithKits({ project, target, kits, home });
      return { lifted: checked?.lifted === true || lifted === true };
    },
    afterRun: (options) => afterRun({ ...options, versions: lastVersions }),
    pruneActivity,
    grantProofs: GRANT_PROOFS,
  });
}

export default sessionsPart();
