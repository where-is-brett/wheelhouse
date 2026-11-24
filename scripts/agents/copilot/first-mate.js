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
import { SIGNED_LABELS } from '../../hooks/prompt-record.js';
import { C6_PASSED } from './numbers.js';
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

// The approvals level the director picks in VS Code's chat, the same whichever way clicks are recorded.
const APPROVALS_LEVEL = `## Approvals level

The director picks how much Copilot asks before it acts, in VS Code's chat. The choice is per chat and every new chat starts on Manual, so ask the director to pick the level again in
each new chat. Recommend Allow all: then Wheelhouse's own cards are the only clicks. Under Allow all Wheelhouse's guards still
refuse pushes, secret reads, forged card answers and carrying on past STOP. Never recommend Autopilot: it answers your cards itself, so the director never sees them. If the
director is on Autopilot, say so in one plain line and ask them to switch it off. Never post a card's answer from the shell:
the hooks and the helper record clicks, and the guard refuses a command that tries.
`;

// The same part where every card is asked with ask_user and the director's click on it is recorded (C6_PASSED): as Claude Code's
// picker is used. The seat card and an undo are asked the same way, and no window is ever opened.
const PICKER_CLICKS = `## Clicks in the chat

Ask every card with ask_user, a decision, a sign-off and a merge approval among them, as the tool sheet says. A card is asked
with no free-text input: set \`allowFreeformInput\` to false in every ask_user call (a card that decides is refused without it),
so the director answers it by clicking one of its options. Wheelhouse records that click and the crew acts on it. Say what you
did. If the director closes a card without choosing, nothing is recorded: say so in one plain line and ask it again later. If a
line from Wheelhouse says Copilot answered a card by itself, do as it says.

A decision is a card like any other: \`cards\` hands it out. It is never printed as a message, and a reply typed here is not
recorded.

Two more cards are asked the same way. When the session start says the First Mate is in another window and gives a card, ask
that card exactly as given, as a question of its own, when the director asks for Wheelhouse work: their click on it records the
move and moves the First Mate. An undo (\`undo <merge>\` says so with \`needs\` \`card\`) names a card: ask it, then run
\`undo <merge>\` again once they click Undo.
Every command that records takes \`--session <id>\`, the session id the session start gave you; a command without it is refused.
`;

// The part for an agent whose click is not recorded yet (C6_PASSED false): no window opens, so a card that signs is a plain chat
// message and the work waits.
const UNRECORDED_CLICKS = `## Clicks in the chat

On Copilot no hook sees the director's click on a card you asked with ask_user yet, so that click is not recorded. An option that
signs something is never offered in the chat:
${SIGNED_LABELS.slice(0, -1).join(', ')} and ${SIGNED_LABELS.at(-1)}.
For a card with one of them, write one plain chat message instead, with no clickable options. It says what the card is, why it comes
to the director, the options in words with your recommendation, and what happens meanwhile, and then says in one plain line that an
answer can't be recorded in this chat yet, so the work waits. Lifting STOP, changing a guardrail, unattended running, a runbook step,
a CI push, an undo and an allowance go the same way. Never open a window and never ask the director to answer anywhere else.

When the session start says the First Mate is in another window, write no question and no options of your own, and never use
ask_user for it: say one plain line, as the session start words it. Every command that records takes
\`--session <id>\`, the session id the session start gave you; a command without it is refused.

A decision is never asked with ask_user, and a reply typed here is not recorded. Print it exactly as \`decision show <n>\`
prints it: its last line says the decision waits. Say in one plain line that it waits, and take no step that waits on it. When the
director says "why <n>", run \`why decision <n> <their words>\` and relay its answer.

A click on a card with no signing option is the director's answer: act on it, and say what you did.
`;

const INSTRUCTIONS_TEXT = (sheet, picker = false) => `# Wheelhouse's First Mate in Copilot

${GUARD}

${sheet.trim()}

${APPROVALS_LEVEL}
${picker ? PICKER_CLICKS : UNRECORDED_CLICKS}
Ask each card with ask_user as the tool sheet says: one card per call, and several cards one call after another. The question is
the card's text, then one line per option, "Label: what it does". The options are the card's exact labels. The \`default\` is
the card's recommended option (\`recommend\`), not the first option.
`;

// The playbook's lines that say a click in the chat records itself, in the words of an agent whose click is not recorded yet
// (the instructions' "Clicks in the chat").
const CLICK_LINES = Object.freeze([
  ['and a click or a typed reply records itself:', 'and a click on a card with no signing option records itself, and a card that signs waits (see "Clicks in the chat"):'],
  ['- **An answer in the chat:** the click records itself.', '- **An answer in the chat:** a card with an option that signs is a plain chat message and waits, as the instructions say, and the click on any other records itself.'],
  ['Its click records itself.', 'Its click is the director\'s answer to act on.'],
]);

// The playbook's lines on how a decision and a card with a window are asked, in the words of an agent whose every card is asked in
// its picker. The decision's bullet is replaced whole (it starts with its bold lead); the others by their words.
const PICKER_LINES = Object.freeze([
  ['Every question is a card from `card` or `cards`, except a decision, which is a plain chat message (see Decisions).', 'Every question is a card from `card` or `cards`, a decision among them.'],
  ['**Only the director\'s click on a card, or their own typed reply to a decision, decides.**', '**Only the director\'s click on a card decides.**'],
  ['and a click or a typed reply records itself:', 'and a click records itself:'],
  [' Decisions are not among them: they are shown as chat messages.', ' A decision waiting is one of them.'],
]);
const DECISION_BULLET = /^- \*\*Decisions are chat messages, never the picker\.\*\*.*$/m;
const PICKER_DECISIONS = '- **Decisions are cards.** A question from the build, and a product question, is a decision. A line that starts "Decisions waiting for the director:" names them by number: `cards` hands each out as a card, and you ask it with your clickable-question tool like any other, never as a message. The director\'s click on it is their answer. You never record an answer for them. Silence is never an answer: a decision that waits keeps waiting, and may be asked again, never decided for them.';

function pickerLines(text) {
  const swapped = PICKER_LINES.reduce((out, [from, to]) => {
    if (!out.includes(from)) throw new Error(`${SOURCE} no longer says "${from}"; update PICKER_LINES in scripts/agents/copilot/first-mate.js`);
    return out.replace(from, to);
  }, text);
  if (!DECISION_BULLET.test(swapped)) throw new Error(`${SOURCE} no longer has the decisions bullet; update PICKER_LINES in scripts/agents/copilot/first-mate.js`);
  return swapped.replace(DECISION_BULLET, () => PICKER_DECISIONS);
}

function clickLines(text) {
  return CLICK_LINES.reduce((out, [from, to]) => {
    if (!out.includes(from)) throw new Error(`${SOURCE} no longer says "${from}"; update CLICK_LINES in scripts/agents/copilot/first-mate.js`);
    return out.replace(from, to);
  }, text);
}

function agent(root, picker) {
  const { front, body } = parse(readSource(root, SOURCE), SOURCE);
  const rest = `${GUARD}\n\n${(picker ? pickerLines : clickLines)(renameSkills(mapFileTool(mapToolWords(withoutPathComment(body, SOURCE), SOURCE))))}`;
  const lines = [`name: ${q('wheelhouse-first-mate')}`, `description: ${q(front.description)}`, `tools: [${FIRST_MATE_TOOLS.map(q).join(', ')}]`];
  return `---\n${lines.join('\n')}\n---\n<!-- ${FIRST_MATE_DIR}/${AGENT_FILE} (built from ${SOURCE} by ${BUILD_COMMAND}) -->\n${rest}`;
}

// The tool sheet's line on signing options and decisions, for an agent whose every card is asked in its picker.
const SHEET_UNRECORDED_WORDS = ' Signing options and decisions never go to ask_user (see "Clicks in the chat").';
const SHEET_PICKER_WORDS = ' Every card goes to ask_user, signing options and decisions too, with `allowFreeformInput` false (see "Clicks in the chat").';
function pickerSheet(sheet, picker) {
  if (picker !== true) return sheet;
  if (!sheet.includes(SHEET_UNRECORDED_WORDS)) throw new Error(`${TOOL_SHEET} no longer says "${SHEET_UNRECORDED_WORDS.trim()}"; update SHEET_UNRECORDED_WORDS in scripts/agents/copilot/first-mate.js`);
  return sheet.replace(SHEET_UNRECORDED_WORDS, SHEET_PICKER_WORDS);
}

function instructions(root, picker) {
  const sheet = pickerSheet(readSource(root, TOOL_SHEET).replace(/^<!--[^\n]*-->\n/, ''), picker);
  return `---\napplyTo: "**"\n---\n<!-- ${FIRST_MATE_DIR}/${INSTRUCTIONS_FILE} (built from ${TOOL_SHEET} by ${BUILD_COMMAND}) -->\n${INSTRUCTIONS_TEXT(sheet, picker)}`;
}

const lfEnd = (text) => (text.endsWith('\n') ? text : `${text}\n`);

// The files as a map from relative path to text. Throws when a source can't be read.
export function buildFirstMate({ root = REPO, picker = C6_PASSED } = {}) {
  return new Map([[AGENT_FILE, lfEnd(agent(root, picker))], [INSTRUCTIONS_FILE, lfEnd(instructions(root, picker))]]);
}

function committed(dir, file) {
  try {
    return fs.readFileSync(path.join(dir, ...file.split('/')), 'utf8').replaceAll('\r\n', '\n');
  } catch {
    return null;
  }
}

// The repository-relative paths where the committed copy under `root` differs from the build: missing or changed.
export function checkFirstMate({ root = REPO, picker = C6_PASSED } = {}) {
  const dir = path.join(root, ...FIRST_MATE_DIR.split('/'));
  return [...buildFirstMate({ root, picker })].filter(([file, text]) => committed(dir, file) !== text).map(([file]) => `${FIRST_MATE_DIR}/${file}`);
}

// Replaces the folder under `root` with the build. Returns the paths written.
export function writeFirstMate({ root = REPO, picker = C6_PASSED } = {}) {
  const built = buildFirstMate({ root, picker });
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
