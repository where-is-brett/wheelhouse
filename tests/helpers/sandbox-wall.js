// tests/helpers/sandbox-wall.js
// What a project's sandbox does to its sessions' commands (scripts/protection/settings.js: denyRead
// and denyWrite on ~/.wheelhouse), for the end-to-end tests: every file call into a walled folder
// fails with EPERM, and is recorded, so a test fails when a sandboxed command reached one. Only
// calls made inside `sandboxed` are held, so a helper answering them in the same process, whose
// requests arrive in the server's own context, is not. It covers fs's synchronous calls only (the
// ones in HELD_CALLS, and realpathSync.native); fs.promises, callbacks and streams pass unheld.
// Importing it wraps those calls for the test file; they are put back once its tests are done.
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const store = new AsyncLocalStorage();
const denied = [];
const TWO_PATHS = ['copyFileSync', 'cpSync', 'linkSync', 'renameSync', 'symlinkSync'];
const HELD_CALLS = [
  'accessSync', 'appendFileSync', 'chmodSync', 'copyFileSync', 'cpSync', 'existsSync', 'linkSync', 'lstatSync', 'mkdirSync',
  'mkdtempSync', 'openSync', 'opendirSync', 'readFileSync', 'readdirSync', 'readlinkSync', 'realpathSync', 'renameSync',
  'rmSync', 'rmdirSync', 'statSync', 'symlinkSync', 'unlinkSync', 'utimesSync', 'writeFileSync',
];

function walledOff(p) {
  const held = store.getStore();
  if (!held) return false;
  let text = null;
  if (typeof p === 'string') text = p;
  else if (Buffer.isBuffer(p)) text = p.toString();
  else if (p instanceof URL) text = fileURLToPath(p);
  if (text === null) return false;
  const full = path.resolve(text);
  return held.some((wall) => full === wall || full.startsWith(`${wall}${path.sep}`));
}

function refusal(call, p) {
  denied.push(`${call} ${String(p)}`);
  return Object.assign(new Error(`EPERM: operation not permitted, ${call} '${String(p)}'`), { code: 'EPERM', syscall: call, path: String(p) });
}

const originals = new Map();
for (const call of HELD_CALLS) {
  const original = fs[call];
  if (typeof original !== 'function') continue;
  originals.set(call, original);
  const wrapped = function held(...args) {
    for (const p of TWO_PATHS.includes(call) ? args.slice(0, 2) : args.slice(0, 1)) {
      if (!walledOff(p)) continue;
      if (call === 'existsSync') {
        denied.push(`${call} ${String(p)}`);
        return false;
      }
      throw refusal(call, p);
    }
    return original.apply(this, args);
  };
  if (call === 'realpathSync') {
    wrapped.native = function heldNative(p, ...rest) {
      if (walledOff(p)) throw refusal('realpathSync.native', p);
      return original.native.call(this, p, ...rest);
    };
  }
  fs[call] = wrapped;
}
after(() => {
  for (const [call, original] of originals) fs[call] = original;
});

// Runs fn as a sandboxed command with `walls` (absolute folders) shut, then checks it touched
// nothing in them.
export async function sandboxed(walls, fn) {
  const before = denied.length;
  const result = await store.run(walls, fn);
  assert.deepEqual(denied.slice(before), [], 'a sandboxed command reached into the Wheelhouse home');
  return result;
}

// The wall holds: a sandboxed read of `file`, inside `walls`, fails and is caught, and is then
// forgotten, so the next sandboxed command is judged on its own.
export async function sandboxHolds(walls, file) {
  const before = denied.length;
  await store.run(walls, async () => {
    assert.throws(() => fs.readFileSync(file), { code: 'EPERM' });
  });
  assert.equal(denied.length, before + 1);
  denied.length = before;
}
