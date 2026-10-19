// scripts/eval/feature-project.js
// What the build loop's evaluation scenarios share (tests/eval/build-loop/):
// setting a scratch project up as a feature session's worktree, and reading
// what the session did from its stream-json events, its files and git.
//
// The set-up: a main checkout on `main` in a folder of its own, and the
// scenario's scratch project made into a linked worktree of it on
// `feature/<work>`, as the foreman makes one; the plan, the brief and the
// session's local allow rules; a stand-in helper (stand-in-helper.js) on a
// socket in a Wheelhouse home of its own, which the session reaches through
// WHEELHOUSE_HOME; and, when asked for, a scratch plugin named `wheelhouse`
// that holds only agents, so `wheelhouse:builder` and `wheelhouse:reviewer`
// resolve without the plugin's hooks, which need a real home. The `with`
// brief is the brief scripts/feature/brief.js renders (the override first);
// the `without` brief is the scenario's own plain text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderBrief } from '../feature/brief.js';
import { ATTRIBUTION_OFF } from '../protection/settings.js';
import { helperAddress } from '../lib/paths.js';
import { locateSuperpowers } from './harness.js';
import { startStandInHelper } from './stand-in-helper.js';
import { assertUnderTmp } from '../../probes/lib/scratch.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FEATURE = '.wheelhouse/feature';

// The repository's own agent files, read when a scenario wants them in its scratch plugin.
export function agentText(name) {
  return fs.readFileSync(path.join(REPO_ROOT, 'agents', `${name}.md`), 'utf8');
}

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=Wheelhouse eval', '-c', 'user.email=eval@wheelhouse.invalid', ...args], {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(root, relative, content) {
  const file = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

// What the session may run without asking, in the worktree's local settings
// (claude -p ignores allow rules in a committed .claude/settings.json; check 25).
// The scratch repositories have no remote, so git, node and npm are allowed whole.
function allowRules() {
  const allow = ['Bash(git *)', 'Bash(node *)', 'Bash(npm *)', 'Bash(ls *)', 'Bash(mkdir *)', 'Bash(pwd)'];
  try {
    const skills = path.join(locateSuperpowers(), 'skills');
    allow.push(`Bash(${skills}/*)`, `Bash(bash ${skills}/*)`);
  } catch { /* Superpowers is not installed here; the run itself will say so */ }
  return allow;
}

const PROJECT_FILES = {
  'package.json': `${JSON.stringify({ name: 'eval-project', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
  '.gitignore': '.wheelhouse/\n.superpowers/\n.claude/settings.local.json\nnode_modules/\n',
  'README.md': '# Eval project\n\nA throwaway project for one evaluation run.\n',
};

// Sets `dir` up as a feature session's worktree and starts the stand-in helper.
// Options:
//   work, lane          the brief's work slug and lane
//   goal, done          the brief's goal and done contract (a list)
//   plan                { path, text }: the plan, written in the worktree and named by the brief
//   files               more files for the main checkout's first commit, { relative: text }
//   branchFiles         files committed on the feature branch before the session starts
//   brief               'wheelhouse' for the rendered brief, or the plain text of a brief
//   agents              null, or { name: text } for the scratch plugin's agents/<name>.md
//   routing             the brief's models by role, { role: model } (none by default)
// Resolves with the context runScenario takes: { env, pluginDirs, helper, home, main, evidence, close }.
export async function setUpFeature(dir, {
  work, lane, goal, done, plan, files = {}, branchFiles = {}, brief, agents = null, routing = {},
}) {
  assertUnderTmp(dir);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-eval-'));
  assertUnderTmp(root);
  const home = path.join(root, 'home');
  const main = path.join(root, 'main');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(main, { recursive: true });

  let helper = null;
  const close = async () => {
    try {
      await helper?.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  try {
    // The main checkout, on main, with the project's first commit.
    git(main, 'init', '--quiet', '--initial-branch=main');
    for (const [relative, content] of Object.entries({ ...PROJECT_FILES, ...files })) write(main, relative, content);
    git(main, 'add', '--all');
    git(main, 'commit', '--quiet', '-m', 'The project so far');

    // The scratch project becomes the feature's linked worktree, as the foreman makes one.
    fs.rmSync(dir, { recursive: true, force: true });
    git(main, 'worktree', 'add', '--quiet', '-b', `feature/${work}`, dir, 'main');

    for (const [relative, content] of Object.entries(branchFiles)) write(dir, relative, content);
    if (Object.keys(branchFiles).length > 0) {
      git(dir, 'add', '--all');
      git(dir, 'commit', '--quiet', '-m', 'Build the plan');
    }
    if (plan) write(dir, plan.path, plan.text);

    // The brief and the recorded plan, in the git-ignored feature folder.
    const fields = {
      v: 1, work, lane, version: 1, goal, done, appetite: { sessions: 1, tokens: 3000000 }, rulings: [], routing, shownFirst: false,
      ...(plan ? { plan: plan.path } : {}),
    };
    const text = brief === 'wheelhouse' ? renderBrief({ fields, pluginRoot: REPO_ROOT }) : brief;
    write(dir, `${FEATURE}/brief.md`, text);
    if (plan && brief === 'wheelhouse') write(dir, `${FEATURE}/plan.json`, `${JSON.stringify({ plan: plan.path })}\n`);
    write(dir, '.claude/settings.local.json', `${JSON.stringify({ permissions: { allow: allowRules() }, ...ATTRIBUTION_OFF }, null, 2)}\n`);

    // The scratch plugin, holding agents only.
    const pluginDirs = [];
    if (agents) {
      const plugin = path.join(root, 'plugin');
      write(plugin, '.claude-plugin/plugin.json', `${JSON.stringify({ name: 'wheelhouse', version: '0.0.0', description: 'The agents of Wheelhouse, for one evaluation run.' }, null, 2)}\n`);
      for (const [name, content] of Object.entries(agents)) write(plugin, `agents/${name}.md`, content);
      pluginDirs.push(plugin);
    }

    const address = process.platform === 'win32' ? helperAddress() : path.join(home, 'helper.sock');
    helper = await startStandInHelper({ address, home });
    // What the run's record keeps beside the events: the helper's records and the feature files.
    const evidence = () => ({ helper: helper.records(), questions: questionsIn(dir), ledger: ledgerLines(dir) });
    return { env: { WHEELHOUSE_HOME: home }, pluginDirs, helper, home, main, evidence, close };
  } catch (error) {
    await close();
    throw error;
  }
}

// ------------------------------------------------------------ reading a run

function blocks(event) {
  const content = event?.message?.content;
  return Array.isArray(content) ? content : [];
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n');
}

// Every tool call in the stream: { order, id, name, input, subagent, parent, result },
// where `order` is the index of the event that holds it (calls and subagent
// runs compare by it), `subagent` says a subagent made it, `parent` is the id
// of the dispatch whose subagent made it (null for the session's own) and
// `result` is { text, isError } or null.
export function callsOf(events) {
  const results = new Map();
  for (const event of events) {
    if (event.type !== 'user') continue;
    for (const block of blocks(event)) {
      if (block.type === 'tool_result') results.set(block.tool_use_id, { text: textOf(block.content), isError: block.is_error === true });
    }
  }
  const calls = [];
  events.forEach((event, index) => {
    if (event.type !== 'assistant') return;
    for (const block of blocks(event)) {
      if (block.type !== 'tool_use') continue;
      calls.push({
        order: index,
        id: block.id,
        name: block.name,
        input: block.input ?? {},
        subagent: Boolean(event.parent_tool_use_id),
        parent: event.parent_tool_use_id ?? null,
        result: results.get(block.id) ?? null,
      });
    }
  });
  return calls;
}

const isDispatch = (call) => call.name === 'Agent' || call.name === 'Task';
const commandOf = (call) => (call.name === 'Bash' && typeof call.input.command === 'string' ? call.input.command : '');

// Every run of a subagent, in order: { order, id, type, description, text }.
// A run is a dispatch, or a subagent resumed with SendMessage, which starts it
// again in the background; each shows in the stream as a `task_started` event
// naming the call that started it, and its last words come back in the
// `task_notification` for that call (a foreground dispatch's also in its
// tool result). A stream without those events falls back to the dispatches.
export function subagentRuns(events) {
  const calls = callsOf(events);
  const resultOf = new Map(calls.map((call) => [call.id, call.result?.text ?? null]));
  const summaries = new Map();
  for (const event of events) {
    if (event.type === 'system' && event.subtype === 'task_notification' && typeof event.summary === 'string') summaries.set(event.tool_use_id, event.summary);
  }
  const words = (id) => {
    const result = resultOf.get(id);
    return result && result.includes('WHEELHOUSE REPORT') ? result : summaries.get(id) ?? result ?? null;
  };
  const runs = [];
  events.forEach((event, index) => {
    if (event.type !== 'system' || event.subtype !== 'task_started' || typeof event.tool_use_id !== 'string') return;
    runs.push({ order: index, id: event.tool_use_id, type: event.subagent_type ?? 'general-purpose', description: event.description ?? '', text: words(event.tool_use_id) });
  });
  if (runs.length > 0) return runs;
  return calls.filter(isDispatch).map((call) => ({
    order: call.order, id: call.id, type: call.input.subagent_type ?? 'general-purpose', description: call.input.description ?? '', text: words(call.id),
  }));
}

// The runs of `wheelhouse:reviewer`, in order.
export function reviewerRuns(runs) {
  return runs.filter((run) => run.type === 'wheelhouse:reviewer');
}

// Every run that reviews: `wheelhouse:reviewer`, or any other subagent sent to review.
export function reviewRuns(runs) {
  return runs.filter((run) => run.type === 'wheelhouse:reviewer' || /review/i.test(`${run.description} ${run.type}`));
}

// The WHEELHOUSE REPORT block at the end of an agent's text, as { key: value }, or null.
// The hand-back indents every line, so lines are trimmed.
export function reportBlock(text) {
  if (typeof text !== 'string') return null;
  const at = text.lastIndexOf('WHEELHOUSE REPORT');
  if (at < 0) return null;
  const fields = {};
  for (const line of text.slice(at).split(/\r?\n/).slice(1)) {
    const m = /^\s*([a-z]+):\s*(.*?)\s*$/.exec(line);
    if (!m) break;
    fields[m[1]] = m[2];
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

// The files a call writes: a write tool's file, or a shell command that writes
// into a file by redirect, `tee`, `sed -i` or `cp`/`mv` onto it.
export function filesWritten(call) {
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(call.name)) return [String(call.input.file_path ?? call.input.notebook_path ?? '')];
  if (call.name !== 'Bash' || typeof call.input.command !== 'string') return [];
  const command = call.input.command;
  const found = [];
  for (const m of command.matchAll(/(?:>>?|\btee\s+(?:-a\s+)?)\s*["']?([^\s"'|;&<>]+)/g)) found.push(m[1]);
  if (/\bsed\s+(?:-[a-zA-Z]*i|--in-place)/.test(command)) {
    for (const m of command.matchAll(/([^\s"'|;&<>]+\.[A-Za-z]+)(?=["']?\s*(?:$|[|;&]))/g)) found.push(m[1]);
  }
  for (const m of command.matchAll(/\b(?:cp|mv)\s+(?:-\S+\s+)*\S+\s+["']?([^\s"'|;&<>]+)/g)) found.push(m[1]);
  return found.filter((file) => file !== '/dev/null');
}

// Bash calls that made a commit: a `git … commit` whose output shows the new commit.
export function commitCalls(calls) {
  return calls.filter((call) => /\bgit\b[^\n|;&]*\scommit\b/.test(commandOf(call))
    && call.result && !call.result.isError && /\[[^\]\n]+ [0-9a-f]{7,40}\]/.test(call.result.text));
}

// Bash calls that ran `git merge` (not `git merge-base`, `merge-tree` and the like).
export function mergeCalls(calls) {
  return calls.filter((call) => /\bgit(?:\s+-[Cc]\s+\S+)*\s+merge(?![-\w])/.test(commandOf(call)));
}

// Bash calls that ran one of the feature commands: `cli.js <command>`.
export function cliCalls(calls, command) {
  const pattern = new RegExp(`cli\\.js["']?\\s+${command}(?![-\\w])`);
  return calls.filter((call) => pattern.test(commandOf(call)));
}

// The questions the session wrote, from questions.jsonl.
export function questionsIn(dir) {
  const file = path.join(dir, ...FEATURE.split('/'), 'questions.jsonl');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text.split(/\r?\n/).filter((line) => line.trim()).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

// A question's words, all in one string, for matching.
export function questionText(question) {
  return [question.what, question.why, ...(question.options ?? []).flatMap((o) => [o.label, o.says])].filter(Boolean).join(' ');
}

// The lines of every Superpowers ledger in the worktree (.superpowers/sdd/**/progress.md).
export function ledgerLines(dir) {
  const base = path.join(dir, '.superpowers', 'sdd');
  const lines = [];
  const visit = (folder, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory() && depth < 3) visit(full, depth + 1);
      else if (entry.isFile() && entry.name === 'progress.md') lines.push(...fs.readFileSync(full, 'utf8').split(/\r?\n/));
    }
  };
  visit(base, 0);
  return lines;
}

// The `Ruling:` lines the session left: in its ledgers, its report, its last
// words, and anything it wrote with a tool (a ledger it later deleted included).
export function rulingLines(dir, finalWords = '', calls = []) {
  let report = '';
  try {
    report = fs.readFileSync(path.join(dir, ...FEATURE.split('/'), 'report.md'), 'utf8');
  } catch { /* no report */ }
  const written = calls
    .filter((call) => ['Write', 'Edit', 'MultiEdit', 'Bash'].includes(call.name))
    .flatMap((call) => [call.input.content, call.input.new_string, call.input.command, ...(call.input.edits ?? []).map((e) => e?.new_string)])
    .filter((text) => typeof text === 'string');
  return [...ledgerLines(dir), report, finalWords, ...written]
    .flatMap((text) => text.split(/\r?\n/))
    .filter((line) => /\bRuling:/.test(line));
}

// The commit a branch is at in the worktree, or null.
export function headOf(dir, branch) {
  try {
    return git(dir, 'rev-parse', '--verify', '--quiet', `${branch}^{commit}`) || null;
  } catch {
    return null;
  }
}
