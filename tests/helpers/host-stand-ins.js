// tests/helpers/host-stand-ins.js
// The programs no test may reach for real (ruling R139), each found first on the PATH as a
// stand-in that notes its arguments in a log and refuses. Code the test can't hand a stand-in of its
// own runs these by name: the helper's own routes (the board's host facts read protection with `gh
// api`, the trial pull request is closed with `gh pr close`), a child process the test starts (the
// mod's bridge, a long step's own process), and anything else that inherits this process's PATH.
// `accept` names the calls a stand-in takes, by their first arguments (`{ gh: [['pr', 'close']] }`):
// it notes them and exits 0. `calls()` gives what was run, one line each (`gh api repos/o/p ...`),
// so a test can assert the log exactly; `reset` empties it, and `restore` puts the PATH back.
// Every stand-in in one folder is found ahead of the real program only while the PATH starts with
// it, so a child process the test gives a PATH of its own has none.
//
// The stand-ins are shell scripts, so they shadow the real programs on macOS and Linux only. On
// Windows they shadow nothing (a shell script doesn't shadow `gh.exe`), so there the "no host tool
// ran" check proves nothing: the files that run on Windows too (tests/e2e/board-and-usage.test.js,
// tests/e2e/front-desk.test.js, and the setup tests through tests/helpers/setup-answers.js) rely on
// what the test gives instead, the e2e files on their day-old host facts cache. Stand-ins for
// Windows are on the security-gaps list.
import fs from 'node:fs';
import path from 'node:path';
import { tempFolder } from './homes.js';

export const HOST_TOOLS = Object.freeze(['gh', 'glab', 'claude', 'launchctl', 'osascript', 'open', 'xdg-open', 'security', 'brew', 'sudo', 'installer', 'softwareupdate']);

const quote = (text) => `'${text.replace(/'/g, "'\\''")}'`;

export function standInTools({ accept = {} } = {}) {
  const dir = tempFolder('wh-shims-');
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(log, '');
  for (const name of HOST_TOOLS) {
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
  const before = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${before}`;
  return {
    dir,
    log,
    calls: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean),
    reset: () => fs.writeFileSync(log, ''),
    // The folder itself goes with the test file's other temporary folders (homes.js).
    restore: () => { process.env.PATH = before; },
  };
}
