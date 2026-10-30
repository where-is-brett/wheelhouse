// scripts/hooks/tool-guard.js
// Before each file, shell (Bash, PowerShell, Monitor) or connector tool (mcp__*
// and the MCP resource tools) in a Wheelhouse project, or in a folder being set up (kit.js's
// beingSetUp), as in a project: refuses
// secrets (.env files, the credential folders, Wheelhouse's own home), writes to
// the places that hold the guardrails (and the files that steer an agent, in the project and the
// home folder: writes only), the host tools (gh, glab, git push), a plain read of the keychain and
// connectors the project has not listed (the Claude Desktop app's own drawing tools
// pass unlisted in a session it started), and a coding agent started from the shell (the agents'
// own programs, scripts/agents/programs.js), and a read of Wheelhouse's own files: an agent runs
// the plugin's scripts with node, as its playbook names them, and reads none of them, so a gap in a
// playbook is reported rather than worked round from the code (scenario 27's route leg). And the build
// engine (spec 12.2): its program, the engine room's port, and its home but for the step's own run's
// artefacts and its own worktree (scripts/protection/archon.js). In a step that reads only (a review), any shell
// command but a reading one (read-only-shell.js). It backs up the deny rules and the
// sandbox; it does not replace them. Any other tool passes untouched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answer, runAndExit, projectOf, registeredByPath, beingSetUp, worktreeRoot } from './kit.js';
import { segmentsWithOperators } from './shell-words.js';
import { AGENT_CONTROL, CONTROL_FILE, homeControlFolders } from '../lib/agent-control.js';
import { credentialPaths } from '../lib/credentials.js';
import { wheelhouseHome, archonHome } from '../lib/paths.js';
import { projectForFolder } from '../lib/projects.js';
import { matchGlob } from '../gate/glob.js';
import { readConfig } from '../gate/guardrails.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { NESTED_PACKAGES, NESTED_REFUSED } from '../agents/programs.js';
import { ARCHON_PROGRAMS, ENGINE_ROOM_PORT, ownRun, placeInHome } from '../protection/archon.js';
import { readOnlyStep, shellWrite } from './read-only-shell.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const WRITING = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const FILE_TOOLS = ['Read', ...WRITING, 'Grep', 'Glob'];
const SHELL_TOOLS = ['Bash', 'PowerShell', 'Monitor'];
const HELPER = 'ask the helper to do it';

function foldFor(platform) {
  if (platform === 'win32') return (p) => windowsName(p).toLowerCase();
  return platform === 'darwin' ? (p) => p.toLowerCase() : (p) => p;
}

const UNREADABLE = 'Wheelhouse could not read this command with certainty. Write it more simply (no comments that hold quotes, backticks or backslashes, no CRLF line endings, no unclosed quotes), or put it in a file: ' + HELPER;
const refuse = (what) => answer.deny(`Wheelhouse does not let an agent ${what}: ${HELPER}`);
// The build engine (spec 12.2): its program and the engine room's port, and its own files.
const ENGINE = 'Wheelhouse does not let an agent run or reach the build engine: it answers only to the helper. Say what the work needs instead';
const ENGINE_FILES = 'Wheelhouse does not let an agent open the build engine\'s own files: only its own run\'s artefacts and its own worktree. Say what the work needs instead';
const OWN_ARTEFACTS = 'The step\'s own run\'s artefacts';
const READS_ONLY = (step, why) => `This step (${step}) reads only, so Wheelhouse lets its shell run only commands that read: ${why}. Read the change with git diff, git show, cat, sed -n, grep or rg, and say in your findings what you could not check`;
const PLUGIN_READ = 'Wheelhouse does not let an agent read its own scripts and files: your playbook names each command and what it takes. '
  + 'Run the command as the playbook gives it; where the playbook doesn\'t say how, tell the director what is missing instead of looking in Wheelhouse\'s code';

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

// The path made absolute, with the real path of its nearest existing parent (the file may not
// exist yet, as when a Write creates it) and the parts below that put back.
function realOfNearestParent(file, cwd) {
  const given = path.resolve(cwd, file);
  const below = [];
  for (let current = given; ; current = path.dirname(current)) {
    try {
      return path.join(fs.realpathSync.native(current), ...below);
    } catch {
      if (path.dirname(current) === current) return given;
      below.unshift(path.basename(current));
    }
  }
}

// Every spelling of a place that the guard looks at: as given, as links lead, and by its nearest
// existing parent's real path.
function spellings(file, cwd) {
  const out = new Set([path.resolve(cwd, file), realOfNearestParent(file, cwd)]);
  try {
    out.add(resolveReal(file, cwd));
  } catch (error) {
    if (error?.message !== TOO_MANY) throw error;
  }
  return [...out];
}

// Whether a path is a file that steers an agent (agent-control.js), in the home folder or in one of
// the project's roots (its main folder and the worktree the session is in), each by every spelling.
// Separators are made alike, since a Windows path may come with either, and case is ignored where
// the system ignores it (the same fold the other checks use).
function steersAgent(candidates, { roots, folders, platform, fold }) {
  const ignoreCase = platform === 'darwin' || platform === 'win32';
  const plain = (p) => fold(p).replaceAll('\\', '/').replace(/\/+$/, '');
  const below = (base, file) => (file === base ? [] : file.startsWith(`${base}/`) ? file.slice(base.length + 1).split('/').filter(Boolean) : null);
  for (const candidate of candidates.map(plain)) {
    if (folders.some((f) => below(plain(f), candidate) !== null)) return true;
    for (const root of roots.map(plain)) {
      const parts = below(root, candidate);
      if (parts !== null && parts.length > 0 && AGENT_CONTROL.some((p) => matchGlob(p, parts.join('/'), { ignoreCase }))) return true;
    }
  }
  return false;
}

function fileRefusal(input, { home, platform, pluginRoot, env, roots, engine }) {
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
  // Wheelhouse's own files, by the path given or a Glob pattern's fixed start; a write is refused below in other words.
  const plugin = [path.resolve(pluginRoot), resolveReal(pluginRoot, pluginRoot)];
  const fixedStart = tool === 'Glob' && typeof args.pattern === 'string' && absolutePath(args.pattern) ? args.pattern.split(/[*?[{]/)[0] : null;
  const reading = [absolute, real, ...(fixedStart === null ? [] : [path.resolve(fixedStart)])];
  if (!WRITING.includes(tool) && reading.some((candidate) => plugin.some((g) => inside(fold, g, candidate)))) return answer.deny(PLUGIN_READ);
  const homeReal = resolveReal(home, home);
  const secrets = secretFolders(home, platform);
  for (const candidate of [absolute, real]) {
    if (secrets.some((s) => inside(fold, s, candidate))) return refuse('open Wheelhouse\'s keys or the credentials on this computer');
  }
  // The build engine's home, but for the step's own run's artefacts and its own worktree: by every spelling of the
  // path (and a Glob pattern's fixed start), and a search over a folder that holds the home.
  if (reading.some((candidate) => engineRefused(spellings(candidate, input.cwd), engine, fold))) return answer.deny(ENGINE_FILES);
  if ((tool === 'Grep' || tool === 'Glob') && [absolute, real].some((candidate) => engine.homes.some((h) => inside(fold, candidate, h)))) return answer.deny(ENGINE_FILES);
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
    // Git's own files (ruling P5-28), in every project and for every agent: a `.git` file (a worktree's pointer, as
    // a Lean project's folder has into its store) or anything under a `.git` folder, by every spelling, so an edit
    // tool can't move a branch, add a hook or change git's settings.
    if (spellings(given, input.cwd).some((candidate) => fold(candidate).split(/[\\/]/).includes('.git'))) return answer.deny(CONTROL_FILE);
    // The files that steer an agent (agent-control.js), whichever agent reads them. The home
    // folders are looked at by their real paths too, and a project's by each root's.
    const folders = [home, homeReal].flatMap((h) => homeControlFolders({ home: h, platform, env }));
    const known = [...folders, ...folders.flatMap((f) => spellings(f, home))];
    const places = [...roots, ...roots.flatMap((r) => spellings(r, r))];
    if (steersAgent(spellings(given, input.cwd), { roots: places, folders: known, platform, fold })) return answer.deny(CONTROL_FILE);
  }
  // The step's own run's artefacts lie outside its worktree, so Claude Code would ask about each use and no one answers
  // in a run. A project setting's allow rule isn't read there: Archon's worktrees come from the engine's mirror, whose
  // folder is never trusted. So a call wholly in them (by every spelling; a Glob by its pattern's fixed start) is allowed.
  const places = fixedStart === null ? [absolute, real] : [path.resolve(fixedStart)];
  if (engine.run !== null && places.every((candidate) => ownArtefacts(spellings(candidate, input.cwd), engine, fold))) return answer.allow(OWN_ARTEFACTS);
  return null;
}

// Whether every spelling of a path lies in the engine's home, in the step's own run's artefacts.
function ownArtefacts(candidates, engine, fold) {
  const run = engine.run === null ? null : fold(engine.run);
  return candidates.length > 0 && candidates.every((candidate) => engine.homes.some((home) => {
    if (!inside(fold, home, candidate)) return false;
    const parts = fold(candidate).slice(fold(home).length).split(/[\\/]/).filter(Boolean);
    return parts.length >= 6 && placeInHome(parts, run) === 'artefacts';
  }));
}

// Whether any spelling of a path lies in the build engine's home (`engine.homes`, every spelling of it) other than in
// the step's own run's artefacts (`engine.run`, from the hook's environment) or in its own worktree (`engine.worktrees`,
// every spelling of the worktree the session started in, which counts only where it is one of a workspace's).
function engineRefused(candidates, engine, fold) {
  const run = engine.run === null ? null : fold(engine.run);
  for (const candidate of candidates) {
    for (const home of engine.homes) {
      if (!inside(fold, home, candidate)) continue;
      const parts = fold(candidate).slice(fold(home).length).split(/[\\/]/).filter(Boolean);
      const place = placeInHome(parts, run);
      if (place === 'artefacts') continue;
      if (place === 'worktree' && engine.worktrees.some((w) => inside(fold, w, candidate))) continue;
      return true;
    }
  }
  return false;
}

// What the guard knows of the build engine for this call: every spelling of its home, the step's own run and every
// spelling of the worktree the session started in (CLAUDE_PROJECT_DIR, which an agent can't move as it can its
// shell's folder; the call's folder where that isn't given).
function engineOf({ engineHome, env, projectDir, cwd }) {
  const start = typeof projectDir === 'string' && projectDir !== '' ? projectDir : cwd;
  const tree = worktreeRoot(start);
  return {
    homes: spellings(engineHome, path.parse(path.resolve(engineHome)).root),
    run: ownRun(env),
    worktrees: tree === null ? [] : spellings(tree, tree),
  };
}

// Whether a command line names a place in the build engine's home that engineRefused holds: a word, or an option's
// value after `=`, as a path from the call's folder. Like the plugin's, this holds only the plain command line: a
// path made at run time, or one reached after a cd, is the sandbox's and the deny rules' to hold.
function readsEngine(command, { windows, fold, home, cwd, engine }) {
  const split = segmentsWithOperators(command, windows);
  if (split === null) return false;
  const names = (word) => {
    let name = expandHome(word, home, windows);
    if (name === '' || name.startsWith('~')) return false;
    if (windows && /^\/[A-Za-z]\//.test(name)) name = `${name[1]}:${name.slice(2)}`;
    if (!absolutePath(name) && typeof cwd !== 'string') return false;
    try {
      return engineRefused(spellings(name, cwd ?? path.parse(path.resolve(name)).root), engine, fold);
    } catch {
      return true;
    }
  };
  return split.segments.some((seg) => seg.some((w) => names(w) || (w.includes('=') && names(w.slice(w.indexOf('=') + 1)))));
}

// Whether a command line reaches the engine room's port on this computer: a word naming a local host and the port
// (`localhost:3090`, `http://127.0.0.1:3090/…`, `[::1]:3090`), or a command with a local host and the port as words
// of their own (`nc 127.0.0.1 3090`). The sandbox's network list, which never names a local host, holds it too.
const LOCAL_HOST = '(?:localhost|127(?:\\.\\d{1,3}){3}|0\\.0\\.0\\.0|\\[::1\\]|::1)';
const LOCAL_PORT = new RegExp(`(?:^|[/@])${LOCAL_HOST}:${ENGINE_ROOM_PORT}(?![0-9])`, 'i');
const LOCAL_WORD = new RegExp(`^${LOCAL_HOST}$`, 'i');
function reachesEngineRoom(command, windows) {
  const split = segmentsWithOperators(command, windows);
  if (split === null) return false;
  return split.segments.some((seg) => seg.some((w) => LOCAL_PORT.test(w)) || (seg.some((w) => LOCAL_WORD.test(w)) && seg.includes(String(ENGINE_ROOM_PORT))));
}

// Whether a Glob pattern or Grep glob names a .env file.
function patternNamesEnv(pattern, fold) {
  return pattern.split(/[\\/{},]/).some((part) => envName(part, fold));
}

const SHELL_FLAG = /^-[A-Za-z]*c$|^\/[ck]$/i;
const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ksh93', 'mksh', 'ash', 'yash', 'csh', 'tcsh', 'fish']);
const SHELLS = new Set([...POSIX_SHELLS, 'pwsh', 'powershell', 'cmd']);
// A POSIX shell's options that take the next word as their value.
const SHELL_VALUES = new Set(['--init-file', '--rcfile', '-o', '-O', '+o', '+O']);
const OPTION = /^-|^\/[A-Za-z]$/;
// git's global options that take the next word as their value.
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path']);
const GIT_PUSHERS = new Set(['git-push', 'git-send-pack', 'git-receive-pack']);
const MAX_DEPTH = 6;
// macOS's `security` commands that read saved passwords and keys out of the keychain. `security`
// takes any first part of a command's name (`find-g`, `dump`), so its command word is refused when
// it begins one of these; so is one made at run time (`$C`, `{}`), and the options that read more
// commands from the input (-i, and -p, which implies it). Matched as words, whatever their case,
// and with a `$` after them as a host tool's name is. This holds only the plain command line: the
// sandbox's denial of ~/Library/Keychains (check 73) is what stops a read, as a program or script
// that calls the security service is not seen here.
const KEYCHAIN_READS = ['find-generic-password', 'find-internet-password', 'dump-keychain', 'export'];
const SECURITY_READS_INPUT = /^-[a-z]*[ip]/i;
const KEYCHAIN = 'Wheelhouse does not let an agent read the keychain, where this computer keeps its passwords. If the work needs a password, say so instead of reading it';
const PWSH = new Set(['pwsh', 'powershell']);
// A coding agent started from an agent's shell (ruling P8-9): its program by name (NESTED_REFUSED), and its package
// behind a package manager (NESTED_PACKAGES), whichever agent the session is. The names come from the adapters.
const NESTED = 'Wheelhouse does not let an agent start another coding agent from its shell. Do the work in this session, or say what needs another agent instead';
// The package runners (npx, pnpx, bunx), and the package managers with the subcommands that run a package or its
// program (npm exec, pnpm dlx, yarn dlx and kin): the package they run is the first plain word after, or --package's.
const PACKAGE_RUNNERS = new Set(['npx', 'pnpx', 'bunx']);
// xargs's options whose value is the next word when not joined to it.
const XARGS_VALUES = new Set(['-a', '-E', '-I', '-L', '-n', '-P', '-s', '-d', '--arg-file', '--eof', '--replace', '--max-lines', '--max-args',
  '--max-procs', '--max-chars', '--delimiter', '--process-slot-var']);
const PACKAGE_RUNS = { npm: ['exec', 'x'], pnpm: ['dlx', 'exec'], yarn: ['dlx', 'exec'], bun: ['x'] };
// The commands that start a program named in their words, besides the runners: PowerShell's Start-Process and
// cmd's start.
const STARTERS = new Set(['start-process', 'saps', 'start']);

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
const WRAPPERS = new Set(['command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'sudo', 'doas', 'timeout', 'stdbuf', 'setsid', 'env', 'busybox',
  'caffeinate', 'arch', 'chroot', 'flock', 'xcrun', 'unbuffer', 'then', 'do', 'else', 'if', 'elif', 'while', 'until', '!', '{', '}']);
// The wrappers that take plain words before the command: chroot's folder, flock's file.
const WRAPPER_WORDS = { chroot: 1, flock: 1 };
// The options of a wrapper that take the next word as their value.
const WRAPPER_VALUES = {
  sudo: ['-u', '-g', '-C', '-h', '-p', '-r', '-t', '-U'], timeout: ['-s', '-k'], exec: ['-a'], env: ['-u', '-C'], nice: ['-n'], stdbuf: ['-i', '-o', '-e'],
  arch: ['-arch'], xcrun: ['--sdk', '-sdk', '--toolchain'],
};
const RUNNERS = new Set(['xargs', 'parallel', 'watch']);
const RUNNER_FLAGS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const MOVERS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location']);
const PWSH_VALUE_OPTIONS = new Set(['executionpolicy', 'ep', 'workingdirectory', 'wd', 'outputformat', 'of', 'inputformat', 'if', 'windowstyle', 'w', 'configurationname', 'configurationfile', 'settingsfile', 'custompipename']);

// The index of a segment's command word: past assignments, options (and the
// values of a wrapper's options), durations and wrappers such as env, sudo and
// timeout (with chroot's folder and flock's file), and the `function NAME` of a
// definition. `command -v x`, which only looks a name up, has none. It is
// seg.length when there is none. A word with a slash is a wrapper only as an
// absolute path outside the project (`/usr/bin/env`); `./env` is a script.
function commandAt(seg, names, ctx) {
  let wrapper = null;
  let words = 0;
  for (let i = 0; i < seg.length; i += 1) {
    if (OPTION.test(seg[i])) {
      if (wrapper !== null && (WRAPPER_VALUES[wrapper] ?? []).includes(seg[i])) i += 1;
      continue;
    }
    if (ASSIGNMENT.test(seg[i]) || DURATION.test(seg[i])) continue;
    if (words > 0) {
      words -= 1;
      continue;
    }
    if (names[i] === 'function') {
      i += 1; // and the function's name
      continue;
    }
    if (WRAPPERS.has(names[i]) && (!/[\\/]/.test(seg[i]) || (absolutePath(seg[i]) && !inside(ctx.fold, ctx.root, seg[i])))) {
      if (names[i] === 'command' && /^-[A-Za-z]*[vV]/.test(seg[i + 1] ?? '')) return seg.length;
      wrapper = names[i];
      words = WRAPPER_WORDS[wrapper] ?? 0;
      continue;
    }
    return i;
  }
  return seg.length;
}

const absolutePath = (name) => path.isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name);

// A file name that reads the command's input, as a pipe into a shell does, and
// the folders that hold devices and the system's own files (`/dev/./stdin`).
const INPUT_FILE = /^(-|\/dev\/stdin|\/dev\/fd\/\d+|\/proc\/self\/fd\/\d+)$/;
const DEVICES = /^\/(dev|proc)(\/|$)/;

// Whether a script that a shell, `source` or a path runs stops the command. The
// file is never opened: only the command line and whether anything is at the
// path are looked at. It is refused when another word of the command names it
// (`named`), when it reads the command's input or lies in /dev or /proc, or when
// its name is empty or made at run time. It is also refused when it is in none
// of the folders the command might be in (it can only come into being during
// the command). A relative one is not held to that after a cd to a folder that
// can't be told (unless it climbs out with ../ or passes a dev or proc folder),
// and a command word run by its path only when it starts with
// ./, ../ or / (or a drive on Windows), since a line such as `scripts/x.js: tidy`
// in a commit body reads as a command too.
function scriptRefused(file, ctx, named, byPath = false) {
  let name = expandHome(file, ctx.home, ctx.windows);
  if (named || name === '' || /[$`]/.test(name)) return true;
  if (ctx.windows && /^\/[A-Za-z]\//.test(name)) name = `${name[1].toUpperCase()}:${name.slice(2)}`;
  const absolute = absolutePath(name);
  const candidates = absolute ? [path.resolve(name)] : (ctx.dirs ?? []).map((d) => path.resolve(d, name));
  if (INPUT_FILE.test(name) || [path.posix.normalize(name), ...candidates].some((c) => DEVICES.test(c))) return true;
  if (byPath && !/^\.{0,2}[\\/]/.test(file) && !(ctx.windows && /^[A-Za-z]:[\\/]/.test(file))) return false;
  if (name.startsWith('~')) return true;
  // With no folder known, a path that climbs out or passes a dev or proc folder may reach /dev/stdin.
  if (!absolute && ctx.dirs === null) return /^\.\.\/|(^|\/)(dev|proc)(\/|$)/.test(path.posix.normalize(name.replace(/\\/g, '/')));
  return !candidates.some((c) => fs.existsSync(c));
}

// The index of a POSIX shell's script word, past its options and their values, or -1.
function shellScriptAt(seg, k) {
  for (let j = k + 1; j < seg.length; j += 1) {
    if (SHELL_VALUES.has(seg[j])) j += 1;
    else if (!OPTION.test(seg[j]) && !seg[j].startsWith('+')) return j;
  }
  return -1;
}

const PWSH_COMMAND = /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i;

// The index of PowerShell's script word, -File's value or its first plain word
// (seg.length when -File is last), or -1 when it has none or runs a -Command.
function pwshScriptAt(seg, k, windows) {
  if (seg.slice(k + 1).some((w) => PWSH_COMMAND.test(w) || encodedFlag(w, windows))) return -1;
  for (let j = k + 1; j < seg.length; j += 1) {
    if (/^-(file|f)$/i.test(seg[j])) return j + 1;
    if (!OPTION.test(seg[j])) return j;
    if (PWSH_VALUE_OPTIONS.has(seg[j].replace(/^(--?|\/)/, '').toLowerCase())) j += 1;
  }
  return -1;
}

// PowerShell's common parameters that take a value, which iex may carry.
const COMMON_VALUES = new Set(['erroraction', 'ea', 'warningaction', 'wa', 'informationaction', 'infa', 'errorvariable', 'ev', 'warningvariable', 'wv',
  'informationvariable', 'iv', 'outvariable', 'ov', 'outbuffer', 'ob', 'pipelinevariable', 'pv']);

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

// Whether a command line reads Wheelhouse's own files: a word naming a path inside the plugin
// (a whole word, or an option's value after `=`), other than the script a `node` in the same
// command runs, which is how every playbook runs the plugin's commands. A `cd` into the plugin is
// such a word too. Like the keychain's, this holds only the plain command line: code that a script
// or `node -e` runs is not followed.
function readsPlugin(command, { windows, fold, home, pluginRoots }) {
  const split = segmentsWithOperators(command, windows);
  if (split === null) return false;
  const nameOf = (w) => fold(lastPart(w)).replace(/\.exe$/, '');
  const inPlugin = (word) => {
    const name = expandHome(word, home, windows);
    if (!absolutePath(name)) return false;
    const full = path.resolve(windows && /^\/[A-Za-z]\//.test(name) ? `${name[1]}:${name.slice(2)}` : name);
    return pluginRoots.some((r) => inside(fold, r, full));
  };
  return split.segments.some((seg) => {
    const node = seg.findIndex((w) => nameOf(w) === 'node');
    const script = node < 0 ? -1 : seg.findIndex((w, j) => j > node && !OPTION.test(w));
    return seg.some((w, j) => j !== script && (inPlugin(w) || (w.includes('=') && inPlugin(w.slice(w.indexOf('=') + 1)))));
  });
}

// Whether a command line should be refused: a host tool, git push, a .env file,
// an unreadable quote. Strings handed to a shell are split again. A shell fed by
// a pipe or redirect (its segment has no script) is refused, and so is a script
// run by a shell, `source` or a path that scriptRefused holds. No script file is
// opened, and code made at run time that the words don't show (`$VAR` or a
// substitution as a command, `sh -c "true; $(...)"`) is not followed.
function bashRefused(command, ctx, depth = 0) {
  const { windows, fold } = ctx;
  if (depth > MAX_DEPTH) {
    ctx.state.unreadable = true;
    return true;
  }
  const split = segmentsWithOperators(command, windows);
  if (split === null) {
    ctx.state.unreadable = true;
    return true;
  }
  const { segments: segs, operators } = split;
  const inContext = (dirs) => ({ ...ctx, dirs });
  let dirs = ctx.dirs === undefined ? (ctx.cwd ? [ctx.cwd] : null) : ctx.dirs;
  const again = (text) => bashRefused(text, inContext(dirs), depth + 1);
  const nameOf = (w) => fold(lastPart(w)).replace(/\.exe$/, '');
  // The words of a command that are scripts it runs, as [index, run by its path].
  // A runner's is the command it starts, its first plain word, when that has a slash.
  const scriptsRun = (seg, names, k) => {
    const found = [];
    const runner = RUNNERS.has(names[k]) ? k : seg.findIndex((w) => RUNNER_FLAGS.has(w));
    const started = runner < 0 ? -1 : seg.findIndex((w, j) => j > runner && !OPTION.test(w) && !DURATION.test(w) && w !== '{}');
    if (started >= 0 && /[\\/]/.test(seg[started])) found.push([started, true]);
    let j = -1;
    if (POSIX_SHELLS.has(names[k])) {
      if (!seg.slice(k + 1).some((w) => SHELL_FLAG.test(w))) j = shellScriptAt(seg, k);
    } else if (PWSH.has(names[k])) {
      j = pwshScriptAt(seg, k, windows);
    } else if (names[k] === 'cmd') {
      const c = seg.findIndex((w, i) => i > k && /^\/[ck]$/i.test(w));
      if (c >= 0 && /\.(bat|cmd)$/i.test(seg[c + 1] ?? '')) j = c + 1;
    } else if (names[k] === 'source' || seg[k] === '.') {
      j = k + 1;
    } else if (/[\\/]/.test(seg[k])) {
      found.push([k, true]);
    }
    if (j >= 0 && j < seg.length) found.push([j, false]);
    return found;
  };
  // A redirect's first word is its file. The words after it are held both as a
  // command of their own and as part of the command before it. Each word is
  // kept with its place, so a script is named only by another word.
  const checks = [];
  let pending = null;
  const isSecurity = (w) => /^security(?:\$|$)/i.test(nameOf(w));
  // A variable set to `security` makes a command word that starts with `$` count as it.
  const securityVariable = segs.some((seg) => seg.some((w) => ASSIGNMENT.test(w) && isSecurity(w.slice(w.indexOf('=') + 1))));
  for (const [index, seg] of segs.entries()) {
    const names = seg.map(nameOf);
    for (let i = 0; i < seg.length; i += 1) {
      const word = seg[i];
      const value = word.slice(word.indexOf('=') + 1);
      if (['gh', 'glab'].includes(names[i]) || ['gh', 'glab'].includes(nameOf(value))) return true;
      if (/^(?:gh|glab)\$/.test(names[i]) || /^(?:gh|glab)\$/.test(nameOf(value))) return true; // a host tool named with a variable
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
    const places = seg.map((_, i) => `${index} ${i}`);
    if (operators[index] !== '<' && operators[index] !== '>') {
      pending = { words: [...seg], places };
      checks.push(pending);
    } else {
      checks.push({ words: seg.slice(1), places: places.slice(1) });
      if (pending === null) checks.push(pending = { words: [], places: [] });
      pending.words.push(...seg.slice(1));
      pending.places.push(...places.slice(1));
    }
  }
  // A script is named when a word elsewhere has its last part, leaving out the
  // scripts the command runs and the words of a test (`test`, `[`, `[[`).
  const unnamed = new Set();
  for (const { words, places } of checks) {
    const names = words.map(nameOf);
    const k = commandAt(words, names, ctx);
    if (k >= words.length) continue;
    if (['test', '[', '[['].includes(names[k])) places.forEach((p) => unnamed.add(p));
    for (const [j] of scriptsRun(words, names, k)) unnamed.add(places[j]);
  }
  // `security` as a command (behind wrappers, or started by a runner), with its words across any
  // redirect; a file descriptor's number before a redirect (`2>`) is not one of them.
  const readsKeychain = ({ words: all, places }) => {
    const words = all.filter((w, j) => {
      const [index, i] = places[j].split(' ').map(Number);
      return !(/^\d+$/.test(w) && i === segs[index].length - 1 && ['<', '>'].includes(operators[index + 1]));
    });
    const names = words.map(nameOf);
    const k = commandAt(words, names, ctx);
    if (k >= words.length) return false;
    const runner = RUNNERS.has(names[k]) ? k : words.findIndex((w) => RUNNER_FLAGS.has(w));
    const isCommand = (j) => isSecurity(words[j]) || (securityVariable && words[j].startsWith('$'));
    const at = isCommand(k) ? k : runner >= 0 ? words.findIndex((_, j) => j > runner && isCommand(j)) : -1;
    if (at < 0) return false;
    const after = words.slice(at + 1);
    const c = after.findIndex((w) => !OPTION.test(w));
    if ((c < 0 ? after : after.slice(0, c)).some((w) => SECURITY_READS_INPUT.test(w))) return true;
    // With no command word, a runner gives it from the input; without one, security prints its usage.
    if (c < 0) return runner >= 0;
    const command = after[c].toLowerCase().replace(/\$.*$/s, '');
    return command === '' || command === '{}' || KEYCHAIN_READS.some((read) => read.startsWith(command));
  };
  // An agent's program as the command a segment runs (ruling P8-31): by its last part, with .exe, .cmd, .bat or .ps1
  // taken off, or named with a variable; behind the wrappers commandAt reads; as the command a runner or a starter
  // runs; or as the package npx, npm exec, pnpm dlx, pnpx, bunx or yarn dlx runs (with any version). An argument to
  // any other command is never refused for naming one. A command word made at run time, in backticks or $( ), is
  // held as a host tool's is: a line with a substitution and any word naming an agent's program is refused. The
  // build engine's program is held the same way (spec 12.2), with its own list.
  const agentName = (w) => fold(lastPart(w)).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
  const startsOneOf = ({ programs, packages }) => {
    const isAgent = (w) => programs.some((n) => agentName(w) === n || agentName(w).startsWith(`${n}$`));
    const isPackage = (w) => {
      const v = w.replace(/^--package=/i, '').toLowerCase();
      return packages.some((p) => v === p || v.startsWith(`${p}@`));
    };
    const agentVariable = segs.some((seg) => seg.some((w) => ASSIGNMENT.test(w) && isAgent(w.slice(w.indexOf('=') + 1))));
    const madeAtRunTime = /`|\$\(/.test(command) && segs.some((seg) => seg.some((w) => isAgent(w) || isAgent(w.slice(w.indexOf('=') + 1))));
    // Whether the command at `k` of `words` starts one: its program, or its package through a package runner; 'inner'
    // when a command a runner's --call runs was refused, which answers for itself.
    const runsAgent = (words, k) => {
      if (isAgent(words[k]) || (agentVariable && words[k].startsWith('$'))) return true;
      const manager = agentName(words[k]);
      let rest = words.slice(k + 1);
      if (Object.hasOwn(PACKAGE_RUNS, manager)) {
        const sub = rest.findIndex((w) => !OPTION.test(w));
        if (sub < 0 || !PACKAGE_RUNS[manager].includes(rest[sub].toLowerCase())) return false;
        rest = rest.slice(sub + 1);
      } else if (!PACKAGE_RUNNERS.has(manager)) {
        return false;
      }
      // The package anywhere in its words, whatever option values come before it; the command a --call (or -c)
      // value runs, read as a shell's -c string; and the program as the first plain word.
      if (rest.some(isPackage)) return true;
      for (let i = 0; i < rest.length; i += 1) {
        const call = /^--call=(.*)$/is.exec(rest[i]);
        if (call && again(call[1])) return 'inner';
        if (/^(--call|-c)$/i.test(rest[i]) && i + 1 < rest.length && again(rest[i + 1])) return 'inner';
      }
      const first = rest.find((w) => w !== '--' && !OPTION.test(w));
      return first !== undefined && isAgent(first);
    };
    const starts = ({ words }) => {
      const names = words.map(nameOf);
      const k = commandAt(words, names, ctx);
      if (k >= words.length) return false;
      const direct = runsAgent(words, k);
      if (direct) return direct;
      // The command a runner or a starter runs: its first plain word, past the wrappers before it.
      const runner = RUNNERS.has(names[k]) || STARTERS.has(names[k].toLowerCase()) ? k : words.findIndex((w) => RUNNER_FLAGS.has(w));
      if (runner < 0) return false;
      // xargs's options that take a separate value are read past it, so the value is not taken for the command.
      let started = -1;
      for (let j = runner + 1; j < words.length; j += 1) {
        const w = words[j];
        if (names[runner] === 'xargs' && XARGS_VALUES.has(w)) {
          j += 1;
        } else if (!OPTION.test(w) && !DURATION.test(w) && w !== '{}') {
          started = j;
          break;
        }
      }
      if (started < 0) return false;
      const inner = words.slice(started);
      const at = commandAt(inner, inner.map(nameOf), ctx);
      return at < inner.length && runsAgent(inner, at);
    };
    if (madeAtRunTime) return true;
    for (const check of checks) {
      const found = starts(check);
      if (found) return found;
    }
    return false;
  };
  if (checks.some(readsKeychain)) {
    ctx.state.keychain = true;
    return true;
  }
  const engine = startsOneOf(ARCHON_PROGRAMS);
  if (engine) {
    if (engine !== 'inner') ctx.state.engine = true;
    return true;
  }
  const nested = startsOneOf({ programs: NESTED_REFUSED, packages: NESTED_PACKAGES });
  if (nested) {
    if (nested !== 'inner') ctx.state.nested = true;
    return true;
  }
  const counts = new Map();
  for (const [index, seg] of segs.entries()) {
    for (const [i, w] of seg.entries()) {
      if (!unnamed.has(`${index} ${i}`)) counts.set(fold(lastPart(w)), (counts.get(fold(lastPart(w))) ?? 0) + 1);
    }
  }
  const commandRefused = (seg) => {
    const segNames = seg.map(nameOf);
    const k = commandAt(seg, segNames, ctx);
    // sudo -s and sudo -i with no command start a shell that reads the input.
    if (k >= seg.length) return segNames.some((n, i) => ['sudo', 'doas'].includes(n) && seg.slice(i + 1).some((w) => ['-s', '-i', '--shell', '--login'].includes(w)));
    const name = segNames[k];
    const lname = name.toLowerCase();
    const args = seg.slice(k + 1);
    // Code made at run time: an empty word, or an unquoted $( that leaves a lone $.
    if (seg[k] === '' || seg[k].endsWith('$')) return true;
    // A runner starts the command in its words: a shell named there, or `{}` as
    // the command. A parallel with no command (before any :::) reads its commands
    // from its input.
    const runner = RUNNERS.has(name) ? k : seg.findIndex((w) => RUNNER_FLAGS.has(w));
    if (runner >= 0) {
      if (segNames.slice(runner + 1).some((n) => SHELLS.has(n))) return true;
      if (RUNNER_FLAGS.has(seg[runner]) && seg[runner + 1] === '{}') return true;
      if (name === 'parallel' && runner === k) {
        const end = args.findIndex((w) => /^:::/.test(w));
        if (!(end < 0 ? args : args.slice(0, end)).some((w) => !OPTION.test(w) && !DURATION.test(w))) return true;
      }
    }
    if (POSIX_SHELLS.has(name)) {
      const flag = args.findIndex((w) => SHELL_FLAG.test(w));
      if (flag >= 0 ? flag === args.length - 1 : args.includes('-') || args.includes('-s') || shellScriptAt(seg, k) < 0) return true;
    } else if (PWSH.has(name)) {
      // With only options, PowerShell reads its commands from its input.
      const j = pwshScriptAt(seg, k, windows);
      const commanded = args.some((w) => PWSH_COMMAND.test(w) || encodedFlag(w, windows));
      if (args.includes('-') || (!commanded && (j < 0 || j >= seg.length))) return true;
    } else if (lname === 'iex' || lname === 'invoke-expression') {
      // With only options it runs its input.
      const plain = [];
      for (let j = 0; j < args.length; j += 1) {
        if (!OPTION.test(args[j])) plain.push(args[j]);
        else if (COMMON_VALUES.has(args[j].replace(/^(--?|\/)/, '').toLowerCase())) j += 1;
      }
      if (plain.length === 0 || plain.some((w) => again(w))) return true;
    } else if (name === 'cmd') {
      if (args.length === 0) return true;
    } else if (name === 'eval') {
      if (args.every((w) => w === '')) return true;
    } else if (name === 'source' || seg[k] === '.') {
      // With no file, it reads a redirect or a process substitution.
      if (args.length === 0) return true;
    } else if (MOVERS.has(lname)) {
      dirs = movedDirs(dirs, args.find((w) => !OPTION.test(w)), ctx);
    }
    const named = (file) => (counts.get(fold(lastPart(file))) ?? 0) > 0;
    return scriptsRun(seg, segNames, k).some(([j, byPath]) => scriptRefused(seg[j], inContext(dirs), named(seg[j]), byPath));
  };
  return checks.some(({ words }) => commandRefused(words));
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

export async function decide(input, { dir, projectOf: find = projectOf, home = os.homedir(), platform = process.platform, pluginRoot = PLUGIN_ROOT, entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT, projectDir = process.env.CLAUDE_PROJECT_DIR, env = process.env, engineHome = archonHome() } = {}) {
  const tool = input.tool_name;
  const isConnector = typeof tool === 'string' && (tool.startsWith('mcp__') || RESOURCE_TOOLS.includes(tool));
  if (!isConnector && !SHELL_TOOLS.includes(tool) && !FILE_TOOLS.includes(tool)) return undefined;
  // A step that reads only (read-only-shell.js), wherever it runs: its shell may only read.
  const reading = SHELL_TOOLS.includes(tool) ? readOnlyStep(env) : null;
  if (reading) {
    const command = input.tool_input?.command;
    if (tool === 'Monitor' && command === undefined && input.tool_input?.ws !== undefined) return undefined;
    const why = tool === 'PowerShell' ? 'PowerShell is not read here' : shellWrite(command);
    if (why) return answer.deny(READS_ONLY(reading, why));
  }
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
    const root = found?.record?.folder ?? setup?.folder ?? cwd;
    // In PowerShell a backtick before a new line continues the command, as a space does.
    const text = tool === 'PowerShell' ? command.replace(/(?<!`)((?:``)*)`\n/g, '$1 ') : command;
    const state = { unreadable: false, keychain: false, engine: false, nested: false };
    if (readsPlugin(text, { windows, fold, home, pluginRoots: [path.resolve(pluginRoot), resolveReal(pluginRoot, pluginRoot)] })) return answer.deny(PLUGIN_READ);
    if (reachesEngineRoom(text, windows)) return answer.deny(ENGINE);
    if (readsEngine(text, { windows, fold, home, cwd, engine: engineOf({ engineHome, env, projectDir, cwd }) })) return answer.deny(ENGINE_FILES);
    if (!bashRefused(text, { windows, fold, cwd, home, root, state })) return undefined;
    if (state.keychain) return answer.deny(KEYCHAIN);
    if (state.engine) return answer.deny(ENGINE);
    if (state.nested) return answer.deny(NESTED);
    return state.unreadable ? answer.deny(UNREADABLE) : refuse('run the host tools, push, or read a .env file');
  }
  // The folders a project's own files are placed from: the project's main folder and the worktree
  // the session is in.
  const roots = [found?.record?.folder, setup?.folder, worktreeRoot(cwd)].filter((r) => typeof r === 'string' && r !== '');
  try {
    return fileRefusal(input, { home, platform, pluginRoot, env, roots: [...new Set(roots)], engine: engineOf({ engineHome, env, projectDir, cwd }) }) ?? undefined;
  } catch (error) {
    if (error?.message === TOO_MANY) return refuse('use a path with that many links');
    throw error;
  }
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: true, event: 'PreToolUse' });
}
