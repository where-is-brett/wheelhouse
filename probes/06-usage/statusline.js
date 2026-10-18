// probes/06-usage/statusline.js
// Check 6: a status line command that logs what Claude Code sends it and
// shows the weekly usage figure if one arrives.
import path from 'node:path';
import { probeLogDir, appendJsonl } from '../lib/log.js';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
let input;
try {
  input = JSON.parse(raw);
} catch {
  input = { unparsed: raw };
}
await appendJsonl(path.join(probeLogDir('06-usage'), 'statusline.jsonl'), { at: new Date().toISOString(), input });
const weekly = input?.rate_limits?.seven_day?.used_percentage;
process.stdout.write(weekly === undefined ? 'Wheelhouse probe: no weekly figure' : `Wheelhouse probe: ${weekly}% of the week used`);
