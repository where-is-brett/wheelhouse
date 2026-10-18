// scripts/state/signing.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../lib/canonical.js';
import { computerId, keysDir, profileDir } from '../lib/paths.js';

const keyFile = () => path.join(keysDir(), 'signing.pem');
const enrolledFile = () => path.join(profileDir(), 'keys', 'enrolled.json');

// Makes this computer's signing key. Returns the public key as base64 SPKI DER.
export function makeSigningKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.mkdirSync(keysDir(), { recursive: true });
  try {
    // Exclusive create, so an existing key is never replaced.
    fs.writeFileSync(keyFile(), pem, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('A signing key already exists on this computer');
    throw new Error(`The signing key could not be written (${error.code ?? 'unknown error'})`);
  }
  return {
    computer: computerId(),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

function withoutSig(record) {
  const { sig, ...rest } = record; // eslint-disable-line no-unused-vars
  return rest;
}

// Returns the record with `sig: { computer, value }` added.
export function sign(record) {
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(fs.readFileSync(keyFile()));
  } catch {
    throw new Error('This computer has no usable signing key');
  }
  const body = withoutSig(record);
  const value = crypto.sign(null, Buffer.from(canonicalJson(body)), privateKey).toString('base64');
  return { ...body, sig: { computer: computerId(), value } };
}

// True only if the record's computer is enrolled and its signature checks. Never throws.
export function verify(record, enrolled) {
  try {
    const sig = record?.sig;
    if (!sig || typeof sig.computer !== 'string' || typeof sig.value !== 'string') return false;
    if (!Array.isArray(enrolled)) return false;
    const entry = enrolled.find((e) => e?.computer === sig.computer);
    if (!entry || typeof entry.publicKey !== 'string') return false;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sig.value)) return false;
    const key = crypto.createPublicKey({
      key: Buffer.from(entry.publicKey, 'base64'), format: 'der', type: 'spki',
    });
    return crypto.verify(null, Buffer.from(canonicalJson(withoutSig(record))), key, Buffer.from(sig.value, 'base64'));
  } catch {
    return false;
  }
}

// The computers whose signatures count. Empty when none are enrolled.
export function readEnrolled() {
  try {
    const list = JSON.parse(fs.readFileSync(enrolledFile(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const isEntry = (e) => e !== null && typeof e === 'object' && !Array.isArray(e)
  && typeof e.computer === 'string' && e.computer !== '' && typeof e.publicKey === 'string' && e.publicKey !== '';

// The list on disk as it is, or [] when there is no file. Throws when the file
// is there but cannot be read, is not JSON, or is not a list of entries.
function loadEnrolled() {
  let text;
  try {
    text = fs.readFileSync(enrolledFile(), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('enrolled.json could not be read, so nothing was changed');
  }
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    list = undefined;
  }
  if (!Array.isArray(list) || !list.every(isEntry)) throw new Error('enrolled.json is damaged, so nothing was changed');
  return list;
}

// Adds a computer, replacing any earlier entry for the same one. A damaged list is
// never overwritten, and the new list is written whole: a temporary file, then a rename.
export function enrol(entry) {
  if (!isEntry(entry)) throw new Error('An enrolment needs a computer id and a public key');
  const list = loadEnrolled().filter((e) => e.computer !== entry.computer);
  list.push({ computer: entry.computer, publicKey: entry.publicKey, enrolledAt: entry.enrolledAt });
  const file = enrolledFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(list, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}
