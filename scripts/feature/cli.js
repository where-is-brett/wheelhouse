// scripts/feature/cli.js
// The commands a feature session runs, as `node "<pluginRoot>/scripts/feature/cli.js" <command> …`:
//   ask      writes a question for the director and prints its id; with --kind build-command,
//            asks for build commands on Windows (design section 12.2)
//   answer   prints the director's answer to a question, once it is signed
//   plan     records the plan just written, in plan.json, for the status and the foreman
//   report   checks report.md and that it holds every ruling kept, then stamps it with what built it
//   push     pushes the worktree's branch to the host, through the helper (after a fix)
//   pull     brings the host's copy of the worktree's branch into it, through the helper (when
//            the host's has moved on, as when the gate brought it up to date)
//   open-pr  pushes the branch, opens the feature's pull request and keeps its number with its plan
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
import { QUESTION_ID, QUESTION_KINDS, featurePaths, parseReport, readQuestions } from './files.js';
import {
  planIn, planInside, readBrief, readCapped, readPlan, readPrRecord, safeFeatureFolder, writeWhole, SMALL_BYTES,
} from './status.js';
import { questionProblem } from '../cards/compose.js';
import { featureWorktree } from '../hooks/feature-status.js';
import { branchOf } from '../hooks/session-start.js';
import { helperClient } from '../host/helper-client.js';
import { REPORT_WORDS } from '../lib/build-loop.js';
import { readConfig } from '../gate/guardrails.js';
import { parseProvenance, withBlock } from '../lineage/provenance.js';
import { BUILD_QUESTION_LABELS, BUILD_QUESTION_OPTIONS, isConfiguredBuildCommand } from '../protection/windows-builds.js';
import { startedAsScript } from '../lib/started-as-script.js';

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

// What a question or an extra plan asks, with the options, recommendation and level the
// session gives it.
function plainQuestion(found, kind) {
  if (found.command !== undefined) throw new CliError('--command is only for --kind build-command');
  const what = needed(found, 'what');
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
  return { what, options, recommendation, level: Number(levelText), ...(kind === 'extra-plan' ? { plan } : {}) };
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
  return `Let this feature's builder run: ${named.join('; ')}.`;
}

// A build-command question (design section 12.2): its options are the design's, never the
// session's, and each command must be local git or one of the configuration's build commands,
// as the helper reads it from the default branch, never the working copy.
async function buildQuestion(found, { worktree, client }) {
  for (const flag of ['what', 'option', 'recommend', 'level', 'plan']) {
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
  const found = flagsOf(argv, ['kind', 'what', 'why', 'option', 'recommend', 'level', 'plan', 'command']);
  const kind = single(found, 'kind') ?? 'question';
  if (!QUESTION_KINDS.includes(kind)) throw new CliError(`--kind is ${QUESTION_KINDS.join(', ')}`);
  const why = needed(found, 'why');
  const asked = kind === 'build-command' ? await buildQuestion(found, { worktree, client }) : plainQuestion(found, kind);

  const brief = readBriefOrSay(worktree);
  if (!safeFeatureFolder(worktree)) throw new CliError(FOLDER);
  const p = featurePaths(worktree);
  const id = nextQuestionId(p.questions, brief.work);
  const { what, ...rest } = asked;
  const question = { id, kind, what, why, ...rest };
  const problem = kind === 'extra-plan' ? null : questionProblem({ ...question, work: brief.work });
  if (problem !== null) throw new CliError(`This question can't be put to the director as a card, so it wasn't asked: ${problem}`);
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

// Opens the pull request from the worktree's branch against the default branch (the helper
// takes a missing base for it) and keeps its number in pr.json, with the plan it was opened for
// (ruling R88). A pull request kept already is not opened again until the foreman's merge marks
// it merged: then the next slice's is opened. The report becomes the pull request's body, so
// nothing is opened until the report passes the `report` check. The branch is pushed first,
// through the helper, since the host opens a pull request only from a branch it holds. The
// helper places the project from the worktree's folder.
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
  // The host opens a pull request only from a branch it holds.
  await push({ client, worktree });
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

const COMMANDS = ['ask', 'answer', 'plan', 'report', 'push', 'pull', 'open-pr'];

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
      const { number, already } = await openPr({ client: helper(), worktree, argv: rest });
      out(already ? `The pull request is open already: #${number}\n` : `Opened pull request #${number}\n`);
    }
    return 0;
  } catch (error) {
    err(`${error instanceof CliError ? error.message : `That did not work: ${error instanceof Error ? error.message : 'unknown error'}`}\n`);
    return 1;
  }
}

if (startedAsScript(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
