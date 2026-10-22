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
import { segmentsWithOperators } from './shell-words.js';
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

// The folders and files that hold Wheelhouse's keys and the computer's credentials, as given and by real path.
function secretFolders(home, platform) {
  const homeReal = resolveReal(home, home);
  return [
    path.join(home, '.wheelhouse'), path.join(homeReal, '.wheelhouse'),
    wheelhouseHome(), resolveReal(wheelhouseHome(), home),
    ...credentialPaths(platform).flatMap((c) => [path.join(home, ...c.split('/')), path.join(homeReal, ...c.split('/'))]),
  ];
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
  const secrets = secretFolders(home, platform);
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
const WRAPPERS = new Set(['command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'sudo', 'doas', 'timeout', 'stdbuf', 'setsid', 'env', 'then', 'do', 'else', 'if', 'elif', 'while', 'until', '!', '{', '}']);
// The options of a wrapper that take the next word as their value.
const WRAPPER_VALUES = {
  sudo: ['-u', '-g', '-C', '-h', '-p', '-r', '-t', '-U'], timeout: ['-s', '-k'], exec: ['-a'], env: ['-u', '-C'], nice: ['-n'], stdbuf: ['-i', '-o', '-e'],
};
const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const RUNNERS = new Set(['xargs', 'parallel', 'watch']);
const RUNNER_FLAGS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const MOVERS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location']);
const PWSH_VALUE_OPTIONS = new Set(['executionpolicy', 'ep', 'workingdirectory', 'wd', 'outputformat', 'of', 'inputformat', 'if', 'windowstyle', 'w', 'configurationname', 'configurationfile', 'settingsfile', 'custompipename']);

// The index of a segment's command word: past assignments, options (and the
// values of a wrapper's options), durations and wrappers such as env, sudo and
// timeout, and the `function NAME` of a definition. `command -v x`, which only
// looks a name up, has none. It is seg.length when there is none.
function commandAt(seg, names) {
  let wrapper = null;
  for (let i = 0; i < seg.length; i += 1) {
    if (OPTION.test(seg[i])) {
      if (wrapper !== null && (WRAPPER_VALUES[wrapper] ?? []).includes(seg[i])) i += 1;
      continue;
    }
    if (ASSIGNMENT.test(seg[i]) || DURATION.test(seg[i])) continue;
    if (names[i] === 'function') {
      i += 1; // and the function's name
      continue;
    }
    if (WRAPPERS.has(names[i])) {
      if (names[i] === 'command' && /^-[A-Za-z]*[vV]/.test(seg[i + 1] ?? '')) return seg.length;
      wrapper = names[i];
      continue;
    }
    return i;
  }
  return seg.length;
}

// A file name that reads the command's input, as a pipe into a shell does.
const INPUT_FILE = /^(-|\/dev\/stdin|\/dev\/fd\/\d+|\/proc\/self\/fd\/\d+)$/;

// Whether a script that a shell, `source` or a path runs stops the command. The
// file is never opened: only the command line and whether anything is at the
// path are looked at. It is refused when another word of the command has the
// same last part (`named`: the command writes, copies, downloads or chmods it),
// when it reads the command's input, or when its name is empty or made at run
// time. It is also refused when it is in none of the folders the command might
// be in (it can only come into being during the command), or is relative and
// the folder can't be told; a command word run by its path is held to that only
// when it starts with ./, ../ or / (or a drive on Windows), since a line such as
// `scripts/x.js: tidy` in a commit body reads as a command too.
function scriptRefused(file, ctx, named, byPath = false) {
  let name = expandHome(file, ctx.home, ctx.windows);
  if (named || INPUT_FILE.test(name) || name === '' || /[$`]/.test(name)) return true;
  if (byPath && !/^\.{0,2}[\\/]/.test(file) && !(ctx.windows && /^[A-Za-z]:[\\/]/.test(file))) return false;
  if (name.startsWith('~')) return true;
  if (ctx.windows && /^\/[A-Za-z]\//.test(name)) name = `${name[1].toUpperCase()}:${name.slice(2)}`;
  const absolute = path.isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name);
  if (!absolute && ctx.dirs === null) return true;
  return !(absolute ? [name] : ctx.dirs.map((d) => path.resolve(d, name))).some((c) => fs.existsSync(c));
}

// The folders a command might be in after a cd, pushd or Set-Location: the ones
// it was in, and the target in each where that is a folder. A shell that stays
// put when the target is missing, or leaves a subshell, is covered by keeping
// the old ones. null means the target can't be told (a variable, a substitution,
// `cd -`, a bare cd), so relative scripts can't be placed.
function movedDirs(dirs, to, ctx) {
  if (dirs === null || to === undefined || to === '' || to === '-' || /[$`]/.test(to)) return null;
  const target = expandHome(to, ctx.home, ctx.windows);
  if (target.startsWith('~')) return null;
  const moved = [...dirs];
  for (const dir of dirs) {
    const next = path.resolve(dir, target);
    try {
      if (fs.statSync(next).isDirectory() && !moved.includes(next)) moved.push(next);
    } catch {
      // The shell stays where it was.
    }
  }
  return moved;
}

// Whether a command line should be refused: a host tool, git push, a .env file,
// an unreadable quote. Strings handed to a shell are split again. A shell fed by
// a pipe or redirect (its segment has no script) is refused, and so is a script
// run by a shell, `source` or a path that scriptRefused holds. No script file is
// opened, and code made at run time that the words don't show (`$VAR` or a
// substitution as a command, `sh -c "true; $(...)"`) is not followed.
function bashRefused(command, ctx, depth = 0) {
  const { windows, fold } = ctx;
  if (depth > MAX_DEPTH) return true;
  const split = segmentsWithOperators(command, windows);
  if (split === null) return true;
  const { segments: segs, operators } = split;
  const inContext = (dirs) => ({ ...ctx, dirs });
  let dirs = ctx.dirs === undefined ? (ctx.cwd ? [ctx.cwd] : null) : ctx.dirs;
  const again = (text) => bashRefused(text, inContext(dirs), depth + 1);
  const nameOf = (w) => fold(lastPart(w)).replace(/\.exe$/, '');
  const counts = new Map();
  for (const w of segs.flat()) counts.set(fold(lastPart(w)), (counts.get(fold(lastPart(w))) ?? 0) + 1);
  const commandRefused = (seg) => {
    const segNames = seg.map(nameOf);
    const k = commandAt(seg, segNames);
    if (k >= seg.length) return false;
    const name = segNames[k];
    const lname = name.toLowerCase();
    const args = seg.slice(k + 1);
    // Code made at run time: an empty word, or an unquoted $( that leaves a lone $.
    if (seg[k] === '' || seg[k].endsWith('$')) return true;
    const script = (file, byPath) => scriptRefused(file, inContext(dirs), (counts.get(fold(lastPart(file))) ?? 0) > 1, byPath);
    // A runner starts the command in its words: a shell named there, `{}` as the
    // command, or a script named by its path is held as a command word would be.
    // A parallel with no command (before any :::) reads its commands from its input.
    const runner = RUNNERS.has(name) ? k : seg.findIndex((w) => RUNNER_FLAGS.has(w));
    if (runner >= 0) {
      if (segNames.slice(runner + 1).some((n) => SHELLS.has(n))) return true;
      if (RUNNER_FLAGS.has(seg[runner]) && seg[runner + 1] === '{}') return true;
      const started = seg.slice(runner + 1).find((w) => /[\\/]/.test(w));
      if (started !== undefined && script(started, true)) return true;
      if (name === 'parallel' && runner === k) {
        const end = args.findIndex((w) => /^:::/.test(w));
        if (!(end < 0 ? args : args.slice(0, end)).some((w) => !OPTION.test(w) && !DURATION.test(w))) return true;
      }
    }
    if (POSIX_SHELLS.has(name)) {
      const flag = args.findIndex((w) => SHELL_FLAG.test(w));
      if (flag >= 0) {
        if (flag === args.length - 1) return true;
      } else {
        const file = args.find((w) => !OPTION.test(w));
        if (args.includes('-') || args.includes('-s') || file === undefined || script(file)) return true;
      }
    } else if (PWSH.has(name)) {
      if (args.length === 0 || args.includes('-')) return true;
      const f = args.findIndex((w) => /^-(file|f)$/i.test(w));
      const commanded = args.some((w) => /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(w) || encodedFlag(w, windows));
      if (f >= 0) {
        if (f === args.length - 1 || script(args[f + 1])) return true;
      } else if (!commanded) {
        // PowerShell takes its first plain word for -File.
        for (let j = 0; j < args.length; j += 1) {
          if (OPTION.test(args[j])) {
            if (PWSH_VALUE_OPTIONS.has(args[j].replace(/^(--?|\/)/, '').toLowerCase())) j += 1;
          } else {
            if (script(args[j])) return true;
            break;
          }
        }
      }
    } else if (lname === 'iex' || lname === 'invoke-expression') {
      if (args.length === 0 || args.some((w) => !OPTION.test(w) && again(w))) return true;
    } else if (name === 'cmd') {
      if (args.length === 0) return true;
      const c = args.findIndex((w) => /^\/[ck]$/i.test(w));
      if (c >= 0 && /\.(bat|cmd)$/i.test(args[c + 1] ?? '') && script(args[c + 1])) return true;
    } else if (name === 'eval') {
      if (args.every((w) => w === '')) return true;
    } else if (name === 'source' || seg[k] === '.') {
      // With no file, it reads a redirect or a process substitution.
      if (args.length === 0 || script(args[0])) return true;
    } else if (MOVERS.has(lname)) {
      dirs = movedDirs(dirs, args.find((w) => !OPTION.test(w)), ctx);
    } else if (/[\\/]/.test(seg[k]) && script(seg[k], true)) {
      return true;
    }
    return false;
  };
  // A redirect's first word is its file. The words after it are held both as a
  // command of their own and as part of the command before it.
  let pending = null;
  for (const [index, seg] of segs.entries()) {
    const names = seg.map(nameOf);
    for (let i = 0; i < seg.length; i += 1) {
      const word = seg[i];
      const value = word.slice(word.indexOf('=') + 1);
      if (['gh', 'glab'].includes(names[i]) || ['gh', 'glab'].includes(nameOf(value))) return true;
      if (GIT_PUSHERS.has(names[i])) return true;
      if (names[i] === 'git' && gitPushes(seg.slice(i + 1))) return true;
      for (const candidate of [word, value]) {
        // A '<rev>:' prefix, as in HEAD:.env, is a path boundary too; on Windows
        // `.env:stream` and `.env::$DATA` name the file, so the name before the
        // colon counts as well.
        for (const name of [fold(lastPart(candidate)), fold(candidate.split(/[\\/:]/).at(-1))]) {
          if (envName(name, fold) || (name.startsWith('.e') && /[*?[]/.test(name))) return true;
        }
      }
      if (names[i] === 'eval' && again(seg.slice(i + 1).join(' '))) return true;
      if (SHELL_FLAG.test(word) && i + 1 < seg.length && (seg[i + 1] === '' || again(seg[i + 1]))) return true;
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
    if (operators[index] !== '<' && operators[index] !== '>') {
      if (pending !== null && commandRefused(pending)) return true;
      pending = [...seg];
    } else {
      if (commandRefused(seg.slice(1))) return true;
      pending = [...(pending ?? []), ...seg.slice(1)];
    }
  }
  return pending !== null && commandRefused(pending);
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
    return bashRefused(command, { windows, fold, cwd, home }) ? refuse('run the host tools, push, or read a .env file') : undefined;
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
