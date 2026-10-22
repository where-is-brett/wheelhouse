// tests/helpers/host-stand-ins.js
// The programs no test may reach for real (ruling R139; `copilot` is among them, and `curl` is the
// trials' one network call), each found first on the PATH as a stand-in that notes its arguments in
// a log and refuses. Code the test can't hand a stand-in of its
// own runs these by name: the helper's own routes (the board's host facts read protection with `gh
// api`, the trial pull request is closed with `gh pr close`), a child process the test starts (the
// mod's bridge, a long step's own process), and anything else that inherits this process's PATH.
// `accept` names the calls a stand-in takes, by their first arguments (`{ gh: [['pr', 'close']] }`):
// it notes them and exits 0. `calls()` gives what was run, one line each (`gh api repos/o/p ...`),
// so a test can assert the log exactly; `reset` empties it, and `restore` puts the PATH (and, in the
// node form, NODE_OPTIONS) back.
// Every stand-in in one folder is found ahead of the real program only while the PATH starts with
// it, so a child process the test gives a PATH of its own has none.
//
// Two forms. The script form (the default off Windows) is a shell script per name, which shadows
// the real programs on macOS and Linux only: a shell script doesn't shadow `gh.exe`. The node form
// (the default on Windows) makes `<dir>/<name>.exe` on Windows (no extension elsewhere) as a hard
// link to the Node.js binary (or, where a link can't be made, to one copy of it in the folder), and
// puts `--require "<dir>/stand-in-preload.cjs"` at the front of NODE_OPTIONS. Run under a stand-in's
// name, Node.js loads the preload first; the preload (tests/helpers/stand-in-preload.cjs) logs the
// call, exits 0 for an accepted one and otherwise refuses with exit 1, and in any other Node.js
// process does nothing. Because Node.js is the program, a flag it reads itself is taken by Node.js
// before the stand-in can see it: `--version`, `-v`, `--help` and `-h` print Node.js's own answer
// and exit 0, unlogged (no test may rely on a stand-in refusing them), and an option Node.js doesn't
// know, such as `curl -s`, ends the process with exit 9 before the preload runs, so that call is
// refused but not logged. Only a call whose first argument is a plain word is logged as written (a
// path-like first argument comes back normalised; `-e` and `-p` log the flags in place of a word).
// The stand-ins work only while NODE_OPTIONS reaches them: a child process given a PATH that keeps
// the stand-in folder but drops NODE_OPTIONS (the eval harness's session environment does) finds
// plain Node.js under the tool's name, which runs its arguments as a script. Code like that must be
// handed a guarded run or spawn instead of relying on the PATH.
// NODE_OPTIONS reads a backslash inside quotes as an escape, so the preload's path is written with
// forward slashes, which Node.js on Windows accepts. `platform` lets a test build the Windows form
// (`.exe` names, that path) on any system.
// The node form is tested on every system (tests/helpers/stand-ins.test.js); its first real run on
// Windows is still to come, at the Windows sitting.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempFolder } from './homes.js';
import { STOOD_IN, guardedRun } from './stood-in.js';

const PRELOAD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stand-in-preload.cjs');

export { STOOD_IN, guardedRun };

const quote = (text) => `'${text.replace(/'/g, "'\\''")}'`;

// Writes the node form's stand-ins into dir: a hard link to the Node.js binary per name, else (a
// folder on another volume, a system that refuses links) one copy in dir and hard links to that.
function writeNodeStandIns(dir, platform) {
  const exe = platform === 'win32' ? '.exe' : '';
  let copy = null;
  for (const name of STOOD_IN) {
    const target = path.join(dir, `${name}${exe}`);
    try {
      fs.linkSync(process.execPath, target);
    } catch {
      if (copy === null) {
        copy = path.join(dir, `node-copy${exe}`);
        fs.copyFileSync(process.execPath, copy);
        fs.chmodSync(copy, 0o755);
      }
      fs.linkSync(copy, target);
    }
  }
}

// The preload's path as NODE_OPTIONS can hold it.
export function preloadOption(dir, platform = process.platform) {
  const file = path.join(dir, 'stand-in-preload.cjs');
  return `--require "${platform === 'win32' ? file.replaceAll('\\', '/') : file}"`;
}

export function standInTools({ accept = {}, platform = process.platform, form = platform === 'win32' ? 'node' : 'script', prefix = 'wh-shims-' } = {}) {
  if (!['script', 'node'].includes(form)) throw new Error(`There is no stand-in form named ${form}`);
  const dir = tempFolder(prefix);
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(log, '');
  if (form === 'script') writeScripts(dir, log, accept);
  else {
    fs.writeFileSync(path.join(dir, 'accept.json'), JSON.stringify(accept));
    fs.writeFileSync(path.join(dir, 'stood-in.json'), JSON.stringify(STOOD_IN));
    fs.copyFileSync(PRELOAD, path.join(dir, 'stand-in-preload.cjs'));
    writeNodeStandIns(dir, platform);
  }
  const before = process.env.PATH;
  const optionsBefore = process.env.NODE_OPTIONS;
  process.env.PATH = `${dir}${path.delimiter}${before}`;
  if (form === 'node') {
    const preload = preloadOption(dir, platform);
    process.env.NODE_OPTIONS = optionsBefore ? `${preload} ${optionsBefore}` : preload;
  }
  return {
    dir,
    log,
    calls: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean),
    reset: () => fs.writeFileSync(log, ''),
    // The folder itself goes with the test file's other temporary folders (homes.js).
    restore: () => {
      process.env.PATH = before;
      if (form === 'node') {
        if (optionsBefore === undefined) delete process.env.NODE_OPTIONS;
        else process.env.NODE_OPTIONS = optionsBefore;
      }
    },
  };
}

function writeScripts(dir, log, accept) {
  for (const name of STOOD_IN) {
    const taken = (accept[name] ?? []).map((args) => {
      const test = args.map((arg, i) => `[ "$${i + 1}" = ${quote(arg)} ]`).join(' && ');
      return `if ${test}; then exit 0; fi`;
    });
    const script = [
      '#!/bin/sh',
      `printf '%s\\n' "${name} $*" >> ${quote(log)}`,
      ...taken,
      `echo '${name} is not run in this test' >&2`,
      'exit 1',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, name), script, { mode: 0o755 });
  }
}
