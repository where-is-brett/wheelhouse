// scripts/feature/brief.js
// The brief the foreman writes into a feature session's worktree: a JSON block of
// the brief's fields, then Markdown text that begins with the Wheelhouse override,
// whole, so it is read before any lane text and before any skill.
// The text is filled from templates/brief/ (brief.md, override.md and one file
// per lane). This file only builds text: it writes no file and records no hash;
// the foreman does both.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_DIR, parseBrief } from './files.js';
import { APPROVED_PATH } from './approved.js';
import { FIX_ROUNDS, REPORT_WORDS } from '../lib/build-loop.js';
import { withLauncherCrewNames } from '../lib/crew-names.js';

// The ref a feature's worktree is cut from and compared against: the remote's default branch, never the local one.
export const BASE_REF = 'origin/HEAD';

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'brief');

// A template's text with line endings evened to LF and its path comment taken off.
function template(...parts) {
  const text = fs.readFileSync(path.join(TEMPLATES, ...parts), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  return text.replace(/^<!--[^\n]*-->\n(?:\n)?/, '');
}

// Fills each {{name}} from `values` in one pass, so text that is put in is never filled again.
function fill(text, values) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`The brief template has a placeholder with no value: ${name}`);
    return values[name];
  });
}

// --- Rendering ---

// The subagent roles, in the order the wake's prompt lists them (scripts/routing/in-force.js, SUBAGENT_ROLES).
const ROLES = Object.freeze([
  ['builder', 'wheelhouse:builder', 'builds each task'],
  ['mechanical', 'wheelhouse:builder', 'builds a mechanical task'],
  ['builderCritical', 'wheelhouse:builder', 'builds a task in a critical area'],
  ['reviewer', 'wheelhouse:reviewer', 'reviews each task and the whole branch'],
  ['reviewerCritical', 'wheelhouse:reviewer', 'reviews work in a critical area'],
  ['tester', 'wheelhouse:tester', 'tries the product against the done contract'],
]);

// The roles by name, with no model: the models and efforts come with each wake (design section 14.6), so the
// brief's `routing` is no longer read. An older brief that carries one keeps it, unread.
function roleLines() {
  return ROLES.map(([role, agent, job]) => `- ${role} (\`${agent}\`, ${job})`).join('\n');
}

// The template's words on build commands on Windows (design section 12.2): one block for Ask,
// one for Guarded and one for a session that only a click in it can allow (watcher Shape 2), of
// which the brief keeps the one for its level, or none. Unattended keeps the Ask block, opening on
// a refused command: the waker reads the level at every run, so one turned off mid-feature asks.
const BUILDS_BLOCK = /<!-- builds:ask -->\n([\s\S]*?)\n<!-- builds:guarded -->\n([\s\S]*?)\n<!-- builds:session -->\n([\s\S]*?)\n<!-- builds:end -->\n/;
const LEVEL_WORDS = /^(ask|guarded|unattended)$/;
const ASK_WHEN = { ask: 'Before your first build command', unattended: 'If a build command is refused' };

// The level the brief speaks to: null off Windows (`windowsBuilds` null), `session` at watcher
// Shape 2 (`shape` 2) whatever the level, Unattended as given, Guarded only with a runner command
// that can sit in the brief, and anything else Ask.
function buildsLevelOf(windowsBuilds) {
  if (windowsBuilds === null || windowsBuilds === undefined) return null;
  if (windowsBuilds?.shape === 2) return 'session';
  const level = typeof windowsBuilds?.level === 'string' && LEVEL_WORDS.test(windowsBuilds.level) ? windowsBuilds.level : 'ask';
  if (level !== 'guarded') return level;
  const command = windowsBuilds.guardedCommand;
  return typeof command === 'string' && command.trim() !== '' && !/[`\r\n\0]/.test(command) ? 'guarded' : 'ask';
}

// The brief's template with the build-commands block for `level` kept, or none.
function withBuildsBlock(text, level) {
  const match = BUILDS_BLOCK.exec(text);
  if (!match) throw new Error("The brief's template has no words on build commands on Windows");
  const block = { ask: match[1], unattended: match[1], guarded: match[2], session: match[3] }[level];
  return text.replace(BUILDS_BLOCK, () => (block === undefined ? '' : `${block}\n`));
}

// What the session reads first when its work starts from a ready-made change: the change and
// the work's document, that only its own branch is pushed, and, when it carries on a pull
// request, how the new pull request's body begins.
function fromLine(f, launchers = false) {
  const carries = f.from.request === undefined ? '' : ` Begin your report's words, which become the pull request's body, with "Carries on #${f.from.request}."`;
  return `\nThis work starts from a ready-made change: your branch \`feature/${f.work}\` begins where that change stands. `
    + `Before anything else, read the change (${launchers ? `\`${LAUNCHER} diff 1\`, then the file it writes` : `\`git diff ${BASE_REF}...HEAD\``}) and the work's document, and carry the work on from there. `
    + `Push only through \`open-pr\` and \`push\`, which push your own branch; never push to the change's own branch.${carries}\n`;
}

// What was asked for (build-loop design, section 13): the approved document the start copied
// into the feature folder, which the plan, the tasks and the questions follow.
function approvedSection() {
  return `# What was asked for\n\nThe director approved a document for this work. It is at \`${APPROVED_PATH}\` in your worktree, and it is the spec. `
    + 'Read it whole before anything else. Your plan, your tasks and your questions follow it: the goal and the done contract below sum it up, '
    + 'and where they leave something out, the document says it. Never make up what it already decides; where it and this brief disagree, ask.\n\n';
}

// A session that runs Wheelhouse's commands by launcher (`wh-feature`, scripts/lib/launchers.js) has a shell that allows that
// command and the project's build commands, and no git. Its brief names the launcher for the feature command and says what the
// command does in place of each git step. Each pair is [the template's words, the launcher's]; a template that no longer holds
// the words throws, so a change to it is seen here.
export const LAUNCHER = 'wh-feature';
const LAUNCHER_WORDS = Object.freeze([
  ['to see what your branch adds, run `git diff {{baseRef}}...HEAD`. To bring in newer work, run `git fetch origin` and then rebase or merge `{{baseRef}}`; `pull` brings in only your own branch.',
    'to see what your branch adds, run `{{cli}} diff <n>`, which writes it to `{{featureDir}}/review/<n>.diff` for you to read with your file tools. To bring in newer work, run `{{cli}} pull --default`, which merges `{{baseRef}}` into your branch; `pull` alone brings in only your own branch.'],
  ['- **Conflicts.**',
    "- **You run no git.** Your shell allows Wheelhouse's own command `{{cli}}` and the project's build commands, and nothing else. `{{cli}} commit` commits everything you have changed (git's hooks off, a message Wheelhouse writes, no co-author line) and prints the head's full hash; `push`, `pull`, `open-pr` and `diff` commit first. `{{cli}} head` prints the head's full hash. Run one command per call, never chained with `;`, `&&` or a pipe. Give each argument as plain letters, digits and `. , : / = + @ -`, or in single quotes (never double quotes) holding none of `' \" % ^ & | < > $ ! ( ) { }` or a backtick (a `;` inside the quotes is fine; unquoted it chains commands and is refused).\n- **Conflicts.**"],
  ['write the diff under review to `{{featureDir}}/review/<n>.diff` (`<n>` counting up from 1), and give the Lookout that path, the full commit hash of the head it reviews,',
    'write the diff under review with `{{cli}} diff <n>` (`<n>` counting up from 1; it writes `{{featureDir}}/review/<n>.diff` and prints the full hash of the head it holds), and give the Lookout that path, that hash,'],
  ["in `.wheelhouse/tmp/` in this worktree (make the folder if it isn't there).", "in `.wheelhouse/tmp/` in this worktree if the folder is there (your file tools can't make a folder)."],
  ["except local git. Local git (`git status`, `git add`, `git commit` and the rest) doesn't go through it, and nor does a command that fetches new code: each is asked for like any build command.",
    "except `{{cli}}`, which doesn't go through it. A command that fetches new code doesn't either: it is asked for like any build command."],
  ['It does not commit it: commit that file with your next commit on your branch, so it merges with your work, and push it with the rest.',
    'It does not commit it: your next `{{cli}} commit`, `push` or `open-pr` commits it with your work.'],
  ['rework to that answer on your branch, commit and push it, then run', 'rework to that answer on your branch, commit it with `{{cli}} commit`, push it, then run'],
  ["remove the markers, `git add` them, run `git commit --no-edit`, run the tests, then push.", 'remove the markers, run `{{cli}} commit`, run the tests, then push.'],
  ['=yes|no|partly', '=<yes, no or partly>'],
  ['--because "<why, in the director\'s terms>"', '--because "<why, in plain product terms>"'],
]);

function launcherWords(text) {
  let out = text;
  for (const [from, to] of LAUNCHER_WORDS) {
    if (!out.includes(from)) throw new Error(`The brief's template no longer holds the words launcherWords rewrites: ${from.slice(0, 60)}`);
    out = out.replaceAll(from, to);
  }
  return out.replaceAll('…', '...');
}

// The launcher's commands in `text` with each double-quoted argument single-quoted, the only quoting its grammar allows.
const singleQuoted = (text) => text.replace(new RegExp(`${LAUNCHER}\\b[^\`\\n]*`, 'g'), (command) => command.replace(/"([^"'\n]*)"/g, "'$1'"));

const numbered = (items) => (items.length === 0 ? 'Nothing is listed.' : items.map((item, i) => `${i + 1}. ${item}`).join('\n'));

function appetiteLine({ sessions, tokens }) {
  return `${sessions} ${sessions === 1 ? 'session' : 'sessions'} and ${tokens} tokens at most. If the work will not fit, stop and report \`partial\` with what is done.`;
}

// The brief's text for `fields`: its JSON block, then the override, the goal and
// done contract, the appetite, the rulings, the lane's loop, how to ask, how to
// finish and the subagent roles. `pluginRoot` is put into the commands the brief
// names, so the session can run them as written. With `launchers`, a session that runs Wheelhouse's commands by launcher and
// runs no git: the commands are `wh-feature` and each git step is a command of its own. `windowsBuilds` is null off
// Windows, else `{ level, guardedCommand, shape }`: at Ask the brief says to ask for every build
// command at once, at Unattended to ask the same way if one is refused, at Guarded to run each
// through `guardedCommand`, and at watcher Shape 2 (`shape` 2) to ask once for the director to
// click Allow in the session itself.
export function renderBrief({ fields, pluginRoot, windowsBuilds = null, launchers = false } = {}) {
  if (typeof pluginRoot !== 'string' || pluginRoot === '' || /["\r\n\0]/.test(pluginRoot)) {
    throw new Error("The plugin root can't be put into the brief");
  }
  const block = `\`\`\`json\n${JSON.stringify(fields, null, 2)}\n\`\`\`\n`;
  const { fields: f } = parseBrief(block);

  const cli = launchers === true ? LAUNCHER : `node "${path.join(pluginRoot, 'scripts', 'feature', 'cli.js')}"`;
  const shared = { baseRef: BASE_REF, cli, featureDir: FEATURE_DIR, fixRounds: String(FIX_ROUNDS), reportWords: String(REPORT_WORDS), work: f.work, lane: f.lane };
  const laneTemplate = template('lanes', `${f.lane}.md`);
  const laneText = fill(laneTemplate, shared).trim();

  const level = buildsLevelOf(windowsBuilds);
  const wording = launchers === true ? launcherWords : (words) => words;
  const text = fill(withBuildsBlock(wording(template('brief.md')), level), {
    ...shared,
    ...(level === 'guarded' ? { guardedCommand: windowsBuilds.guardedCommand } : {}),
    ...(Object.hasOwn(ASK_WHEN, level) ? { buildsAskWhen: ASK_WHEN[level] } : {}),
    override: template('override.md').trim(),
    planLine: f.plan === undefined ? '' : `\nThe plan is at \`${f.plan}\`; use it rather than writing another.\n`,
    slicesLine: f.slices === undefined ? '' : `\nThis feature has ${f.slices} ${f.slices === 1 ? 'slice' : 'slices'}, each its own plan and its own pull request.\n`,
    fromLine: f.from === undefined ? '' : fromLine(f, launchers === true),
    approvedSection: f.approved === undefined ? '' : approvedSection(),
    shownFirstLine: f.shownFirst
      ? '\nThis change is marked shown first: the director sees it before it ships. Do not alter what users see beyond the goal and the done contract; if you must, ask at decision level 3.\n'
      : '',
    goal: f.goal,
    done: numbered(f.done),
    appetite: appetiteLine(f.appetite),
    rulings: f.rulings.length === 0 ? 'No rulings apply yet.' : f.rulings.map((r) => `- ${r.id}: ${r.words}`).join('\n'),
    laneText,
    models: roleLines(),
  });
  return `${block}\n${launchers === true ? singleQuoted(withLauncherCrewNames(text)) : text}`;
}

// A brief again from the brief `text` already in a worktree, with the words its agent runs by now (`pluginRoot`,
// `windowsBuilds` and `launchers` as renderBrief takes them): its fields (the version, the plan, the approved document's
// hash and the rest) are read from the text and put back as they stand, and so is the "What changed" section the
// amendments built. Only the words around them are written afresh, so a session started before a change to them reads the
// brief as a start now would write it. Returns text only; the caller writes it and records its hash. Throws if `text` is
// not a brief.
export function renderAgain(text, { pluginRoot, windowsBuilds = null, launchers = false } = {}) {
  const { fields, body } = parseBrief(text);
  const fresh = renderBrief({ fields, pluginRoot, windowsBuilds, launchers });
  const { changed } = splitOverride(body);
  if (changed === '') return fresh;
  const at = splitOverride(parseBrief(fresh).body);
  const block = `\`\`\`json\n${JSON.stringify(fields, null, 2)}\n\`\`\`\n`;
  return `${block}\n${at.override}\n\n# What changed\n\n${changed}\n${at.rest === '' ? '' : `\n${at.rest}`}`;
}

// --- Amending ---

const MONTHS = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);

function dayMonthYear(now) {
  const when = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(when.getTime())) throw new Error('The time given is not a time');
  return `${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]} ${when.getUTCFullYear()}`;
}

const OVERRIDE_HEADING = '# The Wheelhouse override';

// A brief's text after its fields block, in its parts: the override, which opens the text and ends at the next top-level
// heading; the entries of the "What changed" section the amendments built (empty when there is none); and the rest. Throws
// if the text has no override.
function splitOverride(body) {
  const text0 = body.replace(/^\s+/, '');
  if (!text0.startsWith(OVERRIDE_HEADING)) throw new Error('The brief has no override');
  const end = text0.indexOf('\n# ', OVERRIDE_HEADING.length);
  const override = end === -1 ? text0.trimEnd() : text0.slice(0, end).trimEnd();
  let rest = end === -1 ? '' : text0.slice(end + 1);
  let changed = '';
  const section = /^# What changed\r?\n([\s\S]*?)(?=\r?\n# |$)/.exec(rest);
  if (section) {
    changed = section[1].trim();
    rest = rest.slice(section[0].length).replace(/^\s+/, '');
  }
  return { override, changed, rest };
}

// The brief `text` with its version one higher and a "What changed" section
// straight after the override, which stays first. A section from an earlier amendment
// is kept, with the latest line first. Returns text only; the caller writes it and
// records its hash. Throws if `text` is not a brief.
export function amendBrief(text, { change, now } = {}) {
  const { fields, body } = parseBrief(text);
  const said = typeof change === 'string' ? change.replace(/\s*\r?\n\s*/g, ' ').trim() : '';
  if (said === '') throw new Error('The change must say what changed');
  const date = dayMonthYear(now);
  const version = fields.version + 1;

  const { override, rest, changed: earlier } = splitOverride(body);
  const entries = [`- ${date} (version ${version}): ${said}`, ...(earlier === '' ? [] : [earlier])].join('\n');
  const block = `\`\`\`json\n${JSON.stringify({ ...fields, version }, null, 2)}\n\`\`\`\n`;
  return `${block}\n${override}\n\n# What changed\n\n${entries}\n${rest === '' ? '' : `\n${rest}`}`;
}
