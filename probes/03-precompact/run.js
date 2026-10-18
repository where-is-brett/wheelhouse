// probes/03-precompact/run.js
// Check 3: fills a headless session's context until it compacts, with the
// guard blocking the first three compactions, then reports from the log.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeLogDir } from '../lib/log.js';
import { makeScratchProject } from '../lib/scratch.js';

const guard = fileURLToPath(new URL('./guard.js', import.meta.url));
const filler = Array.from({ length: 4000 }, (_, i) => `Line ${i}: ${'filler text for the probe. '.repeat(4)}`).join('\n');
const files = {};
for (let i = 1; i <= 12; i += 1) files[`big-${i}.txt`] = filler;

const project = await makeScratchProject({
  name: 'precompact',
  files,
  settings: {
    autoCompactWindow: 100000,
    hooks: { PreCompact: [{ matcher: 'auto', hooks: [{ type: 'command', command: `node "${guard}"` }] }] },
  },
});

const log = path.join(probeLogDir('03-precompact'), 'guard.jsonl');
fs.rmSync(log, { force: true });
const claude = (args) => spawnSync('claude', args, { cwd: project.dir, encoding: 'utf8', shell: process.platform === 'win32' });

let result = claude(['-p', 'Read big-1.txt and big-2.txt in full, then say how many lines each has.', '--output-format', 'json']);
const sessionId = JSON.parse(result.stdout || '{}').session_id;
const turns = [];
for (let i = 3; i <= 12 && sessionId; i += 1) {
  result = claude(['-p', `Read big-${i}.txt in full, then say its last line.`, '--resume', sessionId, '--output-format', 'json']);
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  turns.push({ turn: i, exit: result.status, guardCalls: calls });
}
console.log(JSON.stringify({ sessionId: Boolean(sessionId), turns }, null, 2));
await project.cleanup();
