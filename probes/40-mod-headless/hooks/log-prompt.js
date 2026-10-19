// probes/40-mod-headless/hooks/log-prompt.js
// The probe's classic UserPromptSubmit hook: appends the prompt it receives, and the
// names of the fields it was given, to probe-40-hook.jsonl in the session's working folder.
import fs from 'node:fs';
import path from 'node:path';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let input;
try { input = JSON.parse(raw); } catch { input = { unparsed: raw }; }
const folder = typeof input.cwd === 'string' ? input.cwd : process.cwd();
fs.appendFileSync(
  path.join(folder, 'probe-40-hook.jsonl'),
  JSON.stringify({ at: new Date().toISOString(), prompt: input.prompt, keys: Object.keys(input) }) + '\n',
);
