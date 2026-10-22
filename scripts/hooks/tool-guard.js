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
const SCRIPT_LIMIT = 2 * 1024 * 1024;
const READ_BUDGET = 8 * 1024 * 1024;
const SNIFF = 4096;

// The index of a segment's command word: past assignments, options (and the
// values of a wrapper's options), durations and wrappers such as env, sudo and
// timeout, and the `function NAME` of a definition. A comment, and `command -v x`
// which only looks a name up, have none. It is seg.length when there is none.
function commandAt(seg, names) {
  let wrapper = null;
  for (let i = 0; i < seg.length; i += 1) {
    if (OPTION.test(seg[i])) {
      if (wrapper !== null && (WRAPPER_VALUES[wrapper] ?? []).includes(seg[i])) i += 1;
      continue;
    }
    if (seg[i].startsWith('#')) return seg.length; // a comment
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

// Reads one script file: 'missing' when it is not there, true when it is
// refused, else false. Only a regular file is read: it is opened without
// blocking and looked at through the descriptor, so a device or a fifo swapped
// in cannot hold the hook. A result is kept by path, a file being read counts
// as refused (so a loop refuses), and the bytes read in one decision are capped.
function readScript(abs, ctx, depth, mode) {
  const key = `${mode}\0${abs}`;
  const { results } = ctx.state;
  if (results.has(key)) return results.get(key);
  let fd;
  try {
    const flags = fs.constants.O_RDONLY | (process.platform === 'win32' ? 0 : (fs.constants.O_NONBLOCK ?? 0));
    fd = fs.openSync(abs, flags);
  } catch (error) {
    return ['ENOENT', 'ENOTDIR'].includes(error?.code) ? 'missing' : true;
  }
  results.set(key, true);
  let result = true;
  try {
    const stat = fs.fstatSync(fd);
    if (stat.isFile() && stat.size <= SCRIPT_LIMIT && (ctx.state.bytes += stat.size) <= READ_BUDGET) {
      const buffer = Buffer.alloc(stat.size);
      let got = 0;
      while (got < buffer.length) {
        const n = fs.readSync(fd, buffer, got, buffer.length - got, got);
        if (n === 0) break;
        got += n;
      }
      const head = buffer.subarray(0, Math.min(SNIFF, got));
      if (head.includes(0)) {
        result = false;
      } else if (mode === 'path' && !shebangShell(head.toString('utf8'))) {
        result = false;
      } else if (mode === 'path' && !ctx.windows && (stat.mode & 0o111) === 0 && !head.toString('utf8').startsWith('#!')) {
        result = false; // the shell won't run a text file with no shebang that is not executable
      } else {
        const text = buffer.subarray(0, got).toString('utf8');
        result = bashRefused(text, { ...ctx, dirs: [path.dirname(abs)], wordsOnly: mode === 'batch' }, depth + 1);
      }
    }
  } catch {
    result = true;
  } finally {
    fs.closeSync(fd);
  }
  results.set(key, result);
  return result;
}

// Whether a script file stops a command being let through: it can't be placed,
// found or read, is not a regular file or is too big, or its text is refused. A
// relative file is looked for in each folder the command might be in, and
// refused if any copy is. A binary passes. In 'path' mode (a command word with a
// slash) a text file whose shebang names something other than a shell passes
// too, since a shell does not run it, and a file that is missing passes unless
// `named` (another word of the command names it, as in `echo x > t.sh; ./t.sh`).
// In 'batch' mode only the host tools and .env files named are looked for.
// A file inside Wheelhouse's home or a credential folder is refused unread.
function scriptRefused(file, ctx, depth, mode = 'shell', named = true) {
  if (depth > MAX_DEPTH) return true;
  let name = file;
  if (name === '~' || name.startsWith('~/') || (ctx.windows && name.startsWith('~\\'))) name = expandHome(name, ctx.home, ctx.windows);
  if (name === '' || /[$`]/.test(name) || name.startsWith('~')) return true;
  if (ctx.windows && /^\/[A-Za-z]\//.test(name)) name = `${name[1].toUpperCase()}:${name.slice(2)}`;
  const absolute = path.isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name);
  if (!absolute && ctx.dirs === null) return true;
  const candidates = [...new Set(absolute ? [name] : ctx.dirs.map((d) => path.resolve(d, name)))];
  const found = [];
  for (const candidate of candidates) {
    try {
      const real = resolveReal(candidate, candidate);
      if ((ctx.secrets ?? []).some((s) => inside(ctx.fold, s, candidate) || inside(ctx.fold, s, real))) return true;
    } catch {
      return true;
    }
    const result = readScript(candidate, ctx, depth, mode);
    if (result === true) return true;
    if (result === false) found.push(candidate);
  }
  if (found.length > 0) return false;
  return !(mode === 'path' && !named && !(ctx.windows && absolute));
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
// a pipe or redirect (its segment has no script), code made at run time by a
// substitution, and a script file that a shell, `source` or a path runs, are
// read and held to the same rules; a script that can't be read yet is refused.
// A script run by another program (`node x.js`, `npm run`, `make`) is not looked
// into, and neither is code made at run time that the words don't show (`$VAR` or
// a backtick substitution as a command, `sh -c "true; $(...)"`). The files read in one decision are kept by path and capped in size.
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
    const script = (file, mode) => {
      const named = (counts.get(fold(lastPart(file))) ?? 0) > 1;
      return scriptRefused(file, inContext(dirs), depth, mode, named);
    };
    const runner = RUNNERS.has(name) ? k : seg.findIndex((w) => RUNNER_FLAGS.has(w));
    if (runner >= 0) {
      if (segNames.slice(runner + 1).some((n) => SHELLS.has(n))) return true;
      if (RUNNER_FLAGS.has(seg[runner]) && seg[runner + 1] === '{}') return true;
    }
    if (POSIX_SHELLS.has(name)) {
      const flag = args.findIndex((w) => SHELL_FLAG.test(w));
      if (flag >= 0) {
        if (flag === args.length - 1) return true;
      } else {
        const file = args.find((w) => !OPTION.test(w));
        if (args.includes('-') || args.includes('-s') || file === undefined || script(file, 'shell')) return true;
      }
    } else if (PWSH.has(name)) {
      if (args.length === 0 || args.includes('-')) return true;
      const f = args.findIndex((w) => /^-(file|f)$/i.test(w));
      const commanded = args.some((w) => /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(w) || encodedFlag(w, windows));
      if (f >= 0) {
        if (f === args.length - 1 || script(args[f + 1], 'shell')) return true;
      } else if (!commanded) {
        // PowerShell takes its first plain word for -File.
        for (let j = 0; j < args.length; j += 1) {
          if (OPTION.test(args[j])) {
            if (PWSH_VALUE_OPTIONS.has(args[j].replace(/^(--?|\/)/, '').toLowerCase())) j += 1;
          } else {
            if (script(args[j], 'shell')) return true;
            break;
          }
        }
      }
    } else if (lname === 'iex' || lname === 'invoke-expression') {
      if (args.length === 0 || args.some((w) => !OPTION.test(w) && again(w))) return true;
    } else if (name === 'cmd') {
      if (args.length === 0) return true;
      const c = args.findIndex((w) => /^\/[ck]$/i.test(w));
      if (c >= 0 && /\.(bat|cmd)$/i.test(args[c + 1] ?? '') && script(args[c + 1], 'batch')) return true;
    } else if (name === 'eval') {
      if (args.every((w) => w === '')) return true;
    } else if (name === 'source' || seg[k] === '.') {
      // With no file, it reads a redirect or a process substitution.
      if (args.length === 0 || script(args[0], 'shell')) return true;
    } else if (MOVERS.has(lname)) {
      dirs = movedDirs(dirs, args.find((w) => !OPTION.test(w)), ctx);
    } else if (/[\\/]/.test(seg[k]) && !seg[k].startsWith('#') && script(seg[k], 'path')) {
      return true;
    }
    return false;
  };
  // A redirect's first word is its file; the words after it belong to the command
  // before it, or are the command when the redirect comes first.
  let pending = null;
  for (const [index, whole] of segs.entries()) {
    const redirect = operators[index] === '<' || operators[index] === '>';
    const names = whole.map(nameOf);
    const comment = whole[0]?.startsWith('#');
    for (let i = 0; i < whole.length; i += 1) {
      const seg = whole;
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
      // The rest of a comment is not run, so only the names above are looked for in it.
      if (comment) continue;
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
    if (ctx.wordsOnly) continue;
    if (!redirect) {
      if (pending !== null && commandRefused(pending)) return true;
      pending = [...whole];
    } else if (pending === null) {
      pending = whole.slice(1);
    } else {
      pending.push(...whole.slice(1));
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
    const ctx = { windows, fold, cwd, home, secrets: secretFolders(home, platform), state: { results: new Map(), bytes: 0 } };
    return bashRefused(command, ctx) ? refuse('run the host tools, push, or read a .env file') : undefined;
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
