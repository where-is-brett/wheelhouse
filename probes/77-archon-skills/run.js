// probes/77-archon-skills/run.js
// Check 77 (early check E4): skills inside Archon's steps. Runs the item workflows against the scratch engine
// on two scratch projects made from task/ (one with no skill copies, one with the copies as project skills),
// keeps each run's record and transcripts in the scratch folder, and reads the measures from them.
//
//   node probes/77-archon-skills/run.js setup
//   node probes/77-archon-skills/run.js item <workflow> <plain|copies>
//   node probes/77-archon-skills/run.js report
//   node probes/77-archon-skills/run.js clean
//
// The pure parts (testFirst, suiteRuns, skillsOpened, tokensPerRound, askedAPerson, unknownSkills) are exported
// for the tests. Nothing runs at import.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { archonEnv, archonRun, cleanScratch } from '../lib/archon.js';
import { run as runCommand } from '../../scripts/lib/run.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------------------------------------
// Reading Claude Code session transcripts (one JSON object per line).

// The parsed objects of a transcript, from lines (strings or objects) or a block of text. Bad lines are skipped.
export function parseLines(input) {
  const lines = Array.isArray(input) ? input : String(input ?? '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (line && typeof line === 'object') { out.push(line); continue; }
    if (typeof line !== 'string' || !line.trim()) continue;
    try { const v = JSON.parse(line); if (v && typeof v === 'object') out.push(v); } catch { /* not JSON */ }
  }
  return out;
}

function contentBlocks(entry) {
  const content = entry?.message?.content;
  return Array.isArray(content) ? content : [];
}

function resultText(block) {
  const c = block?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('\n');
  return '';
}

// The tool calls in order, each with its result: { index, name, input, result, isError }.
export function toolCalls(input) {
  const entries = parseLines(input);
  const calls = [];
  const byId = new Map();
  for (const entry of entries) {
    for (const block of contentBlocks(entry)) {
      if (entry.type === 'assistant' && block?.type === 'tool_use') {
        const call = { index: calls.length, id: block.id, name: block.name, input: block.input ?? {}, result: null, isError: false };
        calls.push(call);
        byId.set(block.id, call);
      } else if (entry.type === 'user' && block?.type === 'tool_result') {
        const call = byId.get(block.tool_use_id);
        if (call) { call.result = resultText(block); call.isError = block.is_error === true; }
      }
    }
  }
  return calls;
}

const TEST_FILE = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_RUN = /\b(bun test|npm test|npm run test|node --test|npx vitest|vitest|jest)\b/;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// What a tool call did, in the order it did it: file writes (test or code) and test runs. A shell call can
// write a file with a heredoc and run the tests in one go, so its command is read left to right.
function callEvents(call) {
  if (WRITE_TOOLS.has(call.name)) {
    const file = String(call.input.file_path ?? call.input.notebook_path ?? '');
    return CODE_FILE.test(file) ? [{ kind: TEST_FILE.test(file) ? 'test-write' : 'code-write', pos: 0 }] : [];
  }
  if (call.name !== 'Bash') return [];
  // Heredoc bodies are file contents, not commands: blank them out, keeping every position.
  const command = String(call.input.command ?? '').replace(/(<<-?\s*['"]?(\w+)['"]?[^\n]*\n)([\s\S]*?)(\n\2\b)/g,
    (_, head, _tag, body, tail) => head + body.replace(/[^\n]/g, ' ') + tail);
  const events = [];
  for (const m of command.matchAll(/(?:>>?|\btee\s+(?:-a\s+)?)\s*([\w./-]+\.[cm]?[jt]sx?)\b/g)) {
    events.push({ kind: TEST_FILE.test(m[1]) ? 'test-write' : 'code-write', pos: m.index });
  }
  const runs = new RegExp(TEST_RUN.source, 'g');
  for (const m of command.matchAll(runs)) {
    events.push({ kind: 'run', pos: m.index });
  }
  return events.sort((a, b) => a.pos - b.pos);
}

function failed(call) {
  if (call.isError) return true;
  const text = String(call.result ?? '');
  return /\b[1-9]\d* fail\b|\(fail\)|error:|Cannot find module|Export named .* not found|not a function/i.test(text);
}

// Whether a test was written, then run and seen failing, before any source file was written. Positions are
// `<call index>.<order within the call>`, so a write and a run in one shell call keep their order.
export function testFirst(input) {
  const calls = toolCalls(input);
  let testWrittenAt = null; let testFailedAt = null; let codeWrittenAt = null;
  for (const call of calls) {
    callEvents(call).forEach((event, n) => {
      const at = call.index + (n + 1) / 100;
      if (event.kind === 'test-write' && testWrittenAt === null) testWrittenAt = at;
      if (event.kind === 'code-write' && codeWrittenAt === null) codeWrittenAt = at;
      if (event.kind === 'run' && testWrittenAt !== null && testFailedAt === null && codeWrittenAt === null && failed(call)) testFailedAt = at;
    });
  }
  const pass = testWrittenAt !== null && testFailedAt !== null && codeWrittenAt !== null
    && testWrittenAt < testFailedAt && testFailedAt < codeWrittenAt;
  return { testWrittenAt, testFailedAt, codeWrittenAt, pass };
}

// How many times the whole suite ran: a shell call that runs one of the suite commands with no file or filter
// after it. `suiteCommand` is a string or a list (for example the suite and the done check that runs it).
export function suiteRuns(input, suiteCommand) {
  const commands = (Array.isArray(suiteCommand) ? suiteCommand : [suiteCommand]).filter(Boolean);
  if (commands.length === 0) return 0;
  let count = 0;
  for (const call of toolCalls(input)) {
    if (call.name !== 'Bash') continue;
    const text = String(call.input.command ?? '');
    for (const command of commands) {
      const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[\\s;&|(])${escaped}(?=$|\\s*(?:[;&|)]|\\d?>))`, 'g');
      count += (text.match(re) ?? []).length;
    }
  }
  return count;
}

// The skills opened, in order: Skill tool calls, and skills started by a slash command.
export function skillsOpened(input) {
  const opened = [];
  for (const entry of parseLines(input)) {
    for (const block of contentBlocks(entry)) {
      if (entry.type === 'assistant' && block?.type === 'tool_use' && block.name === 'Skill') {
        const name = block.input?.skill ?? block.input?.command ?? block.input?.name;
        if (name) opened.push(String(name));
      }
    }
    const text = typeof entry?.message?.content === 'string' ? entry.message.content : '';
    const m = entry.type === 'user' ? /<command-name>\/?([^<]+)<\/command-name>/.exec(text) : null;
    if (m) opened.push(m[1].trim());
  }
  return opened;
}

const ASKING = /\b(would you|do you want|should I|shall I|can you|could you|please (confirm|let me know|tell me|advise)|let me know|which (one|option|would)|what would you like|before I (proceed|continue|go on))\b/i;

// Whether the session ended by asking a person something: an AskUserQuestion call anywhere, or a question to
// the user in the final message. With nothing to read it counts as asking (it can't be shown not to).
export function askedAPerson(input) {
  const entries = parseLines(input);
  let last = null;
  for (const entry of entries) {
    if (entry.type !== 'assistant') continue;
    for (const block of contentBlocks(entry)) {
      if (block?.type === 'tool_use' && block.name === 'AskUserQuestion') return true;
      if (block?.type === 'text' && block.text?.trim()) last = block.text;
      if (block?.type === 'tool_use' && block.name === 'StructuredOutput') last = JSON.stringify(block.input ?? {});
    }
  }
  if (last === null) return true;
  const questions = last.split(/(?<=[.!?])\s+/).filter((s) => s.trim().endsWith('?'));
  return questions.some((q) => ASKING.test(q) || /\byou\b/i.test(q));
}

// Archon's `input` figure already holds the cached tokens (cacheRead and cacheWrite are parts of it), so a
// step's tokens are its input and output added together.
function sumTokens(t) {
  if (!t || typeof t !== 'object') return 0;
  return (Number(t.input) || 0) + (Number(t.output) || 0);
}

function nodeTokens(node) {
  const value = node?.execution?.spend?.tokens?.value ?? node?.tokens;
  return value ? sumTokens(value) : null;
}

// A session's tokens from its transcript: each model reply counted once (a reply split over several lines
// carries the same id and usage), its input (fresh and cached) and output added together.
export function sessionTokens(input) {
  const seen = new Map();
  for (const entry of parseLines(input)) {
    if (entry.type !== 'assistant' || !entry.message?.usage) continue;
    const u = entry.message.usage;
    const key = entry.message.id ?? `line-${seen.size}`;
    seen.set(key, (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0));
  }
  return [...seen.values()].reduce((a, b) => a + b, 0);
}

// One token figure per loop round. `record` is `archon workflow get --json --verbose`. Archon v0.13.0 keeps one
// row for a whole loop, with its total and one session id per round, so each round's figure comes from that
// round's session transcript (`transcripts` maps a session id to its lines). A record that carries a row per
// iteration is read directly. Empty when neither gives a figure.
export function tokensPerRound(record, transcripts = {}) {
  const nodes = Array.isArray(record?.nodes) ? record.nodes : [];
  const rounds = new Map();
  for (const node of nodes) {
    const iteration = node.iteration ?? node.execution?.iteration ?? null;
    const tokens = nodeTokens(node);
    if (iteration === null || iteration === undefined || tokens === null) continue;
    rounds.set(Number(iteration), (rounds.get(Number(iteration)) ?? 0) + tokens);
  }
  if (rounds.size > 0) return [...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
  const loop = nodes.find((node) => node.execution?.node?.kind === 'loop') ?? nodes.find((node) => (node.sessionIds ?? []).length > 1);
  const ids = loop?.sessionIds ?? [];
  const figures = ids.map((id) => (transcripts[id] ? sessionTokens(transcripts[id]) : 0));
  return figures.every((t) => t > 0) ? figures : [];
}

// The names in `names` that match no copy (the pack's own check: Archon only warns on an unknown name).
export function unknownSkills(names, copies) {
  const known = new Set(copies);
  return (names ?? []).filter((name) => !known.has(String(name).replace(/^[\w-]+:/, '')));
}

// ---------------------------------------------------------------------------------------------------------
// Running the items.

const ROOT = path.join(os.tmpdir(), 'wheelhouse-archon-checks');
const E4 = path.join(ROOT, 'e4');
const EVIDENCE = path.join(E4, 'evidence');
const COPIES = ['tdd', 'codebase-design', 'test-driven-development'];

function engine() {
  const claudeBin = path.join(os.homedir(), '.local', 'bin', 'claude');
  const env = archonEnv({ home: path.join(ROOT, 'home'), bunDir: path.join(ROOT, 'bun'), claudeBin, extra: { LANG: 'en_AU.UTF-8' } });
  return { env, bin: path.join(ROOT, 'bin', 'archon') };
}

async function sh(cmd, args, cwd) {
  const r = await runCommand(cmd, args, { cwd });
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

async function makeProject(name, withCopies) {
  const dir = path.join(E4, `e4-${name}`);
  fs.cpSync(path.join(HERE, 'task'), dir, { recursive: true });
  fs.mkdirSync(path.join(dir, '.archon', 'workflows'), { recursive: true });
  for (const file of fs.readdirSync(path.join(HERE, 'workflows'))) {
    fs.copyFileSync(path.join(HERE, 'workflows', file), path.join(dir, '.archon', 'workflows', file));
  }
  if (withCopies) {
    for (const skill of COPIES) fs.cpSync(path.join(HERE, 'plugin', 'skills', skill), path.join(dir, '.claude', 'skills', skill), { recursive: true });
  }
  const git = (...a) => sh('/usr/bin/git', ['-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', ...a], dir);
  await git('init', '-q');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'Seed');
  await git('branch', '-M', 'main');
  await sh('/usr/bin/git', ['init', '-q', '--bare', `${dir}-remote.git`], E4);
  await git('remote', 'add', 'origin', `${dir}-remote.git`);
  await git('push', '-q', 'origin', 'main');
  return dir;
}

async function setup() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  for (const [name, copies] of [['plain', false], ['copies', true]]) {
    if (!fs.existsSync(path.join(E4, `e4-${name}`))) console.log('made', await makeProject(name, copies));
  }
}

// The Claude session transcripts written for runs in this project's worktrees since `since`.
function claudeTranscripts(project, workflow, since) {
  const base = path.join(os.homedir(), '.claude', 'projects');
  // Each run has its own worktree, named for the workflow: <workspace>/worktrees/<workflow>-<number>.
  const key = `wheelhouse-archon-checks-home-workspaces-e4-e4-${project}-remote-worktrees-${workflow}-`;
  const found = [];
  for (const dir of fs.readdirSync(base)) {
    if (!dir.includes(key)) continue;
    for (const file of fs.readdirSync(path.join(base, dir))) {
      if (!file.endsWith('.jsonl')) continue;
      const full = path.join(base, dir, file);
      const stat = fs.statSync(full);
      if (stat.mtimeMs >= since) found.push({ full, dir, birth: stat.birthtimeMs });
    }
  }
  return found.sort((a, b) => a.birth - b.birth);
}

async function item(workflow, project) {
  const { env, bin } = engine();
  const cwd = path.join(E4, `e4-${project}`);
  const started = Date.now();
  const launched = await archonRun(['workflow', 'run', workflow, `check 77 ${workflow}`, '--detach'], { env, bin, cwd, timeoutMs: 120000 });
  const id = /Run id:\s*(\S+)/.exec(launched.stdout)?.[1] ?? launched.json?.runId;
  if (!id) throw new Error(`no run id: ${launched.stdout}\n${launched.stderr}`);
  console.log('run', id);
  await archonRun(['workflow', 'wait', id], { env, bin, cwd, timeoutMs: 1500000 });
  const got = await archonRun(['workflow', 'get', id, '--json', '--verbose'], { env, bin, cwd, timeoutMs: 120000 });
  const out = path.join(EVIDENCE, workflow);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'record.json'), got.stdout);
  // Archon keys the workspace by the remote's owner and name: here the folder `e4` and the bare remote.
  const log = path.join(ROOT, 'home', 'workspaces', 'e4', `e4-${project}-remote`, 'logs', `${id}.jsonl`);
  if (fs.existsSync(log)) fs.copyFileSync(log, path.join(out, 'archon-log.jsonl'));
  const sessions = claudeTranscripts(project, workflow, started);
  sessions.forEach((s, i) => fs.copyFileSync(s.full, path.join(out, `session-${i + 1}.jsonl`)));
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ id, workflow, project, started, ended: Date.now(), sessions: sessions.map((s) => s.full) }, null, 2));
  const record = got.json ?? {};
  console.log(JSON.stringify({ status: record.status, error: record.metadata?.error, seconds: Math.round((Date.now() - started) / 1000), sessions: sessions.length }));
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

function report() {
  const rows = [];
  for (const workflow of fs.existsSync(EVIDENCE) ? fs.readdirSync(EVIDENCE).sort() : []) {
    const dir = path.join(EVIDENCE, workflow);
    const record = readJson(path.join(dir, 'record.json')) ?? {};
    const meta = readJson(path.join(dir, 'meta.json')) ?? {};
    const sessions = fs.readdirSync(dir).filter((f) => f.startsWith('session-')).sort();
    const nodes = (record.nodes ?? []).map((n) => ({ node: n.nodeId, state: n.state, tokens: n.execution?.spend?.tokens?.value ?? null, cost: n.execution?.spend?.costUsd?.value ?? null, model: n.execution?.binding?.model?.requested ? 'set' : undefined }));
    const perSession = sessions.map((f) => {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      return { file: f, tokens: sessionTokens(text), skills: skillsOpened(text), testFirst: testFirst(text), suite: suiteRuns(text, 'bun test'), suiteOrCheck: suiteRuns(text, ['bun test', 'sh check.sh']), asked: askedAPerson(text), tools: toolCalls(text).map((c) => c.name).join(',') };
    });
    rows.push({ workflow, status: record.status, seconds: meta.ended ? Math.round((meta.ended - meta.started) / 1000) : null, cost: record.metadata?.total_cost_usd, nodes, rounds: tokensPerRound(record, Object.fromEntries((meta.sessions ?? []).map((full, i) => [path.basename(full, '.jsonl'), fs.readFileSync(path.join(dir, `session-${i + 1}.jsonl`), 'utf8')]))), perSession });
  }
  console.log(JSON.stringify(rows, null, 2));
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'setup') return setup();
  if (command === 'item') return item(rest[0], rest[1] ?? 'plain');
  if (command === 'report') return report();
  if (command === 'clean') return cleanScratch(E4);
  console.log('usage: run.js setup | item <workflow> <plain|copies> | report | clean');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
