// scripts/hooks/tool-guard.js
// Before each file, shell (Bash, PowerShell, Monitor) or connector tool (mcp__*
// and the MCP resource tools) in a Wheelhouse project, or in a folder being set up (kit.js's
// beingSetUp), as in a project: refuses
// secrets (.env files, the credential folders, Wheelhouse's own home), writes to
// the places that hold the guardrails, the host tools (gh, glab, git push) and
// connectors the project has not listed (the Claude Desktop app's own drawing tools
// pass unlisted in a session it started). It backs up the deny rules and the
// sandbox; it does not replace them. Any other tool passes untouched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answer, runAndExit, projectOf, registeredByPath, beingSetUp } from './kit.js';
import { segments } from './shell-words.js';
import { credentialPaths } from '../lib/credentials.js';
import { wheelhouseHome } from '../lib/paths.js';
import { projectForFolder } from '../lib/projects.js';
import { readConfig } from '../gate/guardrails.js';
import { startedAsScript } from '../lib/started-as-script.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const WRITING = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const FILE_TOOLS = ['Read', ...WRITING, 'Grep', 'Glob'];
const SHELL_TOOLS = ['Bash', 'PowerShell', 'Monitor'];
const HELPER = 'ask the helper to do it';

function foldFor(platform) {
  if (platform === 'win32') return (p) => windowsName(p).toLowerCase();
  return platform === 'darwin' ? (p) => p.toLowerCase() : (p) => p;
}

const refuse = (what) => answer.deny(`Wheelhouse does not let an agent ${what}: ${HELPER}`);

const MAX_LINKS = 40;
const TOO_MANY = 'Too many links';

// The path made absolute and real. Each part is looked at with lstat; a link is
// followed by its text even when its target is missing, so a write through a
// dangling link is placed where it will really land. Past 40 links it throws,
// which the hook answers with a refusal.
function resolveReal(file, cwd) {
  const start = path.resolve(cwd, file);
  const root = path.parse(start).root;
  let queue = start.slice(root.length).split(/[\\/]/).filter(Boolean);
  let current = root;
  let links = 0;
  while (queue.length > 0) {
    const [part, ...rest] = queue;
    queue = rest;
    if (part === '.') continue;
    if (part === '..') {
      current = path.dirname(current);
      continue;
    }
    const candidate = path.join(current, part);
    let stat = null;
    try {
      stat = fs.lstatSync(candidate);
    } catch {
      current = path.join(candidate, ...queue);
      queue = [];
      break;
    }
    if (stat.isSymbolicLink()) {
      links += 1;
      if (links > MAX_LINKS) throw new Error(TOO_MANY);
      const target = path.resolve(current, fs.readlinkSync(candidate));
      const targetRoot = path.parse(target).root;
      queue = [...target.slice(targetRoot.length).split(/[\\/]/).filter(Boolean), ...queue];
      current = targetRoot;
    } else {
      current = candidate;
    }
  }
  return current;
}

// A leading ~ means the home folder.
function expandHome(given, home, windows) {
  if (given === '~') return home;
  if (given.startsWith('~/') || (windows && given.startsWith('~\\'))) return path.join(home, given.slice(2));
  return given;
}

function envName(name, fold) {
  const n = fold(name);
  return n.startsWith('.env');
}

// On Windows a path part may end in dots or spaces and carry an NTFS stream
// (`name::$DATA`); none of that changes which file is meant. Each part is
// trimmed and cut at its colon (a drive such as C: first of all is kept).
export function windowsName(p) {
  return p.split(/([\\/])/).map((part, i) => {
    if (part === '' || part === '.' || part === '..' || /^[\\/]$/.test(part)) return part;
    if (i === 0 && /^[A-Za-z]:$/.test(part)) return part;
    return part.replace(/:.*$/s, '').replace(/[. ]+$/, '');
  }).join('');
}

const lastPart = (word) => word.split(/[\\/]/).at(-1);

// Whether the folder holds the file, or is it.
function inside(fold, folder, file) {
  const base = fold(folder);
  const target = fold(file);
  return target === base || target.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}

function fileRefusal(input, { home, platform, pluginRoot }) {
  const tool = input.tool_name;
  const args = input.tool_input ?? {};
  const fold = foldFor(platform);
  const raw = tool === 'NotebookEdit' ? args.notebook_path : (tool === 'Grep' || tool === 'Glob') ? (args.path ?? input.cwd) : args.file_path;
  if (typeof raw !== 'string' || raw === '') throw new Error('A file tool without a path');
  const given = expandHome(raw, home, platform === 'win32');
  if (tool === 'Glob' && typeof args.pattern === 'string' && patternNamesEnv(args.pattern, fold)) return refuse('read a .env file');
  if (tool === 'Grep' && typeof args.glob === 'string' && patternNamesEnv(args.glob, fold)) return refuse('read a .env file');
  const absolute = path.resolve(input.cwd, given);
  const real = resolveReal(given, input.cwd);
  for (const candidate of [absolute, real]) {
    if (envName(path.basename(candidate), fold)) return refuse('read a .env file');
  }
  const homeReal = resolveReal(home, home);
  const secrets = [
    path.join(home, '.wheelhouse'), path.join(homeReal, '.wheelhouse'),
    wheelhouseHome(), resolveReal(wheelhouseHome(), home),
    ...credentialPaths(platform).flatMap((c) => [path.join(home, ...c.split('/')), path.join(homeReal, ...c.split('/'))]),
  ];
  for (const candidate of [absolute, real]) {
    if (secrets.some((s) => inside(fold, s, candidate))) return refuse('open Wheelhouse\'s keys or the credentials on this computer');
  }
  // A search over the home folder, or over a folder that holds a guarded one,
  // could read the secrets below it. The deny rules (Task 12) back up the gap
  // that remains: this hook does not look inside what a search returns.
  if (tool === 'Grep' || tool === 'Glob') {
    for (const candidate of [absolute, real]) {
      if (inside(fold, candidate, homeReal) || inside(fold, candidate, home) || secrets.some((s) => inside(fold, candidate, s))) {
        return refuse('search the home folder or a folder holding credentials');
      }
    }
  }
  if (WRITING.includes(tool)) {
    const guarded = [path.join(home, '.claude'), path.join(homeReal, '.claude'), path.resolve(pluginRoot), resolveReal(pluginRoot, pluginRoot)];
    for (const candidate of [absolute, real]) {
      if (guarded.some((g) => inside(fold, g, candidate))) return refuse('change Claude\'s settings or the Wheelhouse plugin');
      const parts = fold(candidate).split(/[\\/]/);
      if ((parts.at(-1) === 'settings.local.json' || parts.at(-1) === 'settings.json') && parts.at(-2) === '.claude') return refuse('change Claude\'s settings');
      if (parts.some((part, i) => part === '.claude' && parts[i + 1] === 'hooks' && i + 2 < parts.length)) return refuse('change the project\'s hooks');
    }
  }
  return null;
}

// Whether a Glob pattern or Grep glob names a .env file.
function patternNamesEnv(pattern, fold) {
  return pattern.split(/[\\/{},]/).some((part) => envName(part, fold));
}

const SHELL_FLAG = /^-[A-Za-z]*c$|^\/[ck]$/i;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd']);
const OPTION = /^-|^\/[A-Za-z]$/;
// git's global options that take the next word as their value.
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path']);
const GIT_PUSHERS = new Set(['git-push', 'git-send-pack', 'git-receive-pack']);
const MAX_DEPTH = 6;
const PWSH = new Set(['pwsh', 'powershell']);

// Whether a word is PowerShell's -EncodedCommand, which hides the command from
// this check: any unambiguous short form (-e, -ec, -en, -enc ...), in any case,
// with - or --, and on Windows with / too.
function encodedFlag(word, windows) {
  const m = /^(--?|\/)([a-z]+)$/.exec(word.toLowerCase());
  if (!m || (m[1] === '/' && !windows)) return false;
  return m[2] === 'ec' || 'encodedcommand'.startsWith(m[2]);
}

// Whether a git command line (the words after the `git` word) pushes: its
// subcommand is push or send-pack, or an alias is defined on the line.
function gitPushes(args) {
  for (let i = 0; i < args.length; i += 1) {
    const w = args[i];
    if (w.startsWith('-')) {
      if (w === '-c' && /^alias\./i.test(args[i + 1] ?? '')) return true;
      if (/^--config-env=alias\./i.test(w)) return true;
      if (GIT_VALUE_OPTIONS.has(w)) i += 1;
    } else {
      return ['push', 'send-pack', 'receive-pack'].includes(w);
    }
  }
  return false;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const DURATION = /^\d+(\.\d+)?[smhd]?$/;
const WRAPPERS = new Set(['command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'sudo', 'doas', 'timeout', 'stdbuf', 'setsid', 'env', 'then', 'do', 'else', 'if', 'elif', 'while', 'until', '!']);
const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const SCRIPT_LIMIT = 1024 * 1024;
const SNIFF = 4096;

// The index of a segment's command word: past assignments, options, durations
// and wrappers such as env, sudo and timeout. `command -v x` only looks a name
// up, so it has none. It is seg.length when there is none.
function commandAt(seg, names) {
  for (let i = 0; i < seg.length; i += 1) {
    if (ASSIGNMENT.test(seg[i]) || OPTION.test(seg[i]) || DURATION.test(seg[i])) continue;
    if (WRAPPERS.has(names[i])) {
      if (names[i] === 'command' && /^-[A-Za-z]*[vV]/.test(seg[i + 1] ?? '')) return seg.length;
      continue;
    }
    return i;
  }
  return seg.length;
}

// Whether the first line of a script text makes it a shell script: it has no
// shebang, or the shebang names a shell, directly or through env.
function shebangShell(text) {
  const first = text.split(/\r?\n/, 1)[0];
  if (!first.startsWith('#!')) return true;
  const words = first.slice(2).trim().split(/\s+/);
  let name = lastPart(words[0] ?? '');
  if (name === 'env') name = lastPart(words.slice(1).find((w) => !w.startsWith('-')) ?? '');
  return POSIX_SHELLS.has(name);
}

// Whether a script file stops a command being let through: it can't be placed,
// found or read, is not a regular file or is over 1 MB, or its text is refused.
// Only a regular file is opened, so a device such as /dev/stdin can't block the
// hook. A binary passes. With byPath, a text file whose shebang names something
// other than a shell passes too, since a shell does not run it.
function scriptRefused(file, dir, ctx, depth, byPath = false) {
  if (depth > MAX_DEPTH) return true;
  if (/[$`]/.test(file) || file.startsWith('~')) return true;
  const absolute = path.isAbsolute(file) ? file : dir === null ? null : path.resolve(dir, file);
  if (absolute === null) return true;
  try {
    const stat = fs.statSync(absolute);
    // By path, a folder or device (the /dev/null of `2>/dev/null`) is not run as a script.
    if (!stat.isFile()) return !byPath;
    if (stat.size > SCRIPT_LIMIT) return true;
    const head = Buffer.alloc(Math.min(SNIFF, stat.size));
    const fd = fs.openSync(absolute, 'r');
    try {
      fs.readSync(fd, head, 0, head.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (head.includes(0)) return false;
    if (byPath && !shebangShell(head.toString('utf8'))) return false;
    const text = fs.readFileSync(absolute, 'utf8');
    return bashRefused(text, { ...ctx, cwd: path.dirname(absolute) }, depth + 1);
  } catch {
    return true;
  }
}

// Whether a command line should be refused: a host tool, git push, a .env file,
// an unreadable quote. Strings handed to a shell are split again. A shell fed by
// a pipe or redirect (its segment has no script), and a script file that a shell,
// `source` or a path runs, are read and held to the same rules; a script that
// can't be read yet is refused. A script run by another program (`node x.js`,
// `npm run`, `make`) is not looked into. A cd moves the folder that later
// scripts are found in.
function bashRefused(command, ctx, depth = 0) {
  const { windows, fold } = ctx;
  if (depth > MAX_DEPTH) return true;
  const segs = segments(command, windows);
  if (segs === null) return true;
  const again = (text) => bashRefused(text, ctx, depth + 1);
  const nameOf = (w) => fold(lastPart(w)).replace(/\.exe$/, '');
  let dir = ctx.cwd ?? null;
  for (const seg of segs) {
    const names = seg.map(nameOf);
    for (let i = 0; i < seg.length; i += 1) {
      const word = seg[i];
      const value = word.slice(word.indexOf('=') + 1);
      if (['gh', 'glab'].includes(names[i]) || ['gh', 'glab'].includes(nameOf(value))) return true;
      if (GIT_PUSHERS.has(names[i])) return true;
      if (names[i] === 'git' && gitPushes(seg.slice(i + 1))) return true;
      for (const candidate of [word, value]) {
        // A '<rev>:' prefix, as in HEAD:.env, is a path boundary too.
        const name = fold(candidate.split(/[\\/:]/).at(-1));
        if (envName(name, fold) || (name.startsWith('.e') && /[*?[]/.test(name))) return true;
      }
      if (names[i] === 'eval' && again(seg.slice(i + 1).join(' '))) return true;
      if (SHELL_FLAG.test(word) && i + 1 < seg.length && again(seg[i + 1])) return true;
      if (PWSH.has(names[i]) && seg.slice(i + 1).some((w) => encodedFlag(w, windows))) return true;
      if (SHELLS.has(names[i]) && seg.slice(i + 1).some((w) => !OPTION.test(w) && again(w))) return true;
      if (names[i] === 'env') {
        for (const w of seg.slice(i + 1)) {
          if (!OPTION.test(w) && again(w)) return true;
          const split = /^(?:--split-string=|-S)(.+)$/s.exec(w);
          if (split && again(split[1])) return true;
        }
      }
    }
    const k = commandAt(seg, names);
    if (k >= seg.length) continue;
    const name = names[k];
    const args = seg.slice(k + 1);
    const script = (file, byPath) => scriptRefused(file, dir, ctx, depth, byPath);
    const exec = seg.findIndex((w) => w === '-exec' || w === '-execdir');
    const from = name === 'xargs' ? k : exec;
    if (from >= 0 && names.slice(from + 1).some((n) => SHELLS.has(n))) return true;
    if (POSIX_SHELLS.has(name)) {
      const flag = args.findIndex((w) => SHELL_FLAG.test(w));
      if (flag >= 0) {
        if (flag === args.length - 1) return true;
      } else {
        const file = args.find((w) => !OPTION.test(w));
        if (args.includes('-') || args.includes('-s') || file === undefined || script(file, false)) return true;
      }
    } else if (PWSH.has(name)) {
      if (args.length === 0 || args.includes('-')) return true;
      const f = args.findIndex((w) => /^-(file|f)$/i.test(w));
      if (f >= 0 && (f === args.length - 1 || script(args[f + 1], false))) return true;
    } else if (name === 'cmd') {
      if (args.length === 0) return true;
    } else if (name === 'source' || seg[k] === '.') {
      if (args.length > 0 && script(args[0], false)) return true;
    } else if (name === 'cd' || name === 'pushd') {
      const to = args.find((w) => !OPTION.test(w));
      dir = to === undefined || dir === null || to.startsWith('~') || to.includes('$') ? null : path.resolve(dir, to);
    } else if (/[\\/]/.test(seg[k]) && !seg[k].startsWith('#') && script(seg[k], true)) {
      return true;
    }
  }
  return false;
}

// The servers the project allows, or null when the configuration cannot be read.
function allowedServers(mainFolder) {
  try {
    let text = null;
    try {
      text = fs.readFileSync(path.join(mainFolder, '.claude', 'wheelhouse.json'), 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') return null;
    }
    return readConfig(text).mcpServers;
  } catch {
    return null;
  }
}

// The tools that read a connector's resources name its server in their input.
const RESOURCE_TOOLS = ['ListMcpResourcesTool', 'ReadMcpResourceTool'];

function serverOf(input) {
  const name = input.tool_name;
  if (RESOURCE_TOOLS.includes(name)) {
    const server = input.tool_input?.server;
    return typeof server === 'string' ? server : null;
  }
  const rest = name.slice('mcp__'.length);
  const cut = rest.indexOf('__');
  return cut < 0 ? null : rest.slice(0, cut);
}

// The Claude Desktop app's own tools that only draw in the app (its task list, its wrap-up box
// and its panes) pass without the project listing them, and only in a session the app started.
// Each is named whole, so every other mcp__ccd_* tool, and one the app adds later, stays with
// the connector list.
//
// Why the names can be trusted. Claude Code itself reserves neither ccd_turn nor ccd_view, and
// writes each character of a server's name outside letters, digits, `_` and `-` as `_`. So in a
// session it starts on its own, a tool of one of these names can come from a user or local
// server (~/.claude.json), a --mcp-config server, a project's .mcp.json, or a tool a mod
// registers ($.tool.register), whose server is the bare plugin name, so a plugin named ccd_turn
// takes mcp__ccd_turn__wrap_up. What keeps those off the pass is the entrypoint: the six pass
// only when CLAUDE_CODE_ENTRYPOINT, which the app sets and hooks inherit, is the app's own. The
// app starts its sessions with a deniedMcpServers setting that names ccd_turn and ccd_view, so
// no configured server of either exact name loads there (its own come in through the SDK, which
// that setting does not hold). That setting matches the name exactly, so `ccd.turn` would slip
// past it; and so a project whose connector list or .mcp.json names either server, in any
// spelling, is refused both servers' tools, these included. A user or local server spelled so in
// ~/.claude.json isn't checked here, so it would load there and pass: that file is the director's
// own to write, not a project's.
const APP_TOOLS = new Set([
  'mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up',
  'mcp__ccd_view__show_pane', 'mcp__ccd_view__close_pane', 'mcp__ccd_view__get_layout', 'mcp__ccd_view__set_transcript_view',
]);
const APP_SERVERS = ['ccd_turn', 'ccd_view'];
// The values of CLAUDE_CODE_ENTRYPOINT in a session the Desktop app started.
const APP_ENTRYPOINTS = new Set(['claude-desktop', 'claude-desktop-3p']);

// A server's name as Claude Code writes it in its tools' names.
const asInToolNames = (name) => name.replace(/[^a-zA-Z0-9_-]/g, '_');
const namesAppServer = (names) => names.some((name) => APP_SERVERS.includes(asInToolNames(name)));

// Whether a .mcp.json names one of the app's servers. One that is there but can't be read counts
// as naming one.
function mcpJsonNamesAppServer(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return !['ENOENT', 'ENOTDIR'].includes(error?.code);
  }
  try {
    const servers = JSON.parse(text)?.mcpServers;
    if (servers === undefined) return false;
    if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) return true;
    return namesAppServer(Object.keys(servers));
  } catch {
    return true;
  }
}

// Whether the project's configuration names one of the app's servers: its connector list, the
// main folder's .mcp.json, or a .mcp.json in the session's folder, the folder the session started
// in (CLAUDE_PROJECT_DIR, whose .mcp.json the session loaded, though its cwd may have moved),
// or any folder above either, as given and by its real path.
function configurationNamesAppServer(allowed, mainFolder, cwd, projectDir) {
  if (namesAppServer(allowed)) return true;
  const files = new Set([path.join(mainFolder, '.mcp.json')]);
  const starts = [];
  for (const folder of [cwd, projectDir]) {
    if (typeof folder !== 'string' || folder === '') continue;
    starts.push(path.resolve(folder));
    try {
      starts.push(fs.realpathSync.native(folder));
    } catch {
      // The folder as given is still looked at.
    }
  }
  for (const start of starts) {
    for (let folder = start; ; folder = path.dirname(folder)) {
      files.add(path.join(folder, '.mcp.json'));
      if (path.dirname(folder) === folder) break;
    }
  }
  return [...files].some(mcpJsonNamesAppServer);
}

function connectorRefusal(input, server, mainFolder, entrypoint, projectDir) {
  const allowed = mainFolder ? allowedServers(mainFolder) : null;
  const appTool = APP_TOOLS.has(input.tool_name);
  if (allowed !== null && (appTool || APP_SERVERS.includes(server))) {
    if (configurationNamesAppServer(allowed, mainFolder, input.cwd, projectDir)) {
      return answer.deny(`This project's configuration names ccd_turn or ccd_view, which the Claude app keeps for its own tools: ${HELPER}`);
    }
    if (appTool && APP_ENTRYPOINTS.has(entrypoint)) return null;
  }
  if (server === null || server === '' || allowed === null || !allowed.includes(server)) {
    return answer.deny(`This project has not listed that connector: ${HELPER}`);
  }
  return null;
}

export async function decide(input, { dir, projectOf: find = projectOf, home = os.homedir(), platform = process.platform, pluginRoot = PLUGIN_ROOT, entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT, projectDir = process.env.CLAUDE_PROJECT_DIR } = {}) {
  const tool = input.tool_name;
  const isConnector = typeof tool === 'string' && (tool.startsWith('mcp__') || RESOURCE_TOOLS.includes(tool));
  if (!isConnector && !SHELL_TOOLS.includes(tool) && !FILE_TOOLS.includes(tool)) return undefined;
  const cwd = input.cwd;
  const found = find(cwd, { dir });
  const byPath = found ? false : registeredByPath(cwd);
  const setup = !found && byPath === false ? beingSetUp(cwd) : null;
  // A folder that cannot be placed is guarded, not waved through.
  if (!found && byPath === false && setup === null) return undefined;
  if (isConnector) {
    let main = found?.record?.folder ?? setup?.folder;
    if (!main) {
      try {
        main = projectForFolder(fs.realpathSync.native(cwd))?.record?.folder;
      } catch {
        main = undefined;
      }
    }
    return connectorRefusal(input, serverOf(input), main, entrypoint, projectDir) ?? undefined;
  }
  if (SHELL_TOOLS.includes(tool)) {
    const command = input.tool_input?.command;
    // Monitor runs a shell command, as Bash does, or opens a WebSocket (`ws`), which runs nothing here.
    if (tool === 'Monitor' && command === undefined && input.tool_input?.ws !== undefined) return undefined;
    if (typeof command !== 'string') throw new Error(`${tool} without a command`);
    // PowerShell exists on every system but is read as on Windows.
    const windows = platform === 'win32' || tool === 'PowerShell';
    const fold = foldFor(windows ? 'win32' : platform);
    return bashRefused(command, { windows, fold, cwd }) ? refuse('run the host tools, push, or read a .env file') : undefined;
  }
  try {
    return fileRefusal(input, { home, platform, pluginRoot }) ?? undefined;
  } catch (error) {
    if (error?.message === TOO_MANY) return refuse('use a path with that many links');
    throw error;
  }
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: true, event: 'PreToolUse' });
}
