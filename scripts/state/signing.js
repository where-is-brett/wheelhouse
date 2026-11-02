// scripts/state/signing.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../lib/canonical.js';
import { computerId, keysDir } from '../lib/paths.js';

const keyFile = () => path.join(keysDir(), 'signing.pem');
// Where this computer's signing key is kept: uninstall lists it for removal on the last project.
export const signingKeyFile = keyFile;
// The computers whose signatures count here, kept beside this computer's own key, where no git
// operation reaches (ruling R105): never in the profile's clone, which anyone who can push to the
// profile repository could change. A list kept in the clone before is not read.
export const enrolledFile = () => path.join(keysDir(), 'enrolled.json');

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

// This computer's own key as an enrolment gives it, { computer, publicKey }, or null when there is
// no usable key here.
export function ownKey() {
  try {
    const privateKey = crypto.createPrivateKey(fs.readFileSync(keyFile()));
    return {
      computer: computerId(),
      publicKey: crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64'),
    };
  } catch {
    return null;
  }
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

// Whether an enrolled key may have signed `record`: a current key always; a retired one only for a record whose id it
// had signed when it was retired (`signedIds`), never for one stamped to look older, since whoever holds a copy of the key
// also chooses the stamp. A retired key with no such list verifies nothing.
function keptBefore(entry, record) {
  if (entry.retiredAt === undefined) return true;
  return Array.isArray(entry.signedIds) && typeof record?.id === 'string' && entry.signedIds.includes(record.id);
}

// True only if the record's computer is enrolled and its signature checks. Never throws.
export function verify(record, enrolled) {
  try {
    const sig = record?.sig;
    if (!sig || typeof sig.computer !== 'string' || typeof sig.value !== 'string') return false;
    if (!Array.isArray(enrolled)) return false;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sig.value)) return false;
    const body = Buffer.from(canonicalJson(withoutSig(record)));
    const value = Buffer.from(sig.value, 'base64');
    // A computer may hold several keys: its current one, and the ones retired by a renewal. A retired key counts only for a
    // record it signed before it was retired, so a copy of it signs nothing new.
    return enrolled.filter((e) => e?.computer === sig.computer && typeof e.publicKey === 'string' && keptBefore(e, record)).some((entry) => {
      const key = crypto.createPublicKey({ key: Buffer.from(entry.publicKey, 'base64'), format: 'der', type: 'spki' });
      return crypto.verify(null, body, key, value);
    });
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
  // A key a renewal retired stays: it still verifies what it signed.
  const list = loadEnrolled().filter((e) => e.computer !== entry.computer || e.retiredAt !== undefined);
  list.push({ computer: entry.computer, publicKey: entry.publicKey, enrolledAt: entry.enrolledAt });
  saveEnrolled(list);
}

// Replaces this computer's signing key with a new one (a renewal). The old private key is overwritten, so nothing can sign
// with it again; its public key stays enrolled as retired at `retiredAt`, so what it signed before still verifies. Returns
// the new enrolment { computer, publicKey }. A key already on this computer is required, and the list must be readable.
export function renewSigningKey({ retiredAt, signedIds = [] }) {
  const old = ownKey();
  if (old === null) throw new Error('This computer has no usable signing key to renew');
  const list = loadEnrolled();
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const fresh = { computer: old.computer, publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const added = [...list, { ...fresh, enrolledAt: retiredAt }];
  const retired = added.map((e) => (e.computer === old.computer && e.retiredAt === undefined && e.publicKey === old.publicKey ? { ...e, retiredAt, signedIds } : e));
  // Every step leaves a key that works: the new key is written aside, enrolled beside the old, put in place, and only then is
  // the old one retired. A failure before the last step leaves the old key signing; one at the last leaves both current.
  const temp = `${keyFile()}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, pem, { flag: 'wx', mode: 0o600 });
    saveEnrolled(added);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw new Error(`The new signing key could not be made (${error.code ?? 'unknown error'})`);
  }
  try {
    fs.renameSync(temp, keyFile());
  } catch (error) {
    fs.rmSync(temp, { force: true });
    saveEnrolled(list);
    throw new Error(`The new signing key could not be put in place (${error.code ?? 'unknown error'})`);
  }
  try { saveEnrolled(retired); } catch { /* both keys stay current: nothing is lost, and the old one is retired next time */ }
  return fresh;
}

function saveEnrolled(list) {
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
