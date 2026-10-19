// scripts/eval/front-desk.js
// What the build loop's front desk scenarios share (tests/eval/build-loop/25,
// 26, 27's route leg and 35): setting a scratch project up as the project's
// main checkout, where the front desk works, with state already holding what
// the scenario needs; and reading what the session did from its stream-json
// events, its files and the state it wrote to.
//
// The set-up: the project's files committed on `main`; a feature's worktree
// under .claude/worktrees/ when the scenario has one building; a stand-in
// helper (stand-in-helper.js) on a socket in a Wheelhouse home of its own,
// reached through WHEELHOUSE_HOME, whose state starts with the scenario's
// events; and the session's local allow rules. **With Wheelhouse** a scratch
// plugin named `wheelhouse` holds the intake skill (skills/intake/SKILL.md),
// the card lines (scripts/state/card-lines.js) and the front desk's command
// (scripts/frontdesk/cli.js, running the stand-in in front-desk-command.js),
// and the session's system prompt says it is Wheelhouse's front desk: the
// front desk plan's playbook and session-start line that will say so are not
// built yet. **Without**, no plugin of Wheelhouse's and a plain prompt.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ATTRIBUTION_OFF } from '../protection/settings.js';
import { helperAddress } from '../lib/paths.js';
import { briefHash } from '../feature/files.js';
import { locateSuperpowers } from './harness.js';
import { plainEvent, startStandInHelper } from './stand-in-helper.js';
import { REPO_ROOT, callsOf, filesWritten } from './feature-project.js';
import { assertUnderTmp } from '../../probes/lib/scratch.js';

export { briefHash };

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

const PROJECT_FILES = {
  '.gitignore': '.wheelhouse/\n.superpowers/\n.claude/settings.local.json\n.claude/worktrees/\nnode_modules/\n',
};

// What the session may run without asking, in the project's local settings (claude -p ignores
// allow rules in a committed .claude/settings.json; check 25), and, with Wheelhouse, reading
// the scratch plugin's files (the card lines), as the real plugin's would be read.
function allowRules(plugin) {
  const allow = ['Bash(git *)', 'Bash(node *)', 'Bash(npm *)', 'Bash(ls *)', 'Bash(mkdir *)', 'Bash(pwd)'];
  if (plugin) {
    // An absolute path in a Read rule starts with two slashes; the temporary folder has two spellings on macOS.
    for (const at of new Set([plugin, realOr(plugin)])) allow.push(`Read(/${at.split(path.sep).join('/')}/**)`);
  }
  try {
    const skills = path.join(locateSuperpowers(), 'skills');
    allow.push(`Bash(${skills}/*)`, `Bash(bash ${skills}/*)`);
  } catch { /* Superpowers is not installed here; the run itself will say so */ }
  return allow;
}

// An event the state holds when the run starts, made as the helper makes one, at `at`.
export function seedEvent(kind, data, at) {
  return plainEvent(kind, data, new Date(at));
}

// The system prompts. Each is one line with no double quotes (see runSession).
export function frontDeskPrompt(pluginRoot) {
  const cli = path.join(pluginRoot, 'scripts', 'frontdesk', 'cli.js');
  const lines = path.join(pluginRoot, 'scripts', 'state', 'card-lines.js');
  return [
    'You are Wheelhouse\'s front desk for this project: the one session the director, its product owner, talks to.',
    'Use the wheelhouse:intake skill on every message from the director, before replying and before any other skill.',
    `Your commands, each run on its own from the project's folder and written out in full, with no shell variables: node '${cli}' similar '<one request>' (the intake's duplicate check over open work, ideas and rejections);`,
    `node '${cli}' views [work|ideas|rejections|questions] (what the project's state holds);`,
    `node '${cli}' record <kind> '<data as JSON>' (records a plain event in the project's state, such as work, amendment, idea or incident; run the command with no arguments to see what each carries);`,
    `node '${cli}' hash <file> (the hash a work event's doc or an amendment names for a document).`,
    `The cards' lines are in ${lines}. This session has no card tool yet: put each card to the director in your reply, its line first, word for word.`,
  ].join(' ');
}

export const PLAIN_PROMPT = 'You help the director, this project\'s product owner, with the project.';

// Sets `dir`, the scratch project, up as the project's main checkout for the front desk, and
// starts the stand-in helper. Options:
//   files       the project's files, { relative: text }, committed on main
//   seed        the events the state holds when the run starts (seedEvent)
//   approved    { work: hash }: work the director approved before the run (standInViews)
//   worktree    null, or { work, files }: a feature building in .claude/worktrees/<work>,
//               on feature/<work>, its files committed there
// Resolves with the context runScenario takes: { env, pluginDirs, appendSystemPrompt, helper,
// seededIds, evidence, close }.
export async function setUpFrontDesk(dir, variant, { files = {}, seed = [], approved = {}, worktree = null } = {}) {
  assertUnderTmp(dir);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-eval-'));
  assertUnderTmp(root);
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });

  let helper = null;
  const close = async () => {
    try {
      await helper?.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  try {
    git(dir, 'branch', '-M', 'main');
    for (const [relative, content] of Object.entries({ ...PROJECT_FILES, ...files })) write(dir, relative, content);
    git(dir, 'add', '--all');
    git(dir, 'commit', '--quiet', '-m', 'The project so far');

    if (worktree) {
      const at = path.join(dir, '.claude', 'worktrees', worktree.work);
      git(dir, 'worktree', 'add', '--quiet', '-b', `feature/${worktree.work}`, at, 'main');
      for (const [relative, content] of Object.entries(worktree.files ?? {})) write(at, relative, content);
      git(at, 'add', '--all');
      git(at, 'commit', '--quiet', '-m', 'Build task 1');
    }
    const pluginDirs = [];
    let appendSystemPrompt = PLAIN_PROMPT;
    const plugin = variant === 'with' ? path.join(root, 'plugin') : null;
    if (plugin) fs.mkdirSync(plugin, { recursive: true });
    write(dir, '.claude/settings.local.json', `${JSON.stringify({ permissions: { allow: allowRules(plugin) }, ...ATTRIBUTION_OFF }, null, 2)}\n`);
    if (plugin) {
      write(plugin, '.claude-plugin/plugin.json', `${JSON.stringify({ name: 'wheelhouse', version: '0.0.0', description: 'Wheelhouse\'s front desk: the intake, for one evaluation run.' }, null, 2)}\n`);
      write(plugin, 'skills/intake/SKILL.md', fs.readFileSync(path.join(REPO_ROOT, 'skills', 'intake', 'SKILL.md'), 'utf8'));
      write(plugin, 'scripts/state/card-lines.js', fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'state', 'card-lines.js'), 'utf8'));
      const command = pathToFileURL(path.join(REPO_ROOT, 'scripts', 'eval', 'front-desk-command.js')).href;
      write(plugin, 'scripts/frontdesk/cli.js', `// scripts/frontdesk/cli.js\nimport { main } from '${command}';\nmain(process.argv.slice(2)).then((code) => { process.exitCode = code; });\n`);
      pluginDirs.push(plugin);
      appendSystemPrompt = frontDeskPrompt(plugin);
    }

    const address = process.platform === 'win32' ? helperAddress() : path.join(home, 'helper.sock');
    helper = await startStandInHelper({ address, state: { events: seed, approved } });
    const seededIds = new Set(seed.map((e) => e.id));
    const evidence = () => ({ helper: helper.records(), written: helper.events().filter((e) => !seededIds.has(e.id)) });
    return { env: { WHEELHOUSE_HOME: home }, pluginDirs, appendSystemPrompt, helper, seededIds, evidence, close };
  } catch (error) {
    await close();
    throw error;
  }
}

// ------------------------------------------------------------ reading a run

// The events the session wrote to the state: everything the state holds that it did not start with.
export function writtenEvents(context) {
  const seeded = context?.seededIds ?? new Set();
  return (context?.helper?.events() ?? []).filter((e) => !seeded.has(e.id));
}

function blocks(event) {
  const content = event?.message?.content;
  return Array.isArray(content) ? content : [];
}

// What the main session said to the director: its text, every turn, in order.
export function replyText(events) {
  return events
    .filter((event) => event.type === 'assistant' && !event.parent_tool_use_id)
    .flatMap((event) => blocks(event).filter((block) => block.type === 'text').map((block) => block.text))
    .join('\n\n');
}

function strings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

// What the main session composed: its reply text and every text in its own tool calls' input.
export function composedText(events) {
  const inputs = callsOf(events).filter((call) => !call.subagent).flatMap((call) => strings(call.input));
  return [replyText(events), ...inputs].join('\n');
}

// The skills a call started (`Skill`), by name.
export function skillsStarted(calls) {
  return calls.filter((call) => call.name === 'Skill').map((call) => String(call.input.skill ?? call.input.command ?? ''));
}

const CODE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/;

const realOr = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

// `file` relative to the project `dir`, or null when it is outside it. The temporary folder
// has two spellings on macOS (/var and /private/var), so each side is tried both ways.
export function inProject(dir, file) {
  const full = path.resolve(dir, String(file));
  for (const base of [dir, realOr(dir)]) {
    for (const target of [full, realOr(full), path.join(realOr(path.dirname(full)), path.basename(full))]) {
      const relative = path.relative(base, target);
      if (relative === '') return '.';
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
    }
  }
  return null;
}
// The front desk's own papers and tools: never the product's code. A feature's worktree under
// .claude/worktrees/ is the product's code, though .claude/ is not.
const PAPERS = /(?:^|[\\/])(?:\.wheelhouse|\.superpowers|docs|node_modules)[\\/]/;

// A code file of the product inside the project (a test file included): not one of the
// session's papers, and not a file outside the project such as the plugin's scripts.
export function isProductCode(file, dir) {
  if (typeof file !== 'string' || !CODE.test(file)) return false;
  const relative = inProject(dir, file);
  if (relative === null) return false;
  if (PAPERS.test(relative)) return false;
  if (/^\.claude[\\/]/.test(relative) && !/^\.claude[\\/]worktrees[\\/]/.test(relative)) return false;
  return true;
}

// The product's code files the session or its subagents wrote.
export function codeWrites(calls, dir) {
  return calls.flatMap((call) => filesWritten(call).filter((file) => isProductCode(file, dir)));
}

// The product's code files the session read: Read, a Grep or Glob over code, or a shell
// command that shows a code file (cat, head, tail, less, sed -n, grep).
export function codeReads(calls, dir) {
  const read = [];
  for (const call of calls) {
    if (call.name === 'Read' && isProductCode(String(call.input.file_path ?? ''), dir)) read.push(String(call.input.file_path));
    if (call.name === 'Grep' || call.name === 'Glob') {
      const where = inProject(dir, String(call.input.path ?? dir));
      const target = `${call.input.glob ?? ''} ${call.input.type ?? ''} ${call.input.pattern ?? ''}`;
      if (where !== null && !PAPERS.test(`${where}/`) && /\bjs\b|\.[cm]?[jt]sx?\b|\*\*/.test(target)) read.push(`${call.name} ${target.trim()}`);
    }
    if (call.name === 'Bash' && typeof call.input.command === 'string') {
      const command = call.input.command;
      if (/\b(?:cat|head|tail|less|grep|rg|sed\s+-n)\b/.test(command)) {
        // A word that sets a shell variable (C=/path/cli.js) names a file by what follows the =.
        for (const m of command.matchAll(/(?:^|[\s"'=])([^\s"'|;&<>=]+\.(?:[cm]?js|jsx|[cm]?ts|tsx))(?![\w.])/g)) if (isProductCode(m[1], dir)) read.push(m[1]);
      }
    }
  }
  return read;
}

// Shell commands that build or test the product.
export const BUILD_COMMAND = /\bnpm\s+(?:run\s+\S+|test|install|ci|i)\b|\bnode\s+--test\b|\bnpx\s+\S+|\bpnpm\b|\byarn\b/;
export const buildCommands = (calls) => calls.filter((call) => call.name === 'Bash' && BUILD_COMMAND.test(String(call.input.command ?? '')));

// Subagents sent to build: Wheelhouse's builder, or any other sent to implement, build or fix.
export function buildDispatches(calls) {
  return calls.filter((call) => (call.name === 'Agent' || call.name === 'Task')
    && (call.input.subagent_type === 'wheelhouse:builder' || /\b(?:implement|build|fix|code)\b/i.test(`${call.input.description ?? ''}`)));
}

// The paragraphs of a text: split on blank lines and headings.
export function paragraphs(text) {
  return String(text).split(/\n\s*\n|\n(?=#{1,6}\s|\*\*\d|\d+\.\s)/).map((p) => p.trim()).filter(Boolean);
}

// Whether `route` (a pattern) is said about a request (a pattern of its words): in a paragraph
// that names the request, or the paragraph after it.
export function saidAbout(text, request, route) {
  const parts = paragraphs(text);
  return parts.some((part, i) => request.test(part) && (route.test(part) || (i + 1 < parts.length && route.test(parts[i + 1]))));
}

// A document the session left in the project whose hash is `hash`, or null.
export function documentWithHash(dir, hash) {
  const visit = (folder, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory() && depth < 6) {
        const found = visit(full, depth + 1);
        if (found) return found;
      } else if (entry.isFile() && /\.(?:md|txt)$/.test(entry.name)) {
        if (briefHash(fs.readFileSync(full, 'utf8')) === hash) return path.relative(dir, full);
      }
    }
    return null;
  };
  return typeof hash === 'string' && hash !== '' ? visit(dir, 0) : null;
}

// The hash of a project file as it stands, or null.
export function hashOfFile(dir, relative) {
  try {
    return briefHash(fs.readFileSync(path.resolve(dir, relative), 'utf8'));
  } catch {
    return null;
  }
}

// The same path, relative to the project, whichever way the session wrote it.
export function sameFile(dir, a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = inProject(dir, a);
  return left !== null && left === inProject(dir, b);
}
