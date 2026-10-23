// scripts/windows/guarded.js
// The Guarded runner (design section 12.2): at the Guarded level a feature session runs each
// build command as `<low copy of node.exe> <this file> <command words…>` in its worktree, which
// is its one allow rule (scripts/windows/low.js, guardedCommand). Started from a file labelled
// low, this process runs at low integrity, and so does everything it starts, so Windows stops
// the command changing anything at the normal level: nearly everything outside the worktree.
//
// Before anything, it checks its own token really is low (`whoami /groups`, System32's own, shows
// the Mandatory Label S-1-16-4096) and runs nothing otherwise (exit 3), nor when Windows' folder
// can't be known to find whoami by. Low integrity doesn't hold the network, so it refuses the
// forms that fetch and run new code (exit 4) and tells the session to ask for them. It refuses
// local git the same way (exit 4, EXIT.git): the worktree's git folders aren't labelled low
// (scripts/windows/low.js, PLAN_GIT_LOW_LABELS), so local git is asked for and runs at the normal
// level. It points npm's cache and the temporary folders inside the worktree, where a low process
// can write, runs the command, ends it and everything it started with `taskkill /T /F` after 30
// minutes, removes each link in the worktree that leads out of it (removeLinksOut), naming each
// on stderr, and exits with the command's code.
//
// `--self-test <home> <marker> <scratch>` is the self-test's mode (low.js, selfTest): after the
// same check, it tries to write a file in Wheelhouse's home, and through a link from `scratch` to
// the home, to read the marker beside the helper's keys, to write into, rename and remove each
// entry kept at the normal level in `scratch`, a folder labelled as a worktree is, and to write
// `.github/hooks/x.json` there; it prints one JSON line saying whether Windows refused each. It
// never prints what it read.
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { plainControlNames } from '../lib/agent-control.js';
import { run as runProgram } from '../lib/run.js';
import { startedAsScript } from '../lib/started-as-script.js';

// A command still running after this long is ended, with everything it started.
export const GUARDED_TIMEOUT_MS = 30 * 60 * 1000;

export const NOT_LOW = 'This runner isn\'t at low integrity, so it won\'t run anything.';
export const ASK_INSTEAD = 'Ask for this with ask --kind build-command.';
export const SELF_TEST_FLAG = '--self-test';

// The runner's exit codes, beside the command's own: `fetches` and `git` share a code, since the
// session does the same for both (asks for the command), and the line said tells them apart;
// `timedOut` is the usual code of a command ended for its time.
export const EXIT = Object.freeze({ usage: 2, notLow: 3, fetches: 4, git: 4, notFound: 127, timedOut: 124 });

// What stays at the normal level in a worktree labelled low (low.js, labelWorktree), so a build
// can't plant a hook or a setting there: folders, labelled with inheritance, and files.
//
// Beside the settings and the connectors' file, the plain names among the files that steer an agent
// (agent-control.js, plainControlNames) are kept too: the folders and files at the worktree's top
// that have no glob in their name. The names with a glob (AGENTS.md in any folder) are not here:
// the merge gate and the tool guard hold those.
//
// .github is kept whole, for both agents, because the control files below it (hooks, skills,
// agents and the rest) can't be kept on their own: were .github left at the low level, a low build
// could move .github away with the hooks in it and put its own in their place. What it costs: a
// build command that writes under .github (one that generates a workflow, say) fails at Guarded
// and must be asked for. Edits to the workflows still come through the agents' file tools, which
// run at the normal level.
const UNIQUE = (list) => Object.freeze([...new Set(list)]);
const CONTROL_NAMES = plainControlNames();
export const KEPT_NORMAL = Object.freeze({
  folders: UNIQUE(['.claude', '.vscode', ...CONTROL_NAMES.folders, '.github']),
  files: UNIQUE(['.git', '.mcp.json', ...CONTROL_NAMES.files]),
});

const LOW_LABEL = 'S-1-16-4096';

// A program Windows keeps in System32, by its full path where Windows says it is (SystemRoot, a
// full path from a drive letter), so a program of the same name found by a search can't stand in
// for it. Null when SystemRoot isn't such a path: the caller then refuses rather than searching.
export function windowsTool(name, env = process.env) {
  const key = Object.keys(env ?? {}).find((k) => k.toLowerCase() === 'systemroot');
  const root = key === undefined ? null : env[key];
  if (typeof root !== 'string' || !/^[A-Za-z]:[\\/][^"%\r\n]*$/.test(root)) return null;
  return path.win32.join(root, 'System32', `${name}.exe`);
}

// Whether `whoami /groups` shows a low token: its one Mandatory Label is S-1-16-4096, Low
// Mandatory Level. Any other label, or a second one, or none, is not low.
export function isLowToken(whoamiGroups) {
  const labels = new Set(String(whoamiGroups ?? '').match(/S-1-16-\d+(?!\d)/g) ?? []);
  return labels.size === 1 && labels.has(LOW_LABEL);
}

// The forms that fetch and run new code, by program, and the programs that do so whatever
// follows. npm's own short forms and misspellings of them are its too.
const FETCHING = Object.freeze({
  npm: ['install', 'i', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall', 'add', 'ci', 'clean-install', 'ic',
    'install-clean', 'isntall-clean', 'install-test', 'it', 'install-ci-test', 'cit', 'update', 'up', 'upgrade', 'udpate', 'exec', 'x'],
  pnpm: ['add', 'install', 'i', 'dlx', 'update', 'up', 'upgrade'],
  yarn: ['add', 'install', 'dlx', 'up', 'upgrade'],
  bun: ['add', 'install', 'i', 'x', 'update'],
});
const ALWAYS_FETCHING = ['npx', 'pnpx', 'bunx'];

// The program's own name: its last path part, in lower case, without a Windows extension.
export const programOf = (word) => String(word ?? '').split(/[\\/]/).pop().toLowerCase().replace(/\.(cmd|exe|bat|com|ps1)$/, '');

// Whether the command fetches new code: a fetching program, or a package manager given one of its
// fetching forms as any of its words (so a flag before it doesn't hide it). Bare `yarn` installs.
export function fetchesCode(words) {
  if (!Array.isArray(words) || words.length === 0) return false;
  const program = programOf(words[0]);
  if (ALWAYS_FETCHING.includes(program)) return true;
  if (!Object.hasOwn(FETCHING, program)) return false;
  if (program === 'yarn' && words.length === 1) return true;
  return words.slice(1).some((w) => FETCHING[program].includes(String(w).toLowerCase()));
}

// The worktree `cwd` is in: the nearest folder holding a `.git`, or `cwd` itself.
function worktreeOf(cwd) {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (path.dirname(dir) === dir) return path.resolve(cwd);
  }
}

// A word for a cmd.exe command line: bare when plain, else in double quotes. Characters cmd
// expands even inside double quotes can't be quoted safely, so they are refused.
function cmdWord(word) {
  if (/["%\r\n]/.test(word)) return null;
  return /^[\w.:\\/@=,+-]+$/.test(word) ? word : `"${word}"`;
}

// What to start for `words`: { file, args, verbatim }, { missing }, or { refused: word }. Off
// Windows the words as they are. On Windows the program is found on the PATH (with PATHEXT); an
// .exe or .com is started itself, with its words as they are, and a .cmd or .bat (npm's shims)
// through cmd.exe.
function resolveCommand(words, { platform, env, exists }) {
  const [name, ...rest] = words;
  if (platform !== 'win32') return { file: name, args: rest, verbatim: false };
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path');
  const extKey = Object.keys(env).find((k) => k.toLowerCase() === 'pathext');
  const exts = (extKey ? env[extKey] : '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const named = /\.[A-Za-z0-9]+$/.test(name) ? [''] : exts;
  const places = /[\\/]/.test(name) ? [''] : (pathKey ? env[pathKey] : '').split(';').map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean);
  let found = null;
  for (const dir of places) {
    for (const ext of named) {
      const file = dir === '' ? `${name}${ext}` : path.join(dir, `${name}${ext}`);
      if (exists(file)) { found = file; break; }
    }
    if (found) break;
  }
  if (found === null) return { missing: true };
  if (/\.(exe|com)$/i.test(found)) return { file: found, args: rest, verbatim: false };
  const line = [found, ...rest].map((w) => ({ w, q: cmdWord(w) }));
  const bad = line.find((x) => x.q === null);
  if (bad) return { refused: bad.w };
  const cmd = windowsTool('cmd', env);
  if (cmd === null) return { missing: true };
  return { file: cmd, args: ['/d', '/s', '/c', `"${line.map((x) => x.q).join(' ')}"`], verbatim: true };
}

// Starts a program with the runner's own input and output.
function startInherited(file, args, options) {
  return spawn(file, args, { ...options, stdio: 'inherit', windowsHide: true, shell: false });
}

// Runs the command to its end, or until `timeoutMs`, when it and everything it started are ended
// with taskkill. Resolves with { code } or { timedOut: true } or { error }.
function runToEnd(child, { run, env, timeoutMs }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(async () => {
      const taskkill = windowsTool('taskkill', env);
      try {
        if (taskkill === null) child.kill?.('SIGKILL');
        else await run(taskkill, ['/pid', String(child.pid), '/T', '/F']);
      } catch { /* it may have ended already */ }
      child.unref?.(); // the runner exits now, whatever is left of it
      finish({ timedOut: true });
    }, timeoutMs);
    child.on('error', (error) => finish({ error }));
    child.on('exit', (code) => finish({ code: Number.isInteger(code) ? code : 1 }));
  });
}

// Whether an error is Windows refusing access.
const refusedBy = (error) => ['EACCES', 'EPERM'].includes(error?.code);

// Whether `attempt` was refused by Windows. Anything that went through, or failed another way,
// is not held.
function refusedTry(attempt) {
  try {
    attempt();
    return false;
  } catch (error) {
    return refusedBy(error);
  }
}

// The tries on a kept entry, in order, each of which would let a build put a low one in its place:
// a write into it, renaming it away and removing it. `folder` says whether the entry is a folder.
export const KEPT_TRIES = Object.freeze({
  writeInto: (entry, folder) => (folder ? fs.writeFileSync(path.join(entry, 'planted-from-low.json'), '{}\n', { flag: 'wx' }) : fs.appendFileSync(entry, '\n')),
  rename: (entry) => fs.renameSync(entry, `${entry}.moved-from-low`),
  remove: (entry, folder) => (folder ? fs.rmdirSync(entry) : fs.unlinkSync(entry)),
});

// Whether every entry kept at the normal level in `scratch` held from here: Windows refused each
// of `tries` on it. A missing entry, or one of the wrong kind, is not held. The self-test removes
// `scratch` afterwards.
export function keptNormalHeld(scratch, tries = KEPT_TRIES) {
  const entries = [...KEPT_NORMAL.folders.map((name) => [name, true]), ...KEPT_NORMAL.files.map((name) => [name, false])];
  for (const [name, folder] of entries) {
    const entry = path.join(scratch, name);
    let stat;
    try {
      stat = fs.lstatSync(entry);
    } catch {
      return false;
    }
    if (stat.isDirectory() !== folder) return false;
    if (!Object.values(tries).every((attempt) => refusedTry(() => attempt(entry, folder)))) return false;
  }
  return true;
}

// Whether a write of a new file in `folder` was refused. One that got through is removed.
function newFileHeld(folder) {
  const file = path.join(folder, `guarded-selftest-${crypto.randomBytes(6).toString('hex')}.txt`);
  try {
    fs.writeFileSync(file, 'written from low integrity\n', { flag: 'wx' });
    fs.rmSync(file, { force: true });
    return false;
  } catch (error) {
    return refusedBy(error);
  }
}

// Whether a write through a link out of the worktree was refused: a folder link (a junction on
// Windows) made in `scratch` leading to `target`, and a new file written through it. Refused when
// the link can't be made, or the write through it is refused; anything that went through, or
// failed another way, is not held. The link is removed afterwards, never followed.
export function linkOutHeld(scratch, target) {
  const link = path.join(scratch, `link-out-from-low-${crypto.randomBytes(6).toString('hex')}`);
  try {
    fs.symlinkSync(target, link, 'junction');
  } catch (error) {
    return refusedBy(error);
  }
  try {
    return newFileHeld(link);
  } finally {
    try {
      fs.unlinkSync(link);
    } catch { /* the self-test removes the scratch folder */ }
  }
}

// Whether a write of `.github/hooks/x.json` in `scratch` was refused: a hook a build could plant.
// Anything that went through, or failed another way (no .github/hooks there), is not held.
export function hookWriteHeld(scratch) {
  return refusedTry(() => fs.writeFileSync(path.join(scratch, '.github', 'hooks', 'x.json'), '{}\n', { flag: 'wx' }));
}

// The self-test's tries, as one JSON line: a write in `home` and one through a link from
// `scratch` to `home` (`writeHeld` only when both were refused), a read of `marker`, and the tries
// on what is kept at the normal level in `scratch` with a write of `.github/hooks/x.json` there
// (`keptHeld` only when every one was refused). Only a refusal counts as held; any other failure
// counts as not held.
function selfTestTries(home, marker, scratch, out) {
  const writeHeld = newFileHeld(home) && linkOutHeld(scratch, home);
  let readHeld = false;
  try {
    fs.readFileSync(marker);
  } catch (error) {
    readHeld = refusedBy(error);
  }
  const keptHeld = keptNormalHeld(scratch) && hookWriteHeld(scratch);
  out(JSON.stringify({ low: true, writeHeld, readHeld, keptHeld }));
  return 0;
}

// The message for each link removed after a command, followed by its path.
export const LINK_REMOVED = 'Removed a link that led out of the worktree:';

// Whether `target` is `folder` or inside it, both real paths; Windows' paths ignore case.
export function insideFolder(folder, target, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const fold = (x) => (platform === 'win32' ? p.resolve(x).toLowerCase() : p.resolve(x));
  const relative = p.relative(fold(folder), fold(target));
  return relative === '' || (!relative.startsWith('..') && !p.isAbsolute(relative));
}

// Removes each symbolic link or junction in `worktree` whose real target is outside it, and each
// dangling one, so the agents' file tools, at the normal level, can't be led out of the worktree
// by a link a low build made. It walks with lstat and never follows a link, and skips the
// worktree's own .git file. Returns the paths removed; one it can't remove isn't among them.
export function removeLinksOut(worktree, { platform = process.platform } = {}) {
  const removed = [];
  let root;
  try {
    root = fs.realpathSync.native(worktree);
  } catch {
    return removed;
  }
  const walk = (dir) => {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (dir === worktree && name === '.git') continue;
      const entry = path.join(dir, name);
      let stat;
      try {
        stat = fs.lstatSync(entry);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        let target = null;
        try {
          target = fs.realpathSync.native(entry);
        } catch { /* dangling, or a loop */ }
        if (target !== null && insideFolder(root, target, platform)) continue;
        try {
          fs.unlinkSync(entry);
          removed.push(entry);
        } catch {
          try {
            fs.rmdirSync(entry);
            removed.push(entry);
          } catch { /* left; the tool guard's real-path check still holds */ }
        }
      } else if (stat.isDirectory()) {
        walk(entry);
      }
    }
  };
  walk(worktree);
  return removed;
}

// The runner: `words` are the command and its arguments. Returns the exit code. `run` is
// scripts/lib/run.js's (for whoami and taskkill), `start` starts the command, `say` writes a line
// to the session (stderr), `out` the self-test's line (stdout).
export async function guarded(words, {
  run = runProgram, start = startInherited, cwd = process.cwd(), env = process.env, platform = process.platform,
  timeoutMs = GUARDED_TIMEOUT_MS, exists = fs.existsSync, say = (line) => process.stderr.write(`${line}\n`), out = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  let low = false;
  const whoami = windowsTool('whoami', env);
  try {
    const who = whoami === null ? null : await run(whoami, ['/groups']);
    low = who?.code === 0 && isLowToken(who.stdout);
  } catch { /* not known to be low */ }
  if (!low) {
    say(NOT_LOW);
    return EXIT.notLow;
  }
  if (!Array.isArray(words) || words.length === 0 || words.some((w) => typeof w !== 'string') || words[0] === '') {
    say('Give the build command to run after the runner, for example: <runner> npm test');
    return EXIT.usage;
  }
  if (words[0] === SELF_TEST_FLAG) {
    if (words.length !== 4) {
      say('The self-test takes the home folder, the marker to read and the scratch folder.');
      return EXIT.usage;
    }
    return selfTestTries(words[1], words[2], words[3], out);
  }
  if (fetchesCode(words)) {
    say(`The runner won't run ${words.join(' ')}: it fetches new code, which low integrity doesn't hold. ${ASK_INSTEAD}`);
    return EXIT.fetches;
  }
  if (programOf(words[0]) === 'git') {
    say(`The runner doesn't run git: local git runs at the normal level, outside the runner. ${ASK_INSTEAD}`);
    return EXIT.git;
  }
  const resolved = resolveCommand(words, { platform, env, exists });
  if (resolved.missing) {
    say(`The runner can't find ${words[0]} on the PATH.`);
    return EXIT.notFound;
  }
  if (resolved.refused !== undefined) {
    say(`The runner can't pass ${JSON.stringify(resolved.refused)} to ${words[0]} safely: a word with " or % can't be quoted for cmd.exe.`);
    return EXIT.usage;
  }

  // npm's cache and the temporary folders, inside the worktree, where a low process can write.
  // The common folder's info/exclude keeps .wheelhouse/ out of git (scripts/feature/files.js).
  const worktree = worktreeOf(cwd);
  const tmp = path.join(worktree, '.wheelhouse', 'tmp');
  try {
    fs.mkdirSync(tmp, { recursive: true });
  } catch { /* the command says what it can't write */ }
  let child;
  try {
    child = start(resolved.file, resolved.args, {
      cwd, env: { ...env, npm_config_cache: tmp, TEMP: tmp, TMP: tmp }, windowsVerbatimArguments: resolved.verbatim,
    });
  } catch (error) {
    say(`The runner couldn't start ${words[0]}: ${error.message}`);
    return EXIT.notFound;
  }
  const ended = await runToEnd(child, { run, env, timeoutMs });
  for (const link of removeLinksOut(worktree, { platform })) say(`${LINK_REMOVED} ${link}`);
  if (ended.timedOut) {
    say(`${words.join(' ')} ran past the runner's time limit of ${Math.round(timeoutMs / 60000)} minutes, so the runner ended it and everything it started.`);
    return EXIT.timedOut;
  }
  if (ended.error) {
    say(`The runner couldn't start ${words[0]}: ${ended.error.message}`);
    return EXIT.notFound;
  }
  return ended.code;
}

if (startedAsScript(import.meta.url)) {
  process.exitCode = await guarded(process.argv.slice(2));
}
