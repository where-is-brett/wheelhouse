// scripts/agents/copilot/first-mate.js
// Builds the First Mate's agent and instructions for the person's Copilot folder (design section 3.3, part 9), from the front
// desk playbook (skills/front-desk) and the Copilot adapter's tool sheet. They live in adapters/copilot/first-mate/, apart from
// the session home (adapters/copilot/home), because the sessions part copies that home into every background session and
// none of them may be given the First Mate. Setup (part 11) copies this folder into the person's Copilot folder.
//
//   node scripts/agents/copilot/first-mate.js           prints the paths that differ from adapters/copilot/first-mate/, exit 1 if any
//   node scripts/agents/copilot/first-mate.js --write   replaces adapters/copilot/first-mate/ with what the build gives
//   --root <folder>                                     builds from, and writes under, another copy of the tree (the tests use it)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tools from '../../../adapters/copilot/tools.js';
import { startedAsScript } from '../../lib/started-as-script.js';
import { mapToolWords, parse, readSource, renameSkills, withoutPathComment } from './home.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const FIRST_MATE_DIR = 'adapters/copilot/first-mate';
const BUILD_COMMAND = 'npm run copilot-first-mate';
const SOURCE = 'skills/front-desk/SKILL.md';
const TOOL_SHEET = 'adapters/copilot/tool-sheet.md';
const AGENT_FILE = 'agents/wheelhouse-first-mate.agent.md';
const INSTRUCTIONS_FILE = 'instructions/wheelhouse-first-mate.instructions.md';
// The files, as paths under the folder (and under the person's Copilot folder, where setup puts them).
export const FIRST_MATE_FILES = Object.freeze([AGENT_FILE, INSTRUCTIONS_FILE]);

// What the First Mate may use: reading and searching, the question tool, the shell (the Wheelhouse command, and the guards
// that stand behind every Copilot session), the file tools for the card's input file, and dispatching and loading skills.
const FIRST_MATE_TOOLS = Object.freeze(['view', 'glob', 'rg', 'ask_user', ...tools.shell, ...tools.edit, 'task', 'skill']);

const q = (value) => JSON.stringify(value);

// The playbook's own words for Claude Code's file tool, in Copilot's.
const mapFileTool = (text) => text.replaceAll('the Write tool', 'the `create` tool').replaceAll('Write tool', '`create` tool');

// These files sit in the person's own Copilot folder, so Copilot offers them in every workspace on the computer. A Wheelhouse
// project is told by its committed configuration, `.claude/wheelhouse.json` (scripts/host/gitlab-base.js reads it the same way).
const PROJECT_MARKER = '.claude/wheelhouse.json';
const GUARD = `**Apply this only in a workspace that is a Wheelhouse project, one with a \`${PROJECT_MARKER}\` file in its folder. In any other workspace, ignore all of it and answer as if it were not here.**`;

const INSTRUCTIONS_TEXT = (sheet) => `# Wheelhouse's First Mate in Copilot

${GUARD}

${sheet.trim()}

## Clicks in the chat

A click on an option of a card you asked with ask_user is recorded by Wheelhouse's helper with the proof chat-click: your
own account of the click, **not proven** until a check shows a hook sees the director's own click. It is enough for the
everyday approvals the director ruled on, and for nothing more.

These steps are never decided by a click in the chat: lifting STOP (Lift STOP), changing a guardrail, unattended running,
a runbook step, a CI push and an allowance. Each goes to the helper's own window with \`confirm\`. A card for one of them
that you ask in the chat is answered only by the window.
`;

function agent(root) {
  const { front, body } = parse(readSource(root, SOURCE), SOURCE);
  const rest = `${GUARD}\n\n${renameSkills(mapFileTool(mapToolWords(withoutPathComment(body, SOURCE), SOURCE)))}`;
  const lines = [`name: ${q('wheelhouse-first-mate')}`, `description: ${q(front.description)}`, `tools: [${FIRST_MATE_TOOLS.map(q).join(', ')}]`];
  return `---\n${lines.join('\n')}\n---\n<!-- ${FIRST_MATE_DIR}/${AGENT_FILE} (built from ${SOURCE} by ${BUILD_COMMAND}) -->\n${rest}`;
}

function instructions(root) {
  const sheet = readSource(root, TOOL_SHEET).replace(/^<!--[^\n]*-->\n/, '');
  return `---\napplyTo: "**"\n---\n<!-- ${FIRST_MATE_DIR}/${INSTRUCTIONS_FILE} (built from ${TOOL_SHEET} by ${BUILD_COMMAND}) -->\n${INSTRUCTIONS_TEXT(sheet)}`;
}

const lfEnd = (text) => (text.endsWith('\n') ? text : `${text}\n`);

// The files as a map from relative path to text. Throws when a source can't be read.
export function buildFirstMate({ root = REPO } = {}) {
  return new Map([[AGENT_FILE, lfEnd(agent(root))], [INSTRUCTIONS_FILE, lfEnd(instructions(root))]]);
}

function committed(dir, file) {
  try {
    return fs.readFileSync(path.join(dir, ...file.split('/')), 'utf8').replaceAll('\r\n', '\n');
  } catch {
    return null;
  }
}

// The repository-relative paths where the committed copy under `root` differs from the build: missing or changed.
export function checkFirstMate({ root = REPO } = {}) {
  const dir = path.join(root, ...FIRST_MATE_DIR.split('/'));
  return [...buildFirstMate({ root })].filter(([file, text]) => committed(dir, file) !== text).map(([file]) => `${FIRST_MATE_DIR}/${file}`);
}

// Replaces the folder under `root` with the build. Returns the paths written.
export function writeFirstMate({ root = REPO } = {}) {
  const built = buildFirstMate({ root });
  const dir = path.join(root, ...FIRST_MATE_DIR.split('/'));
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [file, text] of built) {
    const target = path.join(dir, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return [...built.keys()];
}

if (startedAsScript(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    const root = argv.includes('--root') ? path.resolve(argv[argv.indexOf('--root') + 1]) : REPO;
    if (argv.includes('--write')) {
      process.stdout.write(`Wrote ${writeFirstMate({ root }).length} files to ${FIRST_MATE_DIR}\n`);
    } else {
      const differ = checkFirstMate({ root });
      if (differ.length > 0) process.stdout.write(`${differ.join('\n')}\n`);
      process.exitCode = differ.length > 0 ? 1 : 0;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
