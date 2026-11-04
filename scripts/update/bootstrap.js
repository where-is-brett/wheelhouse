// scripts/update/bootstrap.js
// The one update a computer on v0.2.6 or earlier makes from Terminal (update design, section 13), run by the director's own hand:
//   node ~/.wheelhouse/update/bootstrap/<tag>/scripts/update/cli.js bootstrap "$PWD"
// Such a computer has no update command and a helper that cannot run the job, so the order is turned round, once: the checks
// of the tag, the director's typed answer, the install on this computer, the second half (finish.js, spawned from the new
// release's cache folder: the hand-over to the new helper), and only then the project's reviewed change, opened through the
// new helper. A change that is refused or closed puts the computer back to the release it had.
//
// Why a typed answer stands in for the click. Every other update needs the director's signed click on the Update card, which
// proves a person chose it. Here nothing is signed yet (the old helper has no such record), so the proof is the terminal
// itself: the answer is read from the process's own standard input, which must be a real terminal. An agent's command has its
// input piped or closed, never a terminal of the director's, so it can neither type the answer nor pipe it in; with no
// terminal this refuses before it reads or changes anything.
//
// Second line of defence: it also refuses when the environment shows a Claude Code or Wheelhouse session (SESSION_MARKERS). The hooks
// refuse `cli.js bootstrap` in an agent session too, but none of this is a full guarantee: a process that strips its own
// environment and fakes a terminal could still type the answer. The real protection is that the director pastes this themselves.
//
// The install and the hand-over go through the same job (runJob) as any update, under the update lock, so finish.js's own
// conditions hold: the journal's finish step is running under a live lock, and it runs from the cache folder of the tag.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { helperClient } from '../host/helper-client.js';
import { claudeHome as defaultClaudeHome } from '../lineage/manifest.js';
import { projectForFolder } from '../lib/projects.js';
import { run as defaultRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';
import { openJournal } from './journal.js';
import { updateMirror, namedRef, readSettings } from './change.js';
import { checksOutLine } from './plan.js';
import { putBack } from './install.js';
import { accountCatalogue } from './account-settings.js';
import { runJob } from './job.js';
import { startFresh, updateSteps } from './run.js';
import { checkTarget, fetchTag } from './release.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASK_TRIES = 5;
export const SESSION_MARKERS = Object.freeze(['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_PROJECT_DIR', 'WHEELHOUSE_SESSION', 'WHEELHOUSE_AGENT']);
export const IN_SESSION = 'Bootstrap is for you to run yourself in Terminal, outside Claude Code, so it will not run inside a session.';
export const inSession = (env) => SESSION_MARKERS.some((name) => typeof env?.[name] === 'string' && env[name] !== '');

export const NO_TERMINAL = 'Bootstrap asks you to type 1 or 2, so it has to be run by you in Terminal (PowerShell on Windows), not by an agent.';
export const NOT_A_PROJECT = 'That folder is not a Wheelhouse project on this computer. Run this in your project\'s folder.';
export const NOT_NOW_LINE = 'Nothing was changed.';
const CHOICE = 'Type 1 to update or 2 for not now: ';

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

// What the folder this script runs from is: the tag (plugin.json's version) and its commit.
async function cloneTag({ root, run }) {
  const version = readJson(path.join(root, '.claude-plugin', 'plugin.json'))?.version;
  // Through the fenced route, never reading the clone's own configuration (it is only the folder the paste fetched).
  const fenced = safeGit({ run, cwd: root, look: 'never' });
  const got = await fenced(['rev-parse', 'HEAD'], { input: '' });
  const sha = got.code === 0 ? got.stdout.trim() : null;
  return typeof version === 'string' && /^[0-9a-f]{40}$/.test(sha ?? '') ? { tag: `v${version}`, sha } : null;
}

// The default `ask`: one line from standard input, which must be a terminal. Gives null for anything else.
export function terminalAsk({ stdin = process.stdin, stdout = process.stdout } = {}) {
  if (stdin?.isTTY !== true) return null;
  const lines = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  let ended = false;
  lines.once('close', () => { ended = true; });
  const ask = (prompt) => new Promise((resolve) => {
    if (ended) { resolve(null); return; }
    lines.once('close', () => resolve(null));
    lines.question(prompt, (text) => resolve(text));
  });
  ask.close = () => lines.close();
  return ask;
}

// Runs the bootstrap. `ask(prompt)` resolves the typed text, or null when the input ended. `say(text)` shows a line.
// Resolves { ok, line }. The seams are those of updateSteps (through `steps`), so a test touches no real computer.
export async function bootstrap({
  projectDir, ask, say = () => {}, root = PLUGIN_ROOT, run = defaultRun, claudeHome = defaultClaudeHome(), mirror = updateMirror(),
  client, project, from = null, journal, steps: over = {}, putBackRun = putBack, env = process.env,
}) {
  const stop = (line) => ({ ok: false, line });
  if (inSession(env)) return stop(IN_SESSION);
  if (typeof ask !== 'function') return stop(NO_TERMINAL);
  const placed = project ?? projectForFolder(projectDir)?.project;
  if (typeof placed !== 'string') return stop(NOT_A_PROJECT);
  const named = await cloneTag({ root, run });
  if (named === null) return stop('This folder is not a Wheelhouse release, so nothing was changed.');
  const { tag, sha } = named;
  const target = { tag, sha };
  // The release the project's settings name now, before anything changes: the move the card and the journal record start from.
  from ??= namedRef(readSettings(projectDir));

  // 1. The checks, before anything is asked or changed.
  const fetch = over.fetch ?? ((t) => fetchTag({ ref: t, run, mirror }));
  const check = over.check ?? ((t) => checkTarget({ ...t, run, mirror }));
  const fetched = await fetch(tag);
  if (fetched?.ok !== true || fetched.sha !== sha) return stop(`${checksOutLine(tag)} ${NOT_NOW_LINE}`);
  const looked = await check(target);
  if (looked?.ok !== true) return stop(`${checksOutLine(tag)} ${NOT_NOW_LINE}`);

  const account = accountCatalogue({ claudeHome });
  if (account?.refused) return stop(`${account.refused} ${NOT_NOW_LINE}`);
  const moved = typeof account?.ref === 'string' && account.ref !== tag ? { from: account.ref, to: tag } : null;

  // 2. The card as plain text, and the typed answer.
  say(`Update Wheelhouse${from ? ` · ${from} → ${tag}` : ` to ${tag}`}`);
  say(looked.says ? `What's new: ${looked.says}` : 'No summary was given for this release.');
  say('What happens: this computer installs it and hands over to the new helper, then your project gets a small reviewed change naming it. About five minutes.');
  if (moved) say(`Your account settings name Wheelhouse at ${moved.from}; the update changes that one entry to ${moved.to}.`);
  say('1  Update');
  say('2  Not now');
  let choice = null;
  for (let tries = 0; tries < ASK_TRIES && choice === null; tries += 1) {
    const typed = await ask(CHOICE);
    if (typed === null || typed === undefined) return stop(`No answer was given. ${NOT_NOW_LINE}`);
    const text = String(typed).trim();
    if (text === '1' || text === '2') choice = text;
    else say('Please type 1 or 2.');
  }
  if (choice === null) return stop(`No answer was given. ${NOT_NOW_LINE}`);
  if (choice === '2') return { ok: false, declined: true, line: `Not now. ${NOT_NOW_LINE}` };

  // 3. The job, in the turned-round order, under the update lock.
  const jour = journal ?? openJournal(placed);
  const release = jour.lock();
  if (!release) return stop('An update is already under way on this computer.');
  try {
    startFresh(jour);
    const plan = { from, to: tag, sha, put: 'release', approval: 'review', carryOn: false, account: moved };
    const helper = client ?? helperClient({ timeout: 5 * 60 * 1000 });
    const all = updateSteps({ project: placed, folder: projectDir, plan, client: helper, claudeHome, mirror, run, ...over });
    const by = Object.fromEntries(all.map((s) => [s.name, s]));
    const ordered = ['checks', 'installs', 'finish', 'change', 'merged', 'idle', 'done'].map((n) => by[n]);
    // The lock is held here for the whole job; runJob's own take of it is a no-op.
    const held = { ...jour, lock: () => () => {} };
    const got = await runJob({ project: placed, target: tag, steps: ordered, journal: held });
    if (got.ok) return { ok: true, line: jour.read().steps.done?.data?.line ?? `Wheelhouse ${tag} is installed.` };
    if (got.step === 'merged' && got.waiting === true) {
      return { ok: true, waiting: true, line: `This computer has ${tag}; the change naming it for your project is waiting to be merged. Type /wheelhouse:update in a new session to carry on.` };
    }
    if (got.step === 'change' || got.step === 'merged') {
      const back = await putBackRun({ journal: jour, run, projectDir, claudeHome });
      // The job's own closed line says nothing was installed, which is not so here: the install came first.
      const why = got.step === 'merged' ? `The change naming ${tag} was closed without being merged.` : got.line;
      return stop(`${why} ${back.line}`);
    }
    return stop(got.line);
  } finally {
    release();
  }
}
