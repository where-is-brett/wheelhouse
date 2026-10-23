// scripts/setup/project-files.js
// Setup's step 7, the project's files, the pins and protection (design section 15).
//
// Its card lists, and its apply makes, in this order:
//   1. the project's own files, each key by key, so every setting of the director's stays as it
//      was (a file that isn't there yet is made whole, as a `file` change with nothing before it):
//      .claude/settings.json merged with Standard's settings (projectSettings), with Wheelhouse's
//      marketplace at the release this computer installed and auto-update off, the pins switched
//      on and the other copies off; .claude/wheelhouse.json, the configuration, with every plan's
//      defaults and `liveData` from step 4's answer (starterConfig); this computer's
//      .claude/settings.local.json merged with localSettings (the helper's socket, the status line
//      and the allow rules for the front desk's and setup's commands, ruling R43, with the front
//      desk's input file, ruling F85), which holds this computer's paths and is never committed,
//      and kept out of git by a line in the folder's own .git/info/exclude unless the product
//      already ignores it; `.wheelhouse/` kept out of git by another line there (ruling R108)
//      unless the list holds it already; and CLAUDE.md's "Compact instructions" section (design
//      section 10), added once;
//   2. the pins, Superpowers and Matt Pocock's skills, each installed by the documented command,
//      `claude plugin install <plugin>@wheelhouse --scope project`, run in the project's folder
//      (check 37: the project's settings alone don't install them, and the command needs no
//      sign-in; ruling R46); Claude Code writes the project's settings again on the way, so any
//      of setup's keys it changed is put back, key by key through the journal, every other key
//      left as it is; then the lineage check (checkInstalled) must pass.
//      Board-and-usage check 32 found the mod needs no second plugin, so there is no
//      wheelhouse-mod to install;
//   1 (continued). secrets kept out of git, planned before the pins and written with the files in
//      apply's first part. The tool guard treats `.env` and `.env.*` as secrets, and a file
//      `git add -A` commits is readable from .git/objects, where the guard cannot see, so the
//      project's .gitignore must keep them out of git (names that start `.env` in other ways,
//      such as `.envrc`, are left to the guard and the sandbox). git itself is asked
//      (`git check-ignore --no-index -v`) about `.env`, `.env.local`, `.env.production` and
//      `.env.wheelhouse-probe`, each at the root and inside a folder, never `.env.example`, which
//      many projects commit on purpose; so a broader pattern (`.env*`, `**/.env*`) counts, and
//      `.env.local` alone (`.env*.local`, `*.local`) or a root-only rule (`/.env`) does not. A probe
//      is covered only when the rule that decides it is not a negation and is in the project's
//      root .gitignore: .git/info/exclude and the computer's global ignore file are not shared with
//      other computers, and any answer git does not give counts as not covered (it fails closed).
//      When the working .gitignore differs from HEAD's, the same probes are asked again of a
//      temporary repository holding HEAD's text (headMissing): the committed text must cover, or the
//      .gitignore is involved and the director asked, whatever the working copy says (a rule such as
//      `.*` covers there without naming .env). On a joining computer, a probe decided by a negation
//      in the root .gitignore gets no exclude line, which that negation would beat; the step says so.
//      What is missing, `.env` and/or `.env.*`, is appended to the root .gitignore (made if absent,
//      the director's text and line endings kept), one `file` change a line, on this step's card;
//      a `!.env.example` line the file holds is restated after `.env.*`, so the example stays
//      shared. The cover must hold in what goes up as well as in the folder: the .gitignore is
//      involved, and asked about like the three files when it holds changes of the director's own,
//      when setup adds lines, when it is untracked or deleted (a deleted one has its own question),
//      when HEAD's text does not cover, or when a changed line mentions `.env`, unless the changes
//      are only lines setup's journal recorded writing. On a first
//      computer it goes up in setup's commit; on a computer joining (ruling R78), which commits
//      nothing, the lines go in this computer's own .git/info/exclude instead, where either file
//      counts as cover. Uninstall keeps these lines (scripts/setup/uninstall.js);
//   3. the setup commit, "Set up Wheelhouse", of the three shared files (.claude/settings.json,
//      .claude/wheelhouse.json and CLAUDE.md), and the .gitignore when the lines above are added to
//      it, made with `git commit --only`, so nothing the director had staged goes in, by the
//      signed-in host account (its no-reply address: a fresh
//      computer has no git identity), and pushed by the helper to the default branch with the
//      director's own sign-in, their host tool as git's credential helper (directorGitEnv), never
//      the narrow key and never /push (ruling R42). Before it is made, the folder is read again:
//      still on the default branch, at the tip the plan read, and the files holding what this
//      apply wrote; the commit made must be setup's alone on that tip, and the push sends that
//      exact commit, never whatever HEAD is. A commit, a branch switch or an edit made while the
//      kits installed stops the step with nothing committed or pushed;
//   4. then protection, switched on with the same sign-in (switchOnAsDirector, Task 8) and read
//      back and said as it is. It comes after the commit: once it is on, nothing goes straight to
//      the default branch, and the gate can't merge without CI and Wheelhouse running.
// Each change is recorded in the journal just before it is made: the files through
// ctx.applyJsonKey or as `file` changes, each pin as a `process` change with what was installed
// before, the commit and the push as `host` changes with the branch's tip before them, and
// protection as a `host` change with what was on before.
//
// The plan reads the default branch from the host (ruling R34) and refuses one of Wheelhouse's own
// branches. Any other default branch is where the commit and protection land, and the card names
// it, since it is the director's own setting on the host and the gate merges into it from then
// on; a folder on another branch than the default is refused, saying how to bring the two
// together, so setup's commit never lands on a branch the folder isn't on. It refuses too when the
// folder holds commits of the director's not yet on the host (they would go up with setup's), when
// the host holds commits the folder hasn't got. When one of the three files holds the director's
// own changes not yet committed (the .gitignore too: see its part above), it asks (ruling R95):
// "Put your changes to <file> in setup's commit" or "Leave them; I'll come back", under an id carrying a hash of the file's text, so a
// file changed since asks again (R51); recommended Put them in for a new product (step 3 made its
// repository), Leave them for an existing one. Put them in lists them on the commit, so the card
// says so and the list's hash covers them; Leave them makes the step wait, saying why. What step
// 1's project-scope install left in the project's settings (the plugin switched on, check 37) is
// not the director's, and goes up in setup's commit with no question. A setup commit
// made but not pushed (a push that failed) is pushed by the next Go ahead, and nothing is
// committed twice; a commit whose sha the journal recorded for the push (written before it is
// tried) is accepted as setup's own, with the director's .gitignore changes they chose to put in.
//
// On a computer joining a project set up on another (ruling R78), the step runs in its "this
// computer" form: this computer's .claude/settings.local.json key by key, the .git/info/exclude
// lines and the pins, with no commit and no protection, which the first computer made. The
// configuration is the project's as committed (.claude/wheelhouse.json), so step 4's answers,
// which a joining run never has, are not read; its `after` of step 4 counts as done there
// (scripts/lib/setup-run.js, stepDone). A shared file that differs from what is committed is left
// as it is and named on the card, never committed. The committed .claude/settings.json is left
// exactly as committed (ruling R103): rewritten by Claude Code while the pins install, in a layout
// of its own but holding the same, it gets the committed text back; holding something else, it is
// left as it is and named in a line.
//
// The step is long (it installs and pushes), so it runs in its own process. It waits for step 3,
// which registers the project and clones its state, and step 4, whose live-data answer the
// configuration holds (`after: [3, 4]`; on a joining run, step 3 only). The foreman's start and
// the first briefing are not here: they are the last thing setup does, at the end of step 10
// (ruling R44).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETUP_FILES } from '../../adapters/claude-code/packaging.js';
import { run as realRun, withoutGitVars } from '../lib/run.js';
import { joinedRepo } from '../lib/setup-run.js';
import { toolPath } from '../lib/host-tools.js';
import { helperAddress } from '../lib/paths.js';
import { projectForFolder } from '../lib/projects.js';
import { canonicalJson } from '../lib/canonical.js';
import { resolveClaude, invocation, withoutHostVariables } from '../lib/claude.js';
import { SETUP_TITLES, SETUP_LABEL } from '../state/card-lines.js';
import { composeCard } from '../cards/compose.js';
import { CARD } from '../lib/front-desk.js';
import { STATE_BRANCH } from '../state/clone.js';
import { sameRemote } from '../state/git.js';
import { PROFILE_BRANCH } from '../profile/store.js';
import { readConfig } from '../gate/guardrails.js';
import { projectSettings, localSettings, mergeSettings, directorStatusLine } from '../protection/settings.js';
import { protectionStatus as realProtectionStatus } from '../host/protection.js';
import { projectPath } from '../host/gitlab-key.js';
import { DEFAULT_GITLAB, commitEmailOf } from '../host/gitlab-base.js';
import { MARKETPLACE, readManifest, checkInstalled, locateInstalled, claudeHome as defaultClaudeHome } from '../lineage/manifest.js';
import { switchOnAsDirector, directorGitEnv, directorGitlabApi, madeBySetup, STOPPED, launchedIn, REAL_USERS } from './host.js';
import { isolated, refuseUnlistedSettings, reaching } from './git.js';
import { toolsStatus, PLUGIN_ROOT } from './tools.js';
import { LIVE_DATA } from './questions.js';
import { newId, readJournal, SAY_CHARS } from './journal.js';

export const COMMIT_MESSAGE = 'Set up Wheelhouse';
// The setup commit's files, and only these (ruling R42). The adapter holds the list (packaging.js).
export { SETUP_FILES };
const [SETTINGS, CONFIG, CLAUDE] = SETUP_FILES;
const samePathText = (a, b) => path.resolve(a) === path.resolve(b);
const LOCAL = '.claude/settings.local.json';
// The line that keeps this computer's settings out of git, in the folder's own .git/info/exclude.
export const EXCLUDE_LINE = '/.claude/settings.local.json';
// The line that keeps Wheelhouse's own folder in the project out of git, in the same list (ruling
// R108), and every form of it ensureIgnored (scripts/feature/files.js) takes as already there.
export const WHEELHOUSE_LINE = '.wheelhouse/';
const WHEELHOUSE_FORMS = Object.freeze(['.wheelhouse/', '/.wheelhouse/', '.wheelhouse', '/.wheelhouse']);
// Whether an ignore list's text holds the line already, in any form that counts as it.
const holdsLine = (text, line) => text !== null && text.split(/\r?\n/)
  .some((l) => (line === WHEELHOUSE_LINE ? WHEELHOUSE_FORMS.includes(l.trim()) : l === line));
// The project's own ignore list, which keeps secrets out of git, and the names that must be kept out
// of it: `.env` and `.env.*`, probed by name at the root and in a folder (not `.env.example`, which
// many projects commit on purpose). A line is added only where its probes are not already ignored.
export const GITIGNORE = '.gitignore';
// The guard treats a `.env` file at any depth as a secret, so the probes include a nested folder
// (named so it is never a real one); `.env.<x>` is probed by three names in each place, so a rule that covers
// only `.env.local` (`.env*.local`, `*.local`) doesn't count as covering them all.
const NESTED_PROBE = 'wheelhouse-probe';
const ENV_ONLY = Object.freeze(['.env', `${NESTED_PROBE}/.env`]);
const ENV_DOT = Object.freeze(['.env.local', '.env.production', '.env.wheelhouse-probe', `${NESTED_PROBE}/.env.local`, `${NESTED_PROBE}/.env.production`, `${NESTED_PROBE}/.env.wheelhouse-probe`]);
const ENV_LINES = ['.env', '.env.*'];
// The lines uninstall keeps, wherever setup wrote them.
export const ENV_STAYS_LINES = Object.freeze([...ENV_LINES, '!.env.example']);
const EXAMPLE_KEPT = '!.env.example';
// The only lines setup ever writes to an ignore list for this.
const OUR_LINES = Object.freeze([...ENV_LINES, EXAMPLE_KEPT]);
// What step 1's project-scope install writes into the project's shared settings (check 37): the
// plugin switched on. Setup's commit takes it up with its own keys.
const STEP_ONE_SETTINGS = Object.freeze({ enabledPlugins: Object.freeze({ [`wheelhouse@${MARKETPLACE}`]: true }) });
export const COMPACT_HEADING = '## Compact instructions';
// What the summary of a compaction keeps (design section 10). The session start after a
// compaction reloads Wheelhouse's own records, so these are what only the conversation holds.
export const COMPACT_SECTION = `${COMPACT_HEADING}

When this conversation is summarised, keep:
- what the director asked for and decided, in their own words where they gave them;
- the work in hand: the step being done, what is finished and what is not;
- each card shown to the director, and whether it was answered;
- whether STOP is on;
- the pull requests and branches in play, by number and name.

Leave out file contents and command output that can be read again. Wheelhouse's records hold the rulebook, the levels, the waiting list and the status, and the session start after a compaction gives them back.
`;
// How long the step waits, when asked before step 3 has registered the project or step 4 has its answer.
export const PROJECT_WAIT_MS = 30 * 1000;
// Wheelhouse's own branches, which are never the product's default (ruling R34).
const WHEELHOUSE_BRANCHES = [STATE_BRANCH, 'wheelhouse-lock', PROFILE_BRANCH];
const NAME = { github: 'GitHub', gitlab: 'GitLab' };
const PIN_NAMES = { superpowers: 'Superpowers', 'mattpocock-skills': 'Matt Pocock\'s skills' };
const INSTALL_WAIT_MS = 10 * 60 * 1000;
const GIT_WAIT_MS = 5 * 60 * 1000;
export const NO_CLAUDE = 'Setup could not run Claude Code\'s command line (claude) to install the pinned kits for this project. Install Claude Code\'s command line, then a fresh Go ahead carries on';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// A JSON object's text, as Claude Code's own settings are laid out.
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

// The object a file's text holds; refused, naming the file, when it isn't one, so setup leaves it as it is.
function objectIn(rel, text) {
  if (text === null) return null;
  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch { /* named below */ }
  if (!isObject(data)) throw new Error(`${rel} is not a JSON object, so setup has left it as it was`);
  return data;
}

// Whether two texts of one of the three files hold the same: the same JSON for the settings and
// the configuration (whatever the layout), the same text for CLAUDE.md, whatever its line endings
// (git may write them as the system's own in the folder). Null is no file.
const lines = (text) => text.replace(/\r\n/g, '\n');
function sameContent(rel, a, b) {
  if (a === null || b === null) return a === b;
  if (!rel.endsWith('.json')) return lines(a) === lines(b);
  try {
    return canonicalJson(JSON.parse(a.replace(/^﻿/, ''))) === canonicalJson(JSON.parse(b.replace(/^﻿/, '')));
  } catch {
    return false;
  }
}

// ---- The configuration ----

// .claude/wheelhouse.json as setup starts it: every plan's keys with their defaults (readConfig's,
// which fills in the build loop's; no model is named in the routing table, so each role takes the
// command line's own default), the front desk's `pages` (none, so no approval carries over a
// screenshot), and `liveData` from step 4's answer (ruling R31). Real users are the `phase` setting
// in state, never a key here (ruling R38). The configuration is the same on GitHub and GitLab.
export function starterConfig({ answers = {} } = {}) {
  const live = answers['4.live-data'];
  if (live?.label !== LIVE_DATA.yes && live?.label !== LIVE_DATA.no) throw new Error('Step 4 has not been told whether the product holds live data yet');
  return { ...readConfig(null), pages: [], liveData: live.label === LIVE_DATA.yes };
}

// The configuration a project ends up with: the one it has, with each of the starter's keys it
// lacks added, and `liveData` as step 4's answer says. A file that isn't a configuration is refused.
function configFrom(existing, starter) {
  if (existing === null) return structuredClone(starter);
  try {
    readConfig(JSON.stringify(existing));
  } catch {
    throw new Error(`${CONFIG} is not a configuration Wheelhouse can read, so setup has left it as it was: correct it or remove it, then ask again`);
  }
  const out = structuredClone(existing);
  for (const [key, value] of Object.entries(starter)) if (!Object.hasOwn(out, key)) out[key] = structuredClone(value);
  out.liveData = starter.liveData;
  return out;
}

// ---- The release ----

// The Wheelhouse release this project follows: the `ref` of Wheelhouse's marketplace as the
// project's own settings name it (a later run keeps the project's release), else as the install
// line declared it in the user's settings (check 37), else as Claude Code recorded the marketplace
// it fetched. Null when none names one: the project's settings then carry no ref, and the
// marketplace is Wheelhouse's default branch, with auto-update off all the same.
export function wheelhouseRelease({ folder, claudeHome = defaultClaudeHome() }) {
  const refOf = (settings) => settings?.extraKnownMarketplaces?.[MARKETPLACE]?.source?.ref;
  const found = [
    refOf(readJson(path.join(folder, ...SETTINGS.split('/')))),
    refOf(readJson(path.join(claudeHome, 'settings.json'))),
    readJson(path.join(claudeHome, 'plugins', 'known_marketplaces.json'))?.[MARKETPLACE]?.source?.ref,
  ].find((ref) => typeof ref === 'string' && ref !== '');
  return found ? { ref: found } : null;
}

// ---- The files ----

const withSection = (text) => {
  if (text === null || text === '') return COMPACT_SECTION;
  return `${text}${text.endsWith('\n') ? '' : '\n'}\n${COMPACT_SECTION}`;
};
const hasSection = (text) => text !== null && /^##?\s*Compact instructions\s*$/im.test(text);

// The key edits that make `existing` hold `target`: each key whose value differs, as deep as both
// sides are objects, so a list or a value is one edit and every other key stays as it was.
function keyEdits(existing, target, prefix = []) {
  const edits = [];
  for (const key of Object.keys(target)) {
    const here = [...prefix, key];
    const has = Object.hasOwn(existing, key);
    if (has && isObject(existing[key]) && isObject(target[key])) edits.push(...keyEdits(existing[key], target[key], here));
    else if (!has || canonicalJson(existing[key]) !== canonicalJson(target[key])) edits.push({ key: here, value: target[key] });
  }
  return edits;
}

// A JSON file's changes: the whole file when it isn't there, else each key that differs.
function jsonChanges(file, existing, target) {
  if (existing === null) return [{ kind: 'file', target: file, after: jsonText(target) }];
  return keyEdits(existing, target).map(({ key, value }) => ({ kind: 'json-key', target: file, key, after: value }));
}

// What each of the three files will hold once setup has written it, from what it holds: a function
// of its text for each, with the configuration the settings are made from.
function targetsFor({ folder, config, release }) {
  const configNow = objectIn(CONFIG, readText(path.join(folder, ...CONFIG.split('/'))));
  const effective = configFrom(configNow, config);
  const ours = projectSettings(effective, { release });
  return {
    [SETTINGS]: (text) => mergeSettings(objectIn(SETTINGS, text) ?? {}, ours),
    [CONFIG]: (text) => configFrom(objectIn(CONFIG, text), config),
    [CLAUDE]: (text) => (hasSection(text) ? text : withSection(text)),
  };
}

// The changes to the project's files (`folder`), for `config`, the starter configuration, and
// `release` ({ ref } or null): .claude/settings.json merged with projectSettings, the
// configuration, .claude/settings.local.json merged with localSettings (`local`: { address, node,
// pluginRoot, platform, claudeHome }, the status line left out where the director has one of their
// own), and CLAUDE.md's "Compact instructions" section, added once. Each JSON file key by key.
export function projectFilesChange({ folder, config, release = null, local }) {
  if (!isObject(local)) throw new Error('projectFilesChange needs this computer\'s local settings: { address, node, pluginRoot, platform, claudeHome }');
  const at = (rel) => path.join(folder, ...rel.split('/'));
  const targets = targetsFor({ folder, config, release });
  const settingsText = readText(at(SETTINGS));
  const configText = readText(at(CONFIG));
  const changes = [
    ...jsonChanges(at(SETTINGS), objectIn(SETTINGS, settingsText), targets[SETTINGS](settingsText)),
    ...jsonChanges(at(CONFIG), objectIn(CONFIG, configText), targets[CONFIG](configText)),
    ...localFilesChange({ folder, local }),
  ];
  if (!hasSection(readText(at(CLAUDE)))) changes.push({ kind: 'file', target: at(CLAUDE), section: 'Compact instructions' });
  return changes;
}

// The changes to this computer's own .claude/settings.local.json in `folder`, merged with
// localSettings key by key (`local` as projectFilesChange's): all a joining computer's step 7
// writes of the project's files (ruling R78).
export function localFilesChange({ folder, local }) {
  const file = path.join(folder, ...LOCAL.split('/'));
  const text = readText(file);
  const ownStatusLine = local.claudeHome ? directorStatusLine({ claudeHome: local.claudeHome, projectDir: folder }) : null;
  const ours = localSettings({ address: local.address, node: local.node, pluginRoot: local.pluginRoot, platform: local.platform, ownStatusLine });
  return jsonChanges(file, objectIn(LOCAL, text), mergeSettings(objectIn(LOCAL, text) ?? {}, ours));
}

// ---- The director's own changes (ruling R95) ----

// The answer that puts the director's changes to a file in setup's commit, and the one that leaves them.
export const putYoursIn = (rel) => `Put your changes to ${rel} in setup's commit`;
export const LEAVE_YOURS = 'Leave them; I\'ll come back';
// The hash of a file's text as the director left it, whatever its line endings.
const textHash = (rel, text) => crypto.createHash('sha256').update(`${rel}\n${lines(text ?? '')}`).digest('hex');

// The question asked when one of the three shared files holds the director's own changes not yet
// committed: its id carries a hash of the file's text (R51), so a file changed since asks again.
// `isNew`: the product is new (step 3 made its repository), so putting them in is recommended.
export function yoursAsk({ rel, text, isNew }) {
  const put = putYoursIn(rel);
  // A .gitignore deleted here: setup's commit would put back one holding only its own lines.
  const deleted = rel === GITIGNORE && text === null;
  return {
    id: `yours-${textHash(rel, text).slice(0, 12)}`,
    card: {
      level: 3,
      what: deleted
        ? `Setup step 7: ${rel} has been deleted here; setup's commit, "${COMMIT_MESSAGE}", would put back one holding only the .env lines.`
        : `Setup step 7: ${rel} has changes of yours not yet committed. Setup's commit, "${COMMIT_MESSAGE}", would take them up with its own.`,
      why: 'What goes up in setup\'s commit is shared with every computer and agent working on the project.',
      options: [
        { label: put, says: deleted ? 'The commit puts back a .gitignore holding only the .env lines, on your Go ahead.' : 'They go up with setup\'s own changes in its one commit, on your Go ahead.' },
        { label: LEAVE_YOURS, says: 'Setup waits at this step until you have committed them or put them aside.' },
      ],
      recommend: isNew ? put : LEAVE_YOURS,
      because: isNew ? 'every file of a new product is new, so its first commit is the natural home for them' : 'they may be work in progress, which is yours to commit when it is ready',
      meanwhile: 'Setup waits at this step; nothing changes.',
    },
  };
}

// Why step 7 waits once the director chose to leave their changes out.
export const leftYoursLine = (rel) => `${rel} holds changes of yours not yet committed, which you chose to leave out of setup's commit: once they are committed or put aside, setup goes on`;

// What step 7 says on a joining computer when the root .gitignore lets some .env files into git
// through a line starting with !, which nothing in this computer's own list can override.
export const NEGATED_LINE = '.gitignore lets some .env files into git (a line starting with !); this computer can\'t override that, so take it up on the computer that set the project up';
// The same on the card, where the .env cover is claimed only for what this computer's list can cover.
const NEGATED_PART = '.gitignore lets some .env files into git (a line starting with !), which this computer can\'t override: take it up on the computer that set the project up';

// ---- The host and git ----

async function quietly(run, file, args, options = {}) {
  try {
    return await run(file, args, options);
  } catch {
    return { code: 1, stdout: '', stderr: '' };
  }
}

const parsed = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// The default branch, by the host's API with the director's own sign-in (ruling R34).
async function defaultBranchOf({ host, repo, run, gitlab, base }) {
  let branch;
  if (host === 'gitlab') {
    const api = await gitlab({ run, baseUrl: base });
    branch = (await api.get(projectPath(repo)))?.body?.default_branch;
  } else {
    const got = await quietly(run, toolPath('gh'), ['api', `repos/${repo}`]);
    branch = got.code === 0 ? parsed(got.stdout)?.default_branch : undefined;
  }
  if (typeof branch !== 'string' || branch === '') {
    throw new Error(`Setup could not read ${repo}'s default branch from ${NAME[host]} with your sign-in: check you are still signed in (step 3), then ask again`);
  }
  return branch;
}

// The setup commit's author: the signed-in account, with its no-reply address, read with the
// director's own sign-in (`gh api user`, `glab api user`). On GitLab, the account's own commit or
// public address when it has one.
export async function commitAuthor({ host, run = realRun, base = DEFAULT_GITLAB }) {
  // A company's GitLab is named to glab through GITLAB_HOST, which takes a port (check 71).
  const got = await quietly(run, toolPath(host === 'gitlab' ? 'glab' : 'gh'), ['api', 'user'], host === 'gitlab' && base !== DEFAULT_GITLAB ? { env: { GITLAB_HOST: new URL(base).host } } : {});
  const user = got.code === 0 ? parsed(got.stdout) : null;
  const id = user?.id;
  if (host === 'gitlab') {
    const login = user?.username;
    if (typeof login === 'string' && login !== '' && Number.isInteger(id)) {
      return { name: typeof user.name === 'string' && user.name !== '' ? user.name : login, email: commitEmailOf(user, base) };
    }
  } else {
    const login = user?.login;
    if (typeof login === 'string' && login !== '' && Number.isInteger(id)) {
      return { name: typeof user.name === 'string' && user.name !== '' ? user.name : login, email: `${id}+${login}@users.noreply.github.com` };
    }
  }
  throw new Error(`Setup could not read who is signed in to ${NAME[host]}, so the setup commit has no author: sign in again (step 3), then a fresh Go ahead`);
}

// git in the project's folder, with the director's own sign-in, git's global and system config
// shut out, hooks pointed at the null file, and a hook the folder's own config declares refused
// before every call (ruling R109, scripts/setup/git.js): `out(args)` its trimmed output or null,
// `raw(args)` its output as it is or null, `ok(args)` whether it went through, `must(args, doing)`
// its output or a throw naming only what was being done. A setting of the folder's repository not on
// setup's allowed list throws, naming it (ruling R112), and the folder is git's working tree whatever
// that config says.
// https is its only transport, with a local path too only when `remoteUrl`, the project's address
// as setup recorded it, is one (ruling R111).
function gitIn({ run, gitPath, host, platform, folder, remoteUrl, base }) {
  const env = reaching(directorGitEnv({ host, gitPath, platform, base }), remoteUrl);
  const call = async (args) => {
    await refuseUnlistedSettings({ run, gitPath, cwd: folder });
    return quietly(run, gitPath, args, { cwd: folder, env: { ...isolated(env), GIT_WORK_TREE: folder }, baseEnv: withoutGitVars(), timeoutMs: GIT_WAIT_MS });
  };
  // The same shut-out git in another folder, a temporary repository of setup's own, whose settings
  // are none to refuse.
  const callIn = (dir, args) => quietly(run, gitPath, args, { cwd: dir, env: isolated(env), baseEnv: withoutGitVars(), timeoutMs: GIT_WAIT_MS });
  return {
    env,
    rawIn: async (dir, args) => {
      const got = await callIn(dir, args);
      return got.code === 0 ? got.stdout : null;
    },
    okIn: async (dir, args) => (await callIn(dir, args)).code === 0,
    raw: async (args) => {
      const got = await call(args);
      return got.code === 0 ? got.stdout : null;
    },
    out: async (args) => {
      const got = await call(args);
      return got.code === 0 ? got.stdout.trim() : null;
    },
    ok: async (args) => (await call(args)).code === 0,
    must: async (args, doing) => {
      const got = await call(args);
      if (got.code !== 0) throw new Error(`git could not ${doing}`);
      return got.stdout.trim();
    },
  };
}

// The tip of the default branch on the host, or null when it has none.
async function remoteTip(git, remoteUrl, branch) {
  const listed = await git.out(['ls-remote', remoteUrl, `refs/heads/${branch}`]);
  if (listed === null) throw new Error(`Setup could not reach the repository with your sign-in to read ${branch}: check you are still signed in (step 3), then ask again`);
  const sha = listed.split(/\s/)[0];
  return /^[0-9a-f]{40,64}$/.test(sha ?? '') ? sha : null;
}

// What a file held at HEAD, exactly, or null when it wasn't there.
const headText = (git, rel, rev = 'HEAD') => git.raw(['show', `${rev}:${rel}`]);

// Whether HEAD is a setup commit made on `tip` and not yet pushed: one commit on it, with setup's
// message, changing only the setup files (and the .gitignore).
async function setupCommitOn(git, head, tip, { strict = false, own = new Set() } = {}) {
  if (head === null || tip === null) return false;
  if ((await git.out(['rev-parse', '-q', '--verify', `${head}^1`])) !== tip) return false;
  if ((await git.out(['log', '-1', '--format=%s', head])) !== COMMIT_MESSAGE) return false;
  const files = ((await git.out(['diff-tree', '--no-commit-id', '--name-only', '-r', head])) ?? '').split('\n').filter(Boolean);
  if (!files.every((f) => SETUP_FILES.includes(f) || f === GITIGNORE)) return false;
  // Found again in a later plan (`strict`), the .gitignore the commit holds must be changed by
  // nothing but setup's own lines; a commit setup has just made may hold the director's, as they chose.
  // A commit whose sha the journal recorded as setup's own (it was recorded just before the push)
  // is accepted as it is: the director chose to put their .gitignore changes in it.
  if (!strict || !files.includes(GITIGNORE) || own.has(head)) return true;
  // The tip's lines must all still be there, in their order, followed by setup's own lines alone
  // (the tip's last line regaining its newline changes nothing in the lines).
  const split = (text) => lines(text ?? '').split('\n').map((l) => l.replace(/\s+$/, ''));
  const trimEnd = (list) => { while (list.length > 0 && list.at(-1) === '') list.pop(); return list; };
  const was = trimEnd(split(await headText(git, GITIGNORE, tip)));
  const now = trimEnd(split(await git.raw(['show', `${head}:${GITIGNORE}`])));
  if (now.length < was.length || !was.every((l, i) => now[i] === l)) return false;
  return now.slice(was.length).filter((l) => l.trim() !== '').every((l) => OUR_LINES.includes(l.trim()));
}

// The shas of the setup commits the journal recorded, each written just before its push was tried.
function journalledCommits(target) {
  const own = new Set();
  for (const r of readJournal().runs) {
    for (const c of Array.isArray(r?.changes) ? r.changes : []) {
      if (c?.kind === 'host' && c.target === target && c.after?.action === 'push' && /^[0-9a-f]{40,64}$/.test(c.after.sha ?? '')) own.add(c.after.sha);
    }
  }
  return own;
}

// Which of the lines `.env` and `.env.*` a folder's ignore lists do not cover: asks git, for each
// probe name (root and nested, `.env` and three `.env.<x>` names), which rule decides it
// (`check-ignore --no-index -v`). A probe is covered when a rule (not a negation) of the folder's
// ROOT .gitignore decides it; with `exclude`, the folder's own .git/info/exclude counts too (a
// joining computer's own cover). Any other answer, from the global ignore file, a nested .gitignore,
// none, or one git did not give, is not covered. `.env` is missing unless both its probes are
// covered; `.env.*` unless every `.env.<x>` probe is.
async function envMissing(git, folder, { exclude = null, at = null } = {}) {
  // `at`: a folder other than the project's whose root .gitignore holds `text` (HEAD's, in a
  // temporary repository), asked through the same git. The answer is { missing, negated }:
  // `negated` lists the lines a negation in the root .gitignore stops from covering, which an
  // exclude line cannot put right.
  const base = at ?? folder;
  const root = path.join(base, GITIGNORE);
  const ask = at === null ? (probe) => git.raw(['check-ignore', '--no-index', '-v', '--', probe]) : (probe) => git.rawIn(at, ['check-ignore', '--no-index', '-v', '--', probe]);
  let blocked = false;
  const covered = async (probe) => {
    const got = await ask(probe);
    // One line: `<source>:<line number>:<pattern>` a tab, and the name asked about.
    const found = got === null ? null : /^(.+):(\d+):([^\t]*)\t(.*)\r?\n?$/.exec(got);
    const [, source, , pattern, named] = found ?? [];
    const file = source ? path.resolve(base, source) : null;
    if (file === root && typeof pattern === 'string' && pattern.startsWith('!') && named === probe) blocked = true;
    return file !== null && pattern !== '' && !pattern.startsWith('!') && named === probe && (file === root || (exclude !== null && file === exclude));
  };
  const all = async (probes) => {
    blocked = false;
    for (const probe of probes) if (!(await covered(probe))) return { ok: false, blocked };
    return { ok: true, blocked: false };
  };
  const missing = [];
  const negated = [];
  for (const [line, probes] of [['.env', ENV_ONLY], ['.env.*', ENV_DOT]]) {
    const got = await all(probes);
    if (!got.ok) missing.push(line);
    if (got.blocked) negated.push(line);
  }
  return { missing, negated };
}

// Which of the lines HEAD's committed .gitignore does not cover, asked of git in a temporary
// repository holding that text, removed afterwards. Any failure counts as not covering (it fails closed).
async function headMissing(git, text) {
  const all = [...ENV_LINES];
  if (text === null) return all;
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-head-'));
    if (!(await git.okIn(dir, ['init', '-q']))) return all;
    fs.writeFileSync(path.join(dir, GITIGNORE), text);
    return (await envMissing(git, dir, { at: fs.realpathSync.native(dir) })).missing;
  } catch {
    return all;
  } finally {
    if (dir !== null) fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The ignore file's lines to add for `missing`, as `file` changes of `target`; the example's
// negation is restated after `.env.*` where the file holds it.
function ignoreChanges(target, missing, text) {
  const out = missing.map((line) => ({ kind: 'file', target, line }));
  if (missing.includes('.env.*') && text !== null && text.split(/\r?\n/).some((l) => l.trim() === EXAMPLE_KEPT)) out.push({ kind: 'file', target, line: EXAMPLE_KEPT, restate: true });
  return out;
}

// The text with `lines` added to its end, in its own line endings.
function withLines(text, lines) {
  const eol = text !== null && text.includes('\r\n') ? '\r\n' : '\n';
  const add = lines.map((l) => `${l}${eol}`).join('');
  return `${text ?? ''}${text && !text.endsWith('\n') ? eol : ''}${add}`;
}

// Whether `work` is `before` with only setup's own lines added (a run that wrote them and didn't
// commit): lines setup's journal recorded writing to this file (`wrote`), nothing the director typed.
function onlyOurLines(before, work, wrote) {
  if (work === null) return false;
  const base = lines(before ?? '');
  const now = lines(work);
  if (!now.startsWith(base) || now.length === base.length) return false;
  const rest = now.slice(base.length).split('\n').map((l) => l.trim()).filter((l) => l !== '');
  return rest.length > 0 && rest.every((l) => OUR_LINES.includes(l) && wrote.has(l));
}

// The lines of this ignore list that setup's journal recorded writing, in any run.
function journalled(target, same) {
  const wrote = new Set();
  for (const r of readJournal().runs) {
    for (const c of Array.isArray(r?.changes) ? r.changes : []) {
      if (c?.kind === 'file' && typeof c.line === 'string' && typeof c.target === 'string' && same(c.target)) wrote.add(c.line);
    }
  }
  return wrote;
}

// The lines that differ between two texts (either side), trimmed.
function changedLines(a, b) {
  const set = (t) => new Set(lines(t ?? '').split('\n').map((l) => l.trim()).filter((l) => l !== ''));
  const [x, y] = [set(a), set(b)];
  return [...x].filter((l) => !y.has(l)).concat([...y].filter((l) => !x.has(l)));
}

// Records a whole-file change, then writes it through a temporary file beside it.
function writeRecorded(ctx, { target, before, after, line, project }) {
  ctx.record({ id: newId('chg'), kind: 'file', target, before, after, ...(line === undefined ? {} : { line }), project });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, after);
  fs.renameSync(temp, target);
}

// ---- The pins ----

async function installPin({ id, folder, run, claude }) {
  let resolved;
  try {
    resolved = claude();
  } catch {
    throw new Error(NO_CLAUDE);
  }
  const call = invocation(resolved, [], ['plugin', 'install', id, '--scope', 'project']);
  let got;
  try {
    got = await run(call.file, call.args, {
      cwd: folder, input: call.input, baseEnv: withoutHostVariables(withoutGitVars(process.env)), timeoutMs: INSTALL_WAIT_MS,
      ...(call.verbatim ? { windowsVerbatimArguments: true } : {}),
    });
  } catch {
    throw new Error(NO_CLAUDE);
  }
  if (got.code !== 0) throw new Error(`Claude Code could not install ${id} for this project${got.timedOut ? ' in time' : ''}; a fresh Go ahead tries again`);
}

// ---- The card ----

const pinName = (target) => PIN_NAMES[target.split('@')[0]] ?? target.split('@')[0];
const listed = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

// Step 7's card: each part of the list in plain words, the branch the commit and protection land on,
// and the release. When that would pass the composer's limit (a long branch name or release), a
// shorter card says the same in fewer words. On a joining computer (`joining`, ruling R78) it says
// that nothing is committed and protection stays as it is, and names each shared file in
// `differ`, which differs from what is committed and is left as it is.
export function projectFilesCard({ changes, host, branch, release, joining = false, differ = [], negated = [] }) {
  const files = changes.filter((c) => (c.kind === 'json-key' || c.kind === 'file') && c.line === undefined);
  // The lines that keep .env files out of git: in the project's .gitignore, or, on a joining
  // computer, in this computer's own list.
  const envLines = changes.filter((c) => c.kind === 'file' && (ENV_LINES.includes(c.line) || c.restate === true));
  const secrets = envLines.length === 0 ? null : envLines.some((c) => path.basename(c.target) === GITIGNORE) ? 'shared' : 'here';
  const shared = files.filter((c) => !c.target.endsWith('settings.local.json'));
  const excluded = changes.some((c) => c.line === EXCLUDE_LINE);
  const ours = changes.some((c) => c.line === WHEELHOUSE_LINE);
  const parts = [];
  if (shared.length > 0) {
    const section = shared.some((c) => c.section) ? ', and a "Compact instructions" section into CLAUDE.md' : '';
    parts.push(`Wheelhouse's settings and configuration go into .claude${section}, keeping yours`);
  }
  if (files.length > shared.length) parts.push(`this computer's settings into .claude/settings.local.json, which stays here${excluded ? `${ours ? '; it and .wheelhouse/' : ','} kept out of git` : ''}`);
  else if (excluded) parts.push(`.claude/settings.local.json${ours ? ' and .wheelhouse/' : ''} kept out of git`);
  if (ours && !excluded) parts.push('.wheelhouse/ kept out of git');
  if (secrets === 'shared') parts.push(`.env files, which hold secrets, kept out of git by .gitignore${envLines.some((c) => c.restate) ? ' (.env.example stays shared)' : ''}`);
  else if (secrets === 'here') parts.push(negated.length > 0 ? `some .env files, which hold secrets, kept out of git on this computer, but ${NEGATED_PART}` : '.env files, which hold secrets, kept out of git on this computer');
  if (negated.length > 0 && secrets !== 'here') parts.push(NEGATED_PART);
  const pins = changes.filter((c) => c.kind === 'process').map((c) => pinName(c.target));
  if (pins.length > 0) parts.push(`${listed(pins)} installed for this project at tested versions`);
  const up = changes.find((c) => c.kind === 'host' && (c.action === 'commit' || c.action === 'push'));
  // The director's own changes setup's commit takes up, as they chose (ruling R95).
  const yours = up?.action === 'commit' && Array.isArray(up.yours) && up.yours.length > 0 ? `, with your own changes to ${listed(up.yours.map((y) => y.file))}` : '';
  const ignored = up?.action === 'commit' && Array.isArray(up.files) && up.files.includes(GITIGNORE);
  if (up?.action === 'commit') parts.push(`the three shared files${ignored ? ' and .gitignore' : ''} go up to ${branch} on ${NAME[host]} in one commit, "${COMMIT_MESSAGE}"${yours}`);
  if (up?.action === 'push') parts.push(`setup's commit, "${COMMIT_MESSAGE}", goes up to ${branch} on ${NAME[host]}`);
  const where = host === 'gitlab' ? ' ("pipelines must succeed" once there is a pipeline)' : ', where your plan allows';
  if (joining) parts.push('the project\'s own files stay as your other computer committed them: nothing is committed and protection stays as it is');
  else parts.push(`${up ? 'then ' : ''}${branch}'s protection goes on${where}`);
  if (differ.length > 0) parts.push(`${listed(differ)} ${differ.length === 1 ? 'differs' : 'differ'} from what is committed, and setup leaves ${differ.length === 1 ? 'it as it is' : 'them as they are'}`);
  const pinned = release?.ref ? `Wheelhouse stays at ${release.ref} and never updates itself.` : 'Wheelhouse never updates itself.';
  const card = (what) => ({
    kind: 'setup',
    level: 3,
    what,
    why: 'Agents start from these files; protection sends later changes through Wheelhouse\'s checks.',
    options: [
      { label: SETUP_LABEL, says: 'Setup makes these changes and says what protection reads back.' },
      { label: 'Not now', says: 'Setup waits here; nothing changes.' },
    ],
    recommend: SETUP_LABEL,
    because: 'agents need these before they start',
    meanwhile: 'Setup waits here; nothing changes.',
  });
  const full = card(joining
    ? `Setup step 7, ${SETUP_TITLES[7]}, for this computer: ${parts.join('; ')}. ${pinned}`
    : `Setup step 7, ${SETUP_TITLES[7]}: ${parts.join('; ')}. All with your ${NAME[host]} sign-in. ${pinned}`);
  const fits = (c) => composeCard({ ...c, target: { step: 7, hash: '0'.repeat(64) } }).question.question.length <= CARD.chars;
  try {
    if (fits(full)) return full;
  } catch { /* too long: the shorter card below */ }
  const cut = (text) => (text.length > 60 ? `${text.slice(0, 59)}…` : text);
  if (joining) {
    const mine = [
      ...(files.length > 0 || excluded || ours ? ['this computer\'s settings'] : []), ...(secrets ? [negated.length > 0 ? 'some .env files kept out of git' : '.env files kept out of git'] : []), ...(negated.length > 0 ? ['.gitignore lets some .env files in: raise it on the computer that set the project up'] : []), ...(pins.length > 0 ? ['the pinned kits'] : []),
      'nothing committed', ...(differ.length > 0 ? [`${listed(differ)} left as ${differ.length === 1 ? 'it is' : 'they are'}`] : []),
    ];
    return card(`Setup step 7, ${SETUP_TITLES[7]}, for this computer: ${mine.join(', ')}. Wheelhouse never updates itself.`);
  }
  const short = [
    ...(shared.length > 0 ? ['the project\'s own files'] : []), ...(files.length > shared.length || excluded || ours ? ['this computer\'s settings'] : []),
    ...(secrets ? ['.env files kept out of git'] : []), ...(pins.length > 0 ? ['the pinned kits'] : []), ...(up ? [`the setup commit up to ${cut(branch)} on ${NAME[host]}${yours === '' ? '' : ', with your changes'}`] : []),
    `${up ? 'then ' : ''}protection on ${up ? 'it' : cut(branch)}`,
  ];
  return card(`Setup step 7, ${SETUP_TITLES[7]}: ${short.join(', ')}, all with your sign-in. Wheelhouse never updates itself.`);
}

// ---- Step 7 ----

// Whether the step's run is a computer's joining a project set up on another (ruling R78): step
// 3's record of it in the run's journal.
const joiningRun = (ctx) => typeof ctx.runId === 'string' && joinedRepo(readJournal().runs.find((r) => r?.id === ctx.runId) ?? null) !== null;

// The parts of a line a step says, joined into one that fits what the journal keeps; the parts that
// do not fit are counted, not cut in the middle.
function sayFit(parts) {
  const more = (n) => ` (and ${n} more)`;
  const clean = parts.map((p) => String(p).trim().replace(/\.$/, ''));
  let out = '';
  for (let i = 0; i < clean.length; i += 1) {
    const next = out === '' ? clean[i] : `${out}. ${clean[i]}`;
    const rest = clean.length - i - 1;
    if (next.length + (rest > 0 ? more(rest).length : 0) > SAY_CHARS) return out === '' ? clean[0].slice(0, SAY_CHARS) : `${out}${more(clean.length - i)}`;
    out = next;
  }
  return out;
}

// `run` runs git, the host's tool and `claude`; `findGit` gives the git step 2 found; `gitlab`
// GitLab's API with the director's sign-in; `claude` finds Claude Code's command line (lib/claude.js:
// on Windows its .exe or .cmd on the path); `manifest`, `claudeHome` and `locate` are the lineage
// check's; `switchOn` and `protectionStatus` are protection's; `address`, `node` and `pluginRoot`
// are what the local settings name. All are for tests.
export function projectFilesStep({
  run = realRun, findGit = async ({ platform }) => (await toolsStatus({ platform, run, tools: ['git'] })).git,
  gitlab = ({ run: r, baseUrl }) => directorGitlabApi({ run: r, baseUrl }), claude = () => resolveClaude(),
  manifest = () => readManifest(), claudeHome = () => defaultClaudeHome(), locate = locateInstalled,
  switchOn = switchOnAsDirector, protectionStatus = realProtectionStatus,
  address = () => helperAddress(), node = process.execPath, pluginRoot = PLUGIN_ROOT,
} = {}) {
  const gitFor = async ({ host, platform, folder, remoteUrl, base }) => {
    const located = await findGit({ platform, run });
    if (!located?.ok || typeof located.path !== 'string') throw new Error('git is not on this computer; step 2 installs it');
    return gitIn({ run, gitPath: located.path, host, platform, folder, remoteUrl, base });
  };
  const lineage = (folder) => checkInstalled({ manifest: manifest(), projectDir: folder, claudeHome: claudeHome(), locate });
  // This computer's part of the list, for either form: the line that keeps its settings out of git
  // (unless the product already ignores them), the line that keeps .wheelhouse/ out of git (unless
  // the folder's own list holds it in any form, ruling R108), then each pin not installed as the
  // manifest has it.
  const computerParts = async (git, folder, { joining = false, blocked = [] } = {}) => {
    const parts = [];
    let excludeFile = null;
    const exclude = async () => {
      if (excludeFile !== null) return excludeFile;
      const at = await git.out(['rev-parse', '--git-path', 'info/exclude']);
      if (at === null) throw new Error('git could not say where this folder keeps its own ignore list');
      excludeFile = path.resolve(folder, at);
      return excludeFile;
    };
    if (!(await git.ok(['check-ignore', '-q', '--', LOCAL]))) parts.push({ kind: 'file', target: await exclude(), line: EXCLUDE_LINE });
    if (!holdsLine(readText(await exclude()), WHEELHOUSE_LINE)) parts.push({ kind: 'file', target: await exclude(), line: WHEELHOUSE_LINE });
    // A joining computer commits nothing, so a .gitignore that doesn't keep .env files out of git is
    // covered by this computer's own list instead; the folder's own list counts as cover there.
    // A negation in the root .gitignore beats the computer's own list, so no line is offered for what it lets in.
    if (joining) {
      const { missing, negated } = await envMissing(git, folder, { exclude: await exclude() });
      blocked.push(...negated);
      for (const line of missing) if (!negated.includes(line)) parts.push({ kind: 'file', target: await exclude(), line });
    }
    const kits = manifest();
    const wrong = new Set(lineage(folder).mismatches.map((m) => m.upstream));
    for (const u of kits.upstreams.filter((x) => wrong.has(x.name))) parts.push({ kind: 'process', target: `${u.plugin}@${MARKETPLACE}`, action: 'install', scope: 'project' });
    return parts;
  };

  // The "this computer" form, on a computer joining a project set up on another (ruling R78): the
  // configuration read from the project's last commit in this folder, and only this computer's
  // own files and pins listed. A run with nothing left to do settles, as R75 does.
  const thisComputer = async (ctx, found, platform) => {
    const { host, repo } = found.record;
    const folder = ctx.folder;
    const at = (rel) => path.join(folder, ...rel.split('/'));
    const git = await gitFor({ host, platform, folder, remoteUrl: found.record.remoteUrl, base: found.record.connection?.baseUrl });
    const committed = await headText(git, CONFIG);
    if (committed === null) {
      throw new Error(`${CONFIG} is not in this folder's last commit of ${repo}, so setup can't read the project's configuration: finish setup on your other computer, bring its commit in here (git pull), then ask again`);
    }
    try {
      readConfig(JSON.stringify(objectIn(CONFIG, committed)));
    } catch {
      throw new Error(`${CONFIG} as committed is not a configuration Wheelhouse can read, so setup has left this project's files as they are: correct it on your other computer, then ask again`);
    }
    const differ = [];
    for (const rel of SETUP_FILES) if (!sameContent(rel, readText(at(rel)), await headText(git, rel))) differ.push(rel);
    const home = claudeHome();
    const release = wheelhouseRelease({ folder, claudeHome: home });
    const blocked = [];
    const changes = [
      ...localFilesChange({ folder, local: { address: address(), node, pluginRoot, platform, claudeHome: home } }),
      ...(await computerParts(git, folder, { joining: true, blocked })),
    ];
    if (changes.length === 0) {
      // One line: the engine keeps only the last one a settling says.
      if (differ.length > 0 || blocked.length > 0) {
        const notes = [...(blocked.length > 0 ? [NEGATED_LINE] : []), ...(differ.length > 0 ? [`${listed(differ)} ${differ.length === 1 ? 'differs' : 'differ'} from what is committed, and setup leaves ${differ.length === 1 ? 'it as it is' : 'them as they are'}`] : [])];
        ctx.say?.(`Setup step 7, ${SETUP_TITLES[7]}: this computer's files are in place; ${notes.join('; ')}.`);
      }
      return { settled: { record: { nothing: true, ...(differ.length > 0 ? { differ } : {}) } } };
    }
    return { changes, card: projectFilesCard({ changes, host, branch: null, release, joining: true, differ, negated: blocked }), director: 'One click' };
  };

  return {
    n: 7,
    title: SETUP_TITLES[7],
    long: true,
    after: [3, 4],
    async plan(ctx) {
      const platform = ctx.platform ?? process.platform;
      const found = projectForFolder(ctx.folder);
      if (found === null) return { wait: PROJECT_WAIT_MS, why: `step 3 (${SETUP_TITLES[3]}) has not registered the project yet; its files come once it has` };
      if (joiningRun(ctx)) return thisComputer(ctx, found, platform);
      if (!ctx.answers?.['4.live-data']) return { wait: PROJECT_WAIT_MS, why: 'step 4 has not been told whether the product holds live data yet; the configuration says so' };
      const { record } = found;
      const { host, repo } = record;
      const folder = ctx.folder;
      const at = (rel) => path.join(folder, ...rel.split('/'));

      const branch = await defaultBranchOf({ host, repo, run, gitlab, base: record.connection?.baseUrl });
      if (WHEELHOUSE_BRANCHES.includes(branch)) {
        throw new Error(`${NAME[host]}'s default branch for ${repo} is ${branch}, which is Wheelhouse's own branch, so setup can't put the project's files there: make the product's own branch the default in the repository's settings on ${NAME[host]}, then ask again`);
      }
      const git = await gitFor({ host, platform, folder, remoteUrl: record.remoteUrl, base: record.connection?.baseUrl });
      const current = await git.out(['symbolic-ref', '--short', '-q', 'HEAD']);
      if (current !== branch) {
        throw new Error(`${NAME[host]}'s default branch for ${repo} is ${branch}, but this folder is on ${current ?? 'no branch'}: Wheelhouse puts its files on the default branch and merges into it from then on. Switch this folder to ${branch}${current ? `, or make ${current} the default on ${NAME[host]}` : ''}, then ask again`);
      }
      const tip = await remoteTip(git, record.remoteUrl, branch);
      if (tip === null) throw new Error(`${branch} is not on ${NAME[host]} yet, so setup's commit has nothing to go on: run step 3 again, then ask again`);
      const head = await git.out(['rev-parse', '-q', '--verify', 'HEAD^{commit}']);
      let unpushed = false;
      if (head !== tip) {
        unpushed = await setupCommitOn(git, head, tip, { strict: true, own: journalledCommits(`${repo} ${branch}`) });
        if (!unpushed) {
          if (head !== null && await git.ok(['merge-base', '--is-ancestor', tip, head])) {
            throw new Error(`This folder has commits of your own on ${branch} that are not on ${NAME[host]} yet, and setup's commit would take them up too: push them, or move them to a branch of their own, then ask again`);
          }
          throw new Error(`${NAME[host]} has commits on ${branch} that this folder hasn't got yet: bring them in (git pull), then ask again`);
        }
      }

      const config = starterConfig({ answers: ctx.answers });
      const home = claudeHome();
      const release = wheelhouseRelease({ folder, claudeHome: home });
      const targets = targetsFor({ folder, config, release });
      // Each shared file holds what it held at the last commit, or that with only what setup or
      // step 1's install wrote (the plugin switched on in the project's settings, check 37): setup
      // gives the same file from it as from the commit. Any other change is the director's own, not
      // yet committed, and setup's commit would take it up: the director is asked first (R95).
      let commit = false;
      const yours = [];
      const isNew = madeBySetup(`${host}:${repo}`);
      for (const rel of SETUP_FILES) {
        const work = readText(at(rel));
        const before = await headText(git, rel);
        const made = (text) => {
          const value = targets[rel](text);
          return typeof value === 'string' ? value : jsonText(value);
        };
        const installed = rel === SETTINGS ? [jsonText(mergeSettings(objectIn(SETTINGS, before) ?? {}, STEP_ONE_SETTINGS))] : [];
        const ours = sameContent(rel, work, before) || [before, ...installed].some((from) => sameContent(rel, made(work), made(from)));
        if (!ours) {
          const asked = yoursAsk({ rel, text: work, isNew });
          const got = ctx.answers?.[`7.${asked.id}`] ?? null;
          if (got === null) return { ask: asked };
          if (got.label !== putYoursIn(rel)) return { wait: PROJECT_WAIT_MS, why: leftYoursLine(rel) };
          yours.push({ file: rel, sha256: textHash(rel, work) });
        }
        if (!sameContent(rel, made(work), before)) commit = true;
      }

      // The project's .gitignore must keep .env files out of git, in what goes up as well as in the
      // folder. What it lacks is appended. It is the director's own file, so it is involved, and its
      // uncommitted changes asked about like the three files', when setup adds lines to it, when it is
      // untracked or deleted, or when a changed line mentions .env (a cover that isn't committed is not
      // trusted); unless the changes are only lines setup's journal recorded writing. Any other edit,
      // with the committed file already covering, is left alone.
      const { missing } = await envMissing(git, folder);
      const ignoreWork = readText(at(GITIGNORE));
      const ignoreBefore = await headText(git, GITIGNORE);
      const ignoreMade = missing.length > 0 ? withLines(ignoreWork, ignoreChanges(at(GITIGNORE), missing, ignoreWork).map((c) => c.line)) : ignoreWork;
      const ignoreDiffers = !sameContent(GITIGNORE, ignoreWork, ignoreBefore);
      const wrote = journalled(at(GITIGNORE), (t) => samePathText(t, at(GITIGNORE)));
      const ignoreOurs = ignoreDiffers && onlyOurLines(ignoreBefore, ignoreWork, wrote);
      // The committed text decides: when the working copy differs and HEAD's own text does not cover
      // every probe, what goes up and what the other clones get lacks the cover, however the working
      // copy gets it (a rule that never says .env, such as `.*`, included).
      const headGaps = ignoreDiffers && !ignoreOurs && ignoreWork !== null && ignoreBefore !== null ? await headMissing(git, ignoreBefore) : [];
      const ignoreTheirs = ignoreDiffers && !ignoreOurs
        && (ignoreWork === null || ignoreBefore === null || headGaps.length > 0 || changedLines(ignoreBefore, ignoreWork).some((l) => l.includes('.env')));
      const ignoreInvolved = missing.length > 0 || ignoreOurs || ignoreTheirs;
      if (ignoreInvolved && ignoreDiffers && !ignoreOurs) {
        const asked = yoursAsk({ rel: GITIGNORE, text: ignoreWork, isNew });
        const got = ctx.answers?.[`7.${asked.id}`] ?? null;
        if (got === null) return { ask: asked };
        if (got.label !== putYoursIn(GITIGNORE)) return { wait: PROJECT_WAIT_MS, why: leftYoursLine(GITIGNORE) };
        yours.push({ file: GITIGNORE, sha256: textHash(GITIGNORE, ignoreWork) });
      }
      const ignoreCommit = ignoreInvolved && !sameContent(GITIGNORE, ignoreMade, ignoreBefore);
      if (ignoreCommit) commit = true;
      const commitFiles = [...SETUP_FILES, ...(ignoreCommit ? [GITIGNORE] : [])];

      const changes = projectFilesChange({ folder, config, release, local: { address: address(), node, pluginRoot, platform, claudeHome: home } });
      // This computer's settings are kept out of git by a line of the folder's own, unless the
      // product already ignores them; then the lines that keep .env files out of git; then the pins.
      changes.push(...(await computerParts(git, folder)));
      if (missing.length > 0) {
        const firstPin = changes.findIndex((c) => c.kind === 'process');
        changes.splice(firstPin === -1 ? changes.length : firstPin, 0, ...ignoreChanges(at(GITIGNORE), missing, ignoreWork));
      }
      const target = `${repo} ${branch}`;
      // The commit goes on the tip the plan read, and the push sends that exact commit (I1). The
      // director's own changes it takes up, as they chose, are named by their text's hash (R95).
      if (commit) changes.push({ kind: 'host', target, action: 'commit', branch, base: tip, message: COMMIT_MESSAGE, files: commitFiles, ...(yours.length > 0 ? { yours } : {}) });
      else if (unpushed) changes.push({ kind: 'host', target, action: 'push', branch, base: tip, commit: head, files: ((await git.out(['diff-tree', '--no-commit-id', '--name-only', '-r', head])) ?? '').split('\n').filter(Boolean) });
      changes.push({ kind: 'host', target: `${repo} protection`, action: 'protect', branch });
      return { changes, card: projectFilesCard({ changes, host, branch, release }), director: 'One click' };
    },

    async apply(ctx, changes) {
      const platform = ctx.platform ?? process.platform;
      const say = typeof ctx.say === 'function' ? ctx.say : () => {};
      const halt = () => { if (ctx.stopped?.()) throw new Error(STOPPED); };
      const found = projectForFolder(ctx.folder);
      if (found === null) throw new Error('the project is not registered on this computer; run step 3 first');
      const { project, record } = found;
      const { host, repo } = record;
      const folder = ctx.folder;
      const at = (rel) => path.join(folder, ...rel.split('/'));

      // 1. The files, each recorded before it is written.
      for (const c of changes) {
        if (c.kind === 'json-key') {
          ctx.applyJsonKey({ file: c.target, key: c.key, value: c.after, project });
        } else if (c.kind === 'file' && c.section) {
          const before = readText(c.target);
          if (hasSection(before)) continue;
          writeRecorded(ctx, { target: c.target, before, after: withSection(before), project });
        } else if (c.kind === 'file' && c.line !== undefined) {
          const before = readText(c.target);
          // A restated line is held when the file already ends with it; any other when it holds it anywhere.
          if (c.restate ? (before ?? '').split(/\r?\n/).filter((l) => l.trim() !== '').at(-1)?.trim() === c.line : holdsLine(before, c.line)) continue;
          const after = withLines(before, [c.line]);
          writeRecorded(ctx, { target: c.target, before, after, line: c.line, project });
        } else if (c.kind === 'file') {
          ctx.record({ id: newId('chg'), kind: 'file', target: c.target, before: null, after: c.after, project });
          fs.mkdirSync(path.dirname(c.target), { recursive: true });
          try {
            fs.writeFileSync(c.target, c.after, { flag: 'wx' });
          } catch (error) {
            if (error.code === 'EEXIST') throw new Error(`${path.basename(c.target)} was made by someone else since the card; ask for the plan again`);
            throw error;
          }
        }
      }
      // What this apply wrote into the shared files and the .gitignore: the commit takes them only as they are.
      const wrote = Object.fromEntries([...SETUP_FILES, GITIGNORE].map((rel) => [rel, readText(at(rel))]));
      halt();

      // 2. The pins, then the lineage check. Claude Code writes the project's settings again as it
      // installs, so any of setup's keys it changed is put back, key by key through the journal;
      // every other key stays as it is.
      const pins = changes.filter((c) => c.kind === 'process' && c.action === 'install');
      if (pins.length > 0) {
        const settingsFile = at(SETTINGS);
        const joining = joiningRun(ctx);
        for (const c of pins) {
          const upstream = { plugin: c.target.split('@')[0] };
          const before = locate(upstream, { projectDir: folder, claudeHome: claudeHome() });
          ctx.record({ id: newId('chg'), kind: 'process', target: `claude plugin install ${c.target} --scope project`, before, after: { plugin: c.target, scope: 'project', folder }, project });
          await installPin({ id: c.target, folder, run, claude });
          halt();
        }
        let differs = null;
        if (joining) {
          // A joining computer leaves the committed .claude/settings.json exactly as committed
          // (ruling R103): rewritten by the installs into a layout of their own but holding the
          // same, it gets the committed text back, recorded first; holding something else, it is
          // left as it is and named.
          const git = await gitFor({ host, platform, folder, remoteUrl: record.remoteUrl, base: record.connection?.baseUrl });
          const committed = await headText(git, SETTINGS);
          const text = readText(settingsFile);
          if (committed !== null && text !== committed) {
            if (sameContent(SETTINGS, text, committed)) writeRecorded(ctx, { target: settingsFile, before: text, after: committed, project });
            else differs = `${SETTINGS} differs from what is committed since the pinned kits were installed, and setup leaves it as it is`;
          }
        } else {
          const now = objectIn(SETTINGS, readText(settingsFile)) ?? {};
          const wanted = targetsFor({ folder, config: starterConfig({ answers: ctx.answers }), release: wheelhouseRelease({ folder, claudeHome: claudeHome() }) })[SETTINGS](readText(settingsFile));
          for (const { key, value } of keyEdits(now, wanted)) ctx.applyJsonKey({ file: settingsFile, key, value, project });
        }
        say(`${listed(pins.map((c) => pinName(c.target)))} ${pins.length === 1 ? 'is' : 'are'} installed for this project`);
        if (differs !== null) say(differs);
      }
      const checked = lineage(folder);
      if (!checked.ok) {
        const names = [...new Set(checked.mismatches.map((m) => PIN_NAMES[m.upstream] ?? m.upstream))];
        throw new Error(`${listed(names)} ${names.length === 1 ? 'is' : 'are'} not installed as Wheelhouse's manifest has ${names.length === 1 ? 'it' : 'them'}, so nothing went up; a fresh Go ahead installs again`);
      }
      halt();

      // 3. The setup commit, of the three shared files and the .gitignore where setup changed it, pushed with the director's own sign-in.
      // The folder is read again first: the commit goes on the tip the plan read, on the default
      // branch, with the three files holding what this apply wrote, and the push sends that exact
      // commit. Anything else (a commit, a branch switch or an edit while the kits installed) stops
      // the step with nothing committed or pushed.
      const up = changes.find((c) => c.kind === 'host' && (c.action === 'commit' || c.action === 'push'));
      if (up) {
        const git = await gitFor({ host, platform, folder, remoteUrl: record.remoteUrl, base: record.connection?.baseUrl });
        const moved = (what) => new Error(`${what} changed while the pinned kits were installed, so nothing went up: ask for the plan again`);
        const tipNow = await remoteTip(git, record.remoteUrl, up.branch);
        let sha = up.commit ?? null;
        if (up.action === 'commit') {
          if ((await git.out(['symbolic-ref', '--short', '-q', 'HEAD'])) !== up.branch) throw moved('This folder\'s branch');
          if ((await git.out(['rev-parse', '-q', '--verify', 'HEAD^{commit}'])) !== up.base) throw moved('This folder\'s latest commit');
          for (const rel of up.files) if (!sameContent(rel, readText(at(rel)), wrote[rel])) throw moved(rel);
          if (tipNow !== up.base) throw moved(`${up.branch} on ${NAME[host]}`);
          const author = await commitAuthor({ host, run, base: record.connection?.baseUrl });
          // A file new to git is added with intent only, so the commit takes it and nothing is staged;
          // a commit that fails takes those entries out again.
          const added = [];
          for (const rel of up.files) {
            if (!(await git.ok(['ls-files', '--error-unmatch', '--', rel])) && fs.existsSync(at(rel))) {
              await git.must(['add', '-f', '--intent-to-add', '--', rel], `add ${rel} for the setup commit`);
              added.push(rel);
            }
          }
          if ((await git.must(['status', '--porcelain', '--', ...up.files], 'read the folder')) !== '') {
            // Recorded just before it is made: the commit in the folder, on the tip the plan read.
            ctx.record({
              id: newId('chg'), kind: 'host', target: up.target, before: { branch: up.branch, sha: up.base },
              after: { action: 'commit', branch: up.branch, message: COMMIT_MESSAGE, files: [...up.files], folder }, project,
            });
            const made = await git.ok([
              '-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, '-c', 'commit.gpgsign=false',
              'commit', '-q', '--no-verify', '--only', '-m', COMMIT_MESSAGE, '--', ...up.files,
            ]);
            if (!made) {
              if (added.length > 0) await git.ok(['reset', '-q', '--', ...added]);
              throw new Error('git could not make the setup commit; nothing went up, and a fresh Go ahead tries again');
            }
            sha = await git.must(['rev-parse', 'HEAD'], 'read the setup commit');
          }
        }
        if (sha !== null && tipNow !== sha) {
          if (!(await setupCommitOn(git, sha, up.base)) || tipNow !== up.base) throw moved(`${up.branch}'s setup commit`);
          // The files the commit actually held, read from it.
          const heldBy = ((await git.out(['diff-tree', '--no-commit-id', '--name-only', '-r', sha])) ?? '').split('\n').filter(Boolean);
          ctx.record({
            id: newId('chg'), kind: 'host', target: up.target, before: { branch: up.branch, sha: tipNow },
            after: { action: 'push', branch: up.branch, sha, message: COMMIT_MESSAGE, files: heldBy }, project,
          });
          const pushed = await git.ok(['push', '-q', '--no-verify', record.remoteUrl, `${sha}:refs/heads/${up.branch}`]);
          if (!pushed) throw new Error(`the setup commit could not be pushed to ${up.branch} on ${NAME[host]}; it is kept in this folder, and a fresh Go ahead pushes it`);
          // The folder's copy of the branch on the host, told what the host now holds, when its
          // origin is the repository pushed to: fetched by the address setup recorded, never by the
          // one origin names (ruling R111).
          const origin = await git.out(['remote', 'get-url', 'origin']);
          if (origin !== null && sameRemote(origin, record.remoteUrl)) await git.ok(['fetch', '-q', record.remoteUrl, `+refs/heads/${up.branch}:refs/remotes/origin/${up.branch}`]);
          say(`Setup's commit is on ${up.branch} on ${NAME[host]}`);
        }
      }
      halt();

      // 4. Protection, with the same sign-in, then read back and said as it is.
      const protect = changes.find((c) => c.kind === 'host' && c.action === 'protect');
      if (protect) {
        // Real users: the project's phase says launched (step 4), or step 3 was told so.
        const realUsers = launchedIn(project) || ctx.answers?.['3.real-users']?.label === REAL_USERS.yes;
        const api = host === 'gitlab' ? await gitlab({ run, baseUrl: record.connection?.baseUrl }) : undefined;
        let before = null;
        try {
          before = await protectionStatus({ host, repo, run, api, env: {}, realUsers });
        } catch { /* recorded as not known */ }
        ctx.record({
          id: newId('chg'), kind: 'host', target: protect.target, before: { on: before?.on ?? null, available: before?.available ?? null },
          after: { action: 'protect', branch: protect.branch, on: true }, project,
        });
        const got = await switchOn({ host, repo, run, api, realUsers });
        // What a step says is its latest line, so protection's read-back, what the real users
        // changed and each gap the read-back found go in one line, in plain words.
        // The gaps about the project's secrets come last: there can be many, and "(and N more)" then
        // only ever stands for secrets' names.
        const gaps = got.gaps ?? [];
        const parts = [got.line];
        if (realUsers && host === 'gitlab') parts.push('A project with real users is merged by Maintainers only on GitLab, so Wheelhouse\'s key is refused and a person presses Merge');
        if (got.askPipelines) parts.push(`"Pipelines must succeed" is left off on ${protect.branch}, since the project has no pipeline yet; once it has one, Wheelhouse asks you to switch it on`);
        parts.push(...gaps.filter((g) => !/\bsecrets?\b/i.test(g)), ...gaps.filter((g) => /\bsecrets?\b/i.test(g)));
        say(sayFit(parts));
      }
      return [];
    },
  };
}
