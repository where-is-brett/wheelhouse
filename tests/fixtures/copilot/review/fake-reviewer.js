// tests/fixtures/copilot/review/fake-reviewer.js
// A stand-in for Copilot CLI in the review's tests, never the real one: run as `node fake-reviewer.js <knobs.json>
// <copilot's arguments...>`. It answers `--version`, the four listings and one session the way check 66's recorded
// route b session did (b-clean-copy.json's events and debug line), reading the reviewer's nonce line from the review
// home's agent, as the agent in effect would. The knobs file says what to change, and where to record what it saw:
//   version        the version it gives (default the one in `expect`)
//   extraAgent     a second agent in the session's events
//   extraDisabled  a name added to the "Disabled tools" line
//   agents         the debug log's agent count (default 1; null writes no count)
//   instructions   the instruction listing (default [])
//   skills         the skills listing's text
//   answer         'nonce' (default), 'no-nonce', or 'none'
//   verdict        CLEAN (default) or FINDINGS
//   record         a file it writes what it saw to: each call's arguments, variable names, folder and home listing
//   plantHome      a path the session writes into the review's home while it runs
//   plantFolder    a path the session writes into the review's folder while it runs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [knobsFile, ...args] = process.argv.slice(2);
const knobs = JSON.parse(fs.readFileSync(knobsFile, 'utf8'));
const recorded = JSON.parse(fs.readFileSync(path.join(HERE, 'b-clean-copy.json'), 'utf8'));
const home = process.env.COPILOT_HOME ?? '';

const listing = (dir) => {
  const out = [];
  const walk = (current, prefix) => {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(current, entry.name), relative);
      else out.push(relative);
    }
  };
  walk(dir, '');
  return out.sort();
};
if (knobs.record) {
  fs.appendFileSync(knobs.record, `${JSON.stringify({ args, env: Object.keys(process.env).sort(), cwd: listing(process.cwd()), home: listing(home) })}\n`);
}

if (args[0] === '--version') {
  console.log(`GitHub Copilot CLI ${knobs.version}.`);
  process.exit(0);
}
if (args[1] === 'list') {
  if (args[0] === 'instruction') console.log(JSON.stringify(knobs.instructions ?? []));
  else if (args[0] === 'lsp') console.log('[]');
  else if (args[0] === 'mcp') console.log(JSON.stringify({ mcpServers: { 'github-mcp-server': {} } }));
  else if (args[0] === 'skill') console.log(knobs.skills ?? 'Builtin skills:\n  customize-cloud-agent\n  github-pr-media\n');
  else process.exit(1);
  process.exit(0);
}

const at = (flag) => args[args.indexOf(flag) + 1];
const prompt = at('-p') ?? '';
const nonceLine = /^WHEELHOUSE CLEAN REVIEWER [0-9a-f]{32}$/m.exec(fs.readFileSync(path.join(home, 'agents', 'reviewer.agent.md'), 'utf8'))?.[0];
const pr = /Review pull request (\d+)/.exec(prompt)?.[1] ?? '0';
const commit = /at its head commit ([0-9a-f]{40})/.exec(prompt)?.[1] ?? '';

const emit = (event) => console.log(JSON.stringify(event));
for (const event of recorded.events) {
  if (event.type === 'session.info' && knobs.extraDisabled) emit({ ...event, data: { ...event.data, message: `${event.data.message}, ${knobs.extraDisabled}` } });
  else if (event.type === 'assistant.message' && event.data?.phase === 'final_answer') continue;
  else if (event.type !== 'result') emit(event);
}
if (knobs.extraAgent) emit({ type: 'session.custom_agents_updated', data: { agents: [{ name: 'reviewer', source: 'user' }, { name: knobs.extraAgent, source: 'project' }] } });
const report = ['WHEELHOUSE REPORT', 'role: reviewer', `pr: ${pr}`, `commit: ${commit}`, `verdict: ${knobs.verdict ?? 'CLEAN'}`, ...(knobs.verdict === 'FINDINGS' ? ['findings: 1'] : [])].join('\n');
const answer = knobs.answer === 'none' ? null : `${knobs.answer === 'no-nonce' ? '' : `${nonceLine}\n`}Read the change in the folder.\n${report}`;
if (answer !== null) emit({ type: 'assistant.message', data: { messageId: 'm2', phase: 'final_answer', content: answer } });
emit({ type: 'result', sessionId: 'sid-review', exitCode: 0, usage: { premiumRequests: 1 } });

for (const [root, file] of [[home, knobs.plantHome], [process.cwd(), knobs.plantFolder]]) {
  if (!file) continue;
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), 'planted\n');
}

const logDir = at('--log-dir');
if (logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const agents = knobs.agents === undefined ? 1 : knobs.agents;
  const lines = agents === null ? [] : [recorded.debugLines[0].replace('loaded=1', `loaded=${agents}`)];
  fs.writeFileSync(path.join(logDir, 'process-review.log'), `${lines.join('\n')}\n`);
}
