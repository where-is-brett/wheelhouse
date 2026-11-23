// vscode/key.cjs
// The add-on's own signing key. It is made once, on first start, and kept only in VS Code's SecretStorage
// (the Keychain on macOS, DPAPI on Windows) under `wheelhouse.panelKey`: never in a file, and never this
// computer's own key. `sign(command, args, project)` signs the command, its arguments, the time and the project, which is
// the evidence a paired app sends (desk/1, scripts/desk/evidence.js); a signature for one project is no act for another.
'use strict';

const crypto = require('node:crypto');

const SECRET_NAME = 'wheelhouse.panelKey';

// JSON with object keys sorted at every level and no spaces: a copy of scripts/lib/canonical.js, which a test
// compares with core's own.
function canonicalJson(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error('A number that is not finite cannot be written canonically');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      const keys = Object.keys(value).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
    }
    default:
      throw new Error(`A ${typeof value} value cannot be written canonically`);
  }
}

// The twelve-character fingerprint of a public key (base64 DER), as the Pair card shows it.
const fingerprintOf = (publicKey) => crypto.createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex').slice(0, 12);

// loadKey(secrets, { now }) -> { client, publicKey, fingerprint, sign(command, args, project) }. `secrets` is VS Code's
// SecretStorage (`get`, `store`). A stored key that can't be read is replaced by a new one, which is then unpaired.
// A key that can't be had is `{ unavailable: <words> }`, never a new key: replacing a key that exists but can't be
// read would unpair the panel without anyone saying so, so it stays unpaired for this run and says why.
const UNAVAILABLE = 'Wheelhouse couldn\'t read its key from VS Code\'s secret storage, so this panel stays unpaired until it can.';
const privateOf = (kept) => crypto.createPrivateKey({ key: Buffer.from(kept, 'base64'), format: 'der', type: 'pkcs8' });

async function loadKey(secrets, { now = () => new Date() } = {}) {
  let privateKey = null;
  try {
    let kept = await secrets.get(SECRET_NAME);
    if (typeof kept !== 'string' || kept === '') {
      const made = crypto.generateKeyPairSync('ed25519');
      await secrets.store(SECRET_NAME, made.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'));
      // Read it back: two windows starting together each store one, and the last stored is the one both use.
      kept = await secrets.get(SECRET_NAME);
    }
    privateKey = privateOf(kept);
  } catch {
    return { unavailable: UNAVAILABLE };
  }
  const publicKey = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
  const fingerprint = fingerprintOf(publicKey);
  const client = `vscode-panel-${fingerprint.slice(0, 8)}`;
  const sign = (command, args = {}, project) => {
    if (typeof project !== 'string' || project === '') throw new Error('A signature names the project it is for');
    const at = now().toISOString();
    return { form: 'client', client, at, sig: crypto.sign(null, Buffer.from(canonicalJson({ command, args, at, project })), privateKey).toString('base64') };
  };
  return { client, publicKey, fingerprint, sign };
}

module.exports = { loadKey, canonicalJson, fingerprintOf, SECRET_NAME };
