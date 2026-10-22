// probes/73-keychain/run.js
// Check 73: does denying reads of the keychain files stop a sandboxed `security`?
// On the Mac, in the director's sitting only: it refuses to run without --consent.
//
// What it does: makes a throwaway keychain file in a scratch folder under the temporary
// folder, stores one made-up item (wheelhouse-probe-73, a random value) in that file only,
// and runs `security find-generic-password -s wheelhouse-probe-73 -w <file>` three ways:
//   plain                    no sandbox
//   deny-scratch-folder      sandbox-exec denying file-read* of the scratch keychain's folder
//   deny-real-keychains      sandbox-exec denying file-read* of ~/Library/Keychains, with the
//                            scratch file read by path (the control: a denial that does not
//                            cover the file should change nothing)
// It prints one line per way, `<way>: read n characters` or `<way>: refused`, never the value.
// It records the keychain search list before and puts it back exactly after, deletes the
// scratch keychain, and checks the list is as it was. It never reads any other item and never
// touches the login keychain.
// The throwaway keychain's password and the item's value are random and made up; they are fed to `security -i` on its
// standard input, one command each, so they are never in an argument list. Ctrl-C, a closed terminal or a kill signal runs
// the same tidy-up as a normal end. It refuses before any change if the search list cannot be read or looks wrong.
// Usage: node probes/73-keychain/run.js --consent
// Log (statuses only, no values): <home>/.wheelhouse-probes/73-keychain/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, withoutGitVars } from '../../scripts/lib/run.js';
import { appendJsonl, probeLogDir } from '../lib/log.js';
import { assertUnderTmp } from '../lib/scratch.js';

export const ITEM = 'wheelhouse-probe-73';
export const WAYS = ['plain', 'deny-scratch-folder', 'deny-real-keychains'];

export function parseOptions(argv) {
  const options = { consent: false };
  for (const arg of argv) {
    if (arg === '--consent') options.consent = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

// `security list-keychains` prints one quoted path per line: `    "/Users/x/Library/Keychains/login.keychain-db"`.
export function parseSearchList(output) {
  return String(output ?? '')
    .split(/\r?\n/)
    .map((line) => /^\s*"(.*)"\s*$/.exec(line)?.[1])
    .filter(Boolean);
}

const quoteForProfile = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// A Seatbelt profile that allows everything except reading under `folder`.
export function denyReadsProfile(folder) {
  return `(version 1)(allow default)(deny file-read* (subpath ${quoteForProfile(folder)}))`;
}

// The one line printed per way. `value` is the output of the read; only its length is used.
export function resultLine(way, { code, value }) {
  const text = String(value ?? '').replace(/\r?\n$/, '');
  return code === 0 && text.length > 0 ? `${way}: read ${text.length} characters` : `${way}: refused (exit ${code ?? 'none'})`;
}

// Why the search list is not safe to change, or null if it is. An empty or odd list would, put back, clear the director's.
export function searchListProblem(list) {
  if (!Array.isArray(list) || list.length === 0) return 'the keychain search list read back empty or could not be understood';
  if (!list.some((entry) => /login\.keychain(-db)?$/.test(entry))) return 'the keychain search list does not hold the login keychain, so it looks wrong';
  return null;
}

// The commands for `security -i`, one per line, with each argument quoted.
export function interactiveLine(args) {
  return args.map((arg) => `"${String(arg).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(' ') + '\n';
}

export function sameList(before, after) {
  return before.length > 0 && before.length === after.length && before.every((entry, index) => entry === after[index]);
}

async function realExec(file, args, { env, input, timeoutMs = 60000 } = {}) {
  try {
    return await run(file, args, { env, input, timeoutMs, baseEnv: withoutGitVars(process.env) });
  } catch (error) {
    return { code: null, stdout: '', stderr: error.message, failedToStart: true };
  }
}

async function say(log, line, record = {}) {
  console.log(line);
  await appendJsonl(log, { at: new Date().toISOString(), line, ...record }).catch(() => {});
}

// deps are for tests: exec (a stand-in for every program), proc (where signals come from), exit, platform.
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { exec = realExec, proc = process, exit = (code) => process.exit(code), platform = process.platform } = deps;
  const options = parseOptions(argv);
  if (!options.consent) {
    console.error('Check 73 makes a throwaway keychain file and briefly changes the keychain search list (it puts it back). Run it only in the director\'s sitting, with --consent. Nothing was done.');
    return 2;
  }
  if (platform !== 'darwin') {
    console.error('Check 73 runs on macOS only: nothing was done.');
    return 2;
  }
  // One command at a time through `security -i`, so a secret is on its standard input and never in an argument.
  const security = (args) => exec('/usr/bin/security', ['-i'], { input: interactiveLine(args) });
  const listArgs = ['list-keychains', '-d', 'user'];
  const log = path.join(probeLogDir('73-keychain'), `run-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const state = { before: null, created: false, keychain: null, scratch: null, tidied: false, code: 0 };

  // Puts the search list back, removes the throwaway keychain and folder, and says what it did. Runs once.
  const tidy = async () => {
    if (state.tidied) return;
    state.tidied = true;
    if (state.created) {
      await security(['delete-keychain', state.keychain]);
      if (state.before && state.before.length > 0) await security([...listArgs, '-s', ...state.before]);
    }
    if (state.scratch) {
      try { fs.rmSync(state.scratch, { recursive: true, force: true }); } catch { /* reported below */ }
    }
    if (state.before) {
      const after = parseSearchList((await security(listArgs)).stdout);
      const restored = sameList(state.before, after);
      await say(log, restored ? 'search-list: as it was' : `search-list: NOT AS IT WAS, put it back by hand with \`security list-keychains -d user -s ${state.before.map((e) => `"${e}"`).join(' ')}\``);
      if (!restored) state.code = 1;
    }
    if (state.scratch) await say(log, fs.existsSync(state.scratch) ? `scratch folder still there: ${state.scratch}` : 'scratch folder: removed');
  };
  const interrupted = (signal) => {
    console.error(`\nCheck 73: ${signal}, tidying up first`);
    tidy().finally(() => exit(130));
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const handlers = signals.map((signal) => [signal, () => interrupted(signal)]);
  for (const [signal, handler] of handlers) proc.on(signal, handler);
  try {
    await say(log, `Check 73, the keychain, on ${platform} ${os.release()} with Node.js ${process.version}`);
    const listed = await security(listArgs);
    const before = listed.code === 0 ? parseSearchList(listed.stdout) : [];
    const problem = searchListProblem(before);
    if (problem) throw new Error(`${problem}, so nothing was changed`);
    state.before = before;

    state.scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-73-')));
    assertUnderTmp(state.scratch);
    const scratch = state.scratch;
    state.keychain = path.join(scratch, 'probe73.keychain-db');
    const keychain = state.keychain;
    const password = crypto.randomBytes(12).toString('hex');
    const value = crypto.randomBytes(12).toString('hex');

    state.created = true;
    const made = await security(['create-keychain', '-p', password, keychain]);
    if (made.code !== 0) throw new Error(`create-keychain failed (exit ${made.code})`);
    await security(['set-keychain-settings', keychain]); // no automatic lock
    const unlocked = await security(['unlock-keychain', '-p', password, keychain]);
    if (unlocked.code !== 0) throw new Error(`unlock-keychain failed (exit ${unlocked.code})`);
    const added = await security(['add-generic-password', '-a', 'probe', '-s', ITEM, '-w', value, keychain]);
    if (added.code !== 0) throw new Error(`add-generic-password failed (exit ${added.code})`);

    const read = ['find-generic-password', '-s', ITEM, '-w', keychain];
    const realKeychains = path.join(fs.realpathSync(os.homedir()), 'Library', 'Keychains');
    const ways = {
      plain: () => exec('/usr/bin/security', read),
      'deny-scratch-folder': () => exec('/usr/bin/sandbox-exec', ['-p', denyReadsProfile(scratch), '/usr/bin/security', ...read]),
      'deny-real-keychains': () => exec('/usr/bin/sandbox-exec', ['-p', denyReadsProfile(realKeychains), '/usr/bin/security', ...read]),
    };
    for (const way of WAYS) {
      if (state.tidied) break; // a signal began the tidy-up
      const result = await ways[way]();
      await say(log, resultLine(way, { code: result.code, value: result.stdout }), { way, exit: result.code });
    }
  } catch (error) {
    console.error(`Check 73: ${error.message}`);
    state.code = 1;
  } finally {
    await tidy();
    for (const [signal, handler] of handlers) proc.off(signal, handler);
  }
  console.log(`Log: ${log}`);
  return state.code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(`Check 73: FAIL (${error.message})`); process.exitCode = 2; },
  );
}
