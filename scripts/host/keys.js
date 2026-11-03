// scripts/host/keys.js
// The connection's keys, one file each under keys/ in the Wheelhouse folder:
//   github-app.json            the GitHub App's client ID, its installations as
//                              `installations` { <account, lower case>: id }
//                              with `installationId` the first of them (a file
//                              written before kept only that one), the access
//                              key, the renewal key and their expiries; never
//                              a client secret (check 20). One file per app:
//                              its access key works across every installation.
//   gitlab-project-<id>.json   { kind: 'project-key' | 'pasted-token', token,
//                              expiresAt, id? } for one GitLab project (check 22);
//                              id is the token's own number, kept when the key is
//                              made (makeProjectKey returns it) so the runbook can
//                              revoke it by number if GitLab refuses the self form.
// Files are written with mode 0o600 where the system supports it; that is
// tidiness, not protection (design section 12.6). Errors name the file, never
// what is in it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { keysDir } from '../lib/paths.js';

const NAME = /^(?:github-app|gitlab-project-\d+)$/;

function fileFor(name) {
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new Error('The key name must be github-app or gitlab-project-<number>');
  }
  return path.join(keysDir(), `${name}.json`);
}

// The key kept under this name, or null when there is none.
export function readKey(name) {
  const file = fileFor(name);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Could not read the key file ${name}.json`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`The key file ${name}.json is damaged`);
  }
  return value;
}

// Keeps the key under this name, replacing any kept before. It is written to
// a temporary file beside it and then renamed, so a reader never sees half.
export function writeKey(name, value) {
  const file = fileFor(name);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A key must be kept as an object');
  }
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${name}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  } catch {
    fs.rmSync(temp, { force: true });
    throw new Error(`Could not save the key file ${name}.json`);
  }
}

// Removes the key kept under this name. A key that is not there is already gone.
export function deleteKey(name) {
  const file = fileFor(name);
  try {
    fs.rmSync(file, { force: true });
  } catch {
    throw new Error(`Could not remove the key file ${name}.json`);
  }
}

// The computer's own store (scripts/host/store.js) is where keys live. The
// functions above read and write the old key files, which stay until a key has
// moved; these reach the store, with the file as the fallback during migration.
// `deps` is a seam for tests: { store } holding readKey, storeKey and deleteKey.
async function storeOf(deps) {
  return deps?.store ?? (await import('./store.js'));
}

// The key under this name from the store, else from the old key file, else null.
export async function findKey(name, deps) {
  fileFor(name);
  const store = await storeOf(deps);
  const kept = await store.readKey(name);
  return kept ?? readKey(name);
}

// Keeps the key in the store, where renewed keys are rewritten from now on.
export async function saveKey(name, value, deps) {
  fileFor(name);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A key must be kept as an object');
  }
  const store = await storeOf(deps);
  await store.storeKey(name, value);
}

// Moves every key file into the store. Each file is deleted only after its key
// has been read back from the store and found equal; a move that fails leaves
// the file, and the next call tries again. Returns { moved, failed } by name.
export async function moveKeysToStore(deps) {
  const store = await storeOf(deps);
  const moved = [];
  const failed = [];
  let files;
  try {
    files = fs.readdirSync(keysDir());
  } catch {
    return { moved, failed };
  }
  for (const file of files.sort()) {
    const name = file.replace(/\.json$/, '');
    if (!file.endsWith('.json') || !NAME.test(name)) continue;
    try {
      const value = readKey(name);
      await store.storeKey(name, value);
      const back = await store.readKey(name);
      if (JSON.stringify(back) !== JSON.stringify(value)) throw new Error('read back differs');
      deleteKey(name);
      moved.push(name);
    } catch {
      failed.push(name);
    }
  }
  return { moved, failed };
}
