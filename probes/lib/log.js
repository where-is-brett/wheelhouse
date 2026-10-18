// probes/lib/log.js
// Where probes keep their logs (outside the repository), and a JSON-lines
// writer that never writes a secret.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SECRET_KEY = /token|secret|password|authorization|cookie/i;

export function probeLogDir(check, home = os.homedir()) {
  const dir = path.join(home, '.wheelhouse-probes', check);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, SECRET_KEY.test(key) ? '[redacted]' : redact(inner)]),
    );
  }
  return value;
}

export async function appendJsonl(file, record) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.appendFile(file, JSON.stringify(redact(record)) + '\n', 'utf8');
}
