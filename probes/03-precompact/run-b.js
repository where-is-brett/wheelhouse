// probes/03-precompact/run-b.js
// Probe 03b: does a held compaction come back on a timer, or only with the
// next request, and does the model see the reason? Scratch project only,
// the Wheelhouse plugin switched off in the scratch project's settings.
// The model is never written into the repository: pass it as --model <name> or
// set WHEELHOUSE_PROBE_MODEL.
// Usage: node probes/03-precompact/run-b.js --model <name>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeLogDir } from '../lib/log.js';
import { makeScratchProject } from '../lib/scratch.js';

const guard = fileURLToPath(new URL('./guard-b.js', import.meta.url));
const filler = Array.from({ length: 4000 }, (_, i) => `Line ${i}: ${'filler text for the probe. '.repeat(4)}`).join('\n');

const project = await makeScratchProject({
  name: 'precompact-b',
  files: { 'big-1.txt': filler, 'big-2.txt': filler },
  settings: {
    autoCompactWindow: 100000,
    enabledPlugins: { 'wheelhouse@wheelhouse': false },
    hooks: { PreCompact: [{ matcher: 'auto', hooks: [{ type: 'command', command: `node "${guard}"` }] }] },
  },
});

const dir = probeLogDir('03-precompact');
for (const f of ['guard-b.jsonl', 'allow']) fs.rmSync(path.join(dir, f), { force: true });
const at = process.argv.indexOf('--model');
const model = (at > 0 ? process.argv[at + 1] : '') || process.env.WHEELHOUSE_PROBE_MODEL || '';
if (!model || model.startsWith('-') || !/^[\w.[\]:-]+$/.test(model)) {
  throw new Error('Name the model: --model <name>, or set WHEELHOUSE_PROBE_MODEL. It is not written into the repository.');
}
const base = ['--model', model, '--output-format', 'json', '--allowedTools', 'Read,Bash'];
const claude = (args) => spawnSync('claude', ['-p', ...args, ...base], { cwd: project.dir, encoding: 'utf8', shell: process.platform === 'win32' });
const mark = (label) => ({ label, atMs: Date.now() });
const marks = [];

marks.push(mark('turn1 start'));
let r = claude(['Read big-1.txt in full, then say how many lines it has.']);
const sessionId = JSON.parse(r.stdout || '{}').session_id;
const replies = [JSON.parse(r.stdout || '{}').result];
marks.push(mark('turn1 end'));

marks.push(mark('turn2 start'));
r = claude(['Run the shell command `node -e "setTimeout(()=>{},40000)"` three times, one at a time, waiting for each to finish (it takes 40 seconds and prints nothing), then reply with the single word done.', '--resume', sessionId]);
replies.push(JSON.parse(r.stdout || '{}').result);
marks.push(mark('turn2 end'));

fs.writeFileSync(path.join(dir, 'allow'), 'x');
marks.push(mark('turn3 start'));
r = claude(['Say hello, then say what the first line of big-1.txt is.', '--resume', sessionId]);
replies.push(JSON.parse(r.stdout || '{}').result);
marks.push(mark('turn3 end'));

// The transcript lives under the user's Claude folder, keyed by the project path.
const root = path.join(os.homedir(), '.claude', 'projects');
let transcript = [];
for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) {
  const f = path.join(root, d, `${sessionId}.jsonl`);
  if (fs.existsSync(f)) transcript = fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}
const requests = transcript.filter((e) => e.type === 'assistant').map((e) => Date.parse(e.timestamp));
const calls = fs.existsSync(path.join(dir, 'guard-b.jsonl'))
  ? fs.readFileSync(path.join(dir, 'guard-b.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  : [];
const t0 = marks[0].atMs;
const rel = (ms) => Math.round((ms - t0) / 1000);
const text = JSON.stringify(transcript) + replies.join(' ');
console.log(JSON.stringify({
  marks: marks.map((m) => ({ label: m.label, s: rel(m.atMs) })),
  guardCalls: calls.map((c) => ({ s: rel(c.atMs), decision: c.decision })),
  assistantEntriesAt: requests.map(rel),
  reasonVisible: text.includes('PROBE-REASON-7731'),
  compactBoundaries: transcript.filter((e) => e.subtype === 'compact_boundary').length,
  replies,
}, null, 2));
await project.cleanup();
