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
// - Package-runner rules: `Bash(x:*)` needs a space after x, so a version form
//   (`npx wrangler@3 ...`) gets its own `@*` rule.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_BUILD_COMMANDS, isBuildCommand } from '../gate/guardrails.js';
import { credentialPaths } from '../lib/credentials.js';
import { WINDOWS_LINE } from '../lib/platform-lines.js';
import { MARKETPLACE, UPSTREAMS, WHEELHOUSE_REPO } from '../lineage/manifest.js';

const PLATFORMS = ['darwin', 'linux', 'win32'];
const HOST_TOOLS = ['vercel', 'netlify', 'flyctl', 'fly', 'wrangler', 'heroku', 'railway', 'aws', 'gcloud', 'az', 'doctl', 'supabase', 'neonctl', 'stripe'];
// Each tool, with the names its package has on npm where they differ.
const RUNNERS = ['npx', 'npm exec', 'pnpm dlx', 'bunx', 'yarn dlx'];
const PACKAGE_NAMES = ['netlify-cli', '@railway/cli'];
const OWN_FILES = ['.claude/settings.json', '.claude/settings.local.json'];

const unique = (list) => [...new Set(list)];

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
// session asks. On Windows there are none: the sandbox does not run there, so
// a rule such as `Bash(node:*)` would let a session run anything unasked. The
// commands are still checked there.
export function featureAllowRules(config, { platform = process.platform } = {}) {
  const commands = config?.buildCommands ?? DEFAULT_BUILD_COMMANDS;
  if (!Array.isArray(commands)) throw new Error('The build commands are not a list');
  for (const c of commands) if (!isBuildCommand(c)) throw new Error(`This build command can't be made into an allow rule: ${JSON.stringify(c)}`);
  if (platform === 'win32') return [];
  return unique(commands.map((c) => `Bash(${c}:*)`));
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

// `release` is { ref } when the project follows a Wheelhouse release; without it the
// marketplace entry carries no ref. Build commands' allow rules are not here: see featureAllowRules.
export function projectSettings(config, { release = null } = {}) {
  const credentials = allCredentials();
  const deny = unique([
    'Read(**/.env)', 'Read(**/.env.*)',
    'Read(~/.wheelhouse/**)', 'Edit(~/.wheelhouse/**)', 'Edit(~/.claude/**)',
    ...credentialRules(),
    ...OWN_FILES.map((f) => `Edit(/${f})`), 'Edit(/.claude/hooks/**)',
    'Bash(gh:*)', 'Bash(glab:*)', 'Bash(git push:*)',
    ...HOST_TOOLS.map((t) => `Bash(${t}:*)`),
    ...RUNNERS.flatMap((r) => unique([...HOST_TOOLS, ...PACKAGE_NAMES]).flatMap((t) => [`Bash(${r} ${t}:*)`, `Bash(${r} ${t}@*)`])),
  ]);
  return {
    permissions: { deny },
    sandbox: {
      enabled: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        denyRead: unique(['~/.wheelhouse', ...credentials.map((c) => `~/${c}`)]),
        denyWrite: ['~/.wheelhouse', '~/.claude', ...OWN_FILES.map((f) => `./${f}`), './.claude/hooks'],
      },
      network: { allowedDomains: unique(['registry.npmjs.org', ...config.webDomains.map(cleanDomain).filter((d) => d !== null)]) },
    },
    ...pluginSettings(release),
    autoCompactWindow: 300000,
    disableAllHooks: false,
    enableAllProjectMcpServers: false,
    ...structuredClone(ATTRIBUTION_OFF),
  };
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

// The socket's path names this computer's home folder, so it stays out of the
// shared file. The status line is added only when `node` and `pluginRoot` are given and the
// director has none of their own (`ownStatusLine`, from directorStatusLine); otherwise theirs
// stays and the share comes from the mod alone.
export function localSettings({ address, node, pluginRoot, ownStatusLine = null }) {
  const settings = { sandbox: { network: { allowUnixSockets: [address] } } };
  if (node && pluginRoot && !ownStatusLine) {
    settings.statusLine = { type: 'command', command: statusLineCommand({ node, pluginRoot }) };
  }
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
