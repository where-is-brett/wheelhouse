// probes/lib/test-ca.js
// A throwaway certificate authority and a certificate for `localhost` signed by it, made with
// `openssl`. Every tool rejects the certificate until it is told about the authority, as with a
// company's own authority. Nothing here touches the machine's trust store.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DAYS = '365';

// Writes ca.pem, localhost.crt and localhost.key into `dir` (mode 600; the folder is 700) and
// returns their paths: { caPem, certPem, keyPem }. The authority's own key is kept only while
// the certificate is signed, then removed.
export function makeTestCa(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const work = fs.mkdtempSync(path.join(dir, '.ca-'));
  const at = (name) => path.join(work, name);
  const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    fs.writeFileSync(at('ca.cnf'), [
      '[req]', 'distinguished_name = dn', 'prompt = no', 'x509_extensions = ca',
      '[dn]', 'CN = Wheelhouse throwaway test authority',
      '[ca]', 'basicConstraints = critical, CA:TRUE', 'keyUsage = critical, keyCertSign, cRLSign',
      'subjectKeyIdentifier = hash', '',
    ].join('\n'));
    fs.writeFileSync(at('leaf.cnf'), [
      '[req]', 'distinguished_name = dn', 'prompt = no',
      '[dn]', 'CN = localhost',
      '[leaf]', 'basicConstraints = CA:FALSE', 'keyUsage = critical, digitalSignature, keyEncipherment',
      'extendedKeyUsage = serverAuth', 'subjectAltName = DNS:localhost, IP:127.0.0.1',
      'subjectKeyIdentifier = hash', 'authorityKeyIdentifier = keyid', '',
    ].join('\n'));
    openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', at('ca.key'), '-out', at('ca.pem'), '-days', DAYS, '-config', at('ca.cnf'));
    openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', at('localhost.key'), '-out', at('localhost.csr'), '-config', at('leaf.cnf'));
    openssl('x509', '-req', '-in', at('localhost.csr'), '-CA', at('ca.pem'), '-CAkey', at('ca.key'), '-CAcreateserial', '-out', at('localhost.crt'), '-days', DAYS, '-extfile', at('leaf.cnf'), '-extensions', 'leaf');
    const out = { caPem: path.join(dir, 'ca.pem'), certPem: path.join(dir, 'localhost.crt'), keyPem: path.join(dir, 'localhost.key') };
    for (const [from, to] of [['ca.pem', out.caPem], ['localhost.crt', out.certPem], ['localhost.key', out.keyPem]]) {
      fs.copyFileSync(at(from), to);
      fs.chmodSync(to, 0o600);
    }
    return out;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
