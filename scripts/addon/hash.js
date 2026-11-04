// scripts/addon/hash.js
// The hash of the packed VS Code add-on, kept in `vscode/vsix.sha256` in the tagged commit. `pack.js` packs byte for byte the
// same each run, so the hash can be known before the tag: the commit that sets a release's version runs `--write`, CI runs
// `--check`, and the install and the release job refuse a .vsix that differs. The recorded file is not itself packed, or the
// hash would have to contain itself.
//
// `node scripts/addon/hash.js --write` records the hash of a fresh pack; `--check` exits 1 with a line when it differs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startedAsScript } from '../lib/started-as-script.js';
import { pack, pluginVersion, vsixName } from './pack.js';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HASH_FILE = path.join('vscode', 'vsix.sha256');

const sha256Of = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const first = (hash) => hash.slice(0, 12);

// vsixHash({ root }) -> { hash, name }: packs to a temporary file, hashes it and removes it.
export function vsixHash({ root = HERE } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-vsix-'));
  const name = vsixName(pluginVersion(root));
  try {
    const file = pack({ root, out: path.join(dir, name) });
    return { hash: sha256Of(file), name };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

// checkHash({ root, file }) -> { ok, line }: the hash of `file` (a pack already made) or of a fresh pack, against the recorded one.
export function checkHash({ root = HERE, file } = {}) {
  const recorded = recordedHash({ root });
  if (!recorded) return { ok: false, line: `There is no recorded hash for the add-on (${HASH_FILE}). Run node scripts/addon/hash.js --write.` };
  let got;
  try {
    got = file ? { hash: sha256Of(file), name: path.basename(file) } : vsixHash({ root });
  } catch (error) {
    return { ok: false, line: `The add-on's hash couldn't be worked out: ${error.message}` };
  }
  if (got.hash !== recorded.hash) {
    return { ok: false, line: `The add-on packs to ${first(got.hash)}, but ${first(recorded.hash)} is recorded in ${HASH_FILE}. Run node scripts/addon/hash.js --write and commit the result.` };
  }
  return { ok: true, line: `The add-on matches its recorded hash (${first(got.hash)}).` };
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
      const got = checkHash({ root: HERE });
      process.stdout.write(`${got.line}\n`);
      if (!got.ok) process.exitCode = 1;
    } else {
      process.stderr.write('Usage: node scripts/addon/hash.js --write | --check\n');
      process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(`The add-on's hash wasn't worked out: ${error.message}\n`);
    process.exitCode = 1;
  }
}
