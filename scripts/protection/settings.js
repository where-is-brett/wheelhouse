// scripts/protection/settings.js
// Standard protection's settings: the project's .claude/settings.json (shared by
// every computer, so it names no user's folder) and this computer's
// .claude/settings.local.json (git-ignored).
//
// Read on 18 October 2026 from:
//   https://code.claude.com/docs/en/settings
//   https://code.claude.com/docs/en/settings-reference
//   https://code.claude.com/docs/en/permissions
//   https://code.claude.com/docs/en/sandboxing
// What the documentation says, and what this file does about it:
// - Key names match the brief: autoCompactWindow (a number of tokens from 100000
//   to 1000000, "Any file" scope), sandbox.enabled, sandbox.allowUnsandboxedCommands,
//   sandbox.filesystem.denyRead / denyWrite, sandbox.network.allowedDomains and
//   sandbox.network.allowUnixSockets (macOS only; Linux and WSL2 ignore it; "Any
//   file" scope, so the local settings file may hold it).
// - Read and Edit permission rules use gitignore patterns: `~/path` is from the
//   home folder, `//path` is absolute, `/path` is relative to the settings file's
//   source (the project folder for .claude/settings.json), `path` or `./path` is
//   relative to the current folder. `**` matches across folders. Edit rules cover
//   every built-in editing tool (Write, MultiEdit and NotebookEdit rules are not
//   consulted), so the rules here are Edit. A Read deny also blocks Edit and Write
//   on the same path. `Bash(x:*)` is equivalent to `Bash(x *)`.
// - Sandbox filesystem paths use the usual conventions: `/` absolute, `~/` home,
//   `./` or no prefix relative to the project root (project settings). A trailing
//   `/` or `/**` is stripped, so `~/.ssh` covers the folder. On Linux and WSL2 the
//   write lists skip wildcard entries, so denyWrite names folders and files
//   exactly, with no `*`.
// - Sandbox lists merge across settings files (paths combined, not replaced).
// - The sandbox does not run on native Windows; Claude Code runs commands
//   unsandboxed there, so Windows is held by the deny rules, the gate and the helper.
// - A deny list does allow a `!` carve-out (`Read(!x)` after `Read(*.env)`), but
//   only for relative patterns, never for rules anchored with `~/`, `/` or `//`.
//   `.env.example` is denied with the rest all the same: the designer's call,
//   failing closed. The tool guard lets Claude's own tools read it, but that
//   allowance does not override a deny rule.
// - Credentials are denied in both forms, `Read(~/x)` and `Read(~/x/**)`, so a
//   file and a folder are both covered. A sandbox path `~/x` covers either.
// - The PowerShell tool is not given deny rules. On Windows with Git Bash, a
//   Bash deny turns the PowerShell tool off; a scoped PowerShell rule (even a
//   deny) would keep it on. The tool guard reads PowerShell commands as it reads
//   Bash ones wherever the tool is on, and the sandbox does not run on Windows.
// - A leading `*.` is a documented wildcard for sandbox domains; a bare `*` is
//   too, but is not allowed here.
// - Read on 23 October 2026 from https://code.claude.com/docs/en/sandboxing ("Protect
//   credentials"): `sandbox.credentials.files` entries with `mode: 'deny'` deny reads inside the
//   sandbox as `filesystem.denyRead` does; `credentials.envVars` entries with `mode: 'deny'` are
//   unset before each sandboxed command. A repository's deny entries still apply when Locked makes
//   the sandbox admin-required.
// - Package-runner rules: `Bash(x:*)` needs a space after x, so a version form
//   (`npx wrangler@3 ...`) gets its own `@*` rule.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_BUILD_COMMANDS, isBuildCommand } from '../gate/guardrails.js';
import { AGENT_CONTROL, controlWritePaths, homeControlPaths } from '../lib/agent-control.js';
import { credentialPaths } from '../lib/credentials.js';
import { FRONT_DESK_INPUT, WORK_REPORTS_RULE } from '../lib/front-desk.js';
import { WINDOWS_LINE } from '../lib/platform-lines.js';
import { archonHome } from '../lib/paths.js';
import { ARCHON_PROGRAMS, PRIVATE_FILES, PRIVATE_FOLDERS, WORKSPACE_FOLDERS, workspaceOfRun } from './archon.js';
import { MARKETPLACE, UPSTREAMS, WHEELHOUSE_REPO } from '../lineage/manifest.js';
import { GIT_LOCAL, isConfiguredBuildCommand } from './windows-builds.js';

const PLATFORMS = ['darwin', 'linux', 'win32'];
// The deploy and hosting tools Standard's deny rules name; the install survey looks for the same ones.
export const HOST_TOOLS = Object.freeze(['vercel', 'netlify', 'flyctl', 'fly', 'wrangler', 'heroku', 'railway', 'aws', 'gcloud', 'az', 'doctl', 'supabase', 'neonctl', 'stripe']);
// Each tool, with the names its package has on npm where they differ.
const RUNNERS = ['npx', 'npm exec', 'pnpm dlx', 'bunx', 'yarn dlx'];
const PACKAGE_NAMES = ['netlify-cli', '@railway/cli'];
const OWN_FILES = ['.claude/settings.json', '.claude/settings.local.json'];

const unique = (list) => [...new Set(list)];

// The macOS keychain files. The `security` command reads a keychain file in its own process, so
// denying the folder stops a sandboxed `security find-generic-password -w` returning the director's
// gh or Claude Code sign-in (check 73). `codesign` and iOS signing read the same files, so a project
// whose configuration says `signsApps: true` leaves them open. Harmless on other systems, which
// have no such folder.
export const KEYCHAINS = '~/Library/Keychains';
const KEYCHAIN_RULES = [`Read(${KEYCHAINS})`, `Read(${KEYCHAINS}/**)`];
const isKeychainFile = (entry) => isObject(entry) && entry.path === KEYCHAINS;
// The host tools' sign-in variables, unset in every sandboxed command: agents hold no host key.
// gh reads the first two and the enterprise pair; glab reads GITLAB_TOKEN, GITLAB_ACCESS_TOKEN and OAUTH_TOKEN.
export const HOST_TOKENS = Object.freeze(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN']);

// Edit denials for the files that steer an agent (agent-control.js): the project's, from its root
// as the settings' and hooks' are (`**/X` for X in any folder), and the home folders of every
// system, in the form the credentials' rules use. Reading them is not denied.
function controlRules() {
  return [
    ...AGENT_CONTROL.map((p) => (p.startsWith('**/') ? `Edit(${p})` : `Edit(/${p})`)),
    ...homeControlPaths().map((f) => `Edit(~/${f}/**)`),
  ];
}

// Every system's credential paths together: the project file is shared.
const allCredentials = () => unique(PLATFORMS.flatMap((p) => credentialPaths(p)));

// A domain the sandbox may reach: lowercase and trimmed, a host name with an
// optional leading `*.`. Anything else (empty, a URL, a path, a port, a bare *)
// is dropped.
export function cleanDomain(given) {
  if (typeof given !== 'string') return null;
  const d = given.trim().toLowerCase();
  if (d === '' || /[\s/:]/.test(d) || d.includes('://') || d === '*') return null;
  return /^(\*\.)?[^*]+$/.test(d) ? d : null;
}

// Read denials for every system's credential files, in the file and the folder form.
export function credentialRules() {
  return allCredentials().flatMap((c) => [`Read(~/${c})`, `Read(~/${c}/**)`]);
}

// The allow rules for feature sessions the watcher starts (build-loop design,
// section 11): one `Bash(<command>:*)` for each of the configuration's build
// commands, so a session nobody watches never waits on a prompt for them. A
// deny rule still wins over any of them. They are passed only with the Shape 1
// starter's --allowedTools, never written into the project's settings: that
// file is shared by every computer, Windows ones too, so an interactive
// session asks. The commands are checked on every system.
//
// On Windows (design section 12.2) the sandbox does not run, so a rule such as
// `Bash(node:*)` would let a session run anything unasked: the rules follow
// the level of build commands on this computer (windows-builds.js). At
// `unattended`, one for each configured command and each local git command;
// at `ask`, and at any level not known, one for each command the director
// granted (`grants`, from buildGrants) that is still configured or local git;
// at `guarded`, the rule for the runner, `guardedCommand` (scripts/windows/low.js),
// with the granted ones as at `ask`, since a command the runner refuses (one that
// fetches new code) still asks. Elsewhere the level and grants change nothing.
export function featureAllowRules(config, { platform = process.platform, level = 'ask', grants = [], guardedCommand = null } = {}) {
  const commands = config?.buildCommands ?? DEFAULT_BUILD_COMMANDS;
  if (!Array.isArray(commands)) throw new Error('The build commands are not a list');
  for (const c of commands) if (!isBuildCommand(c)) throw new Error(`This build command can't be made into an allow rule: ${JSON.stringify(c)}`);
  const rules = (list) => unique(list.map((c) => `Bash(${c}:*)`));
  if (platform !== 'win32') return rules(commands);
  if (level === 'unattended') return rules([...commands, ...GIT_LOCAL]);
  const granted = (Array.isArray(grants) ? grants : []).flatMap((g) => (Array.isArray(g?.commands) ? g.commands : []));
  const asked = granted.filter((c) => isConfiguredBuildCommand(c, commands));
  if (level === 'guarded') {
    const runner = typeof guardedCommand === 'string' && guardedCommand !== '' && !/[\r\n]/.test(guardedCommand) ? [guardedCommand] : [];
    return rules([...runner, ...asked]);
  }
  return rules(asked);
}

// The file rules for feature sessions the watcher starts, passed with --allowedTools beside the
// build commands' (and never written into the project's settings): a session nobody watches
// can't answer a prompt. It may read the files plugins installed, such as Superpowers' helper
// scripts (read-only: `Edit(~/.claude/**)` stays denied), and it has `.wheelhouse/tmp/` in its
// own worktree for temporary files, a folder git ignores (`.wheelhouse/` is kept out of git), so
// the system temporary folder is never opened. `/` names the worktree, the project's root. The
// Wheelhouse home (`~/.wheelhouse`) and everything else the deny rules and the sandbox refuse
// stay refused: a deny rule wins over any allow rule.
export const FEATURE_TEMPORARY_FOLDER = '.wheelhouse/tmp';
export function featureFileRules() {
  return ['Read(~/.claude/plugins/cache/**)', `Edit(/${FEATURE_TEMPORARY_FOLDER}/**)`];
}

// The copies of the pinned kits that must stay off in a project (check 24): Anthropic's
// Superpowers, and the synced copies of Superpowers and Matt Pocock's skills. Two copies
// of Superpowers share one manifest name, so they must never both be on.
export const SWITCHED_OFF_PLUGINS = Object.freeze([
  'superpowers@claude-plugins-official', 'superpowers@synced', 'mattpocock-skills@synced',
]);

// The plugin settings (check 24): the copies pinned in Wheelhouse's marketplace on, every
// other copy off. A project-level false beats the user's true.
function pluginSettings(release) {
  if (release !== null && !isObject(release)) throw new Error('The release is not { ref }');
  const ref = release?.ref;
  if (ref !== undefined && (typeof ref !== 'string' || ref === '')) throw new Error('The release needs a ref that is a tag or branch name');
  // The one entry `releaseChange` edits: `source.ref` only. A `github` marketplace source takes
  // repo, ref, path and sparsePaths, and no sha (marketplace reference, read 19 October 2026),
  // so no sha is written; the pinned kits carry their own shas in the marketplace file. With no
  // release the entry has no ref, so the marketplace is the repository's default branch.
  // autoUpdate is off, so nothing moves unless Wheelhouse moves it.
  const source = { source: 'github', repo: WHEELHOUSE_REPO };
  if (ref !== undefined) source.ref = ref;
  return {
    extraKnownMarketplaces: { [MARKETPLACE]: { source, autoUpdate: false } },
    enabledPlugins: {
      ...Object.fromEntries(SWITCHED_OFF_PLUGINS.map((name) => [name, false])),
      ...Object.fromEntries(UPSTREAMS.map((u) => [`${u.plugin}@${MARKETPLACE}`, true])),
    },
  };
}

// Claude Code's own update settings (check 28): the stable channel, and the lowest version
// auto-updates may install. Setup writes them where check 28 says; `floor` is
// manifest.claudeCode.floor, a plain version such as 2.1.100.
export function claudeCodeSettings({ floor } = {}) {
  if (typeof floor !== 'string' || !/^\d+\.\d+\.\d+$/.test(floor)) throw new Error(`The floor isn't a version such as 2.1.100: ${JSON.stringify(floor)}`);
  return { autoUpdatesChannel: 'stable', minimumVersion: floor };
}

// Claude Code's own switch-off for the attribution it adds to commits and pull requests
// (https://code.claude.com/docs/en/settings-reference, "attribution"): empty strings hide the
// commit trailer and the pull request line, and sessionUrl false drops the session link.
// includeCoAuthoredBy is the older, deprecated key that earlier versions still read. Why:
// the Global Constraints allow no Co-Authored-By line and no model name in commits.
export const ATTRIBUTION_OFF = {
  attribution: { commit: '', pr: '', sessionUrl: false },
  includeCoAuthoredBy: false,
};

// The engine's home as the shared project file names it, as `~/.wheelhouse` is named for Wheelhouse's: the default
// place, from the home folder, so the file names no user's folder.
export const ENGINE_HOME = '~/.wheelhouse-engine';

// A home as the rules name it: kept when it starts with `~/`, from the home folder when it is inside it, else whole.
// `rule` is the permission rules' form (`//` before a full path), `sandbox` the sandbox lists' (`/`).
function homeSpellings(home) {
  if (typeof home !== 'string' || home === '') throw new Error('The engine\'s home must be a path');
  if (home === '~' || home.startsWith('~/')) return { rule: home.replace(/\/+$/, ''), sandbox: home.replace(/\/+$/, '') };
  if (!path.isAbsolute(home) && !/^[A-Za-z]:[\\/]/.test(home)) throw new Error('The engine\'s home must be a full path or start with ~/');
  const user = os.homedir();
  const relative = path.relative(user, home);
  if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    const tilde = `~/${relative.split(path.sep).join('/')}`;
    return { rule: tilde, sandbox: tilde };
  }
  const slashed = path.resolve(home).replaceAll('\\', '/').replace(/\/+$/, '');
  return { rule: `/${slashed.startsWith('/') ? '' : '/'}${slashed}`, sandbox: slashed };
}

// Archon's private files, kept from every agent (spec 6.4, 12.2): `archon` as a command, by itself and through the
// package runners; Read denials (which hold Edit and Write too) for the database and its journal files,
// credential-key, .env, config.yaml, plugins/ and every workspace's logs/ and workflow-source/; and the sandbox's
// read and write lists for the files and folders at the top of the home. The sandbox lists name no wildcard (their
// write lists skip one on Linux and WSL2), so a workspace's folders, and every run's artefacts but the step's own,
// are shut by the run's own overlay (ownRunRules), which names its workspace, and by the tool guard. A deny rule
// can't be opened again for one run, so no rule here names the artefacts.
export function archonDenyRules(home = archonHome()) {
  const { rule, sandbox } = homeSpellings(home);
  const names = [...ARCHON_PROGRAMS.programs, ...ARCHON_PROGRAMS.packages];
  const deny = unique([
    ...ARCHON_PROGRAMS.programs.map((p) => `Bash(${p}:*)`),
    ...RUNNERS.flatMap((r) => names.flatMap((n) => [`Bash(${r} ${n}:*)`, `Bash(${r} ${n}@*)`])),
    ...PRIVATE_FILES.map((f) => `Read(${rule}/${f})`),
    ...PRIVATE_FOLDERS.flatMap((f) => [`Read(${rule}/${f})`, `Read(${rule}/${f}/**)`]),
    ...WORKSPACE_FOLDERS.map((f) => `Read(${rule}/workspaces/**/${f}/**)`),
  ]);
  const top = [...PRIVATE_FILES, ...PRIVATE_FOLDERS].map((f) => `${sandbox}/${f}`);
  return { deny, denyRead: top, denyWrite: [...top] };
}

// The run's own settings overlay (check 75): what a run's first step writes as `.claude/settings.local.json` in the
// run's worktree, before any Claude step. Plain project settings, so they hold once Claude starts in its ordinary mode
// (the patch, build.js): the sandbox's read list shuts the workspace's logs/, workflow-source/ and every run's
// artefacts, its write list the first two, and allowRead and allowWrite open the run's own artefacts folder. The shared settings deny
// writing the overlay (`./.claude/settings.local.json` in the sandbox's list, `Edit(/.claude/settings.local.json)`,
// and the tool guard), so an agent can't name another run as its own; and the tool guard learns the own run from its
// environment, not from this file. `artifactsDir` is the run's folder, `<workspace>/artifacts/runs/<runId>`.
export function ownRunRules(runId, artifactsDir) {
  const workspace = workspaceOfRun(artifactsDir, runId);
  const own = path.resolve(artifactsDir);
  const folders = WORKSPACE_FOLDERS.map((f) => path.join(workspace, f));
  // The artefacts are left off the write list: a write outside the worktree is refused unless allowed, and a
  // denyWrite would win over the own folder's allowWrite.
  // In the engine's ordinary mode (acceptEdits) the Read tool asks before reading outside the worktree, and no one
  // answers in a run, so the run's own artefacts are allowed by a rule, by each spelling of the folder (a home under a
  // linked folder such as /tmp is read by its real path too).
  let real = own;
  try { real = fs.realpathSync.native(own); } catch { /* not made yet: its own spelling only */ }
  const allow = unique([own, real]).map((dir) => `Read(/${dir.replaceAll('\\', '/')}/**)`);
  return {
    permissions: { allow },
    sandbox: {
      enabled: true,
      allowUnsandboxedCommands: false,
      filesystem: { denyRead: [...folders, path.join(workspace, 'artifacts', 'runs')], denyWrite: folders, allowRead: [own], allowWrite: [own] },
    },
  };
}

// Host names that reach this computer itself. The sandbox's proxy reaches only the domains listed, by host and not by
// port, so listing one of these would open every local port to agents, the engine room's among them (spec 12.2).
// (cleanDomain already drops `::1`, which holds a colon.)
const LOOPBACK = /^(\*\.)?localhost$|^127(\.\d{1,3}){3}$|^0\.0\.0\.0$/;

// `release` is { ref } when the project follows a Wheelhouse release; without it the
// marketplace entry carries no ref. Build commands' allow rules are not here: see featureAllowRules.
export function projectSettings(config, { release = null } = {}) {
  const credentials = allCredentials();
  const engine = archonDenyRules(ENGINE_HOME);
  const keychainShut = config.signsApps !== true;
  const deny = unique([
    'Read(**/.env)', 'Read(**/.env.*)',
    'Read(~/.wheelhouse/**)', 'Edit(~/.wheelhouse/**)', 'Edit(~/.claude/**)',
    ...credentialRules(),
    ...(keychainShut ? KEYCHAIN_RULES : []),
    ...OWN_FILES.map((f) => `Edit(/${f})`), 'Edit(/.claude/hooks/**)',
    ...controlRules(),
    'Bash(gh:*)', 'Bash(glab:*)', 'Bash(git push:*)',
    ...HOST_TOOLS.map((t) => `Bash(${t}:*)`),
    ...RUNNERS.flatMap((r) => unique([...HOST_TOOLS, ...PACKAGE_NAMES]).flatMap((t) => [`Bash(${r} ${t}:*)`, `Bash(${r} ${t}@*)`])),
    ...engine.deny,
  ]);
  return {
    permissions: { deny },
    sandbox: {
      enabled: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        denyRead: unique(['~/.wheelhouse', ...credentials.map((c) => `~/${c}`), ...engine.denyRead]),
        denyWrite: unique(['~/.wheelhouse', '~/.claude', ...OWN_FILES.map((f) => `./${f}`), './.claude/hooks', ...controlWritePaths(), ...homeControlPaths().map((f) => `~/${f}`), ...engine.denyWrite]),
      },
      credentials: {
        // Always a list, empty when open, so a setup run on a project that has lifted it writes the empty list.
        files: keychainShut ? [{ path: KEYCHAINS, mode: 'deny' }] : [],
        envVars: HOST_TOKENS.map((name) => ({ name, mode: 'deny' })),
      },
      network: { allowedDomains: unique(['registry.npmjs.org', ...config.webDomains.map(cleanDomain).filter((d) => d !== null && !LOOPBACK.test(d))]) },
    },
    ...pluginSettings(release),
    autoCompactWindow: 300000,
    disableAllHooks: false,
    enableAllProjectMcpServers: false,
    ...structuredClone(ATTRIBUTION_OFF),
  };
}

// The settings with the keychain left open: `settings` (a project's, perhaps merged with the
// director's own) less the keychain's deny rules and its credentials entry, for a project whose
// configuration says `signsApps: true`. A merge only adds, so this is how such a project's file
// loses the entries; the credentials' file list stays, perhaps empty, since setup's key edits
// replace a key but never remove one. Nothing else is touched, and the input is not changed.
export function withoutKeychainDenial(settings) {
  const copy = isObject(settings) ? structuredClone(settings) : {};
  if (Array.isArray(copy.permissions?.deny)) copy.permissions.deny = copy.permissions.deny.filter((r) => !KEYCHAIN_RULES.includes(r));
  const credentials = copy.sandbox?.credentials;
  if (isObject(credentials) && Array.isArray(credentials.files)) credentials.files = credentials.files.filter((f) => !isKeychainFile(f));
  return copy;
}

// The command that runs the status line: the Node that is running this, and the script in the
// plugin. Both paths are quoted, since either may hold spaces.
export function statusLineCommand({ node, pluginRoot }) {
  return `"${node}" "${path.join(pluginRoot, 'scripts', 'statusline.js')}"`;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Whether a status line is the one Wheelhouse sets: its command names scripts/statusline.js.
export function isOwnStatusLine(statusLine) {
  return isObject(statusLine) && typeof statusLine.command === 'string'
    && /scripts[\\/]statusline\.js/.test(statusLine.command);
}

// The existing local settings, ready to merge: Wheelhouse's own status line is taken out when
// the director has one of their own (`director`, from directorStatusLine), since the local file
// outranks the user and project files and would hide theirs. Ours is kept when they have none,
// and a status line that is not ours is never touched. The input is not changed.
export function withoutOwnStatusLine(existingLocal, { director = null } = {}) {
  const copy = isObject(existingLocal) ? structuredClone(existingLocal) : {};
  if (director && Object.hasOwn(copy, 'statusLine') && isOwnStatusLine(copy.statusLine)) delete copy.statusLine;
  return copy;
}

// The status line in the director's own settings, or null: the user settings, the project's
// shared settings, then this computer's local settings. A status line that names
// scripts/statusline.js is Wheelhouse's own from an earlier setup, so it is not the director's.
// A file that is missing or damaged names none.
export function directorStatusLine({ claudeHome, projectDir }) {
  const files = [
    path.join(claudeHome, 'settings.json'),
    path.join(projectDir, '.claude', 'settings.json'),
    path.join(projectDir, '.claude', 'settings.local.json'),
  ];
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const line = isObject(parsed) && Object.hasOwn(parsed, 'statusLine') ? parsed.statusLine : null;
    if (line !== null && line !== undefined && !isOwnStatusLine(line)) return line;
  }
  return null;
}

// The one flag a plugin script's command may carry between `node` and the script. Claude Code sets
// NODE_USE_SYSTEM_CA=1 for a session's commands, and in the sandbox Node.js then prints a line for each
// system certificate whose trust settings it can't read; this flag turns the system store off for that process.
export const NO_SYSTEM_CA = '--no-use-system-ca';

// Whether the Node.js running this knows NO_SYSTEM_CA (Node.js 22.15 and later); `flags` is what it allows.
export function knowsNoSystemCa(flags = process.allowedNodeEnvironmentFlags) {
  return flags.has('--use-system-ca');
}

// The command that runs one of the plugin's scripts (`script`, its path inside the plugin, such as
// scripts/frontdesk/cli.js), as its allow rule and its playbook write it: `node`, then the
// script's full path in double quotes. On Windows the path has forward slashes after its drive
// letter, which node and Git Bash both take, and which the STOP guard reads as the same path. Null
// when the plugin's folder isn't a full path, or holds a character that could end the quotes or
// change what the rule matches (a quote, `*`, a parenthesis, `$`, a backtick, a backslash or a
// control character): that folder gets no rule, and the command is asked about each time.
// With `noSystemCa`, `node` is followed by NO_SYSTEM_CA.
export function pluginScriptCommand(pluginRoot, script, { platform = process.platform, noSystemCa = false } = {}) {
  if (typeof pluginRoot !== 'string') return null;
  if (typeof script !== 'string' || !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(script) || script.split('/').includes('..')) {
    throw new Error('The script must be a path inside the plugin, written with forward slashes');
  }
  let root = pluginRoot;
  if (platform === 'win32') {
    if (!/^[A-Za-z]:[\\/]/.test(root)) return null;
    root = root.replaceAll('\\', '/');
  } else if (!root.startsWith('/')) {
    return null;
  }
  if (/["*()$`\\\p{Cc}]/u.test(root)) return null;
  return `node ${noSystemCa ? `${NO_SYSTEM_CA} ` : ''}"${root.replace(/\/+$/, '')}/${script}"`;
}

// The front desk's command (scripts/frontdesk/cli.js), as pluginScriptCommand gives it.
export function frontDeskCommand(pluginRoot, { platform = process.platform, noSystemCa = false } = {}) {
  return pluginScriptCommand(pluginRoot, 'scripts/frontdesk/cli.js', { platform, noSystemCa });
}

// Setup's command (scripts/setup/cli.js), as pluginScriptCommand gives it. Setup's step 2 writes
// its allow rule into the project's local settings by itself (ruling R43), so the playbook's
// calls before step 7 are not asked about each time.
export function setupCommand(pluginRoot, { platform = process.platform, noSystemCa = false } = {}) {
  return pluginScriptCommand(pluginRoot, 'scripts/setup/cli.js', { platform, noSystemCa });
}

// The allow rule for one of these commands, in this file's `Bash(x:*)` form, the same as
// `Bash(x *)`; null for a command that has none.
export function allowRule(command) {
  return command === null ? null : `Bash(${command}:*)`;
}

// The socket's path names this computer's home folder, so it stays out of the
// shared file. The status line is added only when `node` and `pluginRoot` are given and the
// director has none of their own (`ownStatusLine`, from directorStatusLine); otherwise theirs
// stays and the share comes from the mod alone. With `pluginRoot`, the front desk's command and
// setup's are allowed by their full paths, so the director's session isn't asked each time it
// composes a card, records a decision or asks setup for a step; the paths name this computer's
// folders too. Beside the front desk's, writing the one file the front desk gives that command its
// input from when its session has no scratchpad (FRONT_DESK_INPUT, ruling F85), and the work's
// reports it writes for `record work` (WORK_REPORTS_RULE: Markdown files directly in .wheelhouse/work/),
// by the project-relative form, and nothing else in the project.
export function localSettings({ address, node, pluginRoot, ownStatusLine = null, platform = process.platform, model = null }) {
  const settings = { sandbox: { network: { allowUnixSockets: [address] } } };
  // The front desk's model, pinned in the routing table (design section 8). This file is never
  // committed; the worktrees inside the folder read it too, so the foreman's and the feature
  // sessions' calls always name their own model (adapters/claude-code/sessions.js).
  if (model) settings.model = model;
  if (node && pluginRoot && !ownStatusLine) {
    settings.statusLine = { type: 'command', command: statusLineCommand({ node, pluginRoot }) };
  }
  // Written on Windows too, unlike the build commands' rules: each reaches only one of Wheelhouse's
  // own cli.js files, by its full path, never `node` itself.
  const frontDesk = pluginRoot ? allowRule(frontDeskCommand(pluginRoot, { platform })) : null;
  const setup = pluginRoot ? allowRule(setupCommand(pluginRoot, { platform })) : null;
  // The session start names the command with NO_SYSTEM_CA when its Node.js knows it, and the playbooks
  // name setup's command from that line, so each command is allowed in both forms.
  const frontDeskFlagged = pluginRoot ? allowRule(frontDeskCommand(pluginRoot, { platform, noSystemCa: true })) : null;
  const setupFlagged = pluginRoot ? allowRule(setupCommand(pluginRoot, { platform, noSystemCa: true })) : null;
  const allow = [
    ...(frontDesk === null ? [] : [frontDesk, frontDeskFlagged, `Edit(/${FRONT_DESK_INPUT})`, WORK_REPORTS_RULE]),
    ...(setup === null ? [] : [setup, setupFlagged]),
  ];
  if (allow.length > 0) settings.permissions = { allow };
  return settings;
}

const own = (o, k) => Object.hasOwn(o, k);
// A plain assignment would turn a `__proto__` key into the prototype.
const set = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });

// Arrays are joined without duplicates, the director's entries first; objects
// merge key by key (own keys only); for anything else ours wins. Neither input
// is changed.
export function mergeSettings(existing, ours) {
  if (Array.isArray(existing) && Array.isArray(ours)) {
    const seen = new Set();
    return [...existing, ...ours].filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((item) => structuredClone(item));
  }
  if (isObject(existing) && isObject(ours)) {
    const merged = {};
    for (const key of Object.keys(existing)) set(merged, key, own(ours, key) ? mergeSettings(existing[key], ours[key]) : structuredClone(existing[key]));
    for (const key of Object.keys(ours)) if (!own(existing, key)) set(merged, key, structuredClone(ours[key]));
    return merged;
  }
  return structuredClone(ours);
}

export function writeSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export function sandboxFlag(platform = process.platform) {
  return platform === 'win32' ? WINDOWS_LINE : 'The sandbox is on: commands run inside it.';
}
