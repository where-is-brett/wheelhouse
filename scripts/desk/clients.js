// scripts/desk/clients.js
// The later apps paired with the desk (spec 5.3), kept beside this computer's own key in
// <WHEELHOUSE_HOME>/keys/clients.json, where no agent can read it (the sandbox denies the home). An app
// asks to pair with its id, name and ed25519 public key (`act('pair')`); the request waits in
// keys/clients-asked.json, and the key is enrolled only by the director's signed Pair it on the card
// naming the app and the key's fingerprint. Unpair it, signed the same way, removes it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { keysDir } from '../lib/paths.js';
import { verify, readEnrolled } from '../state/signing.js';
import { APP_ID } from '../state/card-lines.js';

export const clientsFile = () => path.join(keysDir(), 'clients.json');
const askedFile = () => path.join(keysDir(), 'clients-asked.json');
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The twelve-character fingerprint of a public key (base64 DER, as signing.js keeps keys).
export const fingerprintOf = (publicKey) => crypto.createHash('sha256').update(Buffer.from(String(publicKey), 'base64')).digest('hex').slice(0, 12);

function readList(file) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(list) ? list.filter(isPlain) : [];
  } catch {
    return [];
  }
}

function writeList(file, list) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

// Whether `publicKey` is an ed25519 public key in base64 DER.
function isKey(publicKey) {
  try {
    return crypto.createPublicKey({ key: Buffer.from(String(publicKey), 'base64'), format: 'der', type: 'spki' }).asymmetricKeyType === 'ed25519';
  } catch {
    return false;
  }
}

export function pairedClients() {
  return readList(clientsFile()).filter((c) => typeof c.id === 'string' && typeof c.publicKey === 'string');
}

// Keeps an app's request to pair, until the director answers its card. Throws when it isn't one.
export function askToPair({ id, name, publicKey }, { now = () => new Date() } = {}) {
  if (typeof id !== 'string' || !APP_ID.test(id)) throw new Error('An app names itself by a short id of letters, digits, dots, dashes and underscores');
  if (typeof name !== 'string' || name.trim() === '' || name.length > 80 || /[\p{Cc}\p{Cf}]/u.test(name)) throw new Error('An app gives its name, on one line');
  if (!isKey(publicKey)) throw new Error('An app gives its ed25519 public key');
  const asked = readList(askedFile()).filter((c) => c.id !== id);
  asked.push({ id, name, publicKey, askedAt: now().toISOString() });
  writeList(askedFile(), asked);
  return { id, name, fingerprint: fingerprintOf(publicKey) };
}

// Whether `signed` is this computer's signed `action` naming the app `id` and the key's fingerprint.
function signedFor(signed, action, id, publicKey) {
  return isPlain(signed) && signed.kind === 'action' && verify(signed, readEnrolled())
    && signed.data?.action === action && signed.data.client === id && signed.data.fingerprint === fingerprintOf(publicKey);
}

// Enrols the app asked as `id`, with the director's signed pair-client action naming it and its key.
export function pairClient({ id }, signedAction, { now = () => new Date() } = {}) {
  const asked = readList(askedFile()).find((c) => c.id === id);
  if (asked === undefined) return { ok: false, refused: `No app ${id} asked to pair` };
  if (!signedFor(signedAction, 'pair-client', id, asked.publicKey)) return { ok: false, refused: 'Pairing an app needs the director\'s signed Pair it for that app and key' };
  writeList(clientsFile(), [...pairedClients().filter((c) => c.id !== id), { id, name: asked.name, publicKey: asked.publicKey, pairedAt: now().toISOString() }]);
  writeList(askedFile(), readList(askedFile()).filter((c) => c.id !== id));
  return { ok: true };
}

// Removes the paired app `id`, with the director's signed unpair-client action naming it and its key.
export function unpairClient(id, signedAction) {
  const paired = pairedClients().find((c) => c.id === id);
  if (paired === undefined) return { ok: false, refused: `No app ${id} is paired` };
  if (!signedFor(signedAction, 'unpair-client', id, paired.publicKey)) return { ok: false, refused: 'Unpairing an app needs the director\'s signed Unpair it for that app and key' };
  writeList(clientsFile(), pairedClients().filter((c) => c.id !== id));
  return { ok: true };
}
