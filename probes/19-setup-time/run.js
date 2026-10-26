// probes/19-setup-time/run.js
// Check 19: setup timed on a fresh account. The agent's steps of the run sheet (run.md), as
// subcommands:
//   node run.js setup [--root <folder>]          the shared folder: copies of this script and run.md,
//                                                and notes.md (root: a wheelhouse-check19* folder
//                                                under /Users/Shared or the temporary folder)
//   node run.js desktop-note --tag <tag> [--root <folder>] [--readme <file>] [--folder-name <name>]
//                                                the note for the throwaway account's desktop: the
//                                                README's Install section, its line with the tag in
//   node run.js times [--root <folder>] [--folder <product folder>] [--home <Wheelhouse home>]
//                                                reads setup's journal and records in this account's
//                                                Wheelhouse home, and writes the director's minutes
//                                                per step, the waits and the total into the notes,
//                                                times.json and cards.json (run in the throwaway
//                                                account: its ~/.wheelhouse is its own only)
//   node run.js gone <owner/name> [--want absent|present]
//                                                asks the host, with the signed-in `gh`, whether the
//                                                repository is there: a 404 is "absent" only for
//                                                the login's own repository (at the sitting only;
//                                                never in a test)
//   node run.js asked <transcript.jsonl> [...]   Windows: how long each AskUserQuestion card in a
//                                                session's transcript waited for its answer
//   node run.js cards <cards.json> [--steps 2,4,6,9]
//                                                Windows: the cards the Mac run showed, for those steps
//   node run.js cleanup <root>                   removes a shared folder made by `setup`
//
// The pure parts (stepTimes, summarise, notesSection, installLineOf, desktopNote, statusOf,
// askedDurations, pickRun), and setup, are exported for tests/probes/19-setup-time/run.test.js. This script is
// copied into the shared folder and run from there in the throwaway account, so it imports nothing
// from the plugin: `stepTimes` is journal.js's own, copied, and TARGET_MINUTES is
// scripts/lib/setup-numbers.js's; the test holds both to the plugin's. It runs on Node.js 20 too,
// since the throwaway account may still have the Mac's 20.9.0 when `times` is run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
export const PREFIX = 'wheelhouse-check19';
export const SHARED_ROOT = `/Users/Shared/${PREFIX}`;
// The design's target for the director's time, in minutes (scripts/lib/setup-numbers.js).
export const TARGET_MINUTES = 15;
// "Within about" the target, read by this run sheet as up to two minutes over (run.md, "The Answer").
export const ABOUT_MINUTES = 2;
// The folder the director makes for the product, which names the test repository.
export const FOLDER_NAME = 'wh19-trial';
// The steps' titles, as scripts/state/card-lines.js's SETUP_TITLES.
export const TITLES = Object.freeze({
  1: 'Install', 2: 'Tools', 3: 'The host and the connection', 4: 'Three questions', 5: 'Rules found',
  6: 'Changes to this computer', 7: 'The project\'s files, pins and protection', 8: 'Locked', 9: 'Phone notifications', 10: 'Health check',
});
const HEALTH_STEP = 10;
const INSTALL_STEP = 1;
const INSTALL_LINE = /^\s*(claude plugin marketplace add "[^"\s#]+#)(?:<tag>|[A-Za-z0-9._-]+)(" --scope project)\s*$/m;

function option(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

// A folder this script may make or remove: a wheelhouse-check19* folder inside /Users/Shared or
// the temporary folder, never one of those itself.
export function assertScratch(dir, { tmp = os.tmpdir() } = {}) {
  const resolved = path.resolve(dir);
  let real = tmp;
  try { real = fs.realpathSync(tmp); } catch { /* the given name only */ }
  const allowed = [tmp, real, '/Users/Shared'].map((root) => path.resolve(root));
  const inside = allowed.some((root) => resolved !== root && path.dirname(resolved) === root);
  if (!inside || !path.basename(resolved).startsWith(PREFIX)) {
    throw new Error(`Refusing to touch ${resolved}: not a ${PREFIX} folder directly in /Users/Shared or the temporary folder`);
  }
  return resolved;
}

// ---- The times (pure) ----

// scripts/setup/journal.js's stepTimes, copied: for each step with its card shown, clicked and
// finished, the director's time from shown to clicked and the wait from clicked to finished, in
// milliseconds, in step order.
export function stepTimes(run) {
  const times = [];
  for (const key of Object.keys(run.steps ?? {}).map(Number).sort((a, b) => a - b)) {
    const { shownAt, clickedAt, doneAt } = run.steps[key];
    if (!shownAt || !clickedAt || !doneAt) continue;
    const directorMs = Date.parse(clickedAt) - Date.parse(shownAt);
    const waitMs = Date.parse(doneAt) - Date.parse(clickedAt);
    if (Number.isNaN(directorMs) || Number.isNaN(waitMs)) continue;
    times.push({ step: key, directorMs, waitMs });
  }
  return times;
}

const ms = (iso) => (typeof iso === 'string' ? Date.parse(iso) : NaN);
export const minutes = (n) => (Number.isFinite(n) ? Math.round(n / 6000) / 10 : null);

// The run of the journal for `folder` (the newest of its runs), or the newest run of all when no
// folder is given; null when there is none. Folders are compared as given and by real path.
export function pickRun(journal, folder, { real = (p) => p } = {}) {
  const runs = Array.isArray(journal?.runs) ? journal.runs : [];
  const want = folder === undefined ? null : new Set([path.resolve(folder), real(path.resolve(folder))]);
  const mine = want === null ? runs : runs.filter((r) => typeof r.folder === 'string' && (want.has(r.folder) || want.has(real(r.folder))));
  if (mine.length === 0) return null;
  return [...mine].sort((a, b) => ms(a.startedAt) - ms(b.startedAt)).at(-1);
}

// The time from each question's asking (as last asked) to its answer, for one run: asked records
// { runId, step, id, at }, answers { at, data: { runId, step, questionId } }. An answer before its
// question's last asking was for an earlier asking, and is passed over; the latest answer counts.
export function questionTimes(runId, asked, answers) {
  const out = [];
  for (const q of asked.filter((a) => a?.runId === runId)) {
    const theirs = answers.filter((e) => e?.data?.runId === runId && e.data.step === q.step && e.data.questionId === q.id && ms(e.at) >= ms(q.at));
    if (theirs.length === 0) {
      out.push({ step: q.step, id: q.id, askedAt: q.at, answeredAt: null, directorMs: null });
      continue;
    }
    const last = theirs.sort((a, b) => ms(a.at) - ms(b.at)).at(-1);
    out.push({ step: q.step, id: q.id, askedAt: q.at, answeredAt: last.at, directorMs: ms(last.at) - ms(q.at) });
  }
  return out.sort((a, b) => a.step - b.step || ms(a.askedAt) - ms(b.askedAt));
}

// The run's times: when it began (step 1's firstMessageAt, R76, else the run's start), when the
// board went green (step 10's answer, else its done mark), each step's card time and wait, its
// questions' times, and its share of the whole (from the step finished before it to its own finish,
// in the order they finished, so the shares add up to the total), the slowest three shares, and the
// verdict against TARGET_MINUTES.
export function summarise(run, { asked = [], answers = [], target = TARGET_MINUTES, about = ABOUT_MINUTES } = {}) {
  const changes = Array.isArray(run.changes) ? run.changes : [];
  const answerOf = (n) => changes.filter((c) => c?.kind === 'answer' && c.step === n).at(-1)?.after ?? null;
  const install = answerOf(INSTALL_STEP);
  const firstMessageAt = typeof install?.firstMessageAt === 'string' ? install.firstMessageAt : null;
  const startAt = firstMessageAt ?? run.startedAt ?? null;
  const health = answerOf(HEALTH_STEP);
  const greenAt = typeof health?.green === 'string' ? health.green : (run.steps?.[HEALTH_STEP]?.doneAt ?? null);
  const cards = new Map(stepTimes(run).map((t) => [t.step, t]));
  const questions = questionTimes(run.id, asked, answers);
  const finished = Object.entries(run.steps ?? {}).map(([n, e]) => ({ step: Number(n), doneAt: e?.doneAt ?? null }))
    .filter((s) => Number.isFinite(ms(s.doneAt))).sort((a, b) => ms(a.doneAt) - ms(b.doneAt) || a.step - b.step);
  const share = new Map();
  let from = ms(startAt);
  for (const s of finished) {
    share.set(s.step, Number.isFinite(from) ? Math.max(0, ms(s.doneAt) - from) : null);
    from = Math.max(Number.isFinite(from) ? from : -Infinity, ms(s.doneAt));
  }
  const numbers = [...new Set([...Object.keys(TITLES).map(Number), ...Object.keys(run.steps ?? {}).map(Number)])].sort((a, b) => a - b);
  const steps = numbers.filter((n) => run.steps?.[n] || questions.some((q) => q.step === n)).map((n) => {
    const entry = run.steps?.[n] ?? {};
    const card = cards.get(n) ?? null;
    const own = questions.filter((q) => q.step === n);
    const questionMs = own.reduce((sum, q) => sum + (q.directorMs ?? 0), 0);
    return {
      step: n, title: TITLES[n] ?? null,
      cardMs: card?.directorMs ?? null, waitMs: card?.waitMs ?? null,
      questions: own.map((q) => ({ id: q.id, directorMs: q.directorMs })),
      directorMs: (card?.directorMs ?? 0) + questionMs,
      doneAt: entry.doneAt ?? null, shareMs: share.get(n) ?? null,
      ...(entry.failed ? { failed: entry.failed } : {}),
    };
  });
  const totalMs = Number.isFinite(ms(startAt)) && Number.isFinite(ms(greenAt)) ? ms(greenAt) - ms(startAt) : null;
  const slowest = steps.filter((s) => s.shareMs !== null).sort((a, b) => b.shareMs - a.shareMs).slice(0, 3).map((s) => s.step);
  let verdict = 'No green board';
  if (totalMs !== null) verdict = minutes(totalMs) <= target + about ? 'Yes' : 'Partly';
  return {
    runId: run.id ?? null, folder: run.folder ?? null, startedAt: run.startedAt ?? null, firstMessageAt, startAt, greenAt,
    totalMs, totalMinutes: minutes(totalMs), targetMinutes: target, aboutMinutes: about,
    directorMs: steps.reduce((sum, s) => sum + s.directorMs, 0),
    waitMs: steps.reduce((sum, s) => sum + (s.waitMs ?? 0), 0),
    steps, slowest, verdict,
    unfinished: numbers.filter((n) => n <= HEALTH_STEP && !run.steps?.[n]?.doneAt),
    closed: run.closedAt ?? null,
  };
}

const cell = (n) => (n === null || n === undefined ? '—' : String(minutes(n)));

// The notes' section for a summary: a table of the steps in minutes, then the totals and the verdict.
export function notesSection(s, { at = new Date().toISOString() } = {}) {
  const lines = [
    `## Times (from the journal, read ${at})`, '',
    `Run ${s.runId}. Started (step 1's first message): ${s.firstMessageAt ?? `not found; the run's start, ${s.startedAt}`}. Green board: ${s.greenAt ?? 'not reached'}.`, '',
    '| Step | Card read and clicked (min) | Questions answered (min) | Wait after the click (min) | Share of the whole (min) |',
    '|---|---|---|---|---|',
  ];
  for (const step of s.steps) {
    const q = step.questions.length ? step.questions.map((x) => `${x.id} ${cell(x.directorMs)}`).join('; ') : '—';
    lines.push(`| ${step.step}. ${step.title ?? ''}${step.failed ? ` (failed once: ${step.failed})` : ''} | ${cell(step.cardMs)} | ${q} | ${cell(step.waitMs)} | ${cell(step.shareMs)} |`);
  }
  lines.push('');
  lines.push(`- Total, first message to green board: ${s.totalMinutes ?? '—'} minutes (target ${s.targetMinutes}, "about" read as up to ${s.targetMinutes + s.aboutMinutes}).`);
  lines.push(`- The director's own card and question time: ${minutes(s.directorMs)} minutes; the waits after clicks: ${minutes(s.waitMs)} minutes (they overlap other steps' questions).`);
  lines.push(`- Slowest shares: ${s.slowest.map((n) => `step ${n} (${cell(s.steps.find((x) => x.step === n).shareMs)})`).join(', ') || 'none'}.`);
  if (s.unfinished.length) lines.push(`- Not finished: steps ${s.unfinished.join(', ')}.`);
  lines.push(`- Verdict on these numbers: ${s.verdict}.`, '');
  return lines.join('\n');
}

// ---- The note on the desktop (pure) ----

// The README's install line, the one that adds Wheelhouse's marketplace at a release, with `<tag>` in
// place of the release the README names (or `<tag>` itself); throws when the README has none.
export function installLineOf(readme) {
  const m = INSTALL_LINE.exec(readme);
  if (!m) throw new Error('The README holds no install line of the form \'claude plugin marketplace add "<source>#<tag>" --scope project\'');
  return `${m[1]}<tag>${m[2]}`;
}

// The note: what this is, the folder's name, and the README's Install section as it is, with the
// tag put into its line only, in place of whichever the README names.
export function desktopNote(readme, tag, { folderName = FOLDER_NAME } = {}) {
  if (typeof tag !== 'string' || !/^[A-Za-z0-9._-]+$/.test(tag)) throw new Error('The tag is letters, digits, dots, dashes and underscores');
  installLineOf(readme);
  const start = readme.search(/^## Install\s*$/m);
  if (start === -1) throw new Error('The README has no "## Install" section');
  const rest = readme.slice(start);
  const next = rest.slice(3).search(/^## /m);
  const section = (next === -1 ? rest : rest.slice(0, next + 3)).trimEnd();
  const filled = section.replace(INSTALL_LINE, (line) => line.replace(/#[^"\s]+"/, `#${tag}"`));
  return [
    'Wheelhouse: check 19, the timed run',
    '',
    'Set up Wheelhouse on this account as if it were a new computer of yours, following the steps below',
    'and what setup shows you. Nobody helps during the run. If you get stuck, say so in the session and',
    'carry on; it is part of what is measured.',
    '',
    '- Sign in to Claude Desktop first: that is not timed. The time runs from the line you paste.',
    `- Name the product's folder ${folderName}, under Projects in your home folder.`,
    `- The release to use is ${tag}: it is already in the line below.`,
    '- When setup asks how agents reach GitHub, choose as you would for a personal project.',
    '- The run ends at the green board. Then tell the agent in your own account.',
    '',
    filled,
    '',
  ].join('\n');
}

// ---- The host (gone) ----

// The HTTP status in `gh api -i`'s output, or in its error line ("(HTTP 404)"), or null.
export function statusOf(text) {
  const head = /^HTTP\/[\d.]+\s+(\d{3})/m.exec(text);
  if (head) return Number(head[1]);
  const err = /\(HTTP (\d{3})\)/.exec(text);
  return err ? Number(err[1]) : null;
}

function realRun(file, args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(file, args, { shell: false, windowsHide: true });
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: String(error.message) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// Whether owner/name is on the host, asked with the signed-in `gh`: a private repository answers
// 404 to anyone who can't see it, so a 404 counts only once `gh` says who it is signed in as, and
// only for a repository of that login's own (the run sheet names no organisation); any other
// owner's 404 is "can't tell".
export async function gone(args, { run = realRun, gh = 'gh', say = console.log } = {}) {
  const repo = args.find((a) => !a.startsWith('--') && a !== option(args, '--want'));
  const want = option(args, '--want') ?? 'absent';
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(String(repo)) || !['absent', 'present'].includes(want)) {
    throw new Error('Usage: gone <owner/name> [--want absent|present]');
  }
  const who = await run(gh, ['api', 'user', '--jq', '.login']);
  const login = who.stdout.trim();
  if (who.code !== 0 || login === '') {
    say(`gh is not signed in here, so a 404 would prove nothing: ${(who.stderr || who.stdout).trim().split('\n')[0] ?? ''}`);
    return { ok: false, status: null, login: null };
  }
  const got = await run(gh, ['api', '-i', `repos/${repo}`]);
  const status = statusOf(`${got.stdout}\n${got.stderr}`);
  // GitHub's logins are not case-sensitive.
  const own = repo.split('/')[0].toLowerCase() === login.toLowerCase();
  const absent = status === 404 && own;
  const ok = want === 'absent' ? absent : status === 200;
  const read = absent ? 'absent' : status === 200 ? 'present'
    : status === 404 ? `can't tell, as ${login} doesn't own it and may not see it` : 'unclear';
  say(`${repo}: HTTP ${status ?? 'unknown'} (asked as ${login}): ${read}; wanted ${want}: ${ok ? 'yes' : 'NO'}`);
  return { ok, status, login };
}

// ---- Windows: the cards' own times in a transcript (pure) ----

// For each AskUserQuestion call in a session's transcript entries: when it was asked (the
// assistant entry holding the call), when it was answered (the user entry holding its result), the
// time between, and its first question's words.
export function askedDurations(entries) {
  const calls = new Map();
  const out = [];
  for (const e of entries) {
    const content = e?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (e.type === 'assistant' && c?.type === 'tool_use' && c.name === 'AskUserQuestion') {
        calls.set(c.id, { askedAt: e.timestamp, question: c.input?.questions?.[0]?.question ?? null });
      } else if (e.type === 'user' && c?.type === 'tool_result' && calls.has(c.tool_use_id)) {
        const call = calls.get(c.tool_use_id);
        calls.delete(c.tool_use_id);
        out.push({ ...call, answeredAt: e.timestamp, directorMs: ms(e.timestamp) - ms(call.askedAt) });
      }
    }
  }
  return out;
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

// ---- Commands ----

export function setup(args) {
  const root = assertScratch(option(args, '--root') ?? (process.platform === 'win32' ? fs.mkdtempSync(path.join(os.tmpdir(), `${PREFIX}-`)) : SHARED_ROOT));
  fs.mkdirSync(root, { recursive: true });
  fs.copyFileSync(SELF, path.join(root, 'run.js'));
  const guide = path.join(path.dirname(SELF), 'run.md');
  if (fs.existsSync(guide)) fs.copyFileSync(guide, path.join(root, 'run.md'));
  const notes = path.join(root, 'notes.md');
  if (!fs.existsSync(notes)) fs.writeFileSync(notes, '# Check 19 notes\n\nThe timed run\'s results, appended as they are made (see run.md).\n\n## Starting point\n\n');
  // The folder is readable and writable by any account on this computer, so the throwaway account
  // can write its times here and the director's account can read them; of the files, only the
  // notes are writable by every account. The script the throwaway account runs, and this sheet,
  // are writable by the director's account alone. (The folder isn't sticky, so the director's
  // account can remove the throwaway account's files at the end; another account could still
  // replace a file by name, which is accepted for a folder that lasts one sitting.)
  if (process.platform !== 'win32') {
    fs.chmodSync(root, 0o777);
    for (const name of fs.readdirSync(root)) fs.chmodSync(path.join(root, name), name === 'notes.md' ? 0o666 : 0o644);
  }
  console.log(JSON.stringify({ root, notes }, null, 2));
}

function desktopNoteCommand(args) {
  const root = assertScratch(option(args, '--root') ?? SHARED_ROOT);
  const readme = option(args, '--readme') ?? path.resolve(path.dirname(SELF), '..', '..', 'README.md');
  const text = desktopNote(fs.readFileSync(readme, 'utf8'), option(args, '--tag'), { folderName: option(args, '--folder-name') ?? FOLDER_NAME });
  const file = path.join(root, 'Start here.txt');
  fs.writeFileSync(file, text, { mode: 0o644 });
  fs.chmodSync(file, 0o644);
  console.log(file);
}

function readRecords(dir, runId, keep) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const name of names) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (keep(r, runId)) out.push(r);
    } catch { /* not a record */ }
  }
  return out;
}

// Reads this account's setup records and writes the summary into the shared folder.
export function times(args, { env = process.env, home = os.homedir(), now = () => new Date(), say = console.log } = {}) {
  const root = assertScratch(option(args, '--root') ?? SHARED_ROOT);
  const wheelhouse = option(args, '--home') ?? env.WHEELHOUSE_HOME ?? path.join(home, '.wheelhouse');
  const journalPath = path.join(wheelhouse, 'setup', 'journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  const folder = option(args, '--folder');
  const run = pickRun(journal, folder, { real });
  if (run === null) throw new Error(`No setup run ${folder ? `for ${folder} ` : ''}in ${journalPath}`);
  const setupDir = path.join(wheelhouse, 'setup');
  const asked = readRecords(path.join(setupDir, 'asked'), run.id, (r, id) => r?.runId === id);
  const answers = readRecords(path.join(setupDir, 'answers'), run.id, (r, id) => r?.data?.action === 'setup-answer' && r.data.runId === id);
  const shown = readRecords(path.join(setupDir, 'shown'), run.id, (r, id) => r?.runId === id);
  const summary = summarise(run, { asked, answers });
  // This computer's id, so the agent can check afterwards that its enrolment left the profile.
  try { summary.computer = JSON.parse(fs.readFileSync(path.join(wheelhouse, 'computer.json'), 'utf8')).id ?? null; } catch { summary.computer = null; }
  // The times only: no answer's words, nothing from the changes but step 1's and step 10's times.
  fs.writeFileSync(path.join(root, 'times.json'), `${JSON.stringify({ summary, steps: run.steps }, null, 2)}\n`, { mode: 0o666 });
  // The cards as the director saw them, by step, for the Windows sitting's replay.
  const cards = [...shown.map((r) => ({ step: r.step, kind: 'go-ahead', at: r.at, card: r.card })), ...asked.map((r) => ({ step: r.step, kind: 'question', id: r.id, at: r.at, card: r.card }))]
    .sort((a, b) => a.step - b.step || ms(a.at) - ms(b.at));
  fs.writeFileSync(path.join(root, 'cards.json'), `${JSON.stringify(cards, null, 2)}\n`, { mode: 0o666 });
  fs.appendFileSync(path.join(root, 'notes.md'), `\n${notesSection(summary, { at: now().toISOString() })}`);
  say(notesSection(summary, { at: now().toISOString() }));
  return summary;
}

function askedCommand(args) {
  for (const file of args) {
    for (const d of askedDurations(readJsonl(file))) {
      console.log(`${d.askedAt} -> ${d.answeredAt}: ${minutes(d.directorMs)} min: ${String(d.question ?? '').slice(0, 80)}`);
    }
  }
}

function cardsCommand(args) {
  const file = args.find((a) => !a.startsWith('--') && a !== option(args, '--steps'));
  const steps = (option(args, '--steps') ?? '2,4,6,9').split(',').map(Number);
  const cards = JSON.parse(fs.readFileSync(file, 'utf8')).filter((c) => steps.includes(c.step));
  console.log(JSON.stringify(cards, null, 2));
}

function cleanup(args) {
  const root = assertScratch(args[0]);
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`removed ${root}`);
}

const [command, ...rest] = process.argv.slice(2);
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(SELF)) {
  const commands = { setup, 'desktop-note': desktopNoteCommand, times, gone, asked: askedCommand, cards: cardsCommand, cleanup };
  if (!commands[command]) {
    console.error('Usage: node run.js setup | desktop-note --tag <tag> | times | gone <owner/name> | asked <transcript> | cards <cards.json> | cleanup <root>');
    process.exit(2);
  }
  try {
    const got = await commands[command](rest);
    if (command === 'gone' && !got.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
