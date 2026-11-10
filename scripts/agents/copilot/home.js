// scripts/agents/copilot/home.js
// Builds the agents a Copilot session's clean home holds: the builder, reviewer, tester and foreman (with the one command
// the foreman may run, in a record beside it), from the same
// playbooks as Claude Code's (agents/ and skills/foreman), so there is one text. Each is given Copilot's names and front
// matter, with Claude Code's tool words mapped to Copilot's by one table. The home's skills are the pinned kits' (kits.js)
// and nothing else of Wheelhouse's; its hooks are written with the session (adapters/copilot/hooks.js), and the sessions part
// copies the agents here into each session's home (adapters/copilot/home/agents).
//
//   node scripts/agents/copilot/home.js           prints the paths that differ from adapters/copilot/home/, exit 1 if any
//   node scripts/agents/copilot/home.js --write   replaces adapters/copilot/home/ with what the build gives
//   --tree                                        builds from the working tree, edits not yet committed included
//   --ref <ref>                                   builds from a clean checkout of that commit (default HEAD)
//   --root <folder>                               builds from, and writes under, another copy of the tree (the tests use it)
//
// The default is a clean checkout: only what the repository holds at the commit is read, so an edit not yet committed, or a
// file that isn't tracked, never reaches a session's home.
//
// The home is plain text and byte-stable: LF line endings, paths in order, every file ending in one newline.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tools from '../../../adapters/copilot/tools.js';
import { safeGit } from '../../lib/safe-git.js';
import { startedAsScript } from '../../lib/started-as-script.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const HOME_DIR = 'adapters/copilot/home';
const BUILD_COMMAND = 'npm run copilot-home';

// The names Claude Code gives its tools, in backticks, become Copilot's. Each name maps to the list of Copilot tools it
// grants. Bash is the shell on either system, so it is both of tools.shell (`bash` and, on Windows, `powershell`). In running
// text a name becomes the first of its list.
export const CLAUDE_TO_COPILOT = Object.freeze({
  Read: Object.freeze(['view']),
  Grep: Object.freeze(['rg']),
  Glob: Object.freeze(['glob']),
  Bash: Object.freeze([...tools.shell]),
  WebFetch: Object.freeze(['web_fetch']),
});
// Every Claude Code tool name a playbook might put in backticks. One with no entry above is an error, not a pass.
const CLAUDE_TOOL_NAMES = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'NotebookRead', 'LS'];
// Words that belong to Claude Code alone. A built file naming one is an error.
const CLAUDE_ONLY_NAMES = ['AskUserQuestion', 'PushNotification', 'ToolSearch', 'SendMessage', 'CLAUDE_PLUGIN_ROOT'];

// The project's rules files, as Copilot reads them. Copilot reads AGENTS.md and .github/copilot-instructions.md (and
// CLAUDE.md, but a person on Copilot may have none).
const AGENTS_MD = '`AGENTS.md`';
const INSTRUCTIONS_MD = '`.github/copilot-instructions.md`';
const RULES_PHRASES = Object.freeze([
  ['(`CLAUDE.md` and any file it points to)', `(the rules files, such as ${AGENTS_MD} and ${INSTRUCTIONS_MD}, and any file they point to)`],
  ['`CLAUDE.md` and the files it points to', `the rules files (such as ${AGENTS_MD} and ${INSTRUCTIONS_MD}) and the files they point to`],
]);

// What the reviewer may use, in Copilot's names (check 66's route b): view, glob and rg, and not the whole of tools.read,
// which holds more than reading files and searching them. The builder reads, edits and runs commands.
const REVIEWER_TOOLS = Object.freeze(['view', 'glob', 'rg']);
const BUILDER_TOOLS = Object.freeze(['view', 'glob', 'rg', ...tools.edit, ...tools.shell]);

// The explicit list of sources. A source missing from the tree is an error, never skipped.
const AGENT_SOURCES = Object.freeze(['builder', 'reviewer', 'tester']);
const FOREMAN_SOURCE = 'skills/foreman/SKILL.md';
// The record of the one command the foreman may run (JSON has no comments, so it carries no path comment).
export const FOREMAN_RULES = 'rules/wheelhouse-foreman.json';
export const SOURCES = Object.freeze([...AGENT_SOURCES.map((agent) => `agents/${agent}.md`), FOREMAN_SOURCE]);

// ---- Reading the sources ----

function readSource(root, rel) {
  try {
    return fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8').replaceAll('\r\n', '\n');
  } catch (error) {
    throw new Error(`The Copilot home can't be built: the source ${rel} can't be read (${error.code ?? error.message})`, { cause: error });
  }
}

// A source's front matter (single-line `key: value` fields) and its body.
function parse(text, rel) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${rel} has no front matter`);
  const front = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z-]+):[ \t]*(.*)$/.exec(line);
    if (!kv) throw new Error(`${rel}: front matter line "${line}" is not "key: value"`);
    front[kv[1]] = kv[2].trim();
  }
  return { front, body: m[2] };
}

// The body without its own path comment (its first line), which the built file replaces with its own.
function withoutPathComment(body, rel) {
  const m = /^\n?<!--[^\n]*-->\n/.exec(body);
  if (!m) throw new Error(`${rel} does not start, after its front matter, with its path comment`);
  return body.slice(m[0].length);
}

// ---- Turning the text into Copilot's ----

// Backticked Claude Code tool names to Copilot's, by the one table; a name with no entry throws.
function mapToolWords(text, rel) {
  return text.replace(new RegExp(`\`(${CLAUDE_TOOL_NAMES.join('|')})\``, 'g'), (_, name) => {
    if (!Object.hasOwn(CLAUDE_TO_COPILOT, name)) throw new Error(`${rel} names \`${name}\`, which CLAUDE_TO_COPILOT has no entry for`);
    return `\`${CLAUDE_TO_COPILOT[name][0]}\``;
  });
}

// Skills name each other with a colon in Claude Code (`wheelhouse:intake`) and by their Copilot names here.
const renameSkills = (text) => text.replace(/\bwheelhouse:([a-z][a-z-]*)/g, 'wheelhouse-$1');

function mapRulesFiles(text) {
  let out = text;
  for (const [from, to] of RULES_PHRASES) out = out.replaceAll(from, to);
  return out;
}

const q = (value) => JSON.stringify(value);
const list = (values) => `[${values.map(q).join(', ')}]`;

// A built file: front matter, then its path comment straight after, then the rest.
function assemble({ file, source, front, rest }) {
  const lines = Object.entries(front).map(([key, value]) => `${key}: ${Array.isArray(value) ? list(value) : q(value)}`);
  const text = `---\n${lines.join('\n')}\n---\n<!-- ${HOME_DIR}/${file} (built from ${source} by ${BUILD_COMMAND}) -->\n${rest}`;
  for (const name of CLAUDE_ONLY_NAMES) if (text.includes(name)) throw new Error(`${file} names ${name}`);
  return text.endsWith('\n') ? text : `${text}\n`;
}

// The items of a Claude Code `tools` or `allowed-tools` line, each { name, pattern }: `Bash(node '...':*)` is the name Bash
// with the pattern `node '...':*`, which limits it to that command; a bare name has the pattern null.
function itemsOf(line) {
  const raw = [];
  let depth = 0;
  let current = '';
  for (const ch of line) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { raw.push(current); current = ''; } else current += ch;
  }
  raw.push(current);
  return raw.map((n) => n.trim()).filter(Boolean).map((item) => {
    const m = /^([A-Za-z]+)(?:\(([\s\S]*)\))?$/.exec(item);
    if (!m) throw new Error(`"${item}" is not a tool a playbook may grant`);
    return { name: m[1], pattern: m[2] ?? null };
  });
}

// Copilot names for the tools a Claude Code `tools` line grants, through the one table. A bracketed pattern is refused: Copilot's
// agent file names tools whole, so keeping the name alone would widen `Bash(node '...':*)` to the whole shell.
function grantedTools(line, rel) {
  const out = [];
  for (const { name, pattern } of itemsOf(line)) {
    if (pattern !== null) throw new Error(`${rel} grants ${name} only for a pattern, which an agent file can't carry; it would be widened to every ${name} command`);
    if (!Object.hasOwn(CLAUDE_TO_COPILOT, name)) throw new Error(`${rel} grants ${name}, which CLAUDE_TO_COPILOT has no entry for`);
    for (const tool of CLAUDE_TO_COPILOT[name]) if (!out.includes(tool)) out.push(tool);
  }
  return out;
}

// The foreman's grant is Bash for one command, and nothing else. Its agent file holds no tool, so it can't run the shell
// whole; the command goes in a record beside it (`rules/wheelhouse-foreman.json`) for the sessions part to turn into the
// session's allow rule. `${CLAUDE_PLUGIN_ROOT}` is the folder Wheelhouse is in, which only the session knows.
const ROOT_WORD = '${CLAUDE_PLUGIN_ROOT}';
function foremanRule(line, rel) {
  const items = itemsOf(line);
  if (items.length === 0 || items.some((i) => i.name !== 'Bash' || i.pattern === null)) throw new Error(`${rel}'s allowed-tools must be Bash for a command pattern and nothing else`);
  return {
    agent: 'wheelhouse-foreman',
    shell: [...CLAUDE_TO_COPILOT.Bash],
    allow: items.map((i) => i.pattern.replaceAll(ROOT_WORD, '<wheelhouse-root>')),
  };
}

function agentFrom(root, agent) {
  const source = `agents/${agent}.md`;
  const { front, body } = parse(readSource(root, source), source);
  const file = `agents/wheelhouse-${agent}.agent.md`;
  let granted;
  if (agent === 'reviewer') {
    // Check 66, route b: the reviewer reads and searches. The source has to say the same.
    granted = [...REVIEWER_TOOLS];
    const fromSource = grantedTools(front.tools ?? '', source);
    if ([...fromSource].sort().join() !== [...granted].sort().join()) throw new Error(`${source}'s tools (${fromSource.join(', ')}) are not the reviewer's reading and searching tools`);
  } else if (front.tools) {
    granted = grantedTools(front.tools, source);
  } else {
    granted = [...BUILDER_TOOLS];
  }
  const rest = renameSkills(mapRulesFiles(mapToolWords(withoutPathComment(body, source), source)));
  if (/CLAUDE\.md/.test(rest)) throw new Error(`${source} still names CLAUDE.md after mapping`);
  return [file, assemble({ file, source, front: { name: `wheelhouse-${agent}`, description: front.description, tools: granted }, rest })];
}

// The foreman's prompt is the foreman playbook's body. Its agent file holds no tool; what it may run is in its rule record.
function foremanFrom(root) {
  const { front, body } = parse(readSource(root, FOREMAN_SOURCE), FOREMAN_SOURCE);
  const file = 'agents/wheelhouse-foreman.agent.md';
  if (!front['allowed-tools']) throw new Error(`${FOREMAN_SOURCE} has no allowed-tools to give the foreman agent its rule`);
  const rule = foremanRule(front['allowed-tools'], FOREMAN_SOURCE);
  const rest = renameSkills(mapToolWords(withoutPathComment(body, FOREMAN_SOURCE), FOREMAN_SOURCE));
  return [
    [file, assemble({ file, source: FOREMAN_SOURCE, front: { name: 'wheelhouse-foreman', description: front.description, tools: [] }, rest })],
    [FOREMAN_RULES, `${JSON.stringify(rule, null, 2)}\n`],
  ];
}

// ---- The manifest ----

// What `git hash-object` prints for a file with these bytes: sha1 of "blob <bytes>\0<content>".
export function gitBlobHash(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function manifestOf(files) {
  return `${[...files.keys()].sort().map((file) => `${gitBlobHash(files.get(file))} ${file}`).join('\n')}\n`;
}

// ---- The home ----

// The home as a map from relative path to text, paths in order, built from the tree at `root`. Throws when a source
// can't be read.
export function buildHome({ root = REPO } = {}) {
  const files = new Map();
  for (const entry of [...AGENT_SOURCES.map((agent) => agentFrom(root, agent)), ...foremanFrom(root)]) files.set(entry[0], entry[1]);
  files.set('MANIFEST.txt', manifestOf(files));
  return new Map([...files.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

// A clean checkout of the sources at `ref`: each one read from the repository's own object store, never the working tree,
// into a new folder, through the fenced git route (scripts/lib/safe-git.js; the repository is read, never changed). Gives
// { root, remove }. A source the commit doesn't hold throws.
export async function cleanCheckout({ ref = 'HEAD', repo = REPO } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref)) throw new Error(`${JSON.stringify(ref)} isn't a commit name`);
  // The fence alone, with no look at the repository's settings: this reads one blob by `show <ref>:<path>`, which runs no filter,
  // hook or program, and a developer's checkout often holds settings (a branch's base) that the look would refuse it for.
  const git = safeGit({ cwd: repo, look: 'never' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-copilot-checkout-'));
  const remove = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    for (const rel of SOURCES) {
      const shown = await git(['show', `${ref}:${rel}`]);
      if (shown.code !== 0) throw new Error(`The Copilot home can't be built: ${ref} holds no ${rel}`);
      const target = path.join(root, ...rel.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, shown.stdout);
    }
  } catch (error) {
    remove();
    throw error;
  }
  return { root, remove };
}

// The home built from a clean checkout of `ref`.
export async function buildCleanHome({ ref = 'HEAD', repo = REPO } = {}) {
  const checkout = await cleanCheckout({ ref, repo });
  try {
    return buildHome({ root: checkout.root });
  } finally {
    checkout.remove();
  }
}

// ---- Checking and writing ----

function committedFiles(dir) {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.set(path.relative(dir, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8').replaceAll('\r\n', '\n'));
    }
  };
  walk(dir);
  return out;
}

// The repository-relative paths where the home under `root` differs from `built`: missing, changed or extra.
export function differences(built, { root = REPO } = {}) {
  const have = committedFiles(path.join(root, ...HOME_DIR.split('/')));
  const differ = new Set();
  for (const [file, text] of built) if (have.get(file) !== text) differ.add(file);
  for (const file of have.keys()) if (!built.has(file)) differ.add(file);
  return [...differ].sort().map((file) => `${HOME_DIR}/${file}`);
}

// The paths where the committed home differs from what buildHome gives the tree at `root`.
export const checkHome = ({ root = REPO } = {}) => differences(buildHome({ root }), { root });

// Replaces the home's folder under `root` with the map. Returns the paths written.
export function writeHome({ root = REPO, built = buildHome({ root }) } = {}) {
  const dir = path.join(root, ...HOME_DIR.split('/'));
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [file, text] of built) {
    const target = path.join(dir, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return [...built.keys()];
}

async function main(argv) {
  const value = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const root = value('--root') === undefined ? REPO : path.resolve(value('--root'));
  // --root and --tree read a tree as it stands; otherwise the sources come from a clean checkout of the commit.
  const fromTree = argv.includes('--tree') || value('--root') !== undefined;
  const built = fromTree ? buildHome({ root }) : await buildCleanHome({ ref: value('--ref') ?? 'HEAD', repo: REPO });
  if (argv.includes('--write')) {
    const written = writeHome({ root, built });
    process.stdout.write(`Wrote ${written.length} files to ${HOME_DIR}\n`);
    return 0;
  }
  const differ = differences(built, { root });
  if (differ.length > 0) process.stdout.write(`${differ.join('\n')}\n`);
  return differ.length > 0 ? 1 : 0;
}

if (startedAsScript(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
