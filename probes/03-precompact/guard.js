// probes/03-precompact/guard.js
// Check 3: a PreCompact hook that blocks the first three compactions and
// logs every call, to learn whether a blocked compaction is tried again.
import fs from 'node:fs';
import path from 'node:path';
import { probeLogDir, appendJsonl } from '../lib/log.js';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

const log = path.join(probeLogDir('03-precompact'), 'guard.jsonl');
const count = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length + 1 : 1;
let input;
try {
  input = JSON.parse(raw);
} catch {
  input = { unparsed: raw };
}
await appendJsonl(log, { at: new Date().toISOString(), count, input });

if (count <= 3) {
  process.stderr.write(`probe: blocking compaction ${count}\n`);
  process.exitCode = 2;
}
