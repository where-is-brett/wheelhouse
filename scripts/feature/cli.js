// scripts/feature/cli.js
// The commands a feature session runs, as `node "<pluginRoot>/scripts/feature/cli.js" <command> …`:
//   ask      writes a question for the director and prints its id
//   answer   prints the director's answer to a question, once it is signed
//   plan     records the plan just written, in plan.json, for the status and the foreman
//   report   checks report.md and that it holds every ruling kept, then stamps it with what built it
//   open-pr  opens the feature's pull request and keeps its number with its plan
// Each command's core is an exported function that takes the helper's client and
// the worktree, so tests use a fake helper. Files are read and written only in the
// feature folder, through the safe readers and writers of status.js; the head
// branch is read from the .git files. Nothing here runs git.
// These commands run inside the project's sandbox, which cannot read ~/.wheelhouse
// (ruling R150): nothing here reads it. Each helper request carries the worktree's
// folder as `cwd`, and the helper places the project from it; STOP, too, comes
// from the helper.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { QUESTION_ID, QUESTION_KINDS, featurePaths, parseReport, readQuestions } from './files.js';
import {
  planIn, planInside, readBrief, readCapped, readPlan, readPrRecord, safeFeatureFolder, writeWhole, SMALL_BYTES,
} from './status.js';
import { featureWorktree } from '../hooks/feature-status.js';
import { branchOf } from '../hooks/session-start.js';
import { helperClient } from '../host/helper-client.js';
import { REPORT_WORDS } from '../lib/build-loop.js';
import { parseProvenance, withBlock } from '../lineage/provenance.js';

// An error whose message is said to the session as it is.
export class CliError extends Error {}

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

// Appends a question to questions.jsonl and returns `{ id }`.
export function ask({ worktree, argv }) {
  const found = flagsOf(argv, ['kind', 'what', 'why', 'option', 'recommend', 'level', 'plan']);
  const kind = single(found, 'kind') ?? 'question';
  if (!QUESTION_KINDS.includes(kind)) throw new CliError(`--kind is ${QUESTION_KINDS.join(' or ')}`);
  const what = needed(found, 'what');
  const why = needed(found, 'why');
  const recommendation = needed(found, 'recommend');
  const levelText = needed(found, 'level');
  if (!/^[1-4]$/.test(levelText)) throw new CliError('--level is a decision level from 1 to 4');
  const plan = single(found, 'plan')?.trim();
  if (kind === 'extra-plan' && !plan) throw new CliError('An extra-plan needs --plan, the path of the plan being handed back');
  if (kind !== 'extra-plan' && found.plan !== undefined) throw new CliError('--plan is only for --kind extra-plan');

  const options = (found.option ?? []).map((text) => {
    const at = text.indexOf('=');
    const label = at < 0 ? '' : text.slice(0, at).trim();
    if (label === '') throw new CliError(`--option "${text}" is written as "<label>=<what it means>"`);
    return { label, says: text.slice(at + 1).trim() };
  });
  if (options.length < 2) throw new CliError('Give two or more options, each with --option "<label>=<what it means>"');
  if (new Set(options.map((o) => o.label)).size !== options.length) throw new CliError('Each option needs its own label');
  if (!options.some((o) => o.label === recommendation)) throw new CliError(`--recommend must be the label of one option (${options.map((o) => o.label).join(', ')})`);

  const brief = readBriefOrSay(worktree);
  if (!safeFeatureFolder(worktree)) throw new CliError(FOLDER);
  const p = featurePaths(worktree);
  const id = nextQuestionId(p.questions, brief.work);
  const question = { id, kind, what, why, options, recommendation, level: Number(levelText), ...(kind === 'extra-plan' ? { plan } : {}) };
  const kept = readCapped(p.questions, QUESTIONS_BYTES);
  // A file that is there but can't be read (a link, a folder) must not be replaced.
  if (kept === null && exists(p.questions)) throw new CliError("questions.jsonl can't be added to");
  const before = kept ?? '';
  const lead = before === '' || before.endsWith('\n') ? '' : '\n';
  writeWhole(p.questions, `${before}${lead}${JSON.stringify(question)}\n`);
  return { id };
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

// --- answer ---

// The label the director chose, or null while the question has no signed answer. The helper
// places the project from the worktree's folder.
export async function answer({ client, worktree, questionId }) {
  if (typeof questionId !== 'string' || !QUESTION_ID.test(questionId)) throw new CliError('Give the id of the question, as ask printed it');
  const said = await client.state.answer({ cwd: worktree, questionId });
  if (said?.ok !== true) throw new CliError(said?.refused ?? 'The host helper gave no answer');
  if (said.answer === null) return { answer: null };
  if (typeof said.answer !== 'string' || said.answer === '') throw new CliError('The host helper gave an answer this could not read');
  return { answer: said.answer };
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
  return { missing, body: missing.length === 0 ? parsed.body.trim() : null };
}

// What report.md lacks, as `{ missing: [text] }`; empty when it is whole.
export function report({ worktree }) {
  return { missing: inspect(worktree).missing };
}

// Stamps report.md with `block`, the one that says what built it (the helper's, the same block it
// stamps in the pull request), in place of any it had. Returns whether report.md was written.
export function stampReport({ worktree, block }) {
  if (typeof block !== 'string' || parseProvenance(block) === null) throw new CliError('The helper gave a provenance block that can\'t be read');
  if (!safeFeatureFolder(worktree)) throw new CliError(FOLDER);
  const file = featurePaths(worktree).report;
  const text = readCapped(file, REPORT_BYTES);
  if (text === null) throw new CliError("report.md can't be read");
  const stamped = withBlock(text, block);
  if (stamped === text) return false;
  writeWhole(file, stamped);
  return true;
}

const NO_PROVENANCE = 'The report carries no provenance block.';

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

// --- open-pr ---

function keptSession(file) {
  try {
    const kept = JSON.parse(readCapped(file, SMALL_BYTES) ?? 'null');
    return typeof kept?.sessionId === 'string' && SESSION_ID.test(kept.sessionId) ? kept.sessionId : null;
  } catch {
    return null;
  }
}

// Opens the pull request from the worktree's branch against the default branch (the helper
// takes a missing base for it) and keeps its number in pr.json, with the plan it was opened for
// (ruling R88). A pull request kept already is not opened again until the foreman's merge marks
// it merged: then the next slice's is opened. The report becomes the pull request's body, so
// nothing is opened until the report passes the `report` check. The helper places the project
// from the worktree's folder.
export async function openPr({ client, worktree, argv }) {
  const found = flagsOf(argv, ['title']);
  const title = needed(found, 'title');
  if (!safeFeatureFolder(worktree)) throw new CliError(FOLDER);
  const p = featurePaths(worktree);
  const already = readPrRecord(worktree);
  if (already !== null && !already.merged) return { number: already.pr, already: true };
  const head = branchOf(worktree);
  if (head === null) throw new CliError("This worktree isn't on a branch, so there is nothing to open a pull request from");
  const checked = inspect(worktree);
  if (checked.missing.length > 0) throw new CliError(`The pull request is not opened until the report passes. ${checked.missing.join(' ')}`);
  const session = keptSession(p.session);
  const opened = await client.openPr({ cwd: worktree, head, title, body: checked.body, ...(session ? { session } : {}) });
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

const COMMANDS = ['ask', 'answer', 'plan', 'report', 'open-pr'];

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
      out(`${ask({ worktree, argv: rest }).id}\n`);
    } else if (command === 'answer') {
      if (rest.length !== 1) throw new CliError('Give the id of the question: answer <questionId>');
      const { answer: label } = await answer({ client: helper(), worktree, questionId: rest[0] });
      out(label === null ? 'There is no answer yet.\n' : `${label}\n`);
    } else if (command === 'plan') {
      out(`Recorded the plan: ${recordPlan({ worktree, argv: rest }).plan}\n`);
    } else if (command === 'report') {
      if (rest.length > 0) throw new CliError('report takes no arguments');
      const { missing } = report({ worktree });
      if (missing.length > 0) {
        err(`${missing.join('\n')}\n`);
        return 1;
      }
      out('The report is whole.\n');
      // The session's own block, and whether STOP is on, from the helper (rulings R147, R150):
      // this command runs where the Wheelhouse home can't be read. The session is the one the
      // hooks kept. A helper that gives no answer, or doesn't say STOP is off, gives no block,
      // so nothing is stamped.
      const session = keptSession(featurePaths(worktree).session);
      let got = null;
      try {
        got = await helper().lineage.provenance({ cwd: worktree, ...(session ? { session } : {}) });
      } catch { /* said below */ }
      if (got?.ok === true && got.stop === true) {
        out('STOP is on, so the report was not stamped with what built it.\n');
        return 0;
      }
      const usable = got?.ok === true && got.stop === false && session !== null && typeof got.block === 'string';
      const block = usable ? got.block : null;
      if (block === null) out(`${NO_PROVENANCE}\n`);
      else if (stampReport({ worktree, block })) out('It now says what built it.\n');
    } else {
      const { number, already } = await openPr({ client: helper(), worktree, argv: rest });
      out(already ? `The pull request is open already: #${number}\n` : `Opened pull request #${number}\n`);
    }
    return 0;
  } catch (error) {
    err(`${error instanceof CliError ? error.message : `That did not work: ${error instanceof Error ? error.message : 'unknown error'}`}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
