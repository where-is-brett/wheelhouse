// scripts/agents/copilot/home.js
// Builds the Lean kit for Copilot: the skills, agents and instructions that the chat copies into a person's
// ~/.copilot/ where no Node.js runs for them (design sections 6.4 and 8.2). It is built from the same
// playbooks as Claude Code's, so there is one text: the skills and agent prompts are read from skills/ and agents/,
// given Copilot's names and front matter, and have Claude Code's tool words mapped to Copilot's by one table.
//
//   node scripts/agents/copilot/home.js           prints the paths that differ from adapters/copilot/home/, exit 1 if any
//   node scripts/agents/copilot/home.js --write   replaces adapters/copilot/home/ with what buildHome gives
//   --root <folder> builds from, and writes under, another copy of the tree (the tests use it)
//
// The kit is plain text and byte-stable: LF line endings, paths in order, every file ending in one newline.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSheet } from '../../../adapters/copilot/tool-sheet.js';
import tools from '../../../adapters/copilot/tools.js';
import { BOARD_FILE } from '../../lib/copilot-numbers.js';
import { startedAsScript } from '../../lib/started-as-script.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const HOME_DIR = 'adapters/copilot/home';
const BUILD_COMMAND = 'npm run copilot-home';

// Ruling P4-9: the names Claude Code gives its tools, in backticks, become Copilot's.
// Each name maps to the list of Copilot tools it grants. Bash is the shell on either system, so it is both of
// tools.shell (`bash` and, on Windows, `powershell`; ruling P4-19). In running text a name becomes the first of its list.
export const CLAUDE_TO_COPILOT = Object.freeze({
  Read: Object.freeze(['view']),
  Grep: Object.freeze(['rg']),
  Glob: Object.freeze(['glob']),
  Bash: Object.freeze([...tools.shell]),
  WebFetch: Object.freeze(['web_fetch']),
});
// Every Claude Code tool name a playbook might put in backticks. One with no entry above is an error, not a pass.
const CLAUDE_TOOL_NAMES = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'NotebookRead', 'LS'];
// The five names Part 3 moved out of the playbooks.
const PART3_NAMES = ['AskUserQuestion', 'PushNotification', 'ToolSearch', 'SendMessage', 'CLAUDE_PLUGIN_ROOT'];

// Ruling P4-9: the project's rules files, as Copilot reads them. Copilot reads AGENTS.md and
// .github/copilot-instructions.md (and CLAUDE.md, but a person on Copilot may have none).
const AGENTS_MD = '`AGENTS.md`';
const INSTRUCTIONS_MD = '`.github/copilot-instructions.md`';
const RULES_PHRASES = Object.freeze([
  ['(`CLAUDE.md` and any file it points to)', `(the rules files, such as ${AGENTS_MD} and ${INSTRUCTIONS_MD}, and any file they point to)`],
  ['`CLAUDE.md` and the files it points to', `the rules files (such as ${AGENTS_MD} and ${INSTRUCTIONS_MD}) and the files they point to`],
]);

// What each agent may use, in Copilot's names. The reviewer's are check 66's route b and nothing else: not the whole
// of tools.read, which holds more than reading files and searching them. The builder reads, edits and runs commands.
const REVIEWER_TOOLS = Object.freeze(['view', 'glob', 'rg']);
const BUILDER_TOOLS = Object.freeze(['view', 'glob', 'rg', ...tools.edit, ...tools.shell]);

// Ruling P4-8: the explicit list of sources. A source missing from the tree is an error, never skipped.
// `wheelhouse-lean` is Lean's playbook, from skills/lean. `wheelhouse-setup` is setup at Lean, from skills/setup-lean (not
// from skills/setup, whose steps need Node.js).
const PLAYBOOK_SKILLS = Object.freeze([
  { name: 'front-desk', source: 'skills/front-desk/SKILL.md' },
  { name: 'intake', source: 'skills/intake/SKILL.md' },
  { name: 'lean', source: 'skills/lean/SKILL.md' },
  { name: 'setup', source: 'skills/setup-lean/SKILL.md' },
]);
// The words a source holds back for the kit to fill in, so the source stays in general words (the core never names an
// agent). `{{agent}}` is the product the kit is for, where a safety line names it (adapters/copilot/safety-line.js).
const KIT_WORDS = Object.freeze({ agent: 'Copilot' });
const AGENT_SOURCES = Object.freeze(['builder', 'reviewer', 'tester']);
const FOREMAN_SOURCE = 'skills/foreman/SKILL.md';

// The skills the director calls by name. Each points to Lean's playbook for it, since no Wheelhouse program runs at
// Lean to give the front desk's own views (the description is the command's).
const LEAN = '`wheelhouse-lean`';
const COMMAND_SKILLS = Object.freeze({
  board: `Show the director the board: read \`${BOARD_FILE}\` in the project and give it as it is, with nothing added. If it isn't there or can't be read, say only that the board couldn't be read.\n\nLean's playbook (${LEAN}) keeps the board up to date; its section "The board" says how and when.`,
  briefing: `Give the director the briefing now, as ${LEAN} gives it (its section "The briefing"), with nothing added. If you can't build it, say only that the briefing couldn't be read.`,
  settings: `Show the director the settings in force, and where each comes from, as ${LEAN} gives them (its section "Settings"), with nothing added: at Lean they are the tier and its lines at the top of the board, and the folder the copy goes to. If they can't be read, say only that the settings couldn't be read.`,
  sources: `Lean has no weekly check of the sources: it is a Wheelhouse program, and none runs here. Say so in one line, as ${LEAN} does (its section "Sources"), and show nothing else.`,
  stop: `Turn STOP on: start no building, reviewing or merging in this chat until the director lifts it. Only reading, reporting and the runbook carry on. Say in one or two lines what was in progress, then follow the section "STOP" of ${LEAN}: tell the director once that nothing enforces STOP here, and ask the Lift STOP card alone.`,
});

const INSTRUCTIONS_LINE = 'In VS Code\'s Local harness Wheelhouse doesn\'t run: say so and ask the director to switch the chat to Copilot.';

// ---- Reading the sources ----

function readSource(root, rel) {
  try {
    return fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8').replaceAll('\r\n', '\n');
  } catch (error) {
    throw new Error(`The Lean kit can't be built: the source ${rel} can't be read (${error.code ?? error.message})`, { cause: error });
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

// The body without its own path comment (its first line), which the kit replaces with its own.
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

// The words a source holds back (`{{agent}}`) become the kit's own. A word the table lacks is an error, not a pass.
function fillKitWords(text, rel) {
  return text.replace(/\{\{([A-Za-z-]+)\}\}/g, (_, word) => {
    if (!Object.hasOwn(KIT_WORDS, word)) throw new Error(`${rel} holds {{${word}}}, which KIT_WORDS has no entry for`);
    return KIT_WORDS[word];
  });
}

function mapRulesFiles(text) {
  let out = text;
  for (const [from, to] of RULES_PHRASES) out = out.replaceAll(from, to);
  return out;
}

const q = (value) => JSON.stringify(value);
const list = (values) => `[${values.map(q).join(', ')}]`;

function pathComment(file, source) {
  return `<!-- ${HOME_DIR}/${file} (built from ${source} by ${BUILD_COMMAND}) -->`;
}

// A kit file: front matter, then its path comment straight after, then the rest.
function assemble({ file, source, front, rest }) {
  const lines = Object.entries(front).map(([key, value]) => `${key}: ${Array.isArray(value) ? list(value) : q(value)}`);
  const text = `---\n${lines.join('\n')}\n---\n${pathComment(file, source)}\n${rest}`;
  for (const name of PART3_NAMES) if (text.includes(name)) throw new Error(`${file} names ${name}`);
  return text.endsWith('\n') ? text : `${text}\n`;
}

function skillFrom(root, { name, source }) {
  const { front, body } = parse(readSource(root, source), source);
  const file = `skills/wheelhouse-${name}/SKILL.md`;
  const rest = fillKitWords(renameSkills(mapToolWords(withoutPathComment(body, source), source)), source);
  return [file, assemble({ file, source, front: { name: `wheelhouse-${name}`, description: front.description }, rest })];
}

function commandSkillFrom(root, command) {
  const source = `commands/${command}.md`;
  const { front } = parse(readSource(root, source), source);
  const file = `skills/wheelhouse-${command}/SKILL.md`;
  // The pane's build tab is the pane's: "Add "build" to open on the build tab." means nothing in a chat.
  const description = front.description.replace(/ Add "build" to open on the build tab\.$/, '');
  return [file, assemble({ file, source, front: { name: `wheelhouse-${command}`, description }, rest: `\n${COMMAND_SKILLS[command]}\n` })];
}

// Copilot names for the tools a Claude Code `tools` or `allowed-tools` line grants, through the one table.
// `Bash(node '...':*)` grants Bash, which is `bash`; the pattern in the brackets is Claude Code's own packaging.
function grantedTools(line, rel) {
  const names = [];
  let depth = 0;
  let current = '';
  for (const ch of line) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { names.push(current); current = ''; } else current += ch;
  }
  names.push(current);
  const out = [];
  for (const raw of names.map((n) => n.trim()).filter(Boolean)) {
    const name = raw.replace(/\(.*$/s, '').trim();
    if (!Object.hasOwn(CLAUDE_TO_COPILOT, name)) throw new Error(`${rel} grants ${name}, which CLAUDE_TO_COPILOT has no entry for`);
    for (const tool of CLAUDE_TO_COPILOT[name]) if (!out.includes(tool)) out.push(tool);
  }
  return out;
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

// The foreman's prompt is the foreman playbook's body; its tools are what its allowed-tools grant (ruling P4-10).
function foremanFrom(root) {
  const { front, body } = parse(readSource(root, FOREMAN_SOURCE), FOREMAN_SOURCE);
  const file = 'agents/wheelhouse-foreman.agent.md';
  if (!front['allowed-tools']) throw new Error(`${FOREMAN_SOURCE} has no allowed-tools to give the foreman agent its tools`);
  const rest = renameSkills(mapToolWords(withoutPathComment(body, FOREMAN_SOURCE), FOREMAN_SOURCE));
  return [file, assemble({ file, source: FOREMAN_SOURCE, front: { name: 'wheelhouse-foreman', description: front.description, tools: grantedTools(front['allowed-tools'], FOREMAN_SOURCE) }, rest })];
}

function instructionsFrom(root) {
  const source = 'adapters/copilot/tool-sheet.md';
  readSource(root, source);
  const sheet = readSheet(path.join(root, ...source.split('/')));
  const file = 'instructions/wheelhouse.instructions.md';
  return [file, assemble({
    file,
    source,
    front: { name: 'wheelhouse', description: 'How the Wheelhouse playbooks name Copilot\'s tools, and where Wheelhouse does not run.', applyTo: '**' },
    rest: `\n${sheet}\n\n${INSTRUCTIONS_LINE}\n`,
  })];
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

// ---- The kit ----

// The kit as a map from relative path to text, paths in order. Throws when a source can't be read.
export function buildHome({ root = REPO } = {}) {
  const files = new Map();
  for (const entry of [
    ...PLAYBOOK_SKILLS.map((skill) => skillFrom(root, skill)),
    ...Object.keys(COMMAND_SKILLS).map((command) => commandSkillFrom(root, command)),
    ...AGENT_SOURCES.map((agent) => agentFrom(root, agent)),
    foremanFrom(root),
    instructionsFrom(root),
  ]) files.set(entry[0], entry[1]);
  files.set('MANIFEST.txt', manifestOf(files));
  return new Map([...files.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
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

// The repository-relative paths where the committed kit differs from what buildHome gives: missing, changed or extra.
export function checkHome({ root = REPO } = {}) {
  const built = buildHome({ root });
  const have = committedFiles(path.join(root, ...HOME_DIR.split('/')));
  const differ = new Set();
  for (const [file, text] of built) if (have.get(file) !== text) differ.add(file);
  for (const file of have.keys()) if (!built.has(file)) differ.add(file);
  return [...differ].sort().map((file) => `${HOME_DIR}/${file}`);
}

// Replaces the kit's folder with the map. Returns the paths written.
export function writeHome({ root = REPO } = {}) {
  const built = buildHome({ root });
  const dir = path.join(root, ...HOME_DIR.split('/'));
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [file, text] of built) {
    const target = path.join(dir, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return [...built.keys()];
}

function main(argv) {
  const rootAt = argv.indexOf('--root');
  const root = rootAt >= 0 ? path.resolve(argv[rootAt + 1]) : REPO;
  if (argv.includes('--write')) {
    const written = writeHome({ root });
    process.stdout.write(`Wrote ${written.length} files to ${HOME_DIR}\n`);
    return 0;
  }
  const differ = checkHome({ root });
  if (differ.length > 0) process.stdout.write(`${differ.join('\n')}\n`);
  return differ.length > 0 ? 1 : 0;
}

if (startedAsScript(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
