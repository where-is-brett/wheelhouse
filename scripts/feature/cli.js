// scripts/feature/cli.js
// The commands a feature session runs, as `node "<pluginRoot>/scripts/feature/cli.js" <command> …`:
//   ask      writes a question for the director and prints its id; with --kind build-command,
//            asks for build commands on Windows (design section 12.2)
//   stuck    says, once, that a decision can't be put into its shape (after three sent back in a row)
//   wait-for says the piece has reached a step it can't undo and has nothing else to do until a decision is answered; only
//            this sets the waiting phase and gives the slot up (asking leaves the piece building on its recommendation)
//   log      adds one call you made on your own side of the decision line to the piece's log (decisions.jsonl)
//   answer   prints the director's answer to a question, once it is signed; --applied says the change it asks for is pushed
//            and --no-change that it asks for none, either of which lets the merge's hold on the decision go
//   plan     records the plan just written, in plan.json, for the status and the foreman
//   report   checks report.md and that it holds every ruling kept, then stamps it with what built it
//   push     pushes the worktree's branch to the host, through the helper (after a fix)
//   pull     brings the host's copy of the worktree's branch into it, through the helper (when
//            the host's has moved on, as when the gate brought it up to date)
//   open-pr  pushes the branch, opens the feature's pull request, whose body is the proof note (scripts/proof/note.js), and
//            keeps its number with its plan
// Each command's core is an exported function that takes the helper's client and
// the worktree, so tests use a fake helper. Files are read and written only in the
// feature folder, through the safe readers and writers of status.js; the head
// branch is read from the .git files. Only `pull` runs git: the session's own, in its
// worktree, inside the sandbox, to bring in the commits the helper hands back.
// These commands run inside the project's sandbox, which cannot read ~/.wheelhouse
// (ruling R150): nothing here reads it. Each helper request carries the worktree's
// folder as `cwd`, and the helper places the project from it; STOP, too, comes
// from the helper.
import fs from 'node:fs';
import path from 'node:path';
import { safeGit } from '../lib/safe-git.js';
import { QUESTION_ID, QUESTION_KINDS, appendLine, featurePaths, parseReport, questionTrail, readQuestions, reworksIn, waitingFor } from './files.js';
import {
  planIn, planInside, readBrief, readCapped, readPlan, readPrRecord, safeFeatureFolder, writeWhole, SMALL_BYTES,
} from './status.js';
import { questionProblem, shapeProblems } from '../cards/compose.js';
import { featureWorktree } from '../hooks/feature-status.js';
import { branchOf } from '../hooks/session-start.js';
import { helperClient } from '../host/helper-client.js';
import { REPORT_WORDS } from '../lib/build-loop.js';
import { dataModelPaths, readConfig } from '../gate/guardrails.js';
import { BUILD_QUESTION_LABELS, BUILD_QUESTION_OPTIONS, isConfiguredBuildCommand } from '../protection/windows-builds.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { appendCall, readLog } from '../decisions/log.js';
import { touchedPages } from '../engine/preview.js';
import { proofNote } from '../proof/note.js';
import { compareSnapshots } from '../proof/data.js';

// An error whose message is said to the session as it is.
export class CliError extends Error {}

// A decision that failed the shape (design section 6.2): it goes back to the session, never to the director. `problems` is one
// sentence each; the command line prints them one to a line and exits with code 2.
export class SentBack extends CliError {
  constructor(problems, failures) {
    super(problems.join(' '));
    this.problems = problems;
    this.failures = failures;
  }
}

// How many failed tries in a row make the session stop and say it is stuck.
export const STUCK_AFTER = 3;

const FOLDER = "The feature's folder isn't a real folder inside this worktree";
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const QUESTIONS_BYTES = 8 * 1024 * 1024;
const REPORT_BYTES = 1024 * 1024;
const RULINGS_BYTES = 8 * 1024 * 1024;
const REQUIRED_FIELDS = ['v', 'work', 'status', 'tests', 'assumptions', 'concerns', 'rulings'];

// --- Reading the arguments ---

// The flags in `argv` as `{ name: [values] }`. Every flag takes a value, and only
// the flags in `allowed` are known.
function flagsOf(argv, allowed) {
  const found = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (typeof flag !== 'string' || !flag.startsWith('--')) throw new CliError(`Unexpected "${flag}": every value comes after a flag such as --what`);
    const name = flag.slice(2);
    if (!allowed.includes(name)) throw new CliError(`${flag} is not a flag this command takes`);
    if (i + 1 >= argv.length) throw new CliError(`${flag} needs a value`);
    i += 1;
    (found[name] ??= []).push(argv[i]);
  }
  return found;
}

// The one value of a flag given once, or undefined when it is not given.
function single(found, name) {
  const values = found[name];
  if (values === undefined) return undefined;
  if (values.length > 1) throw new CliError(`--${name} is given once`);
  return values[0];
}

function needed(found, name) {
  const value = single(found, name);
  if (value === undefined || value.trim() === '') throw new CliError(`--${name} is needed`);
  return value.trim();
}

// --- ask ---

function nextQuestionId(file, work) {
  const { questions, truncated } = readQuestions(file, { maxBytes: QUESTIONS_BYTES });
  if (truncated) throw new CliError("questions.jsonl is too big to add to");
  let highest = 0;
  for (const q of questions) {
    const m = /^q-(.+)-([0-9]+)$/.exec(q.id);
    if (m && m[1] === work) highest = Math.max(highest, Number(m[2]));
  }
  return `q-${work}-${highest + 1}`;
}

// The words each answer to --undo stands for.
const UNDO_WORDS = Object.freeze({ yes: 'Can be undone', no: 'Cannot be undone', partly: 'Can be partly undone' });

// The values of a repeated "<label>=<value>" flag, by label; a malformed one, or one naming a label twice, is put in `problems`.
function byLabel(found, flag, problems) {
  const values = new Map();
  for (const text of found[flag] ?? []) {
    const at = text.indexOf('=');
    const label = at < 0 ? '' : text.slice(0, at).trim();
    const value = at < 0 ? '' : text.slice(at + 1).trim();
    if (label === '' || value === '') problems.push(`--${flag} "${text}" is written as "<option label>=<value>".`);
    else if (values.has(label)) problems.push(`--${flag} names "${label}" twice.`);
    else values.set(label, value);
  }
  return values;
}

// What a question or an extra plan asks, with the options, recommendation and level the
// session gives it. A plain question is a decision: its shape is judged by the caller (shapeProblems), and what is wrong
// with the flags that spell the shape comes back as `problems`.
function plainQuestion(found, kind) {
  if (found.command !== undefined) throw new CliError('--command is only for --kind build-command');
  const what = needed(found, 'what');
  const levelText = needed(found, 'level');
  if (!/^[1-4]$/.test(levelText)) throw new CliError('--level is a decision level from 1 to 4');
  const plan = single(found, 'plan')?.trim();
  if (kind === 'extra-plan' && !plan) throw new CliError('An extra-plan needs --plan, the path of the plan being handed back');
  if (kind !== 'extra-plan' && found.plan !== undefined) throw new CliError('--plan is only for --kind extra-plan');
  const decision = kind === 'question';
  for (const flag of ['cost', 'undo', 'holds', 'meanwhile', 'because']) {
    if (!decision && found[flag] !== undefined) throw new CliError(`--${flag} is only for a plain question`);
  }

  const options = (found.option ?? []).map((text) => {
    const at = text.indexOf('=');
    const label = at < 0 ? '' : text.slice(0, at).trim();
    if (label === '') throw new CliError(`--option "${text}" is written as "<label>=<what it means>"`);
    return { label, says: text.slice(at + 1).trim() };
  });
  if (new Set(options.map((o) => o.label)).size !== options.length) throw new CliError('Each option needs its own label');
  const problems = [];
  const recommendation = decision ? single(found, 'recommend')?.trim() : needed(found, 'recommend');
  if (!decision) {
    if (options.length < 2) throw new CliError('Give two or more options, each with --option "<label>=<what it means>"');
    if (!options.some((o) => o.label === recommendation)) throw new CliError(`--recommend must be the label of one option (${options.map((o) => o.label).join(', ')})`);
    return { what, options, recommendation, level: Number(levelText), problems, ...(kind === 'extra-plan' ? { plan } : {}) };
  }

  // A decision's options carry what each costs and whether it can be undone (design section 6.2).
  const costs = byLabel(found, 'cost', problems);
  const undos = byLabel(found, 'undo', problems);
  for (const [flag, labelled] of [['cost', costs], ['undo', undos]]) {
    for (const label of labelled.keys()) if (!options.some((o) => o.label === label)) problems.push(`--${flag} names "${label}", which is not one of the options.`);
  }
  for (const [label, answer] of undos) {
    if (!Object.hasOwn(UNDO_WORDS, answer)) problems.push(`--undo "${label}" must be yes, no or partly.`);
  }
  const holds = single(found, 'holds')?.trim();
  const meanwhile = single(found, 'meanwhile')?.trim();
  const because = single(found, 'because')?.trim();
  const full = options.map((o) => ({
    ...o,
    ...(costs.has(o.label) ? { cost: costs.get(o.label) } : {}),
    ...(Object.hasOwn(UNDO_WORDS, undos.get(o.label)) ? { undo: UNDO_WORDS[undos.get(o.label)] } : {}),
  }));
  return {
    what, options: full, recommendation, level: Number(levelText), problems,
    ...(because === undefined ? {} : { because }), ...(holds === undefined ? {} : { holds }), ...(meanwhile === undefined ? {} : { meanwhile }),
  };
}

const PACKAGE_BYTES = 1024 * 1024;
const SCRIPT_CHARS = 200;

// The package script `command` runs, for `npm test` and `npm run <x>`, or undefined for any other.
function scriptOf(command) {
  if (command === 'npm test' || command.startsWith('npm test ')) return 'test';
  return /^npm run ([^ ]+)/.exec(command)?.[1];
}

// What a build-command question asks: each command and, for `npm test` and `npm run <x>`, the
// line it runs from the worktree's package.json, on one line and cut at 200 characters.
function buildWhat(worktree, commands) {
  let scripts = {};
  try {
    const parsed = JSON.parse(readCapped(path.join(worktree, 'package.json'), PACKAGE_BYTES) ?? 'null');
    if (parsed !== null && typeof parsed.scripts === 'object' && !Array.isArray(parsed.scripts)) scripts = parsed.scripts ?? {};
  } catch { /* no package.json that reads: every script is missing */ }
  const named = commands.map((c) => {
    const script = scriptOf(c);
    if (script === undefined) return c;
    const line = Object.hasOwn(scripts, script) && typeof scripts[script] === 'string' ? scripts[script] : null;
    return line === null ? `${c}, which runs (no such script)` : `${c}, which runs "${line.replace(/\s*[\r\n]+\s*/g, ' ').slice(0, SCRIPT_CHARS)}"`;
  });
  return `Let this feature's Crew run: ${named.join('; ')}.`;
}

// A build-command question (design section 12.2): its options are the design's, never the
// session's, and each command must be local git or one of the configuration's build commands,
// as the helper reads it from the default branch, never the working copy.
async function buildQuestion(found, { worktree, client }) {
  for (const flag of ['what', 'option', 'recommend', 'level', 'plan', 'about']) {
    if (found[flag] !== undefined) throw new CliError(`--${flag} is not given for a build-command question: Wheelhouse writes it`);
  }
  const commands = [...new Set((found.command ?? []).map((c) => c.trim()))];
  if (commands.length === 0) throw new CliError('Name each build command you need with --command "<command>"');
  if (commands.includes('')) throw new CliError('--command needs a command');
  let answer;
  try {
    answer = await client.config({ cwd: worktree });
  } catch {
    answer = null;
  }
  if (answer?.ok !== true) throw new CliError(`The project's build commands can't be read from the host helper, so nothing was asked: ${answer?.refused ?? 'it gave no answer'}`);
  let config;
  try {
    config = readConfig(JSON.stringify(answer.config));
  } catch {
    throw new CliError("The project's configuration on the default branch can't be read, so nothing was asked");
  }
  for (const c of commands) {
    if (!isConfiguredBuildCommand(c, config.buildCommands)) throw new CliError(`"${c}" isn't one of this project's build commands or local git, so it can't be asked for`);
  }
  return {
    what: buildWhat(worktree, commands),
    options: BUILD_QUESTION_OPTIONS.map((o) => ({ ...o })),
    recommendation: BUILD_QUESTION_LABELS.once,
    level: 3,
    commands,
  };
}

// Appends a question to questions.jsonl and returns `{ id }`. Only a build-command question
// needs `client`, to read the configuration; the helper places the project from the worktree's
// folder. A question for the director, a build-command question too, that no card could carry
// (by the composer's own rules: at most four options, none a button that puts a card off but a
// build-command question's own Not now, words that fit the card) is refused, so it never waits unasked.
export async function ask({ worktree, argv, client }) {
  const found = flagsOf(argv, ['kind', 'what', 'why', 'option', 'recommend', 'level', 'plan', 'command', 'about', 'cost', 'undo', 'holds', 'meanwhile', 'because']);
  const kind = single(found, 'kind') ?? 'question';
  if (!QUESTION_KINDS.includes(kind)) throw new CliError(`--kind is ${QUESTION_KINDS.join(', ')}`);
  const why = needed(found, 'why');
  // The kind of call the question is about (the decision line): a director's kind, or one the line doesn't know, comes at level 3 or 4.
  const about = single(found, 'about')?.trim();
  if (found.about !== undefined && about === '') throw new CliError('--about needs the kind of call this is about');
  if (about !== undefined && kind !== 'question') throw new CliError('--about is only for a plain question');
  const asked = kind === 'build-command' ? await buildQuestion(found, { worktree, client }) : plainQuestion(found, kind);

  const brief = readBriefOrSay(worktree);
  if (!safeFeatureFolder(worktree)) throw new CliError(FOLDER);
  const p = featurePaths(worktree);
  const id = nextQuestionId(p.questions, brief.work);
  const { what, problems: flagProblems = [], ...rest } = asked;
  const question = { id, kind, what, why, ...rest };
  // A decision that fails its shape goes back to this session; the director never sees it (design section 6.2).
  if (kind === 'question') {
    const problems = [...flagProblems, ...shapeProblems({ what, why, ...rest, work: brief.work })];
    if (problems.length > 0) sendBack(p.questions, problems);
  }
  const problem = kind === 'extra-plan' ? null : questionProblem({ ...question, work: brief.work, ...(about === undefined ? {} : { decides: about }) });
  if (problem !== null) throw new CliError(`This question can't be put to the director as a card, so it wasn't asked: ${problem}`);
  addLine(p.questions, question);
  return { id };
}

// Adds one line to questions.jsonl by appending, so the foreman's own line written at the same time is kept.
function addLine(file, object) {
  try {
    appendLine(file, object);
  } catch {
    throw new CliError("questions.jsonl can't be added to");
  }
}

// Writes the failed try into questions.jsonl, which counts the tries in a row, and sends the problems back to the session. On the
// third failure in a row it also says to stop trying and send one plain message (`stuck`).
function sendBack(file, problems) {
  const failures = questionTrail(file, { maxBytes: QUESTIONS_BYTES }).failures + 1;
  addLine(file, { sentBack: true, at: new Date().toISOString(), problems });
  const said = failures >= STUCK_AFTER
    ? [...problems, `That is ${failures} tries in a row that failed. Stop trying: send one plain message with \`stuck --why "<what keeps failing>"\`, then carry on with what does not depend on the answer.`]
    : problems;
  throw new SentBack(said, failures);
}

// Whether anything is at `file`, a link included.
function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function readBriefOrSay(worktree) {
  try {
    return readBrief(worktree);
  } catch {
    throw new CliError("The brief can't be read, so this isn't a feature session's folder");
  }
}

// --- stuck ---

// Says, once and in plain words, that the session can't get a decision into its shape. It is one line in questions.jsonl; the
// count of failed tries starts again after it. Returns the line kept.
export function stuck({ worktree, argv, now = () => new Date() }) {
  const found = flagsOf(argv, ['why']);
  const why = needed(found, 'why');
  readBriefOrSay(worktree);
  if (!safeFeatureFolder(worktree)) throw new CliError(FOLDER);
  const line = { stuck: true, at: now().toISOString(), why };
  addLine(featurePaths(worktree).questions, line);
  return line;
}

// --- answer ---

// The label the director chose, or null while the question has no signed answer. The helper
// places the project from the worktree's folder. `applied` says the change the answer asks for is pushed, and `noChange` that it
// asks for none; either lets the merge's hold on the decision go (a different answer from the recommendation needs `applied`).
export async function answer({ client, worktree, questionId, noChange = false, applied = false }) {
  if (typeof questionId !== 'string' || !QUESTION_ID.test(questionId)) throw new CliError('Give the id of the question, as ask printed it');
  if (noChange && applied) throw new CliError('Say --applied or --no-change, not both');
  const said = await client.state.answer({ cwd: worktree, questionId, ...(noChange ? { noChange: true } : {}), ...(applied ? { applied: true } : {}) });
  if (said?.ok !== true) throw new CliError(said?.refused ?? 'The host helper gave no answer');
  if (said.answer === null) return { answer: null };
  if (typeof said.answer !== 'string' || said.answer === '') throw new CliError('The host helper gave an answer this could not read');
  return { answer: said.answer };
}

// --- wait-for ---

// Says the piece has reached a step it can't undo (migrating real data, deleting anything, spending money, going live) or has
// nothing else to do, and waits for the director's answer to `questionId`: only this sets the `waiting` phase and gives the
// piece's slot up (design section 6.4). One line in questions.jsonl, kept once. A decision already answered doesn't wait.
// Returns `{ waiting: true }`, or `{ waiting: false, answer }` when the answer is there.
export async function waitFor({ client, worktree, questionId, now = () => new Date() }) {
  if (typeof questionId !== 'string' || !QUESTION_ID.test(questionId)) throw new CliError('Give the id of the decision, as ask printed it');
  readBriefOrSay(worktree);
  if (!safeFeatureFolder(worktree)) throw new CliError(FOLDER);
  const file = featurePaths(worktree).questions;
  const asked = readQuestions(file, { maxBytes: QUESTIONS_BYTES }).questions.find((q) => q.id === questionId);
  if (asked === undefined || asked.kind !== 'question') throw new CliError(`${questionId} is not a decision this piece asked`);
  const said = await client.state.answer({ cwd: worktree, questionId });
  if (said?.ok !== true) throw new CliError(said?.refused ?? 'The host helper gave no answer');
  if (typeof said.answer === 'string' && said.answer !== '') return { waiting: false, answer: said.answer };
  if (!waitingFor(file, { maxBytes: QUESTIONS_BYTES }).includes(questionId)) addLine(file, { waitFor: questionId, at: now().toISOString() });
  return { waiting: true };
}

// --- log ---

// Adds one call to the piece's log: what the session decided on its own side of the decision line, the options it saw and
// why. A director's kind is refused, with the words to ask instead. Returns the line kept.
export function log({ worktree, argv, now }) {
  const found = flagsOf(argv, ['decided', 'option', 'why', 'kind']);
  const fail = (message) => { throw new CliError(message); };
  return appendCall({
    worktree, decided: single(found, 'decided'), options: found.option, why: single(found, 'why'), kind: single(found, 'kind'), fail,
    ...(now === undefined ? {} : { now }),
  });
}

// --- report ---

// The report's missing fields, said by name, when its first json block can be read at all.
function missingFields(text) {
  const match = /^(?:[ \t]*\r?\n)*```json[ \t]*\r?\n([\s\S]*?)\r?\n```/.exec(text.replace(/^﻿/, ''));
  if (!match) return null;
  try {
    const fields = JSON.parse(match[1]);
    if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return null;
    return REQUIRED_FIELDS.filter((k) => !(k in fields));
  } catch {
    return null;
  }
}

const quoted = (text) => (text.length > 100 ? `${text.slice(0, 97)}...` : text);

// What report.md lacks, as `{ missing: [text], body }`: nothing missing when it is whole, and then
// `body` is its text after the fields.
function inspect(worktree) {
  if (!safeFeatureFolder(worktree)) return { missing: [FOLDER] };
  const p = featurePaths(worktree);
  const text = readCapped(p.report, REPORT_BYTES);
  if (text === null) return { missing: ['report.md is not there: write it in the feature folder'] };
  let parsed;
  try {
    parsed = parseReport(text);
  } catch {
    const absent = missingFields(text);
    if (absent === null) return { missing: ['report.md must begin with a fenced json block holding the report\'s fields'] };
    if (absent.length > 0) return { missing: [`report.md lacks the field${absent.length > 1 ? 's' : ''}: ${absent.join(', ')}`] };
    return { missing: ['report.md has fields of the wrong kind: check status, pr, head and the lists against the brief'] };
  }
  const missing = [];
  const brief = readBriefOrSay(worktree);
  if (parsed.fields.work !== brief.work) missing.push(`report.md names the work "${parsed.fields.work}", not "${brief.work}"`);
  if (parsed.words > REPORT_WORDS) missing.push(`The report is ${parsed.words} words: cut it to ${REPORT_WORDS} or fewer`);

  const kept = readCapped(p.rulings, RULINGS_BYTES);
  if (kept === null) {
    if (exists(p.rulings)) missing.push("rulings.jsonl can't be read");
  } else {
    const reported = new Set(parsed.fields.rulings.map((r) => r.trim()));
    const seen = new Set();
    for (const line of kept.split(/\r?\n/)) {
      let ruling;
      try {
        ruling = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof ruling !== 'string' || seen.has(ruling)) continue;
      seen.add(ruling);
      if (!reported.has(ruling.trim())) missing.push(`A ruling is missing from the report's rulings: ${quoted(ruling)}`);
    }
  }
  return { missing, body: missing.length === 0 ? parsed.body.trim() : null, fields: parsed.fields };
}

// What the report lacks on the decisions the director answered with something other than the piece's recommendation (design
// section 6.4): a `rework` entry for each, naming the question, the answer chosen and the recommendation, and what the change
// cost. The answers come from the helper; one it can't give leaves its decision unchecked here, since the gate keeps holding the
// merge until that answer is applied.
async function reworkMissing({ worktree, client, fields }) {
  if (typeof client?.state?.answer !== 'function') return [];
  const decisions = readQuestions(featurePaths(worktree).questions, { maxBytes: QUESTIONS_BYTES }).questions.filter((q) => q.kind === 'question');
  const entries = reworksIn(fields);
  const missing = [];
  for (const q of decisions) {
    let said;
    try {
      said = await client.state.answer({ cwd: worktree, questionId: q.id });
    } catch {
      continue;
    }
    if (said?.ok !== true || typeof said.answer !== 'string' || said.answer === '' || said.answer === q.recommendation) continue;
    const covered = entries.some((e) => (e.question === q.id || e.question === q.what) && e.chose === said.answer && e.recommended === q.recommendation);
    if (!covered) {
      missing.push(`report.md needs a "rework" field for ${q.id}: the director chose "${said.answer}", not your recommendation "${q.recommendation}". `
        + `Add "rework": { "question": "${q.id}", "chose": "${said.answer}", "recommended": "${q.recommendation}", "cost": "<what the change cost>" } (a list of them for several)`);
    }
  }
  return missing;
}

// `inspect`, and with a `client` the rework check too.
async function inspectWithAnswers(worktree, client) {
  const checked = inspect(worktree);
  if (checked.missing.length > 0 || checked.fields === undefined) return checked;
  const rework = await reworkMissing({ worktree, client, fields: checked.fields });
  return rework.length === 0 ? checked : { ...checked, missing: rework, body: null };
}

// What report.md lacks, as `{ missing: [text] }`; empty when it is whole.
export function report({ worktree }) {
  return { missing: inspect(worktree).missing };
}

// `report`, and with a `client` that can read the director's answers, the rework a different answer needs to have reported.
export async function reportChecked({ worktree, client }) {
  return { missing: (await inspectWithAnswers(worktree, client)).missing };
}

// --- plan ---

// Records the plan just written (ruling R87): a path inside the worktree, to a
// plan file that is there, kept in plan.json as `{ plan }` with forward
// slashes. The status and the foreman read the plan from it when the brief
// names none. Returns `{ plan }`.
export function recordPlan({ worktree, argv }) {
  if (argv.length !== 1 || typeof argv[0] !== 'string' || argv[0].trim() === '') throw new CliError("Give the plan's path: plan <path>");
  const given = argv[0].trim();
  const rel = path.relative(worktree, path.resolve(worktree, given)).replaceAll('\\', '/');
  if (!planInside(worktree, rel)) throw new CliError('The plan must be a file inside this worktree');
  if (readPlan(worktree, rel) === null) throw new CliError(`${rel} isn't a plan file that can be read`);
  if (!safeFeatureFolder(worktree)) throw new CliError(FOLDER);
  writeWhole(featurePaths(worktree).plan, `${JSON.stringify({ plan: rel })}\n`);
  return { plan: rel };
}

// --- push ---

// Pushes the worktree's branch to the host through the helper, which places the project from
// the worktree's folder and applies its push rules (never the default branch, never a force).
// Returns `{ branch }`.
export async function push({ client, worktree }) {
  const branch = branchOf(worktree);
  if (branch === null) throw new CliError("This worktree isn't on a branch, so there is nothing to push");
  const pushed = await client.push({ cwd: worktree, dir: worktree, refspec: branch });
  if (pushed?.ok === true) return { branch };
  if (pushed?.rejected === 'non-fast-forward') throw new CliError(`The branch was not pushed: ${MOVED_ON}`);
  throw new CliError(`The branch was not pushed: ${pushed?.refused ?? 'the host helper gave no answer'}`);
}

// What a push the host turned down because its branch moved on says.
const MOVED_ON = 'the host\'s branch has moved on (the gate may have brought it up to date): run `cli.js pull`, then push again';

// --- pull ---

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const PULL_MS = 5 * 60 * 1000;
const UNREADABLE = 'The host helper gave an answer this could not read, so nothing was brought in';

// Brings the host's copy of the worktree's branch into it (final review, I1). The
// helper, which alone can reach the host, fetches it into its own mirror and brings it together
// with the worktree's branch there: a fast-forward, or a plain merge it makes itself, refusing a
// conflict. It hands back only the commits, as a git bundle; no key or setting of the helper's
// comes with them. The session's own git, here in the sandbox, fetches them from the bundle and
// moves the branch on with a fast-forward, which git refuses if it would overwrite uncommitted
// changes. Returns `{ branch, already, merged?, sha? }`.
export async function pull({ client, worktree }) {
  const branch = branchOf(worktree);
  if (branch === null) throw new CliError("This worktree isn't on a branch, so there is nothing to bring the host's branch into");
  const got = await client.pull({ cwd: worktree, dir: worktree, branch });
  if (got?.ok !== true) {
    const files = Array.isArray(got?.conflicts) && got.conflicts.every((f) => typeof f === 'string') && got.conflicts.length > 0
      ? ` (${got.conflicts.join(', ')})` : '';
    throw new CliError(`The host's branch was not brought in: ${got?.refused ?? 'the host helper gave no answer'}${files}`);
  }
  if (got.already === true) return { branch, already: true };
  if (!FULL_SHA.test(got.sha ?? '') || !FULL_SHA.test(got.from ?? '') || typeof got.bundle !== 'string' || !BASE64.test(got.bundle)) {
    throw new CliError(UNREADABLE);
  }
  if (!safeFeatureFolder(worktree)) throw new CliError(FOLDER);
  const file = path.join(featurePaths(worktree).dir, 'pull.bundle');
  // The fenced route; the bundle is a file on this computer, so a local path is let through. A
  // setting off the allowed list in the worktree's repository is refused with the look's line.
  const fenced = safeGit({ cwd: worktree, reach: 'local', look: 'each', list: 'project', timeoutMs: PULL_MS, caller: 'feature' });
  const git = async (args) => {
    try {
      return await fenced(args, { env: { GIT_TERMINAL_PROMPT: '0' }, input: '' });
    } catch (e) {
      throw new CliError(e.message);
    }
  };
  try {
    writeWhole(file, Buffer.from(got.bundle, 'base64'));
    const fetched = await git(['fetch', '-q', '--no-tags', file, 'refs/wheelhouse/pulled']);
    if (fetched.code !== 0) throw new CliError(`git could not read the commits the helper handed back: ${firstLine(fetched.stderr)}`);
    const moved = await git(['merge', '-q', '--ff-only', got.sha]);
    if (moved.code !== 0) throw new CliError(`git could not bring the host's branch in: ${firstLine(moved.stderr)}. If changes are not yet committed, commit them, then run pull again`);
  } finally {
    fs.rmSync(file, { force: true });
  }
  return { branch, already: false, merged: got.merged === true, sha: got.sha };
}

const firstLine = (text) => String(text ?? '').split(/\r?\n/).map((l) => l.replace(/^(?:error|fatal):\s*/, '').trim()).find((l) => l !== '') ?? 'no reason given';

// --- open-pr ---

function keptSession(file) {
  try {
    const kept = JSON.parse(readCapped(file, SMALL_BYTES) ?? 'null');
    return typeof kept?.sessionId === 'string' && SESSION_ID.test(kept.sessionId) ? kept.sessionId : null;
  } catch {
    return null;
  }
}

// How long the session waits for the helper's data check, which fits inside the session's own tool limit.
export const DATA_CHECK_MS = 100 * 1000;

// What the change is, read by the session's own git against the merge base with the host's default branch, for when the helper
// can't say: { changes: [{ status, path }], dataWork }, or null when it can't be read. The same data-model places the helper
// uses (guardrails.js dataModelPaths), plus any `paths` the branch's own configuration adds, which only widens what counts.
async function localChangeOf(worktree) {
  const fenced = safeGit({ cwd: worktree, reach: 'local', look: 'each', list: 'project', timeoutMs: 30 * 1000, caller: 'feature' });
  const git = (args) => fenced(args, { env: { GIT_TERMINAL_PROMPT: '0' }, input: '' });
  try {
    let base = null;
    for (const ref of ['origin/HEAD', 'origin/main', 'origin/master', 'origin/trunk', 'origin/develop']) {
      const got = await git(['merge-base', 'HEAD', ref]);
      if (got.code === 0 && /^[0-9a-f]{40,64}$/.test(got.stdout.trim())) {
        base = got.stdout.trim();
        break;
      }
    }
    if (base === null) return null;
    const listed = await git(['diff', '--name-status', '-z', '--no-renames', '--no-ext-diff', base, 'HEAD']);
    if (listed.code !== 0) return null;
    const parts = listed.stdout.split('\0');
    const changes = [];
    for (let i = 0; i + 1 < parts.length; i += 2) changes.push({ status: parts[i], path: parts[i + 1] });
    let config = null;
    try {
      config = readConfig(fs.readFileSync(path.join(worktree, '.claude', 'wheelhouse.json'), 'utf8'));
    } catch { /* none, or one that can't be read: the defaults alone */ }
    return { changes, dataWork: dataModelPaths(changes.map((c) => c.path), config).length > 0 };
  } catch {
    return null;
  }
}

// What the helper makes of the pushed branch for the proof note (design section 7 of the director's way of working): whether the
// change is data work and, where the project names a read-only data command, the data before and after. A check the helper
// can't make (it refuses, fails, is not there or takes too long) never stops the pull request, but the session then reads the
// change's files itself, so data work is still found and still needs its comparison or its reason.
async function dataFacts({ client, worktree, branch, declared, dataMs, localChange }) {
  let why;
  if (typeof client?.dataCheck !== 'function') {
    why = "the helper's data check is not there";
  } else {
    let timer;
    try {
      const got = await Promise.race([
        client.dataCheck({ cwd: worktree, branch, declared }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('it took too long')), dataMs); }),
      ]);
      if (got?.ok === true) return { made: true, ...got };
      why = got?.refused ?? 'the helper gave no answer';
    } catch (error) {
      why = String(error?.message ?? error).slice(0, 200);
    } finally {
      clearTimeout(timer);
    }
  }
  const local = await localChange(worktree);
  // Where the files can't be read here either, the note says so rather than passing quietly.
  return { made: false, why: local === null ? `${why}, and the changed files could not be read here either` : why, ...(local === null ? {} : local) };
}

// The proof note for the piece: the report's words, the calls it logged, the decisions it followed, the pages it touches and,
// for data work, the data before and after. Throws a CliError when the change is data work (the helper says so, or the session's
// own reading of the files does, or the report says its change moves data) and there is neither a comparison nor a reason in
// the report's `data`. A reason is taken where nothing could be compared: no data command, or a command that failed or a check
// that could not be made, which the note then prints as such beside the reason. Where the comparison was made, a reason is ignored.
function proofFor({ worktree, checked, facts }) {
  const { fields, body } = checked;
  const data = fields.data;
  const comparable = facts.made && facts.ran === true;
  const failure = facts.made && facts.ran === false && facts.failed === true ? facts.why : undefined;
  const failureTail = failure !== undefined && typeof facts.tail === 'string' ? facts.tail : undefined;
  const unavailable = facts.made ? undefined : facts.why;
  const isData = facts.dataWork === true || data !== undefined;
  if (isData && !comparable && data?.none === undefined) {
    const because = failure !== undefined ? `the data command failed: ${failure}` : unavailable !== undefined ? `the data check could not be made: ${unavailable}` : (facts.why ?? 'there is no data command');
    throw new CliError(`The pull request is not opened: this change is data work and no before-and-after of the data could be made (${because}). `
      + 'Add "data": { "none": "<why there is nothing to compare>" } to report.md, '
      + 'or { "expect": ["<the tables this change is meant to move>"] } where the project\'s data command can run.');
  }
  let note = null;
  if (isData) {
    const route = facts.route === 'real' ? 'real' : 'test';
    const refused = facts.realRefused ? { realRefused: facts.realRefused } : {};
    note = comparable
      ? { route, comparison: compareSnapshots(facts.before, facts.after, { expect: data?.expect ?? [] }), ...refused }
      : { route, none: data.none, ...(failure === undefined ? {} : { failure, ...(failureTail === undefined ? {} : { failureTail }) }), ...(unavailable === undefined ? {} : { unavailable }), ...refused };
  }
  const pages = touchedPages(Array.isArray(facts.changes) ? facts.changes : []);
  return proofNote({
    report: { fields, body, goal: readBrief(worktree).goal },
    calls: readLog(worktree),
    followed: fields.followed ?? [],
    review: null,
    previews: pages.map((page) => ({ page })),
    data: note,
    notes: !isData && unavailable !== undefined ? [`The data check could not be made: ${unavailable}.`] : [],
  });
}

// Opens the pull request from the worktree's branch against the default branch (the helper
// takes a missing base for it) and keeps its number in pr.json, with the plan it was opened for
// (ruling R88). A pull request kept already is not opened again until the foreman's merge marks
// it merged: then the next slice's is opened. The report becomes the pull request's body, so
// nothing is opened until the report passes the `report` check. The branch is pushed first,
// through the helper, since the host opens a pull request only from a branch it holds. The
// helper places the project from the worktree's folder.
export async function openPr({ client, worktree, argv, dataClient = client, dataMs = DATA_CHECK_MS, localChange = localChangeOf }) {
  const found = flagsOf(argv, ['title']);
  const title = needed(found, 'title');
  if (!safeFeatureFolder(worktree)) throw new CliError(FOLDER);
  const p = featurePaths(worktree);
  const already = readPrRecord(worktree);
  if (already !== null && !already.merged) return { number: already.pr, already: true };
  const head = branchOf(worktree);
  if (head === null) throw new CliError("This worktree isn't on a branch, so there is nothing to open a pull request from");
  const checked = await inspectWithAnswers(worktree, client);
  if (checked.missing.length > 0) throw new CliError(`The pull request is not opened until the report passes. ${checked.missing.join(' ')}`);
  const session = keptSession(p.session);
  // The host opens a pull request only from a branch it holds.
  await push({ client, worktree });
  const note = proofFor({ worktree, checked, facts: await dataFacts({ client: dataClient, worktree, branch: head, declared: checked.fields.data !== undefined, dataMs, localChange }) });
  const opened = await client.openPr({ cwd: worktree, head, title, body: note, ...(session ? { session } : {}) });
  if (opened?.ok !== true) throw new CliError(opened?.refused ?? 'The host helper did not open the pull request');
  const number = opened.result?.number;
  if (!Number.isSafeInteger(number) || number < 1) throw new CliError('The host opened a pull request but gave no number for it');
  let plan = null;
  try {
    plan = planIn(worktree, readBrief(worktree));
  } catch { /* the report check read the brief; a plan is only kept when there is one */ }
  writeWhole(p.pr, `${JSON.stringify({ pr: number, ...(plan ? { plan } : {}) })}\n`);
  return { number, already: false };
}

// --- The command line ---

const COMMANDS = ['ask', 'stuck', 'wait-for', 'log', 'answer', 'plan', 'report', 'push', 'pull', 'open-pr'];

// Runs a command and resolves with the exit code. `out` and `err` take text to show.
export async function main(argv, {
  cwd = process.cwd(), client, out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t), find = featureWorktree,
} = {}) {
  try {
    const [command, ...rest] = argv;
    if (!COMMANDS.includes(command)) throw new CliError(`Commands: ${COMMANDS.join(', ')}`);
    const found = find(cwd);
    if (found === null) throw new CliError("This folder isn't a feature session's worktree: run the command from there");
    const worktree = found.root;
    const helper = () => client ?? helperClient();

    if (command === 'ask') {
      out(`${(await ask({ worktree, argv: rest, client: helper() })).id}\n`);
    } else if (command === 'stuck') {
      stuck({ worktree, argv: rest });
      out('Noted: the director will be told you are stuck. Carry on with what does not depend on the answer.\n');
    } else if (command === 'wait-for') {
      if (rest.length !== 1) throw new CliError('Give the id of the decision: wait-for <questionId>');
      const got = await waitFor({ client: helper(), worktree, questionId: rest[0] });
      out(got.waiting
        ? 'Waiting for the director: your slot is free. End your turn; the answer wakes you.\n'
        : `That decision is answered already: ${got.answer}. Read it with \`answer ${rest[0]}\` and carry on.\n`);
    } else if (command === 'log') {
      log({ worktree, argv: rest });
      out('Logged.\n');
    } else if (command === 'answer') {
      const flag = rest.length === 2 ? rest[1] : null;
      const noChange = flag === '--no-change';
      const applied = flag === '--applied';
      if (rest.length !== 1 && !noChange && !applied) {
        throw new CliError('Give the id of the question: answer <questionId>, then --applied once the change the answer asks for is pushed, or --no-change when it asks for none');
      }
      const { answer: label } = await answer({ client: helper(), worktree, questionId: rest[0], noChange, applied });
      out(label === null ? 'There is no answer yet.\n' : `${label}\n`);
    } else if (command === 'plan') {
      out(`Recorded the plan: ${recordPlan({ worktree, argv: rest }).plan}\n`);
    } else if (command === 'report') {
      if (rest.length > 0) throw new CliError('report takes no arguments');
      const { missing } = await reportChecked({ worktree, client: helper() });
      if (missing.length > 0) {
        err(`${missing.join('\n')}\n`);
        return 1;
      }
      out('The report is whole.\n');
    } else if (command === 'push') {
      if (rest.length > 0) throw new CliError('push takes no arguments');
      out(`Pushed ${(await push({ client: helper(), worktree })).branch}\n`);
    } else if (command === 'pull') {
      if (rest.length > 0) throw new CliError('pull takes no arguments');
      const pulled = await pull({ client: helper(), worktree });
      if (pulled.already) out(`Already up to date with the host's ${pulled.branch}\n`);
      else if (pulled.merged) out(`Brought in the host's ${pulled.branch}: merged with this branch at ${pulled.sha.slice(0, 12)}\n`);
      else out(`Brought in the host's ${pulled.branch}: this branch is now at ${pulled.sha.slice(0, 12)}\n`);
    } else {
      const { number, already } = await openPr({ client: helper(), worktree, argv: rest, dataClient: client ?? helperClient({ timeout: DATA_CHECK_MS }) });
      out(already ? `The pull request is open already: #${number}\n` : `Opened pull request #${number}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof SentBack) {
      err(`${error.problems.join('\n')}\n`);
      return 2;
    }
    err(`${error instanceof CliError ? error.message : `That did not work: ${error instanceof Error ? error.message : 'unknown error'}`}\n`);
    return 1;
  }
}

if (startedAsScript(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
