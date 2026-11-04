// scripts/update/run.js
// The update's first half, run by the helper's /update/apply in a process of its own:
//   node <installed folder>/scripts/update/run.js <project> <folder>
// (update design, section 6). It takes the one update lock and holds it from the checks to the end, so a second update is
// refused and the helper accepts the retire for the update only while it stands. It reads the plan the director's card showed
// (plan.json in the journal's folder), runs the steps of the journal in order, and, while the job waits for the merge, for
// work in progress or for the director's answer, asks again every half minute. The second half, the new version's own
// finish.js, is started as a process of its own from the new plugin folder, and its one line of JSON is read here.
// Every outside thing is a seam, so a test starts no process and reaches no network.
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { caEnv } from '../host/company-ca.js';
import { helperClient } from '../host/helper-client.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { stopState } from '../lib/stop.js';
import { wheelhouseHome } from '../lib/paths.js';
import { run as defaultRun } from '../lib/run.js';
import { MARKETPLACE, claudeHome as defaultClaudeHome } from '../lineage/manifest.js';
import { changeSteps, updateMirror } from './change.js';
import { helperCardFor, releaseCard } from './cards.js';
import { ASKING_LINE } from './finish.js';
import { installRelease } from './install.js';
import { runJob } from './job.js';
import { openJournal } from './journal.js';
import { openReleaseChange } from './open.js';
import { checksOutLine } from './plan.js';
import { checkTarget, fetchTag } from './release.js';

export const POLL_MS = 30 * 1000;
export const MOST_WAIT_MS = 12 * 60 * 60 * 1000;
export const FINISH_MS = 15 * 60 * 1000;
export const STOPPED_LINE = 'All stop is on, so nothing is installed. Lift All stop and the update carries on.';
const RAISE_TRIES = 24;
const RAISE_EVERY_MS = 10 * 1000;

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

// Puts a composed card in the project's state, once: a card with the same set line there already is left as it is. A helper that
// is making way for the update refuses writes for a short while, so a refusal is tried again.
export async function raiseCard({ client, project, composed, sleep = pause, tries = RAISE_TRIES, every = RAISE_EVERY_MS }) {
  let last = 'the card could not be raised';
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const seen = await client.state.views({ project, cards: true });
    if (seen?.ok === true) {
      if ((seen.cards ?? []).some((e) => e?.data?.line === composed.card.line)) return true;
      const made = await client.state.write({ project, kind: 'card', data: composed.card });
      if (made?.ok === true) return true;
      last = made?.refused ?? last;
    } else {
      last = seen?.refused ?? last;
    }
    if (attempt < tries - 1) await sleep(every);
  }
  throw new Error(last);
}

// Clears an earlier update's records, so a new one starts from a blank journal. The plan the card showed stays.
export function startFresh(journal) {
  for (const name of ['journal.json', 'finish.json', 'install.json', 'confirmed.json']) fs.rmSync(path.join(journal.folder, name), { force: true });
  fs.rmSync(path.join(journal.folder, 'backup'), { recursive: true, force: true });
}

// The last line of a process's output that reads as a JSON object.
export function lastJson(text) {
  for (const line of String(text ?? '').split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* not this line */ }
  }
  return null;
}

// The second half: `node <script> <project>`, from the new release's own plugin folder. Resolves { code, stdout }.
export function spawnFinish({ script, project, spawn = nodeSpawn, timeoutMs = FINISH_MS }) {
  return new Promise((resolve) => {
    let stdout = '';
    let done = false;
    const end = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout });
    };
    let child;
    try {
      child = spawn(process.execPath, [script, project], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, env: { ...process.env, ...caEnv(wheelhouseHome()) } });
    } catch {
      resolve({ code: null, stdout: '' });
      return;
    }
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.on('error', () => end(null));
    child.on('close', end);
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } end(null); }, timeoutMs);
    timer.unref?.();
  });
}

// The steps of the job, in the journal's order. `plan` is what the card showed: { from, to, sha, put }.
export function updateSteps({
  project, folder, plan, client, run = defaultRun, stopped = () => stopState().on, claudeHome = defaultClaudeHome(), mirror = updateMirror(),
  fetch = (tag) => fetchTag({ ref: tag, run, mirror }), check = ({ tag, sha }) => checkTarget({ tag, sha, run, mirror }),
  install = (args) => installRelease({ run, ...args }), finishRun = spawnFinish, raise = (composed) => raiseCard({ client, project, composed }),
  features = async () => (await client.state.views({ project }))?.views?.features, spawn,
}) {
  const target = { tag: plan.to, sha: plan.sha };
  const put = plan.put === 'undo' ? 'undo' : 'release';
  const previous = put === 'undo' ? { ref: plan.to, sha: plan.sha } : null;
  const mine = changeSteps({
    projectDir: folder,
    target,
    previous,
    put,
    run,
    mirror,
    stopped,
    features,
    open: (request) => openReleaseChange({ project, projectDir: folder, client, run, ...request }),
    raise: (card) => raise(releaseCard({ previous: card.previous, release: card.release, commit: card.commit })),
    prState: async (number) => {
      const got = await client.prState({ project, number });
      if (got?.ok === false) throw new Error(got.refused ?? 'the change could not be read');
      return got;
    },
  });
  return [
    {
      name: 'checks',
      async run() {
        if (stopped()) return { ok: false, waiting: true, line: STOPPED_LINE };
        const fetched = await fetch(plan.to);
        if (fetched?.ok !== true || fetched.sha !== plan.sha) return { ok: false, line: checksOutLine(plan.to) };
        const looked = await check(target);
        if (looked?.ok !== true) return { ok: false, line: checksOutLine(plan.to) };
        return { data: { tag: plan.to, sha: plan.sha, from: plan.from, put } };
      },
    },
    ...mine,
    {
      name: 'installs',
      async run({ journal }) {
        if (stopped()) return { ok: false, waiting: true, line: STOPPED_LINE };
        const got = await install({ project, target, journal, projectDir: folder, claudeHome, accountNamed: plan.account ?? null });
        return got.ok ? { data: { line: got.line } } : { ok: false, line: got.line };
      },
    },
    {
      name: 'finish',
      async run() {
        const script = path.join(claudeHome, 'plugins', 'cache', MARKETPLACE, 'wheelhouse', plan.to.replace(/^v/, ''), 'scripts', 'update', 'finish.js');
        if (!fs.existsSync(script)) return { ok: false, line: `Wheelhouse ${plan.to} is installed, but its own folder for finishing the update was not found, so the refreshes were not made. Type /wheelhouse:update to try again.` };
        const out = await finishRun({ script, project, ...(spawn === undefined ? {} : { spawn }) });
        const said = lastJson(out.stdout);
        if (said === null) return { ok: false, line: 'The second half of the update did not answer. Type /wheelhouse:update to try again.' };
        if (said.ok === true) return { data: { line: said.line } };
        if (Array.isArray(said.asks) && said.asks.length > 0) {
          for (const card of said.asks) await raise(helperCardFor(card));
          return { ok: false, waiting: true, line: said.line ?? ASKING_LINE };
        }
        return { ok: false, line: said.line ?? 'The second half of the update did not finish.' };
      },
    },
    {
      name: 'done',
      async run({ data }) {
        return { data: { line: data.finish?.line ?? `Wheelhouse ${plan.to} is installed. Start a new session on this folder to use it.` } };
      },
    },
  ];
}

// Runs the update to its end, holding the update lock throughout and asking again while a step waits. Resolves
// { ok, step, line }. `plan` carries `carryOn: true` for an update part-way, whose journal is kept.
export async function runUpdate({
  project, plan, steps, journal = openJournal(project), poll = POLL_MS, mostMs = MOST_WAIT_MS, now = Date.now, sleep = pause,
}) {
  const release = journal.lock();
  if (!release) return { ok: false, step: null, line: 'An update is already under way on this computer.' };
  try {
    const read = journal.read();
    if (!read.newer && (plan.carryOn !== true || read.steps.done?.state === 'done')) startFresh(journal);
    // The lock is held here for the whole update; the job's own take of it is a no-op.
    const held = { ...journal, lock: () => () => {} };
    const end = now() + mostMs;
    for (;;) {
      const got = await runJob({ project, target: plan.to, steps, journal: held });
      if (got.ok || got.waiting !== true) return got;
      if (now() >= end) return { ...got, line: `${got.line} Type /wheelhouse:update to carry on.` };
      await sleep(poll);
    }
  } finally {
    release();
  }
}

export async function main(argv, deps = {}) {
  const [project, folder, ...rest] = argv;
  if (typeof project !== 'string' || typeof folder !== 'string' || rest.length > 0) return 1;
  try {
    const journal = openJournal(project);
    const stored = readJson(path.join(journal.folder, 'plan.json'));
    if (!stored?.plan || stored.project !== project) return 1;
    const client = deps.client ?? helperClient({ timeout: 5 * 60 * 1000 });
    const steps = updateSteps({ project, folder, plan: stored.plan, client, ...deps.steps });
    const got = await runUpdate({ project, plan: stored.plan, steps, journal, ...deps.run });
    return got.ok ? 0 : 1;
  } catch {
    return 1;
  }
}

if (startedAsScript(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
