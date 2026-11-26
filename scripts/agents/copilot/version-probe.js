// scripts/agents/copilot/version-probe.js
// A check for one computer: reads the Copilot CLI's version as the watcher's start does, and prints what it got. Run it
// from a Wheelhouse checkout: `node scripts/agents/copilot/version-probe.js`.
//
// It starts a copy of itself as startWatcher starts the watcher (scripts/foreman/start.js): with the standard environment
// of the home, in Wheelhouse's own folder, detached, hidden and with no output handles. That copy takes the Copilot
// sessions part the watcher takes (sessionsFor, the object sessionsOfProject gives a Copilot project) and calls its
// version read (versionRead), which a start makes before anything else and which starts `copilot --version` alone: no
// session is started, and no hold or record is written. The copy writes what it got to a file in the system's temporary
// folder, which this process prints and removes, beside the same read made here in this shell's own environment.
//
// It prints the versions, why the CLI's couldn't be read, the program found, and the names (never the values) of the
// variables this shell has that the watcher's environment lacks. `--as-before` leaves the Windows system variables out of
// the copy's environment, as the watcher's was before standardEnv kept them, to show what they change.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionsFor } from '../project-agent.js';
import { pathWithClaude } from '../../lib/claude.js';
import { jobFolder, wheelhouseHome } from '../../lib/paths.js';
import { SYSTEM_NAMES, standardEnv } from '../../lib/standard-env.js';
import { startedAsScript } from '../../lib/started-as-script.js';
import { resolveCopilot } from './versions.js';

const SELF = fileURLToPath(import.meta.url);
// Two tries of `copilot --version` at 30 seconds each, and room to start.
const WAIT_MS = 75000;
const POLL_MS = 250;

// What the read gave, in the current process's environment.
async function readHere() {
  const { versions, fault } = await sessionsFor('copilot').versionRead();
  let program;
  try {
    const found = resolveCopilot();
    program = `${found.file} (${found.kind})`;
  } catch {
    program = 'not found';
  }
  return { versions, fault, program, names: Object.keys(process.env) };
}

// The environment startWatcher gives the watcher; `asBefore` leaves out the Windows system variables.
export function watcherEnv({ env = process.env, asBefore = false } = {}) {
  const standard = pathWithClaude(standardEnv({ home: wheelhouseHome(), env }));
  if (!asBefore) return standard;
  const left = new Set(SYSTEM_NAMES.map((name) => name.toLowerCase()));
  return Object.fromEntries(Object.entries(standard).filter(([name]) => !left.has(name.toLowerCase())));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Starts the copy as the watcher is started, and waits for what it writes: the parsed record, or null when none came.
export async function readAsWatcher({ asBefore = false, waitMs = WAIT_MS } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-version-probe-'));
  const out = path.join(dir, 'read.json');
  try {
    const child = spawn(process.execPath, [SELF, '--copy', out], {
      cwd: jobFolder(), env: watcherEnv({ asBefore }), detached: true, windowsHide: true, stdio: 'ignore',
    });
    child.on('error', () => {});
    child.unref();
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      try {
        return JSON.parse(fs.readFileSync(out, 'utf8'));
      } catch { /* not written yet */ }
      await sleep(POLL_MS);
    }
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const lines = (label, read) => [
  `${label}:`,
  `  Copilot CLI: ${read.versions?.cli ?? 'not read'}`,
  `  why not read: ${read.fault ?? '-'}`,
  `  program found: ${read.program}`,
  `  VS Code: ${read.versions?.vscode ?? 'not known'}; Copilot runtime: ${read.versions?.runtime ?? 'not known'} (the add-on is parked, so these are not known; the pin compares the CLI only)`,
];

export async function main(argv = process.argv.slice(2), { say = (line) => process.stdout.write(`${line}\n`) } = {}) {
  if (argv[0] === '--copy') {
    // The copy: read, and write what was read where the starting process waits for it.
    const read = await readHere();
    const file = argv[1];
    fs.writeFileSync(`${file}.part`, JSON.stringify(read));
    fs.renameSync(`${file}.part`, file);
    return 0;
  }
  const asBefore = argv.includes('--as-before');
  const here = await readHere();
  const watcher = await readAsWatcher({ asBefore });
  for (const line of lines("In this shell's environment", here)) say(line);
  if (watcher === null) {
    say(`As the watcher reads it${asBefore ? ' (as before)' : ''}: the copy wrote nothing within ${WAIT_MS / 1000} seconds`);
    return 1;
  }
  for (const line of lines(`As the watcher reads it${asBefore ? ' (as before)' : ''}`, watcher)) say(line);
  const has = new Set(watcher.names.map((name) => name.toLowerCase()));
  const lacking = here.names.filter((name) => !has.has(name.toLowerCase())).sort();
  say(`Variables this shell has that the watcher's environment lacks (names only): ${lacking.join(', ') || 'none'}`);
  return watcher.versions?.cli ? 0 : 1;
}

if (startedAsScript(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    process.stdout.write(`The probe didn't finish: ${String(error?.message ?? 'no reason given').replace(/\s+/g, ' ')}\n`);
    process.exitCode = 1;
  });
}
