// scripts/watcher/resume.js
// Crash resume for feature sessions (core cut design, section 4.3). A feature session whose process has gone without
// writing its report is lost: it died mid-step, and nothing else would notice until something woke it. The watcher
// looks for lost sessions when it starts and on each tick, and starts each one again by its session id, telling it to
// carry on and naming the plan's ticked tasks and the branch's commits, so it knows which steps are done. It counts the
// resumes on disk: a piece that stops three times is not started again, and the director gets one card instead.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SLUG } from '../lib/build-loop.js';
import { safeGit } from '../lib/safe-git.js';
import { featurePaths } from '../feature/files.js';
import { planIn, readBrief, readCapped, readPlan } from '../feature/status.js';
import {
  lostFile, pidAlive, sessionFile, watcherDir, watcherFolder, writeJsonFile,
} from './waker.js';

// How many times a piece may stop before it becomes a card instead of being started again.
export const RESUME_LIMIT = 3;
// The first line of every resume prompt.
export const CARRY_ON = "Carry on from what's there.";

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x.trim() !== '';
const SMALL = 64 * 1024;
// How many of a prompt's ticked tasks and commits are named, and how long each may be.
const LISTED = 60;
const LINE = 200;
// How many runs per piece are remembered as counted.
const SEEN = 20;
const TRY_AGAIN = 'Try again';
const SET_ASIDE = 'Set it aside';

const resumesFile = (project) => path.join(watcherDir(project), 'resumes.json');
const lostDir = (project) => path.join(watcherDir(project), 'lost');
const runningDir = (project) => path.join(watcherDir(project), 'running');

function readJson(file) {
  try {
    return JSON.parse(readCapped(file, SMALL) ?? 'null');
  } catch {
    return null;
  }
}

function names(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

const isDir = (dir) => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

// One read-only git call in `cwd` by the shared route: its trimmed output, or null when git fails or can't be run.
async function gitText(cwd, args) {
  try {
    const got = await safeGit({
      cwd, look: 'never', list: 'project', timeoutMs: 10000, env: { GIT_OPTIONAL_LOCKS: '0' },
    })(args);
    return got.code === 0 ? String(got.stdout ?? '').trim() : null;
  } catch {
    return null;
  }
}

const dropMarker = (project, work) => fs.rmSync(lostFile(project, work), { force: true });

// The feature sessions whose process has gone and that wrote no report: `[{ work, sessionId, branch, worktree, runAt }]`.
// A running record is gone when its process id no longer runs, or when it began before the computer last started (the
// id may since belong to another process); a lost marker is what the waker leaves for a session that died while it
// watched. `runAt` is when the lost run began, so one death is counted once.
export async function findLostSessions({
  project, now = () => new Date(), alive = pidAlive, bootAt = now().getTime() - os.uptime() * 1000,
}) {
  const found = new Map();
  const live = new Set();
  for (const name of names(runningDir(project))) {
    if (!name.startsWith('feature-') || !name.endsWith('.json')) continue;
    const work = name.slice('feature-'.length, -'.json'.length);
    if (!SLUG.test(work)) continue;
    const r = readJson(path.join(runningDir(project), name));
    if (!isPlain(r) || r.state !== 'running' || !Number.isInteger(r.pid) || !isText(r.at)) continue;
    const before = Number.isFinite(Date.parse(r.at)) && Date.parse(r.at) < bootAt;
    if (alive(r.pid) && !before) live.add(work);
    else found.set(work, r.at);
  }
  for (const name of names(lostDir(project))) {
    if (!name.endsWith('.json')) continue;
    const work = name.slice(0, -'.json'.length);
    if (!SLUG.test(work)) continue;
    const m = readJson(path.join(lostDir(project), name));
    if (live.has(work)) {
      dropMarker(project, work);
      continue;
    }
    if (!found.has(work) && isPlain(m) && isText(m.at)) found.set(work, m.at);
  }
  const out = [];
  for (const [work, runAt] of found) {
    const s = readJson(sessionFile(project, work));
    if (!isPlain(s) || !isText(s.sessionId) || !isText(s.worktree) || !isDir(s.worktree)) continue;
    if (fs.existsSync(featurePaths(s.worktree).report)) {
      dropMarker(project, work);
      continue;
    }
    const branch = await gitText(s.worktree, ['rev-parse', '--abbrev-ref', 'HEAD']);
    out.push({
      work, sessionId: s.sessionId, branch: branch || null, worktree: s.worktree, runAt,
    });
  }
  return out.sort((a, b) => a.work.localeCompare(b.work));
}

const clip = (s) => (s.length > LINE ? `${s.slice(0, LINE - 1)}…` : s);

// The plan's ticked tasks (`- [x] ...` lines outside code blocks), in order.
export function tickedTasks(worktree) {
  let brief = {};
  try {
    brief = readBrief(worktree);
  } catch { /* the plan may be recorded in plan.json alone */ }
  const plan = planIn(worktree, brief);
  const text = plan === null ? null : readPlan(worktree, plan);
  const out = [];
  let fence = null;
  for (const line of (text ?? '').split(/\r?\n/)) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = /^\s*[-*+]\s+\[[xX]\]\s+(.+?)\s*$/.exec(line);
    if (m) out.push(clip(m[1]));
  }
  return out;
}

// The subjects of the branch's commits since it left its base, oldest first.
export async function branchCommits(worktree) {
  for (const base of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
    const fork = await gitText(worktree, ['merge-base', base, 'HEAD']);
    if (!fork) continue;
    const log = await gitText(worktree, ['log', '--reverse', '--format=%s', `${fork}..HEAD`]);
    if (log === null) continue;
    return log.split('\n').map((s) => s.trim()).filter(Boolean).map(clip);
  }
  return [];
}

const listed = (items) => (items.length > LISTED ? [...items.slice(0, LISTED), `…and ${items.length - LISTED} more`] : items);

// The prompt a lost session is started again with.
export function resumePrompt({ ticked, commits }) {
  const parts = [CARRY_ON];
  if (ticked.length > 0) parts.push(`Ticked in the plan already:\n${listed(ticked).map((t) => `- ${t}`).join('\n')}`);
  if (commits.length > 0) parts.push(`Commits on the branch so far:\n${listed(commits).map((c) => `- ${c}`).join('\n')}`);
  return parts.join('\n\n');
}

function readResumes(project) {
  const kept = readJson(resumesFile(project));
  return isPlain(kept) ? kept : {};
}

function writeResumes(project, all) {
  watcherFolder(project);
  writeJsonFile(resumesFile(project), all);
}

function entryOf(all, work) {
  const e = isPlain(all[work]) ? all[work] : {};
  return {
    count: Number.isInteger(e.count) && e.count >= 0 ? e.count : 0,
    seen: Array.isArray(e.seen) ? e.seen.filter(isText) : [],
    carded: e.carded === true,
    aside: e.aside === true,
    used: Array.isArray(e.used) ? e.used.filter(isText) : [],
  };
}

// The card for a piece that stopped RESUME_LIMIT times. It is a plain question card the helper keeps: the director's
// click writes a card-answer naming its question, which resumeLost reads back.
export function stoppedCard(work) {
  const ask = `${work} stopped three times. Start it again?`;
  const what = `The session building ${work} stopped three times before finishing, and was started again by itself after the first two.`;
  const why = 'A piece is started again by itself twice; a third stop suggests something in it keeps ending the session.';
  const meanwhile = `${work} waits, and its work so far stays on its branch. Nothing else is held up.`;
  const says = {
    [TRY_AGAIN]: 'Start it again from where it got to, with a fresh count of three.',
    [SET_ASIDE]: 'Leave it stopped; its work so far stays on its branch.',
  };
  const options = [TRY_AGAIN, SET_ASIDE];
  const because = 'a stop is often passing, and the piece carries on from its last commit';
  return {
    question: [ask, what, why, meanwhile].join('\n'),
    header: 'Stopped',
    kind: 'question',
    level: 2,
    options,
    descriptions: options.map((o) => (o === TRY_AGAIN ? `Recommended: ${says[o]}` : says[o])),
    recommend: TRY_AGAIN,
    line: null,
    code: null,
    parts: {
      kind: 'question',
      header: 'Stopped',
      ask,
      what,
      small: why,
      recommendation: `${TRY_AGAIN}, because ${because}.`,
      options: options.map((o) => ({ label: o, says: says[o], recommended: o === TRY_AGAIN })),
      why,
      meanwhile,
      line: null,
      code: null,
    },
  };
}

const sameQuestion = (question) => (e) => e?.data?.question === question;

// Starts each lost session again, or raises its card. Returns `[{ work, outcome }]`, where outcome is 'resumed' (started
// again), 'card' (it stopped RESUME_LIMIT times: its card is up, and it is not started), 'aside' (the director set it
// aside) or 'held' (the waker could not start it now: STOP, its work paused, or another engine's shape; it is not
// counted and is tried at the next tick). A run already counted and started again gives nothing. `resume({ work,
// prompt })` is the waker's resumeFeature. `record({ kind, work, at, key })` takes each death as the engine's reliability
// record: `resumed` when the piece was started again, `lost` when it stopped RESUME_LIMIT times and its card went up
// (scripts/watcher/reliability.js).
export async function resumeLost({
  project, lost, now = () => new Date(), resume, client, log = () => {}, record = () => {},
}) {
  const all = readResumes(project);
  const out = [];
  let cardsSeen = null;
  const views = async () => {
    if (cardsSeen === null) {
      const v = await client.state.views({ project, cards: true, answers: true });
      if (v?.ok !== true) throw new Error(v?.refused ?? "the state's cards can't be read");
      cardsSeen = { cards: Array.isArray(v.cards) ? [...v.cards] : [], answers: Array.isArray(v.answers) ? [...v.answers] : [] };
    }
    return cardsSeen;
  };
  const note = (kind, work, runAt) => {
    try {
      record({ kind, work, at: now().toISOString(), key: `${kind}:${project}:${work}:${runAt}` });
    } catch (error) {
      log(`The ${kind} piece ${work} couldn't be recorded: ${error.message}`);
    }
  };
  const save = (work, e) => {
    all[work] = { ...e, seen: e.seen.slice(-SEEN), at: now().toISOString() };
    writeResumes(project, all);
  };

  for (const l of lost) {
    const { work, runAt } = l;
    const e = entryOf(all, work);
    if (e.aside) {
      out.push({ work, outcome: 'aside' });
      continue;
    }
    let again = false;
    if (e.carded) {
      const question = stoppedCard(work).question;
      let answer;
      try {
        answer = (await views()).answers.find((a) => sameQuestion(question)(a) && isText(a.id) && !e.used.includes(a.id));
      } catch (error) {
        log(`The card for ${work} can't be read: ${error.message}`);
      }
      if (!answer) {
        if (!e.seen.includes(runAt)) save(work, { ...e, seen: [...e.seen, runAt] });
        out.push({ work, outcome: 'card' });
        continue;
      }
      e.used = [...e.used, answer.id];
      e.carded = false;
      if (answer.data.label !== TRY_AGAIN) {
        e.aside = true;
        save(work, e);
        out.push({ work, outcome: 'aside' });
        continue;
      }
      e.count = 0;
      again = true;
    }
    const fresh = !e.seen.includes(runAt);
    if (!fresh && !again) continue;
    const before = { ...e };
    if (fresh) {
      e.seen = [...e.seen, runAt];
      if (!again) e.count += 1;
    }
    if (e.count >= RESUME_LIMIT) {
      try {
        const card = stoppedCard(work);
        const seen = await views();
        const open = seen.cards.filter(sameQuestion(card.question)).length > seen.answers.filter(sameQuestion(card.question)).length;
        if (!open) {
          const made = await client.state.write({ project, kind: 'card', data: card });
          if (made?.ok !== true) throw new Error(made?.refused ?? 'the card was refused');
          seen.cards.push({ kind: 'card', data: card });
        }
        // Answers given before this card belong to earlier ones.
        e.used = [...new Set([...e.used, ...seen.answers.filter(sameQuestion(card.question)).map((a) => a.id).filter(isText)])];
        e.carded = true;
        save(work, e);
        note('lost', work, runAt);
        out.push({ work, outcome: 'card' });
      } catch (error) {
        log(`The card for ${work}, which stopped ${RESUME_LIMIT} times, can't be raised: ${error.message}`);
        save(work, { ...before, used: e.used });
        out.push({ work, outcome: 'held' });
      }
      continue;
    }
    const prompt = resumePrompt({ ticked: tickedTasks(l.worktree), commits: await branchCommits(l.worktree) });
    let started = null;
    try {
      started = await resume({ work, prompt });
    } catch (error) {
      log(`${work} can't be started again now: ${error.message}`);
    }
    if (started === null || started?.skipped === true) {
      save(work, { ...before, used: e.used, carded: e.carded });
      out.push({ work, outcome: 'held' });
      continue;
    }
    save(work, e);
    dropMarker(project, work);
    note('resumed', work, runAt);
    out.push({ work, outcome: 'resumed' });
  }
  return out;
}
