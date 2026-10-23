// adapters/copilot/sessions.js
// How a background Copilot session is started and woken (design section 6.4; checks 56, 61, 64 and 66; rulings
// P7-1 to P7-8): its command line, its own home and environment, and how its output is read afterwards.
//
// Built here, and the adapter's sessions part (ruling P8-1), but switched off: while BACKGROUND_SESSIONS_READY
// (scripts/lib/copilot-numbers.js) is false, checkForeman and checkFeature refuse, so neither the waker nor the
// foreman's start starts a Copilot session, and the helper's sign-in start makes no watcher for a Copilot project. sessionsPart({
// ready: true }) builds the part switched on, for tests to drive the waker with; nothing else passes it.
//
// Beside the contract's six members the part has three the waker asks for when they are there (ruling P8-2):
// `prepare` writes the session's own home before every start, `afterRun` reads a run's whole output once it ends (its
// outcome, its session id, and the records it leaves), and `pruneActivity` removes old activity.
//
// Every call has its rules spelt out (`--allow-tool=` and `--deny-tool=`), `--no-ask-user`, the temporary folder
// shut off, and never `--trust-folder` or an allow-everything flag: trust loads a project's hooks and `.mcp.json`
// servers, which run outside the permission rules, so background sessions run untrusted (checks 56 and 61). It
// imports nothing that reaches the hook kit, the waker or the registry, so each can load it without a cycle.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kitsForSession } from '../../scripts/agents/copilot/kits.js';
import { checkVersions, noSubsetRunner, readVersions } from '../../scripts/agents/copilot/versions.js';
import { DEFAULT_BUILD_COMMANDS, isModelName } from '../../scripts/gate/guardrails.js';
import { quoteForCmd, resolveCommand } from '../../scripts/lib/claude.js';
import { ACTIVITY_DAYS, BACKGROUND_SESSIONS_READY, LEVELS } from '../../scripts/lib/copilot-numbers.js';
import { SLUG } from '../../scripts/lib/build-loop.js';
import { stateDir, wheelhouseHome } from '../../scripts/lib/paths.js';
import { PLUGIN_ROOT, foremanTools } from '../../scripts/foreman/tools.js';
import { isConfiguredBuildCommand } from '../../scripts/protection/windows-builds.js';
import { scanText } from '../../scripts/state/secret-scan.js';
import { fingerprintTree } from '../../scripts/lineage/fingerprint.js';
import { writeProvenance } from '../../scripts/lineage/check.js';
import { readManifest } from '../../scripts/lineage/manifest.js';
import { run as realRun } from '../../scripts/lib/run.js';
import { recordRunUsage } from '../../scripts/usage/store.js';
import { copilotHome, file as hookFile, writeRegistration } from './hooks.js';
import { levelAllowed, levelRules } from './permissions.js';

// The kit's agents, copied into every session's own home (adapters/copilot/home/agents).
const KIT_AGENTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'home', 'agents');

// The keys of Copilot's config.json that hold the sign-in: the signed-in users, which is how a home finds the
// keychain entry (probes/lib/copilot.js). Nothing else in the person's file reaches a session's home: above all not
// `trustedFolders`, which would make a folder trusted and load its hooks and `.mcp.json` (checks 56 and 66). No run
// has yet recorded the file's keys, so this list is the probes' account of the file; the first real run of a
// session started from here records the keys a signed-in file holds, and confirms or corrects this list (check
// 61's note). Both spellings Copilot has used are listed.
export const SIGN_IN_KEYS = Object.freeze(['loggedInUsers', 'lastLoggedInUser', 'logged_in_users', 'last_logged_in_user']);

// What may stay at the top of a session's home between runs: Wheelhouse's own four, and Copilot's own state (its
// sessions, which `--resume` reads; its session database and that database's side files; its logs; its lock files).
// Everything else is removed before each start: a `settings.json`, `mcp-config.json`, `lsp-config.json`,
// `copilot-instructions.md`, instructions or installed plugins never survive into a run, and `skills` holds only the
// pinned kits' verified copies (scripts/agents/copilot/kits.js), written afresh each start. The first real run
// lists what Copilot writes into a home, and confirms these names (check 61 saw `session-state`, a session database,
// `installed-plugins`, `plugin-data` and lock files).
const WHEELHOUSE_KEEPS = ['config.json', 'hooks', 'agents', 'skills'];
export const COPILOT_STATE = [/^session-state$/, /^logs?$/, /\.(db|sqlite3?)(-wal|-shm|-journal)?$/i, /\.lock$/i];

// The variables a session keeps from the environment it is started from (ruling P7-7). No token variable: check 61
// signed in through the keychain, found from config.json and the real HOME (a scratch HOME breaks it), so GH_TOKEN,
// GITHUB_TOKEN, COPILOT_GITHUB_TOKEN and the like are all dropped, as is COPILOT_ALLOW_ALL (which lets everything
// through) and every variable that steers what a session loads. Whether Windows also needs ComSpec, PATHEXT or
// APPDATA is the Windows sitting's (S2).
const KEPT_VARIABLES = ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'SystemRoot', 'WHEELHOUSE_HOME'];

// The longest command line cmd.exe runs; a .cmd start past it is refused before anything runs.
export const CMD_LINE_MOST = 8191;

// The flags no call ever carries, at any level: a level's "the shell allowed" is `--allow-tool=shell`, a rule,
// never a flag that lifts every rule (ruling P7-3).
const WIDE_FLAGS = ['--trust-folder', '--allow-all', '--yolo', '--allow-all-tools', '--allow-all-paths', '--allow-all-urls', '--add-dir'];

// The most of a command an activity summary keeps, the most commands, and the kinds of refusal it names.
// scripts/state/events.js holds the same two (ACTIVITY_COMMANDS, REFUSAL_KINDS) without this file importing the
// state's writer; a test holds them equal.
const COMMAND_CHARS = 200;
export const MOST_COMMANDS = 50;
export const REFUSAL_KIND_NAMES = Object.freeze(['guard', 'rule', 'no-rule', 'other']);

const PLAIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// The project's folder in the home: `<home>/projects/<p>`, with the name checked as the state's is.
const projectFolder = (project) => path.dirname(stateDir(project));

function plainId(value, what) {
  if (typeof value !== 'string' || !PLAIN_ID.test(value) || /^\.+$/.test(value)) throw new Error(`This can't be used as a ${what}: ${JSON.stringify(value)}`);
  return value;
}

// The session's own Copilot home, written by Wheelhouse only: one per target (`foreman`, or `feature-<work>`), so
// `--resume` finds its session and two sessions never share Copilot's lock files.
export function sessionHome(project, target) {
  if (typeof target !== 'string' || !(target === 'foreman' || (target.startsWith('feature-') && SLUG.test(target.slice('feature-'.length))))) {
    throw new Error(`A session's home is the foreman's or a feature's, and this target isn't either: ${JSON.stringify(target)}`);
  }
  let folder;
  try {
    folder = projectFolder(project);
  } catch {
    throw new Error(`This isn't a project's folder name: ${JSON.stringify(project)}`);
  }
  return path.join(folder, 'copilot-home', target);
}

// Where a run's whole output is kept, as its activity: `<home>/projects/<p>/activity/<id>.jsonl`. `id` is the
// run's own until Copilot names the session (sessionIdOf); a wake appends to `<session id>.jsonl`.
export function activityFile(project, id) {
  return path.join(projectFolder(project), 'activity', `${plainId(id, 'run or session id')}.jsonl`);
}

// The environment a session gets: only KEPT_VARIABLES (when set), and COPILOT_HOME, its own home. On Windows names
// are matched without regard to case, as Windows reads them, and keep the spelling they came with.
export function copilotSessionEnv(env, { home, platform = process.platform } = {}) {
  if (typeof home !== 'string' || home === '') throw new Error('A Copilot session runs from a home of its own, and none was given');
  const same = (a, b) => (platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const kept = Object.entries(env ?? {}).filter(([name, value]) => typeof value === 'string' && KEPT_VARIABLES.some((k) => same(k, name)));
  return { ...Object.fromEntries(kept), COPILOT_HOME: home };
}

// The sign-in keys of the Copilot home `signedInFrom`'s config.json (SIGN_IN_KEYS), and nothing else of the file.
// Throws, in plain words, when it holds none: no session starts unsigned.
export function signInOf(signedInFrom = copilotHome()) {
  let source;
  try {
    source = JSON.parse(fs.readFileSync(path.join(signedInFrom, 'config.json'), 'utf8'));
  } catch {
    source = null;
  }
  const signIn = source !== null && typeof source === 'object' && !Array.isArray(source)
    ? Object.fromEntries(SIGN_IN_KEYS.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]))
    : {};
  if (Object.keys(signIn).length === 0) throw new Error("Copilot isn't signed in on this computer, so no session can start: sign in to Copilot CLI first");
  return signIn;
}

// Throws when any folder from Wheelhouse's home down to `dir` is a link (ruling P8-12), so nothing written or removed
// under `dir` can land outside the home. Folders not made yet are not looked at.
function refuseLinkedPath(dir) {
  const home = path.resolve(wheelhouseHome());
  const relative = path.relative(home, path.resolve(dir));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${dir} isn't inside Wheelhouse's home`);
  let at = home;
  for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
    at = part === '' ? at : path.join(at, part);
    const stat = fs.lstatSync(at, { throwIfNoEntry: false });
    if (stat === undefined) return;
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${at} must be a folder Wheelhouse made, and it is a link or a file, so nothing is written there`);
  }
}

// Copies one verified skill folder into the home's skills/, then checks the copy against the manifest's hash: a link
// is never copied, and a copy that differs refuses the start.
function copySkill(skill, into) {
  const target = path.join(into, skill.name);
  fs.cpSync(skill.dir, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`The ${skill.name} skill holds a link, which is never given to a session`);
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
  };
  walk(target);
  if (typeof skill.hash === 'string' && fingerprintTree(target).hash !== skill.hash) throw new Error(`The ${skill.name} skill copied into the session's home doesn't match Wheelhouse's manifest, so no session is started`);
}

// Writes the session's own home before a start (ruling P7-7), and returns its path: Wheelhouse's hook registration in
// hooks/wheelhouse.json (the only place Wheelhouse's hooks load without trust, check 56), the only hook file there;
// the kit's agents, the only agents there; the pinned kits' skills (`skills`, each `{ name, dir, hash }` from
// kitSkills), the only skills there; config.json holding the sign-in keys only, from the person's Copilot home
// (`signedInFrom`); and nothing else but Copilot's own state. config.json is written last, so a home is never signed
// in without its guards: a write that fails part way leaves a home no session can sign in from. A source with no
// sign-in refuses the start before anything in the home is touched, and so does a link anywhere from Wheelhouse's
// home down to the session's.
export function writeSessionHome({ project, target, signedInFrom = copilotHome(), node = process.execPath, root = PLUGIN_ROOT, platform = process.platform, skills = [] }) {
  const home = sessionHome(project, target);
  const signIn = signInOf(signedInFrom);
  if (!Array.isArray(skills) || !skills.every((s) => s !== null && typeof s === 'object' && typeof s.name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s.name) && typeof s.dir === 'string')) {
    throw new Error("A session's skills are each a plain name and a folder");
  }
  refuseLinkedPath(home);

  const there = fs.lstatSync(home, { throwIfNoEntry: false });
  if (there && !there.isDirectory()) throw new Error(`A session's Copilot home must be a folder Wheelhouse made, and ${home} isn't`);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  refuseLinkedPath(home);
  for (const name of fs.readdirSync(home)) {
    const own = COPILOT_STATE.some((pattern) => pattern.test(name)) && !fs.lstatSync(path.join(home, name)).isSymbolicLink();
    // A link is removed, never followed; Wheelhouse's own four are written afresh.
    if (!own) fs.rmSync(path.join(home, name), { recursive: true, force: true });
  }

  writeRegistration({ home, node, root, platform });
  const agents = path.join(home, 'agents');
  fs.mkdirSync(agents);
  for (const name of fs.readdirSync(KIT_AGENTS).filter((n) => n.endsWith('.agent.md'))) fs.copyFileSync(path.join(KIT_AGENTS, name), path.join(agents, name));
  if (skills.length > 0) {
    const into = path.join(home, 'skills');
    fs.mkdirSync(into);
    for (const skill of skills) copySkill(skill, into);
  }

  const config = path.join(home, 'config.json');
  const temp = `${config}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(signIn, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, config);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return home;
}

// The role's model from the routing table's Copilot column (`config.agentRouting.copilot.<role>`, ruling P7-6), or
// null for Copilot's own default. Claude Code's `routing` is never read here.
function modelOf(config, role) {
  const model = config?.agentRouting?.copilot?.[role] ?? null;
  if (model !== null && !isModelName(model)) throw new Error(`The ${role}'s model for Copilot can't be passed to copilot`);
  return model;
}

// The words the switch refuses with, while BACKGROUND_SESSIONS_READY is false (ruling P8-1).
export const NOT_SWITCHED_ON = "Copilot's background sessions aren't switched on yet: their first real run hasn't been seen";

function switchedOn(ready) {
  if (ready !== true) throw new Error(NOT_SWITCHED_ON);
}

// Whether a foreman session can be started under `config`: throws, in plain words, when the watcher's second shape is
// asked for (on Copilot the watcher wakes a fresh foreman for each wake, ruling P8-6), when its model can't be
// passed, and while the sessions aren't switched on.
function checkForemanAt(config, ready) {
  if (config?.watcherShape === 2) throw new Error("On Copilot the watcher wakes a fresh foreman for each wake; the second shape isn't offered");
  modelOf(config, 'foreman');
  switchedOn(ready);
}

// Whether a feature session can be started under `config`: throws, in plain words, when its model can't be passed,
// and while the sessions aren't switched on.
function checkFeatureAt(config, ready) {
  modelOf(config, 'builder');
  switchedOn(ready);
}

export const checkForeman = (config) => checkForemanAt(config, BACKGROUND_SESSIONS_READY);
export const checkFeature = (config) => checkFeatureAt(config, BACKGROUND_SESSIONS_READY);

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

// One session's call (ruling P7-2): `{ file, args, env, input, verbatim, home, usageFile, logDir, activityFile,
// output }`, `output` being the activity file again: the waker hands the child that file as its stdout (ruling P8-2).
// `rules` are `{ allow, deny }` in Copilot's syntax: the foreman's own tools, or a feature's level's (featureRules);
// none given allows nothing, which fails closed (a tool no rule allows is refused at once, check 61). `copilot` is
// the program as resolveCommand finds it. Through a .cmd shim the whole line, the prompt included, goes through
// quoteForCmd: Copilot was never shown to read -p's prompt on stdin, so every prompt is Wheelhouse's own short text
// naming a file, and one quoteForCmd refuses fails the start in plain words (ruling P7-5). The home must already hold Wheelhouse's hook file (writeSessionHome), or
// the call refuses.
function sessionCall({ project, target, role, config, prompt, rules = {}, resume = null, runId = crypto.randomUUID(), env = process.env, platform = process.platform, copilot = null }) {
  if (typeof prompt !== 'string' || prompt === '') throw new Error('A session needs a prompt');
  // A prompt is never read as a flag.
  if (prompt.startsWith('-')) throw new Error("A session's prompt can't start with a dash");
  const home = sessionHome(project, target);
  // No session starts from a home without Wheelhouse's guards (writeSessionHome writes them first).
  if (!fs.lstatSync(hookFile({ home }), { throwIfNoEntry: false })?.isFile()) {
    throw new Error("This session's Copilot home has no Wheelhouse hook file, so its guards wouldn't run: no session is started");
  }
  const model = modelOf(config, role);
  const run = plainId(runId, 'run id');
  const activity = path.dirname(activityFile(project, run));
  const logDir = path.join(activity, `${run}.logs`);
  const usageFile = path.join(activity, `${run}.usage.json`);
  const allow = rulesOf(rules.allow, 'allow');
  const deny = rulesOf(rules.deny, 'deny');
  const args = [
    ...(resume === null ? [] : [`--resume=${plainId(resume, 'session id')}`]),
    '-p', prompt, '--output-format', 'json', '--no-auto-update', '--disable-builtin-mcps', '--no-ask-user', '--disallow-temp-dir',
    '--log-dir', logDir, '--usage-output-file', usageFile, '--agent', `wheelhouse-${role}`,
    ...(model === null ? [] : ['--model', model]),
    ...allow.map((rule) => `--allow-tool=${rule}`),
    ...deny.map((rule) => `--deny-tool=${rule}`),
  ];
  // Held absolutely, whatever a caller passes: the prompt is the one argument not read as a flag.
  const flags = args.filter((_, i) => args[i - 1] !== '-p');
  if (flags.some((arg) => WIDE_FLAGS.some((wide) => arg === wide || arg.startsWith(`${wide}=`)))) {
    throw new Error('A Copilot session is never started trusted or with every permission given');
  }
  const resolved = copilot ?? resolveCommand({ name: 'copilot', platform, env });
  let call;
  if (resolved.kind === 'cmd') {
    let line;
    try {
      line = [resolved.file, ...args].map(quoteForCmd).join(' ');
    } catch {
      throw new Error('This Copilot session can\'t be started through a .cmd program safely: an argument holds ", %, ! or a closing backslash, which cmd.exe would change');
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
    home,
    usageFile,
    logDir,
    activityFile: activityFile(project, resume ?? run),
    output: activityFile(project, resume ?? run),
  };
}

// A fresh foreman for one wake, run in the project's main checkout. Its rules are its own tools, each
// `Bash(<command>:*)` given as `shell(<command>:*)`, with no write (ruling P7-3). Copilot runs the watcher's first
// shape only, so there is no long foreman session, and asking for one refuses (ruling P8-6).
function buildForemanCall({ config, project, prompt, tools = null, env, platform = process.platform, pluginRoot = PLUGIN_ROOT, copilot = null, runId, long = false }) {
  if (long) throw new Error("Copilot's foreman runs one wake at a time; its long session isn't built");
  const given = tools ?? foremanTools(pluginRoot, { platform });
  const allow = given.filter((tool) => /^Bash\(.+\)$/s.test(tool)).map((tool) => `shell(${tool.slice('Bash('.length)}`);
  return sessionCall({ project, target: 'foreman', role: 'foreman', config, prompt, rules: { allow }, env, platform, copilot, runId });
}

// A feature session's level and rules (ruling P7-11), worked out here, never taken from the caller: `rules` and
// Claude Code's `allowed` are ignored. The level that runs is levelAllowed's; given no level, or one that can't be
// read, it is Ask with no grants (failing closed). The grants' commands count only while the configuration still
// lists them, as featureAllowRules counts them. `domains` are the project's web domains, its configuration's when
// not given. Throws when the worktree isn't a whole path.
function featureRules({ config, level, grants, guardedCommand = null, worktree, domains, realUsers, keysUnreadable, hostApproval, unattendedConfirmed, platform = process.platform }) {
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
function featureCall({ rules: _rules, level, grants, guardedCommand, worktree, domains, realUsers, keysUnreadable, hostApproval, unattendedConfirmed, ...rest }, extra) {
  const feature = featureRules({ config: rest.config, level, grants, guardedCommand, worktree, domains, realUsers, keysUnreadable, hostApproval, unattendedConfirmed, platform: rest.platform });
  return { ...sessionCall({ ...rest, ...extra, rules: feature.rules }), level: feature.level };
}

// A feature's first session, run in its worktree, at the level levelAllowed lets run (`level` in the call's result).
// Copilot can't be given a session id, so `sessionId` is ignored; sessionIdOf reads Copilot's own from the run's output,
// and `idFromRun` tells the waker so (ruling P8-3).
function buildFeatureStartCall({ sessionId: _ignored, project, work, ...rest }) {
  return { ...featureCall(rest, { project, target: `feature-${work}`, role: 'builder' }), idFromRun: true };
}

// A feature's session, woken: `--resume=<id>` in the feature's own home, never `--continue` (which takes the newest
// session in the home, check 61). Its rules are worked out afresh, so a grant spent by an earlier run is not given.
function buildFeatureResumeCall({ sessionId, project, work, ...rest }) {
  if (sessionId === undefined || sessionId === null) throw new Error('A wake needs the session id');
  return featureCall(rest, { project, target: `feature-${work}`, role: 'builder', resume: sessionId });
}

// Each call checks the switch itself, so no caller (the waker, the foreman's start, an evaluation runner) can build
// one while the sessions aren't switched on (ruling P8-1).
function switched(ready, build, options) {
  switchedOn(ready);
  return build(options);
}
export const foremanCall = (options) => switched(BACKGROUND_SESSIONS_READY, buildForemanCall, options);
export const featureStartCall = (options) => switched(BACKGROUND_SESSIONS_READY, buildFeatureStartCall, options);
export const featureResumeCall = (options) => switched(BACKGROUND_SESSIONS_READY, buildFeatureResumeCall, options);

// The events in a run's output, one JSON object per line; a line that isn't one is skipped.
export function eventsOf(stdout) {
  const events = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      const event = JSON.parse(line);
      if (event !== null && typeof event === 'object' && !Array.isArray(event)) events.push(event);
    } catch {
      // Not an event line.
    }
  }
  return events;
}

// The last `assistant.message` with something in it, or null (check 66).
export function finalAnswer(stdout) {
  let last = null;
  for (const event of eventsOf(stdout)) {
    const content = event.type === 'assistant.message' ? event.data?.content : undefined;
    if (typeof content === 'string' && content.trim() !== '') last = content;
  }
  return last;
}

// The session id from the last `result` event, when it is a plain id; otherwise null.
export function sessionIdOf(stdout) {
  let last = null;
  for (const event of eventsOf(stdout)) if (event.type === 'result') last = event.sessionId;
  return typeof last === 'string' && PLAIN_ID.test(last) ? last : null;
}

// The kinds of refusal, by their messages (checks 58, 61 and 69). A guard's come first, so a Wheelhouse guard's
// refusal is never taken for a gap in the rules, whatever its reason quotes. A refusal is a guard's only when it
// carries the code `denied` and its message is one of the hook's own forms, from its start (ruling P8-10): the
// guard's reason ("Denied by preToolUse hook: ...", the exit-2 form among them) or a hook that failed ("Denied by
// preToolUse hook from "<file>" (hook errored)"), so a tool's own message quoting those words is no guard's.
const GUARD = [/^Denied by preToolUse hook: /, /^Denied by preToolUse hook from "[^"\r\n]*" \(hook errored\)$/];
const RULE = /denied due to the following rules:?\s*(.*)$/s;
const NO_RULE = /no interactive user response was available/;

// Each refused tool call, in order, as `{ tool, kind }`, with `rule` when a deny rule named one. All carry the code
// `denied` and the run still exits 0, so what happened is read from these events, never from the exit code.
export function refusalsOf(stdout) {
  const toolOf = new Map();
  const refusals = [];
  for (const event of eventsOf(stdout)) {
    if (event.type === 'tool.execution_start') toolOf.set(event.data?.toolCallId, event.data?.toolName);
    if (event.type !== 'tool.execution_complete' || event.data?.success !== false) continue;
    const tool = toolOf.get(event.data?.toolCallId);
    const message = typeof event.data?.error?.message === 'string' ? event.data.error.message : '';
    // The tool's name is cleaned as the activity's tool counts are (ruling P8-10).
    const refusal = { tool: typeof tool === 'string' && TOOL_NAME.test(tool) ? tool : tool === undefined || tool === null || tool === '' ? 'unknown' : 'other' };
    if (event.data?.error?.code === 'denied' && GUARD.some((form) => form.test(message))) refusal.kind = 'guard';
    else if (RULE.test(message)) {
      refusal.kind = 'rule';
      const rule = RULE.exec(message)[1].replace(/`/g, '').trim();
      if (rule !== '') refusal.rule = shown(rule);
    } else if (NO_RULE.test(message)) refusal.kind = 'no-rule';
    else refusal.kind = 'other';
    refusals.push(refusal);
  }
  return refusals;
}

// The first refusal's kind, or null when nothing was refused.
export function refusalOf(stdout) {
  return refusalsOf(stdout)[0]?.kind ?? null;
}

// A line as an activity record may hold it: cut short, and replaced by a note when the secret scan flags it,
// before or after the cut, so the scan the state's write makes never refuses the record.
function shown(line) {
  const cut = line.slice(0, COMMAND_CHARS);
  const hits = [...new Set([...scanText(line), ...scanText(cut)].map((hit) => hit.pattern))].sort();
  return hits.length > 0 ? `[hidden: matched ${hits.join(', ')}]` : cut;
}

const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;

// What a run did, for its `activity` record (ruling P7-4): `{ session, tools, commands, refusals }`.
export function activitySummary(stdout) {
  const tools = {};
  const commands = [];
  for (const event of eventsOf(stdout)) {
    if (event.type !== 'tool.execution_start') continue;
    const name = typeof event.data?.toolName === 'string' && TOOL_NAME.test(event.data.toolName) ? event.data.toolName : 'other';
    tools[name] = (tools[name] ?? 0) + 1;
    const command = event.data?.arguments?.command;
    if (typeof command === 'string' && command.trim() !== '' && commands.length < MOST_COMMANDS) commands.push(shown(command));
  }
  return { session: sessionIdOf(stdout), tools, commands, refusals: refusalsOf(stdout) };
}

const numberOr = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const TOKEN_KINDS = ['input', 'output', 'cache_read', 'cache_write'];
const tokensOf = (details) => Object.fromEntries(TOKEN_KINDS.map((kind) => [kind, numberOr(details?.[kind]?.tokenCount)]));

// A session's use, read by field name (check 64): the usage file (`--usage-output-file`), else the last
// `session.usage_checkpoint` event, else nothing but the `result` event's premium requests. A missing field is
// null, never 0. `source` says which was read.
export function sessionUsage({ usageFile = null, stdout = '' } = {}) {
  const events = eventsOf(stdout);
  let premiumRequests = null;
  let checkpoint = null;
  for (const event of events) {
    if (event.type === 'result') premiumRequests = numberOr(event.usage?.premiumRequests);
    if (event.type === 'session.usage_checkpoint' && event.data !== null && typeof event.data === 'object') checkpoint = event.data;
  }
  let file = null;
  if (typeof usageFile === 'string') {
    try {
      const parsed = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) file = parsed;
    } catch {
      // Missing or unreadable: the next source.
    }
  }
  if (file !== null) {
    return { source: 'file', totalNanoAiu: numberOr(file.totalNanoAiu), totalPremiumRequestCost: numberOr(file.totalPremiumRequestCost), tokens: tokensOf(file.tokenDetails), premiumRequests };
  }
  if (checkpoint !== null) {
    const snapshot = checkpoint.accountingSnapshot;
    return {
      source: 'checkpoint',
      totalNanoAiu: numberOr(checkpoint.totalNanoAiu ?? snapshot?.totalNanoAiu),
      totalPremiumRequestCost: numberOr(snapshot?.totalPremiumRequestCost),
      tokens: tokensOf(snapshot?.tokenDetails),
      premiumRequests,
    };
  }
  return { source: premiumRequests === null ? null : 'result', totalNanoAiu: null, totalPremiumRequestCost: null, tokens: tokensOf(null), premiumRequests };
}

// The model a run used, by name (check 64: the usage file's `currentModel`, else the last checkpoint's), or null.
export function modelOfRun({ usageFile = null, stdout = '' } = {}) {
  const plain = (value) => (typeof value === 'string' && isModelName(value) ? value : null);
  if (typeof usageFile === 'string') {
    try {
      const file = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
      if (plain(file?.currentModel) !== null) return file.currentModel;
    } catch {
      // Missing or unreadable: the checkpoint.
    }
  }
  let model = null;
  for (const event of eventsOf(stdout)) {
    if (event.type === 'session.usage_checkpoint') model = plain(event.data?.accountingSnapshot?.currentModel) ?? plain(event.data?.currentModel) ?? model;
  }
  return model;
}

// A credit is a billion of the `totalNanoAiu` unit (check 64 reads the name so; Copilot's output doesn't say it).
const NANO_AIU_PER_CREDIT = 1e9;

// What a run that named its session leaves on this computer once it ends (rulings P8-19 and P8-21): its use in the
// usage store, by the session it was (the sessions Wheelhouse started, each counted as its own use), and the
// session's provenance, for the pull requests it opens: the pinned kits' commits (the start checked them), the
// versions read before it started (`versions`, each null when not known) and the model it used. Each informs: one
// that can't be written is passed over, and the run still settles.
function recordRun({ project, sessionId, work, usage, model, versions, at }) {
  try {
    recordRunUsage({
      at, session: sessionId, project, role: work === undefined ? 'foreman' : 'feature', work, agent: 'copilot',
      credits: usage.totalNanoAiu === null ? null : usage.totalNanoAiu / NANO_AIU_PER_CREDIT,
      // The two are kept apart (review Minor 9): a count of requests from the result, and the usage file's cost.
      premiumRequests: usage.premiumRequests,
      premiumCost: usage.totalPremiumRequestCost,
      tokens: usage.tokens,
    });
  } catch { /* the run's use isn't counted */ }
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

// Removes the project's activity older than ACTIVITY_DAYS: each run's output, usage file and log folder, by when
// it was last written. A link is removed, never followed, and a link anywhere from Wheelhouse's home down to the
// activity folder refuses the whole prune (ruling P8-12). Returns the names removed.
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

// The board note a run leaves when a Wheelhouse guard refused something in it: one per run, naming the session and
// the tools, never what was refused (the activity record holds that).
function guardNote(refusals, work) {
  const tools = [...new Set(refusals.map((r) => r.tool))].slice(0, 5);
  const who = work === undefined ? "the foreman's run" : `the ${work} session's run`;
  const times = refusals.length === 1 ? 'one tool call' : `${refusals.length} tool calls`;
  return `A Wheelhouse guard refused ${times} in ${who} (${tools.join(', ')}). The run's activity record lists them.`;
}

// What a run's whole output says once it ends (ruling P8-2), as `{ ok, why, sessionId, records }`. A run with no
// `result` event failed, whatever its exit code (`code`, which is never read: a refusal exits 0, check 61); one with a
// result is done, refusals and all, and its refusals go into its activity record. `records` are what the waker writes
// to the state: the run's `activity` (ruling P7-4), with its use (sessionUsage) and, for a feature, its work; and,
// when a guard refused anything, one `note` for the board. `call` is what the waker kept of the call: its `output`,
// `usageFile` and `idFromRun`. A first run's output (`idFromRun`) is renamed to the session's own name, so its wakes
// append to it (activityFile). Given the `project`, a run that named its session also records its use and the
// session's provenance (recordRun), with `versions`, the versions read before it started.
export function afterRun({ stdout = '', code: _code = null, call = {}, target, project, versions = null, at = new Date().toISOString() } = {}) {
  const finished = eventsOf(stdout).some((event) => event.type === 'result');
  const sessionId = sessionIdOf(stdout);
  const work = typeof target === 'string' && target.startsWith('feature-') ? target.slice('feature-'.length) : undefined;
  const summary = activitySummary(stdout);
  const usage = sessionUsage({ usageFile: typeof call?.usageFile === 'string' ? call.usageFile : null, stdout });
  const records = [{ kind: 'activity', data: { ...summary, role: work === undefined ? 'foreman' : 'builder', ...(work === undefined ? {} : { work }), usage, at } }];
  if (typeof project === 'string' && sessionId !== null) {
    recordRun({ project, sessionId, work, usage, model: modelOfRun({ usageFile: typeof call?.usageFile === 'string' ? call.usageFile : null, stdout }), versions, at });
  }
  const guards = summary.refusals.filter((r) => r.kind === 'guard');
  if (guards.length > 0) records.push({ kind: 'note', data: { text: guardNote(guards, work) } });
  if (call?.idFromRun === true && sessionId !== null && typeof call.output === 'string' && path.basename(call.output).endsWith('.jsonl')) {
    const named = path.join(path.dirname(call.output), `${sessionId}.jsonl`);
    try {
      if (named !== call.output && fs.lstatSync(call.output, { throwIfNoEntry: false })?.isFile() && fs.lstatSync(named, { throwIfNoEntry: false }) === undefined) {
        fs.renameSync(call.output, named);
      }
    } catch { /* the output stays under the run's own name */ }
  }
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

// The proofs an answer must name for its build-command grant to count (the waker's buildGrants).
export const GRANT_PROOFS = Object.freeze(['window']);

// The sessions part. `ready` is the switch (BACKGROUND_SESSIONS_READY unless a test builds the part switched on);
// `kits` ({ manifest, fetchTo }) and `home` ({ signedInFrom, node, root }) are for tests, which never fetch from the
// network or read the person's Copilot home. `versions` ({ run, env, home, runSubset }) is how the versions are read
// and a new one checked: `run` starts `copilot --version`, and `runSubset` is the safety subset's runner, which Part 8
// Task 3 builds (until then noSubsetRunner, which fails, so a new version holds Copilot work).
export function sessionsPart({ ready = BACKGROUND_SESSIONS_READY, kits = {}, home = {}, versions: versionsFrom = {} } = {}) {
  const { runSubset = noSubsetRunner, run = realRun, ...readFrom } = versionsFrom;
  // The versions read before this part's latest start, for that run's provenance.
  let lastVersions = null;
  return Object.freeze({
    checkForeman: (config) => checkForemanAt(config, ready),
    checkFeature: (config) => checkFeatureAt(config, ready),
    foremanCall: (options) => switched(ready, buildForemanCall, options),
    featureStartCall: (options) => switched(ready, buildFeatureStartCall, options),
    featureResumeCall: (options) => switched(ready, buildFeatureResumeCall, options),
    finalAnswer,
    // Before every start (ruling P7-27 a): the versions in use read, and a new one checked by the safety subset before
    // any work starts on it (rulings P8-20, P8-23); the pinned kits fetched once and checked; the activity folder; and
    // the session's own home written afresh. A throw refuses the start; nothing has been run. A version that fails,
    // or a kit that differs, holds the project's work (its agent hold) and carries the lineage hold's record; a check
    // that passes again lifts that hold, and says so (`lifted`).
    async prepare({ project, target }) {
      switchedOn(ready);
      const versions = await readVersions({ ...readFrom, run });
      lastVersions = versions;
      const checked = await checkVersions({ project, versions, runSubset, ...(readFrom.home === undefined ? {} : { home: readFrom.home }) });
      const { skills, lifted } = await kitsForSession({ project, ...kits });
      activityFolder(project);
      writeSessionHome({ project, target, skills, ...home });
      // A hold of this project's that the checks just removed: the waker records its lift, so its card closes.
      return { lifted: checked?.lifted === true || lifted === true };
    },
    afterRun: (options) => afterRun({ ...options, versions: lastVersions }),
    pruneActivity,
    // A build-command grant counts only from a click in the helper's own window (ruling P8-8): no Copilot hook
    // signs, so no other answer binds.
    grantProofs: GRANT_PROOFS,
  });
}

export default sessionsPart();
