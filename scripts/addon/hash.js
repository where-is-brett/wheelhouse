// scripts/addon/hash.js
// The hash of the packed VS Code add-on, kept in `vscode/vsix.sha256` in the tagged commit. `pack.js` packs byte for byte the
// same each run, so the hash can be known before the tag: the commit that changes the add-on or sets a release's version runs
// `--write`, CI runs `--check`, and the release job and the install refuse a .vsix that differs. The recorded file is not
// itself packed, or the hash would have to contain itself.
//
// `node scripts/addon/hash.js --write` records the hash of a fresh pack; `--check [file]` exits 1 with a line when a fresh
// pack, or the file named, differs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startedAsScript } from '../lib/started-as-script.js';
import { pluginVersion, sha256Of, vsixBytes, vsixName } from './pack.js';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HASH_FILE = path.join('vscode', 'vsix.sha256');

const first = (hash) => hash.slice(0, 12);

// vsixHash({ root }) -> { hash, name }: packs in memory and hashes it.
export function vsixHash({ root = HERE } = {}) {
  return { hash: sha256Of(vsixBytes({ root })), name: vsixName(pluginVersion(root)) };
}

// recordedHash({ root }) -> { hash, name } | null: the file as `shasum -a 256` prints it. Never throws.
export function recordedHash({ root = HERE } = {}) {
  try {
    const match = /^([0-9a-f]{64}) [ *](\S.*?)\s*$/m.exec(fs.readFileSync(path.join(root, HASH_FILE), 'utf8'));
    return match ? { hash: match[1], name: match[2] } : null;
  } catch {
    return null;
  }
}

// checkHash({ root, file }) -> { ok, expected, actual, line }: the hash of `file` (a pack already made) or of a fresh pack
// (`actual`), against the recorded one (`expected`). `expected` is null when none is recorded, and `actual` is null when the
// hash couldn't be worked out. Never throws.
export function checkHash({ root = HERE, file } = {}) {
  const recorded = recordedHash({ root });
  if (!recorded) return { ok: false, missing: true, expected: null, actual: null, line: `There is no recorded hash for the add-on (${HASH_FILE}). Run node scripts/addon/hash.js --write.` };
  let actual;
  try {
    actual = file ? sha256Of(fs.readFileSync(file)) : vsixHash({ root }).hash;
  } catch (error) {
    return { ok: false, expected: recorded.hash, actual: null, line: `The add-on's hash couldn't be worked out: ${error.message}` };
  }
  if (actual !== recorded.hash) {
    return { ok: false, expected: recorded.hash, actual, line: `The add-on packs to ${first(actual)}, but ${first(recorded.hash)} is recorded in ${HASH_FILE}. Run node scripts/addon/hash.js --write and commit the result.` };
  }
  return { ok: true, expected: recorded.hash, actual, line: `The add-on matches its recorded hash (${first(actual)}).` };
}

// writeHash({ root }) -> { hash, name }: records the hash of a fresh pack.
export function writeHash({ root = HERE } = {}) {
  const got = vsixHash({ root });
  fs.writeFileSync(path.join(root, HASH_FILE), `${got.hash}  ${got.name}\n`);
  return got;
}

if (startedAsScript(import.meta.url)) {
  const flag = process.argv[2];
  try {
    if (flag === '--write') {
      const got = writeHash({ root: HERE });
      process.stdout.write(`${got.hash}  ${got.name}\n`);
    } else if (flag === '--check') {
      const named = process.argv[3];
      const got = checkHash({ root: HERE, file: named ? path.resolve(named) : undefined });
      process.stdout.write(`${got.line}\n`);
      if (!got.ok) process.exitCode = 1;
    } else {
      process.stderr.write('Usage: node scripts/addon/hash.js --write | --check [file]\n');
      process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(`The add-on's hash wasn't worked out: ${error.message}\n`);
    process.exitCode = 1;
  }
}
