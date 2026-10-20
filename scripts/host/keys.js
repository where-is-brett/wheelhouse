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
