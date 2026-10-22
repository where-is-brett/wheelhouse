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
  return code === 0 && text.length > 0 ? `${way}: read ${text.length} characters` : `${way}: refused`;
}

export function sameList(before, after) {
  return before.length === after.length && before.every((entry, index) => entry === after[index]);
}

async function exec(file, args, { env, timeoutMs = 60000 } = {}) {
  try {
    return await run(file, args, { env, timeoutMs, baseEnv: withoutGitVars(process.env) });
  } catch (error) {
    return { code: null, stdout: '', stderr: error.message, failedToStart: true };
  }
}

async function say(log, line, record = {}) {
  console.log(line);
  await appendJsonl(log, { at: new Date().toISOString(), line, ...record }).catch(() => {});
}

const security = (args) => exec('/usr/bin/security', args);

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  if (!options.consent) {
    console.error('Check 73 makes a throwaway keychain file and briefly changes the keychain search list (it puts it back). Run it only in the director\'s sitting, with --consent. Nothing was done.');
    return 2;
  }
  if (process.platform !== 'darwin') {
    console.error('Check 73 runs on macOS only: nothing was done.');
    return 2;
  }
  const log = path.join(probeLogDir('73-keychain'), `run-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-73-')));
  assertUnderTmp(scratch);
  const keychain = path.join(scratch, 'probe73.keychain-db');
  const password = crypto.randomBytes(12).toString('hex');
  const value = crypto.randomBytes(12).toString('hex');
  let before = null;
  let created = false;
  let code = 0;
  try {
    await say(log, `Check 73, the keychain, on ${process.platform} ${os.release()} with Node.js ${process.version}`);
    const listed = await security(['list-keychains', '-d', 'user']);
    if (listed.code !== 0) throw new Error('could not read the keychain search list, so nothing was changed');
    before = parseSearchList(listed.stdout);

    created = true;
    const made = await security(['create-keychain', '-p', password, keychain]);
    if (made.code !== 0) throw new Error(`create-keychain failed (exit ${made.code})`);
    await security(['set-keychain-settings', keychain]); // no automatic lock
    await security(['unlock-keychain', '-p', password, keychain]);
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
      const result = await ways[way]();
      await say(log, resultLine(way, { code: result.code, value: result.stdout }), { way, exit: result.code });
    }
  } catch (error) {
    console.error(`Check 73: ${error.message}`);
    code = 1;
  } finally {
    if (created) {
      await security(['delete-keychain', keychain]);
      if (before) await security(['list-keychains', '-d', 'user', '-s', ...before]);
    }
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* checked below */ }
    if (before) {
      const after = parseSearchList((await security(['list-keychains', '-d', 'user'])).stdout);
      const restored = sameList(before, after);
      await say(log, restored ? 'search-list: as it was' : 'search-list: NOT AS IT WAS, put it back by hand with `security list-keychains -d user -s <the login keychain>`');
      if (!restored) code = 1;
    }
    await say(log, fs.existsSync(scratch) ? `scratch folder still there: ${scratch}` : 'scratch folder: removed');
  }
  console.log(`Log: ${log}`);
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(`Check 73: FAIL (${error.message})`); process.exitCode = 2; },
  );
}
