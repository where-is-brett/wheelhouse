// probes/lib/hook-logger.js
// A hook for probes: logs the JSON it receives on stdin and does nothing else.
// Run as: node "<path>/hook-logger.js" <check> <event>
import path from 'node:path';
import { probeLogDir, appendJsonl } from './log.js';

const [check, event] = process.argv.slice(2);
let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  input = { unparsed: raw };
}
await appendJsonl(path.join(probeLogDir(check), 'hooks.jsonl'), { at: new Date().toISOString(), event, input });
