// vscode/key.cjs
// The add-on's own signing key. It is made once, on first start, and kept only in VS Code's SecretStorage
// (the Keychain on macOS, DPAPI on Windows) under `wheelhouse.panelKey`: never in a file, and never this
// computer's own key. `sign(command, args)` signs the command, its arguments and the time, which is the
// evidence a paired app sends (desk/1, scripts/desk/evidence.js).
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

// loadKey(secrets, { now }) -> { client, publicKey, fingerprint, sign(command, args) }. `secrets` is VS Code's
// SecretStorage (`get`, `store`). A stored key that can't be read is replaced by a new one, which is then unpaired.
async function loadKey(secrets, { now = () => new Date() } = {}) {
  let privateKey = null;
  try {
    const kept = await secrets.get(SECRET_NAME);
    if (typeof kept === 'string' && kept !== '') privateKey = crypto.createPrivateKey({ key: Buffer.from(kept, 'base64'), format: 'der', type: 'pkcs8' });
  } catch {
    privateKey = null;
  }
  if (privateKey === null) {
    const made = crypto.generateKeyPairSync('ed25519');
    privateKey = made.privateKey;
    await secrets.store(SECRET_NAME, made.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'));
  }
  const publicKey = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
  const fingerprint = fingerprintOf(publicKey);
  const client = `vscode-panel-${fingerprint.slice(0, 8)}`;
  const sign = (command, args = {}) => {
    const at = now().toISOString();
    return { form: 'client', client, at, sig: crypto.sign(null, Buffer.from(canonicalJson({ command, args, at })), privateKey).toString('base64') };
  };
  return { client, publicKey, fingerprint, sign };
}

module.exports = { loadKey, canonicalJson, fingerprintOf, SECRET_NAME };
