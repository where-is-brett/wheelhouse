// probes/03-precompact/guard-b.js
// Probe 03b: a PreCompact hook that logs every call with a millisecond time and
// blocks each one, with a stated reason, until an "allow" file appears.
import fs from 'node:fs';
import path from 'node:path';
import { probeLogDir, appendJsonl } from '../lib/log.js';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

const dir = probeLogDir('03-precompact');
let input;
try {
  input = JSON.parse(raw);
} catch {
  input = { unparsed: raw };
}
const allow = fs.existsSync(path.join(dir, 'allow'));
await appendJsonl(path.join(dir, 'guard-b.jsonl'), {
  atMs: Date.now(),
  at: new Date().toISOString(),
  decision: allow ? 'allow' : 'block',
  trigger: input.trigger,
});

if (!allow) {
  process.stderr.write('PROBE-REASON-7731: compaction is held because state is unsaved\n');
  process.exitCode = 2;
}
